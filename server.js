'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const root=__dirname, bin=path.join(root,'build');fs.mkdirSync(bin,{recursive:true});
if(process.platform==='win32' && fs.existsSync('D:\\iverilog\\bin'))process.env.PATH='D:\\iverilog\\bin;'+process.env.PATH;
const gcc=process.env.COREI3_GCC||'gcc', iv=process.env.COREI3_IVERILOG||'iverilog',vvp=process.env.COREI3_VVP||'vvp';
const ivFlags=process.env.COREI3_IVL_BASE?['-B',process.env.COREI3_IVL_BASE]:[];
const rtl=['tmr_voter.v','watchdog.v','supervisor.v','spi_register_reader.v','telemetry_supervisor.v'].map(f=>path.join(root,'rtl',f));
const cBinary=path.join(bin,process.platform==='win32'?'tmr.exe':'tmr');
function run(exe,args,opts={}){return execFileSync(exe,args,{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,cwd:bin,...opts});}
try{
 run(gcc,['-std=c11','-Wall','-Wextra','-Werror','-pedantic',path.join(root,'tmr.c'),'-o',cBinary]);
 for(const [top,bench] of [['tb_dashboard','tb_dashboard.v'],['tb_supervisor','tb_supervisor.v'],['tb_level3','tb_level3.v']])
  run(iv,[...ivFlags,'-g2012','-Wall','-s',top,'-o',path.join(bin,top+'.vvp'),...rtl,path.join(root,'sim',bench)]);
}catch(e){console.error('Startup compilation failed. Check GCC and Icarus Verilog on PATH.\n'+e.message);process.exit(1);}
const sessions=new Map();
function replay(commands){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'corei3-'));
 try{
  const file=path.join(folder,'commands.txt');fs.writeFileSync(file,commands.map(c=>c.join(' ')).join('\n')+'\n');
  const out=run(vvp,[path.join(bin,'tb_dashboard.vvp'),'+commands='+file]);
  const rows=out.split(/\r?\n/).filter(l=>l.startsWith('RESULT ')).map(l=>JSON.parse(l.slice(7)));
  if(rows.length!==commands.length)throw Error('Incomplete HDL response');
  return rows;
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
function cResult(r){const masks=r.paths.map(p=>p^r.input);return JSON.parse(run(cBinary,['--json',String(r.input),...masks.map(String)]));}
function decorate(r){const c=cResult(r);if(c.voted!==r.voted || c.paths.some((p,i)=>p!==r.paths[i]))throw Error('C/HDL cross-check failed');return {...r,c,engine:'compiled C + Icarus Verilog',crossCheck:true};}
function validInt(n,min,max){return Number.isInteger(n)&&n>=min&&n<=max;}
function command(body){switch(body.action){
 case 'reset':if(validInt(body.input,0,255))return [0,body.input,0,0,0];break;
 case 'set':if(validInt(body.input,0,255)&&Array.isArray(body.masks)&&body.masks.length===3&&body.masks.every(n=>validInt(n,0,255)))return [1,body.input,...body.masks];break;
 case 'advance':if(validInt(body.ticks,1,1024))return [2,body.ticks,0,0,0];break;
 case 'heartbeat':if(typeof body.enabled==='boolean')return [3,Number(body.enabled),0,0,0];break;
 case 'integrity':if(typeof body.enabled==='boolean')return [4,Number(body.enabled),0,0,0];break;
 case 'spi':if(validInt(body.address,0,255))return [5,body.address,0,0,0];break;
 }throw Error('Invalid action or parameter');}
let verification=null;
function verify(){
 const results=[['C model',run(cBinary,['--test'])],['Level 2 HDL',run(vvp,[path.join(bin,'tb_supervisor.vvp')])],['Level 3 SPI HDL',run(vvp,[path.join(bin,'tb_level3.vvp')])]];
 if(results.some(([,out])=>!/Failures: 0\b/.test(out)))throw Error('Verification failed');
 verification={passed:true,time:new Date().toISOString(),results:results.map(([name,output])=>({name,output}))};return verification;
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function readBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Body too large');}return JSON.parse(body||'{}');}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
   const origin=req.headers.origin;
   if(origin && origin!==`http://${req.headers.host}`)return json(res,403,{error:'Use the local dashboard origin.'});
   const body=await readBody(req);
   if(url.pathname==='/api/session'){
    for(const [id,s]of sessions)if(Date.now()-s.updated>2*60*60*1000)sessions.delete(id);
    if(sessions.size>=24)return json(res,429,{error:'Too many sessions. Restart the server to clear them.'});
    const id=randomUUID(), commands=[[0,10,0,0,0]],rows=replay(commands);
    sessions.set(id,{commands,updated:Date.now()});return json(res,200,{session:id,state:decorate(rows.at(-1))});
   }
   if(url.pathname==='/api/verify')return json(res,200,verify());
   if(url.pathname==='/api/action'){
    const session=sessions.get(body.session);if(!session)return json(res,404,{error:'Session expired. Reload the page.'});
    if(session.commands.length>=500)return json(res,409,{error:'Session reached 500 actions. Start a new session.'});
    const cmd=command(body), commands=[...session.commands,cmd],rows=replay(commands),result=decorate(rows.at(-1));
    session.commands=commands;session.updated=Date.now();return json(res,200,{state:result});
   }
   return json(res,404,{error:'Unknown endpoint'});
  }
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ready:true,engine:'C + HDL',verification});
 const files = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/space.jpg': ['space.jpg', 'image/jpeg'],
  '/architecture': ['../ARCHITECTURE.md', 'text/plain']
};
  if(req.method==='GET'&&files[url.pathname]){const [file,type]=files[url.pathname];const content=fs.readFileSync(path.join(root,'public',file));res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(content);}
  json(res,404,{error:'Not found'});
 }catch(e){console.error(e.message);json(res,/Invalid|JSON|Body/.test(e.message)?400:500,{error:e.message.includes('Invalid')?e.message:'Request failed. Check the server terminal.'});}
});
server.on('error',e=>{if(e.code==='EADDRINUSE')console.error('Port 8080 is already in use. Stop your earlier dashboard with Ctrl+C, then restart.');else console.error(e.message);process.exitCode=1;});
server.listen(Number(process.env.PORT||8080),process.env.COREI3_HOST||'127.0.0.1',()=>console.log('Corei3 ready: http://127.0.0.1:8080 | C + HDL + real simulated SPI'));
