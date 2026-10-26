// End-to-end HTTP -> C/HDL -> SPI regression. No external packages.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const server=spawn(process.execPath,['server.js'],{cwd:__dirname,env:process.env});
let checks=0,started=false;
function check(condition,label){assert.ok(condition,label);checks++;console.log('PASS '+label);}
server.stderr.on('data',d=>process.stderr.write(d));
server.on('exit',code=>{if(!started){console.error('Server exited before ready: '+code);process.exitCode=1;}});
server.stdout.on('data',async chunk=>{
 if(started||!chunk.toString().includes('Corei3 ready'))return;started=true;
 const base='http://127.0.0.1:8080';
 async function post(endpoint,body){const r=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
 try{
  const first=await post('/api/session',{});const session=first.session;
  const act=async body=>(await post('/api/action',{session,...body})).state;
  const reset=async(input=10)=>act({action:'reset',input});
  const set=async masks=>act({action:'set',input:10,masks});
  let s=first.state;
  check(s.voted===10&&s.l3Output===10&&!s.l2Safe&&!s.l3Safe,'initial direct-input state');
  for(const masks of [[1,0,0],[0,1,0],[0,0,1],[15,0,0]]){s=await set(masks);check(s.voted===10&&!s.l3Safe&&s.crossCheck,'single-path injection '+masks);}
  s=await set([1,2,0]);check(s.ambiguous&&!s.l3Safe&&s.voted===10,'split faults correct despite all words differing');
  s=await set([1,1,0]);check(s.voted===11&&!s.l2Safe&&s.l3Safe&&s.l3Output===0&&s.parityFault,'wrong majority: Level 2 normal / Level 3 parity fallback');
  s=await act({action:'spi',address:4});check((s.spiValue&37)===37,'fault flags read through real HDL SPI');
  s=await set([0,0,0]);check(s.voted===10&&s.l3Safe&&!s.parityFault,'clear faults retains sticky safe mode');
  s=await reset();check(s.l3Output===10&&!s.l3Safe&&s.mismatchEvents===0,'controlled reset clears safety and history');
  s=await set([1,1,1]);check(!s.mismatch&&s.parityFault&&s.l3Safe,'common odd-bit corruption caught by independent parity');
  await reset();s=await set([3,3,0]);check(s.voted===9&&!s.c.correct&&!s.parityFault&&!s.l3Safe,'even-bit parity blind spot explicitly exposed');
  await reset();await act({action:'heartbeat',enabled:false});s=await act({action:'advance',ticks:8});check(!s.l2Safe&&s.elapsed<64,'no premature watchdog timeout');
  s=await act({action:'advance',ticks:64});check(s.timeout&&s.l2Safe&&s.l3Safe&&s.l2Output===0&&s.l3Output===0,'hang activates both hardware supervisors');
  s=await act({action:'spi',address:4});check((s.spiValue&3)===3,'SPI responsive during processor hang');
  s=await act({action:'spi',address:28});check(s.spiValue===64&&s.elapsed===64,'elapsed counter saturates at timeout');
  s=await act({action:'heartbeat',enabled:true});check(s.l2Safe&&s.l3Safe,'heartbeat restart cannot clear safety');
  s=await reset();check(!s.l3Safe&&s.heartbeatEnabled,'reset restores heartbeat and output');
  s=await act({action:'integrity',enabled:true});check(s.l2Safe&&s.l3Safe&&s.integrity2&&s.integrity3,'external integrity alarm activates both supervisors');
  s=await act({action:'integrity',enabled:false});check(s.l2Safe&&s.l3Safe,'integrity alarm safety is sticky');
  for(const input of [0,1,10,255]){s=await reset(input);check(s.voted===input&&s.c.expected===input&&!s.l3Safe,'direct-input boundary '+input);}
  await reset();
  const expected=new Map([[0,0x43334933],[4,0],[8,0],[12,0],[16,0],[20,0x0a0a0a0a],[24,10],[32,0],[36,64],[40,0x10000],[255,0xdeadbeef]]);
  for(const [address,value]of expected){s=await act({action:'spi',address});check(s.spiValue===value,'SPI register '+address+' correct');}
  const other=await post('/api/session',{});await act({action:'integrity',enabled:true});
  const independent=(await post('/api/action',{session:other.session,action:'advance',ticks:8})).state;
  check(!independent.l3Safe,'browser sessions are isolated');
  for(const body of [{action:'set',input:-1,masks:[0,0,0]},{action:'set',input:256,masks:[0,0,0]},{action:'set',input:1.5,masks:[0,0,0]},{action:'set',input:10,masks:[0,256,0]},{action:'advance',ticks:0},{action:'spi',address:256},{action:'heartbeat',enabled:'false'},{action:'unknown'}]){
   const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})});check(r.status===400,'invalid parameter rejected '+JSON.stringify(body));
  }
  const badOrigin=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'});check(badOrigin.status===403,'cross-origin mutation rejected');
  for(const file of ['/','/app.js','/style.css','/architecture']){const r=await fetch(base+file);check(r.status===200,'local asset served '+file);}
  const tests=await post('/api/verify',{});check(tests.passed&&tests.results.length===3,'all C and HDL suites execute through dashboard API');
  for(const t of tests.results)console.log('\n'+t.name+'\n'+t.output);
  console.log('\nINTEGRATION PASS: '+checks+' checks, zero failures.');
 }catch(e){console.error(e);process.exitCode=1;}finally{server.kill();}
});
