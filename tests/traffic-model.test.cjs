// Run with Node.js, no packages required. Tests execute the actual inline model in index.html.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const drawing=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
function setup(count=50){
 const dom={},downloads=[];function element(id){return dom[id]??=( {value:id==='initialQueue'?String(count):id==='speed'?'3':'',textContent:'',innerHTML:'',classList:{toggle(){}},addEventListener(){},getBoundingClientRect(){return{width:900,height:612}},getContext(){return drawing}});}
 const context={document:{getElementById:element,addEventListener(){},createElement(){return{click(){}}}},performance:{now:()=>0},matchMedia:()=>({matches:false}),devicePixelRatio:1,requestAnimationFrame(){},Blob,URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test'},revokeObjectURL(){}},setTimeout:fn=>fn(),console};vm.createContext(context);
 const exportCode=`globalThis.test={reset,activate,tick,initial,enter,advance,add,monitor,chooseNext,sceneCars,signalState,occupied,averageWait,downloadRun,render,makeCar,RULES,GROUPS,arrivals,dom:$,state:()=>({fixed,smart,t,arrivalIndex,active,activationTime}),setT:n=>{t=n;},setArrivals:a=>arrivals.splice(0,arrivals.length,...a)};`;
 vm.runInContext(source.replace('reset();requestAnimationFrame(frame);','reset();'+exportCode),context);context.test.downloads=downloads;return context.test;
}
function step(a,s,n){for(let i=0;i<Math.round(n/.05);i++)a.advance(s,.05);}
function empty(a){const s=a.initial();for(const key in s.q)s.q[key]=[];s.adaptive=true;return s;}
// Fixed/adaptive equality before activation, conservation, signal transitions, green limits, wait accounting.
const results=[];let measuredReasons=new Set();
for(const count of [7,20,50]){
 const a=setup(count);let switches=0;
 for(let i=0;i<12000;i++){
  if(i===600)a.activate();
  const before=a.state();const previous=[before.fixed,before.smart].map(s=>({phase:s.phase,elapsed:s.elapsed,occupied:a.occupied(s)}));a.tick();const st=a.state();
  if(i<600)assert.equal(JSON.stringify(st.fixed),JSON.stringify(st.smart),'models diverged before activation');
  for(const [j,s]of [st.fixed,st.smart].entries()){
   const pending=Object.values(s.q).flat();assert.equal(pending.length+s.passed,count+2+st.arrivalIndex,'car conservation');
   assert.ok(Math.abs(s.totalWait-(s.releasedWait+pending.reduce((sum,c)=>sum+c.wait,0)))<1e-6,'waiting time conservation');
   assert.equal(Object.values(a.signalState(s)).filter(v=>v==='GREEN').length,[0,3,6].includes(s.phase)?1:0);
   const prev=previous[j];if(s.phase!==prev.phase){switches++;
    if([1,4,7].includes(prev.phase))assert.equal(s.phase,prev.phase+1,'yellow must enter all red');
    if([2,5,8].includes(prev.phase)&&[0,3,6].includes(s.phase)){assert.ok(!a.occupied(s),'green before clearance');assert.ok(prev.elapsed>=2.95-1e-8,'short all red');}
    if(j===1&&i>600&&[0,3,6].includes(prev.phase)){
     assert.equal(s.phase,prev.phase+1);assert.ok(prev.elapsed>= (prev.phase===0?10:6)-.051);assert.ok(prev.elapsed<=(prev.phase===0?22:55)+.001);
    }
   }
   measuredReasons.add(s.reasonCode);
  }
 }
 const st=a.state();results.push({initial:count,arrivals:st.arrivalIndex,fixedMain:st.fixed.q.left.length+st.fixed.q.right.length,smartMain:st.smart.q.left.length+st.smart.q.right.length,fixedBranch:st.fixed.q.bottomLeft.length+st.fixed.q.bottomRight.length,smartBranch:st.smart.q.bottomLeft.length+st.smart.q.bottomRight.length,fixedPassed:st.fixed.passed,smartPassed:st.smart.passed,fixedAverage:+a.averageWait(st.fixed).toFixed(1),smartAverage:+a.averageWait(st.smart).toFixed(1),fixedMax:+st.fixed.maxWait.toFixed(1),smartMax:+st.smart.maxWait.toFixed(1)});assert.ok(switches>20);
}
{
 const a=setup(),s=empty(a);a.enter(s,3);step(a,s,5.95);assert.equal(s.phase,3);step(a,s,.05);assert.equal(s.phase,4);assert.equal(s.reasonCode,'empty');step(a,s,3);assert.equal(s.phase,5);step(a,s,3);assert.equal(s.phase,5,'empty intersection should stay all red');s.q.right=[a.makeCar(0)];step(a,s,.5);assert.equal(s.phase,6,'new demand wakes controller');
}
{
 const a=setup(),s=empty(a);s.q.right=Array.from({length:100},(_,i)=>a.makeCar(i*34));a.enter(s,6);step(a,s,6);assert.equal(s.phase,6);assert.equal(s.reasonCode,'extend');assert.ok(s.remaining>2.99);step(a,s,49);assert.equal(s.phase,7);assert.equal(s.reasonCode,'max');
}
{
 const a=setup(),s=empty(a);s.q.left=Array.from({length:50},(_,i)=>a.makeCar(i*34));s.q.right=[a.makeCar(0)];a.enter(s,3);step(a,s,45);assert.equal(s.phase,4);assert.equal(s.reasonCode,'fairness');step(a,s,8);assert.equal(s.phase,6,'long-red direction gets next green');
}
{
 const a=setup(),s=empty(a);s.q.left=[a.makeCar(300)];a.enter(s,0);step(a,s,1);assert.equal(s.q.left[0].wait,0,'approaching cars should not accumulate stopped time');step(a,s,4);assert.ok(s.q.left[0].wait>1.7);assert.ok(s.q.left[0].redWait>1.7);
 // Recent arrivals use the half-open window (now-60, now], excluding the initial queue.
 const b=empty(a);a.add(b,{lane:'right',turn:false});assert.equal(a.monitor(b,6).arrivals,1);step(a,b,59.95);assert.equal(a.monitor(b,6).arrivals,1);step(a,b,.05);assert.equal(a.monitor(b,6).arrivals,0);
}
{
 // Triggering fairness must respect the minimum green even when another direction already waited 45 s.
 const a=setup(),s=empty(a);s.q.left=Array.from({length:50},(_,i)=>a.makeCar(i*34));s.q.right=[{...a.makeCar(0),redWait:50}];a.enter(s,3);step(a,s,5.95);assert.equal(s.phase,3);step(a,s,.05);assert.equal(s.phase,4);assert.equal(s.reasonCode,'fairness');
 // A more urgent nonempty direction is selected; empty directions are skipped.
 const b=empty(a);b.q.right=[{...a.makeCar(0),redWait:55}];b.q.left=[{...a.makeCar(0),redWait:48}];assert.equal(a.chooseNext(b,0).p,6);
}
for(const phase of [0,1,2,3,4,5,6,7,8]){
 const a=setup();a.state().smart.phase=phase;a.state().smart.elapsed=5;a.state().smart.remaining=1;a.activate();a.tick();assert.ok(a.state().smart.remaining>=0,'activation produced negative budget');
}
assert.ok(measuredReasons.has('extend'));assert.ok(measuredReasons.has('empty'));assert.ok(measuredReasons.has('fairness'));
console.log('PASS: conservation, shared arrivals, waiting, phase clearance, min/max green, extension, early switching, fairness, sensor window, activation in every phase.');
console.log(JSON.stringify(results,null,2));
if(process.argv.includes('--json'))fs.writeFileSync(require('node:path').join(__dirname,'../validation-results.json'),JSON.stringify(results,null,2)+'\n');

{
 const a=setup(20);for(let i=0;i<600;i++)a.tick();a.activate();for(let i=0;i<200;i++)a.tick();a.downloadRun();
 assert.equal(a.downloads.length,1);
 a.downloads[0].text().then(text=>{
  const rows=text.trim().split('\r\n').map(r=>r.split(','));assert.equal(rows.length,7);assert.equal(rows[0].length,12);
  for(const row of rows.slice(1)){assert.equal(row[1],'40');assert.equal(row[2],'30');assert.equal(row.length,12);}
  const encoded=html.match(/data-check-csv="([^"]+)"/)[1];const archived=Buffer.from(encoded,'base64').toString('utf8');assert.ok(archived.includes('126.8'));assert.equal(archived.split('\r\n').length,4);
  console.log('PASS: live CSV contains both models and activation time; embedded comparison CSV matches the new results.');
 }).catch(error=>{console.error(error);process.exitCode=1;});
}
