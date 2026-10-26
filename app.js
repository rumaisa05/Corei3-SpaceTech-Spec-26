'use strict';
const $=id=>document.getElementById(id);
const ui={session:null,state:null,busy:false,masks:[0,0,0],events:[],reads:new Map(),step:-1,verification:null,integrity:false};
const registers=[
 [0,'IDENTIFICATION','Corei3 identifier'],[4,'STATUS','Current supervisor flags'],[8,'MISMATCH_EVENTS','Disagreement episodes'],[12,'PARITY_EVENTS','Parity fault episodes'],[16,'AMBIGUOUS_EVENTS','No word majority episodes'],[20,'PATH_SNAPSHOT','C / B / A / voted'],[24,'PROTECTED_OUTPUT','Safe mux output'],[28,'ELAPSED','Watchdog ticks'],[32,'HISTORY','Sticky historical flags'],[36,'TIMEOUT','Timeout configuration'],[40,'VERSION','Interface version']
];
const presets=[['Healthy',[0,0,0]],['Single bit · A',[1,0,0]],['Single bit · B',[0,1,0]],['Single bit · C',[0,0,1]],['4 bits · A',[15,0,0]],['Split faults',[1,2,0]],['Wrong majority',[1,1,0]],['Silent TMR fault',[1,1,1]],['Parity blind spot',[3,3,0]]];
const hex=(v,width=8)=>'0x'+Number(v).toString(16).toUpperCase().padStart(width,'0');
const binary=v=>v.toString(2).padStart(8,'0');
const parity=v=>v.toString(2).replaceAll('0','').length%2;
function error(message){$('error').hidden=false;$('error').textContent=message;}
function setBusy(value,label='Running C + HDL…'){
 ui.busy=value;$('busyIndicator').hidden=!value;$('busyText').textContent=label;
 document.querySelectorAll('button:not(#fullscreen)').forEach(b=>b.disabled=value);
 $('input').disabled=value;
}
async function request(url,body){
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Backend request failed');return data;
}
async function guarded(work,label){if(ui.busy)return;setBusy(true,label);$('error').hidden=true;try{await work();}catch(e){error(e.message);}finally{setBusy(false);}}
function inputValue(){const raw=$('input').value;const v=Number(raw);if(!raw.trim()||!Number.isInteger(v)||v<0||v>255)throw Error('Mission input must be a whole decimal number from 0 to 255.');return v;}
function leaveGuide(){ui.step=-1;$('guidePanel').hidden=true;$('guide').textContent='Launch mission demo ↗';}
async function action(body,label){
 const data=await request('/api/action',{session:ui.session,...body});ui.state=data.state;
 ui.masks=data.state.paths.map(p=>p^data.state.input);
 if(body.action==='reset'){ui.reads.clear();ui.integrity=false;}
 if(body.action==='integrity')ui.integrity=body.enabled;
 if(body.action==='spi')ui.reads.set(body.address,{value:data.state.spiValue,sequence:data.state.sequence,timePs:data.state.timePs});
 ui.events.push({label,action:body,time:new Date().toISOString(),state:data.state});render();return data.state;
}
async function startSession(){
 const d=await request('/api/session',{});ui.session=d.session;ui.state=d.state;ui.masks=[0,0,0];ui.events=[];ui.reads.clear();ui.integrity=false;leaveGuide();$('input').value=10;
 ui.events.push({label:'New mission session · reset / input 10',action:{action:'reset',input:10},time:new Date().toISOString(),state:d.state});render();
 $('connection').textContent='● C + HDL CONNECTED';$('connection').className='connection';
}
function statusLabel(s){return s.l3Safe?'SAFE MODE':!s.c.correct?'UNDETECTED ERROR':s.mismatch?'FAULT MASKED':'NOMINAL';}
function render(){
 const s=ui.state;if(!s)return;
 $('metricVoted').textContent=s.voted;$('metricVotedNote').textContent=binary(s.voted)+' / '+(s.c.correct?'oracle verified':'incorrect vs oracle');
 $('metricOutput').textContent=s.l3Output;$('metricOutputNote').textContent=s.l3Safe?'Level 3 safety mux → inactive command':'Level 3 safety mux → voted value';
 $('metricStatus').textContent=statusLabel(s);$('metricStatus').classList.toggle('badtext',!!s.l3Safe||!s.c.correct);
 $('metricStatusNote').textContent=s.timeout?'Heartbeat timeout latched':s.integrity3?'Integrity / parity alarm latched':!s.c.correct?'Checker blind spot exposed by oracle':s.mismatch?'Redundancy preserves the output':'All paths agree';
 $('statusDot').style.color=s.l3Safe||!s.c.correct?'var(--red)':'var(--mint)';
 $('metricCross').textContent=s.crossCheck?'MATCHED ✓':'FAILED';
 $('paths').innerHTML=s.paths.map((v,p)=>`<article class="path ${v!==s.input?'faulty':''}"><div class="pathTitle"><span class="pathLetter">${'ABC'[p]}</span>PATH<small>${v!==s.input?'FAULT INJECTED':'NOMINAL'}</small></div><div class="bits">${Array.from({length:8},(_,i)=>{const bit=7-i,fault=!!(ui.masks[p]&(1<<bit));return `<button class="bit ${fault?'flipped':''}" data-path="${p}" data-bit="${bit}" aria-pressed="${fault}" aria-label="Toggle path ${'ABC'[p]} bit ${bit}"><small>${bit}</small>${(v>>bit)&1}</button>`;}).join('')}</div><div class="decimal">${v}<small>DECIMAL</small></div></article>`).join('');
 $('paths').querySelectorAll('button').forEach(b=>b.onclick=()=>guarded(async()=>{leaveGuide();const masks=[...ui.masks];masks[Number(b.dataset.path)]^=1<<Number(b.dataset.bit);await action({action:'set',input:inputValue(),masks},`Toggle path ${'ABC'[Number(b.dataset.path)]} · bit ${b.dataset.bit}`);}));
 $('voteBits').textContent=binary(s.voted);$('voteStatus').textContent=s.c.correct?(s.mismatch?'FAULT MASKED':'NOMINAL'):'WRONG MAJORITY';$('voteStatus').className='labelPill'+(!s.c.correct?' bad':'');
 const corrected=ui.events.filter(e=>e.action.action==='set'&&e.state.c.correct&&e.state.c.mismatch);
 $('correctedEvents').textContent=corrected.length;$('correctedBits').textContent=corrected.reduce((n,e)=>n+e.state.c.corrected_bits,0);
 $('expected').textContent=s.input;$('mismatch').textContent=s.mismatch?'DETECTED':'NONE';$('rawCorrect').textContent=s.c.correct?'CORRECT':'INCORRECT';$('rawCorrect').className=s.c.correct?'':'badtext';
 const insight=s.l3Safe?(s.timeout?'Watchdog timeout: safe mode forces the Level 3 output to zero. Resume heartbeat and reset only after a controlled recovery.':s.parityFault?'The raw majority is incorrect. Independent-reference parity detects an odd-bit error and latches Level 3 safe mode. Level 2 alone cannot detect this with a healthy heartbeat.':'Safe mode remains latched after the triggering fault ends. Use controlled reset to restore operation.'):
 !s.c.correct?'Blind spot demonstrated: the raw majority is wrong, but the parity check does not detect it. Only the test oracle identifies this error. TMR and parity do not cover every multi-path fault.':
 s.ambiguous?'All three words differ, but the bitwise vote is still correct. No-word-majority is an uncertainty indicator, not proof of an incorrect output.':
 s.mismatch?'A faulty path differs from the reference. The two healthy copies preserve the voted output. This masks the fault; it does not repair the path.':`All paths carry the input directly. Decimal ${s.input} is binary ${binary(s.input)}. Inject a fault to see redundancy protect the output.`;
 $('insight').textContent=insight;$('insight').className='insight'+((s.l3Safe||!s.c.correct)?' warning':'');
 $('elapsed').textContent=s.elapsed;$('progressBar').style.width=Math.min(100,s.elapsed/64*100)+'%';$('progressBar').style.background=s.timeout?'var(--red)':'var(--mint)';
 $('timeoutBadge').textContent=s.timeout?'TIMEOUT LATCHED':'ARMED';$('timeoutBadge').className='labelPill'+(s.timeout?' bad':'');
 $('hbLabel').textContent=s.heartbeatEnabled?'● HEARTBEAT ENABLED':'○ HEARTBEAT STOPPED';$('hbLabel').style.color=s.heartbeatEnabled?'var(--mint)':'var(--amber)';
 $('heartbeat').textContent=s.heartbeatEnabled?'Stop heartbeat':'Resume heartbeat';
 $('l2Status').textContent=s.l2Safe?'SAFE / OUTPUT '+s.l2Output:'NORMAL / OUTPUT '+s.l2Output;$('l2Status').className=s.l2Safe?'badtext':'';
 $('l3Status').textContent=s.l3Safe?'SAFE / OUTPUT '+s.l3Output:'NORMAL / OUTPUT '+s.l3Output;$('l3Status').className=s.l3Safe?'badtext':'';
 $('parity').textContent=parity(s.voted)+' / '+parity(s.input)+(s.parityFault?' · MISMATCH':' · MATCH');$('parity').className=s.parityFault?'badtext':'';
 $('integrity').textContent=ui.integrity?'Remove integrity alarm':'Inject integrity alarm';
 $('signalOutput').textContent='Protected output: '+s.l3Output;
 $('mismatchEvents').textContent=s.mismatchEvents;$('parityEvents').textContent=s.parityEvents;$('ambiguousEvents').textContent=s.ambiguousEvents;
 renderRegisters();
 if(s.spiAddress>=0){$('spiAddress').textContent=hex(s.spiAddress,2);$('spiValue').textContent=hex(s.spiValue);$('spiDecode').textContent=decode(s.spiAddress,s.spiValue);}
 else{$('spiAddress').textContent='0x—';$('spiValue').textContent='NOT READ';$('spiDecode').textContent='Select a register to clock a real HDL transaction.';}
 $('presets').querySelectorAll('button').forEach((b,i)=>b.classList.toggle('selected',presets[i][1].every((v,j)=>v===ui.masks[j])));
 $('eventLog').innerHTML=ui.events.slice(-100).reverse().map(e=>`<div class="event ${e.state.l3Safe||!e.state.c.correct?'bad':''}"><span class="eventIcon">${e.state.l3Safe?'!':'↗'}</span><span>${e.time.slice(11,19)} UTC</span><div>${e.label}<br><span class="muted">x=${e.state.input} · vote=${e.state.voted} · output=${e.state.l3Output} · HDL t=${e.state.timePs} ps</span></div><strong>${statusLabel(e.state)}</strong></div>`).join('');
 if(ui.busy)document.querySelectorAll('button:not(#fullscreen)').forEach(b=>b.disabled=true);
}
function decode(address,v){if(address===4){const flags=['SAFE MODE','TIMEOUT','INTEGRITY LATCH','DISAGREEMENT','NO WORD MAJORITY','PARITY FAULT','EXTERNAL ALARM'];return flags.filter((_,i)=>v&(1<<i)).join(' · ')||'All current status flags clear.';}
 if(address===20)return `Snapshot: C=${v>>>24}, B=${(v>>>16)&255}, A=${(v>>>8)&255}, voted=${v&255}.`;
 if(address===32)return 'Sticky history bitmask. Clears on controlled reset; see architecture for bit definitions.';
 return registers.find(r=>r[0]===address)?.[2]+': '+v+' (decimal).';}
function renderRegisters(){
 $('registers').innerHTML=registers.map(([addr,name])=>{const r=ui.reads.get(addr);return `<tr><td>${hex(addr,2)}</td><td>${name}</td><td>${r?hex(r.value):'—'}<small>${r?'READ AT ACTION '+r.sequence:'NOT READ'}</small></td><td><button data-address="${addr}" aria-label="Read ${name} via SPI">↗</button></td></tr>`;}).join('');
 $('registers').querySelectorAll('button').forEach(b=>b.onclick=()=>guarded(async()=>{leaveGuide();await action({action:'spi',address:Number(b.dataset.address)},'SPI read '+hex(Number(b.dataset.address),2));},'Clocking HDL SPI transaction…'));
}
$('presets').innerHTML=presets.map(([name],i)=>`<button data-preset="${i}">${name}</button>`).join('');
$('presets').querySelectorAll('button').forEach(b=>b.onclick=()=>guarded(async()=>{leaveGuide();const [name,masks]=presets[Number(b.dataset.preset)];await action({action:'set',input:inputValue(),masks},name);}));
$('input').onchange=()=>guarded(async()=>{leaveGuide();await action({action:'set',input:inputValue(),masks:ui.masks},'Change decimal mission input');});
$('clearFaults').onclick=()=>guarded(async()=>{leaveGuide();await action({action:'set',input:inputValue(),masks:[0,0,0]},'Remove injected bit faults');});
$('reset').onclick=()=>guarded(async()=>{leaveGuide();await action({action:'reset',input:inputValue()},'Controlled reset · faults cleared / heartbeat resumed');});
$('heartbeat').onclick=()=>guarded(async()=>{leaveGuide();await action({action:'heartbeat',enabled:!ui.state.heartbeatEnabled},ui.state.heartbeatEnabled?'Stop processor heartbeat':'Resume processor heartbeat');});
for(const n of [8,64])$('tick'+n).onclick=()=>guarded(async()=>{leaveGuide();await action({action:'advance',ticks:n},'Advance '+n+' independent watchdog ticks');});
$('integrity').onclick=()=>guarded(async()=>{leaveGuide();await action({action:'integrity',enabled:!ui.integrity},ui.integrity?'Remove external integrity alarm':'Inject external integrity alarm');});
$('readAll').onclick=()=>guarded(async()=>{leaveGuide();for(const [address,name]of registers)await action({action:'spi',address},'SPI read '+name);},'Reading all registers through HDL SPI…');
$('newSession').onclick=()=>guarded(startSession,'Starting a new mission session…');
const steps=[
 ['Healthy mission','Input 10 enters all three paths as 00001010. C and HDL agree. Both supervisors forward the voted value.',async()=>{ $('input').value=10;await action({action:'reset',input:10},'Demo · healthy mission');}],
 ['One bit flips. The mission continues.','A becomes 11, while B and C remain 10. TMR masks the fault and both protected outputs stay correct.',async()=>action({action:'set',input:10,masks:[1,0,0]},'Demo · single-bit upset')],
 ['A wrong majority needs more than voting.','A and B now agree on 11. Level 2 keeps forwarding that wrong majority. Level 3 detects the parity mismatch and forces its protected output to zero.',async()=>action({action:'set',input:10,masks:[1,1,0]},'Demo · wrong majority / parity fallback')],
 ['Read the evidence over SPI.','A real serial transaction reads STATUS at 0x04. The SPI panel decodes the returned flags from the Verilog register interface.',async()=>action({action:'spi',address:4},'Demo · SPI fault-status read')],
 ['Independent watchdog takes over.','Reset, then stop processor heartbeats and advance 64 watchdog ticks. Both supervisors latch safe mode even though the processor is no longer making progress.',async()=>{await action({action:'reset',input:10},'Demo · reset before hang');await action({action:'heartbeat',enabled:false},'Demo · processor stops heartbeat');await action({action:'advance',ticks:64},'Demo · watchdog timeout');}],
 ['Telemetry survives the hang.','The SPI interface remains responsive because it runs in the watchdog clock domain. STATUS reports the timeout while the processor heartbeat remains stopped.',async()=>action({action:'spi',address:4},'Demo · read telemetry during processor hang')],
 ['Resuming is not recovery.','Heartbeat resumes, but safety stays latched. Critical actions remain blocked until a controlled reset.',async()=>action({action:'heartbeat',enabled:true},'Demo · heartbeat resumes / latch retained')],
 ['Know the boundary.','After reset, two paths flip two bits each: A=B=9, C=10. The vote is wrong, but parity still matches. The test oracle exposes a fault this checker cannot detect.',async()=>{await action({action:'reset',input:10},'Demo · reset before blind-spot test');await action({action:'set',input:10,masks:[3,3,0]},'Demo · even-bit parity blind spot');}],
 ['Controlled recovery. Mission restored.','Reset returns the model to healthy paths, clears hardware fault history, and resumes progress. Export session evidence or run the verification suites next.',async()=>action({action:'reset',input:10},'Demo · controlled recovery complete')]
];
async function guide(index){await steps[index][2]();ui.step=index;$('guidePanel').hidden=false;$('stepNumber').textContent=String(index+1).padStart(2,'0');$('stepLabel').textContent=`MISSION DEMO / ${index+1} OF ${steps.length}`;$('stepTitle').textContent=steps[index][0];$('stepText').textContent=steps[index][1];$('next').textContent=index===steps.length-1?'Finish demo ✓':'Next step →';$('guide').textContent='Restart mission demo ↻';$('guidePanel').scrollIntoView({behavior:'smooth',block:'start'});}
$('guide').onclick=()=>guarded(()=>guide(0),'Preparing guided mission…');
$('next').onclick=()=>guarded(async()=>{if(ui.step===steps.length-1)leaveGuide();else await guide(ui.step+1);});
$('exitGuide').onclick=leaveGuide;
$('verify').onclick=()=>guarded(async()=>{
 const r=await request('/api/verify',{});ui.verification=r;
 const ids=['testC','testL2','testL3'];r.results.forEach((suite,i)=>{const m=suite.output.match(/(?:Level 3 checks|Checks): (\d+)/);$(ids[i]).textContent=(m?Number(m[1]).toLocaleString():'')+' CHECKS · PASS';$(ids[i]).className='passed';});
 $('testOutput').textContent=r.results.map(s=>s.name+'\n'+s.output).join('\n');document.querySelector('.testDetails').open=true;
},'Running all C and HDL verification suites…');
$('export').onclick=()=>{
 const blob=new Blob([JSON.stringify({project:'Corei3 / SPEC26',exportedAt:new Date().toISOString(),engines:'Compiled C + Icarus Verilog RTL + bit-serial SPI',notes:'C correctness is test-oracle verified. Parity uses a trusted independent reference. Read sequence timestamps identify snapshots. Safe state is sticky until reset.',verification:ui.verification,experiments:ui.events,spiReads:Array.from(ui.reads,([address,result])=>({address,...result}))},null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Corei3-mission-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){error('Fullscreen is unavailable in this browser. Use F11 if supported.');}};
const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id));},{rootMargin:'-15% 0px -60% 0px'});
for(const id of ['overview','faultlab','watchdog','telemetry','verification'])observer.observe($(id));
guarded(startSession,'Compiling mission state…');
// ===== COREi3 SCROLL REVEAL =====

(() => {
  const sections = document.querySelectorAll(
    "main > section:not(.hero), main > .eventPanel, #guidePanel, .siteFooter"
  );

  // Add reveal effects to the major sections.
  sections.forEach((section) => {
    section.classList.add("reveal");
  });

  // Stagger the cards inside their parent sections.
  const cardGroups = document.querySelectorAll(
    ".summary, .labgrid, .watchgrid, .telemetrygrid, .verificationCards"
  );

  cardGroups.forEach((group) => {
    group.querySelectorAll(":scope > *").forEach((card) => {
      card.classList.add("reveal-child");
    });
  });

  // Reveal each section when it enters the viewport.
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.08,
      rootMargin: "0px 0px -40px 0px"
    }
  );

  sections.forEach((section) => {
    revealObserver.observe(section);
  });
})();