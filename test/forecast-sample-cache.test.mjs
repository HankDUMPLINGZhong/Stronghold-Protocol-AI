import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastContextKey as key, beginForecastSampleCache as begin, endForecastSampleCache as end,
  lookupForecastSample as lookup, storeForecastSample as store, replayForecastSample as replay,
  forecastSampleCacheState as state, cancelForecastSampleCaches as cancel, forecastCacheSteps as steps} from '../addons/shared/compute/sampleCache.js';
function fixture(){const m={mode:'coop',round:14,phase:'PREP',opts:{},ds:{},gd:{},battleContent:{},BattleClass:class{},newBattle(){}};return {m,ps:{m}};}
const spec=()=>({seed:4,timeLimit:Infinity,players:[{playerId:'ai_0',lpForBoss:3,units:[{uid:1,row:9,col:3,items:['x']}]}],spawns:[{t:1,id:'boss'}],flags:{layers:false}});
const outcome={valid:true,bossDamage:10,elapsed:240};
function saved(m,ps,projection='own-damage-v1',input=spec()){const t=lookup(m,ps,projection,input);store(m,ps,t,outcome,20);return lookup(m,ps,projection,input);}

test('typed full context distinguishes Infinity, null, undefined, holes, order and aliases',()=>{
  const values=[Infinity,-Infinity,null,undefined,0,-0,'Infinity',{},Object.create(null),[],Array(1),[undefined],[null],new Map(),new Set()];
  assert.equal(new Set(values.map(key)).size,values.length);
  assert.notEqual(key({a:1,b:2}),key({b:2,a:1}));
  assert.notEqual(key(new Set([1,2])),key(new Set([2,1])));
  const same={a:1};assert.notEqual(key([same,same]),key([{a:1},{a:1}]));
  assert.equal(key({fn(){}}),null);assert.equal(key({x:NaN}),null);assert.equal(key({x:new Date()}),null);
  assert.equal(key({get x(){throw Error('must not execute');}}),null);
  assert.equal(key(new(class extends Map {})()),null);assert.equal(key(new(class extends Set {})()),null);assert.equal(key(new(class extends Array {})()),null);
  const decorated=new Set([1]);decorated.extra=2;assert.equal(key(decorated),null);
});
test('complete inputs and projection separate samples, preserving sequence and prepared effects',()=>{
  const {m,ps}=fixture();begin(m,ps,{namespace:'arturia'});saved(m,ps);
  assert.ok(lookup(m,ps,'own-damage-v1',structuredClone(spec())).row);
  for(const change of [s=>s.seed++,s=>s.timeLimit=240,s=>s.players[0].lpForBoss++,s=>s.players[0].units[0].row++,
    s=>s.players[0].units[0].items.push('y'),s=>s.spawns[0].t++,s=>s.flags.layers=true]){
    const next=spec();change(next);assert.equal(lookup(m,ps,'own-damage-v1',next).row,undefined);
  }
  assert.equal(lookup(m,ps,'team-victory-v1',spec()).row,undefined);end(ps);
});
test('same public module serves three personas with separate player and projection scopes',()=>{
  const {m}=fixture(),players=['arturia','lavinia','zumama'].map(namespace=>({m,namespace}));
  for(const ps of players){begin(m,ps,{namespace:ps.namespace});assert.equal(lookup(m,ps,'test',spec()).row,undefined);saved(m,ps,'test');}
  cancel(m,players[0]);assert.equal(state(m,players[0]),null);
  for(const ps of players.slice(1)){assert.ok(lookup(m,ps,'test',spec()).row);end(ps);}
});
test('logical charges keep partial and exact ceiling stops, without more candidates or samples',()=>{
  const {m,ps}=fixture();begin(m,ps);const t=saved(m,ps);
  for(const [start,expected]of [[70,true],[80,false],[90,false]]){
    const session={steps:start,limits:{fieldSteps:100},reason:null};assert.equal(replay(t,session),expected);assert.equal(session.steps,Math.min(100,start+20));
    if(!expected)assert.equal(session.reason,'field-step-budget');
  }
  end(ps);assert.equal(replay(t),null);
});
test('prep-begin lease survives returned jobs and is cleared by prep-end or generator cancellation',()=>{
  const {m,ps}=fixture();let token;
  function* beginSteps(){yield* [];token=saved(m,ps);return {run:()=>replay(token)};}
  const started=steps(m,ps,{namespace:'arturia'},beginSteps(),{keepOpen:true}).next();
  assert.equal(started.done,true);assert.equal(started.value.run(),true);assert.ok(state(m,ps));
  [...steps(m,ps,{namespace:'arturia'},(function*(){yield* [];assert.ok(lookup(m,ps,'own-damage-v1',spec()).row);})())];assert.equal(state(m,ps),null);
  const interrupted=steps(m,ps,{},(function*(){saved(m,ps);yield;})(),{keepOpen:true});interrupted.next();interrupted.return();assert.equal(state(m,ps),null);
});
test('engine/data/factory changes invalidate samples; stable function-binding proxies keep hits',()=>{
  const {m:owner,ps}=fixture(),m=new Proxy(owner,{get(t,k){const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
  assert.notEqual(m.BattleClass,m.BattleClass);begin(m,ps);saved(m,ps);assert.ok(lookup(m,ps,'own-damage-v1',spec()).row);
  for(const k of ['ds','gd','battleContent','BattleClass','newBattle']){
    const old=saved(m,ps);owner[k]=k==='BattleClass'?class{}:k==='newBattle'?function(){}:{};
    assert.equal(replay(old),null);store(m,ps,old,outcome,20);assert.equal(lookup(m,ps,'own-damage-v1',spec()).row,undefined);
  }
  end(ps);
});
test('namespace, round, match and phase changes cannot reuse stale outcomes',()=>{
  const {m,ps}=fixture();begin(m,ps,{namespace:'a'});const old=saved(m,ps);begin(m,ps,{namespace:'b'});
  assert.equal(lookup(m,ps,'own-damage-v1',spec()).row,undefined);assert.equal(replay(old),null);
  saved(m,ps);m.round++;assert.equal(lookup(m,ps,'own-damage-v1',spec()),null);m.round--;m.phase='COMBAT';assert.equal(lookup(m,ps,'own-damage-v1',spec()),null);
  m.phase='PREP';assert.equal(lookup({...m},ps,'own-damage-v1',spec()),null);cancel(m);assert.equal(state(m,ps),null);
});
test('cache never exposes mutable stored outcomes or accepts invalid/opaque results',()=>{
  const {m,ps}=fixture();begin(m,ps);const t=lookup(m,ps,'p',spec()),row={valid:true,metrics:{value:1}};
  store(m,ps,t,row,20);row.metrics.value=2;const hit=lookup(m,ps,'p',spec());assert.equal(hit.row.outcome.metrics.value,1);
  assert.throws(()=>{hit.row.outcome.metrics.value=3;},TypeError);
  for(const bad of [{valid:false},{valid:true,x:NaN},{valid:true,x:Infinity},{valid:true,x:new Map()},null]){
    const input={...spec(),seed:9},token=lookup(m,ps,'p',input);store(m,ps,token,bad,20);assert.equal(lookup(m,ps,'p',input).row,undefined);
  }
  const hidden={valid:true};Object.defineProperty(hidden,'x',{value:1});
  for(const bad of [new(class{valid=true;x=1;})(),hidden,{valid:true,get x(){throw Error('must not execute');}}]){
    const token=lookup(m,ps,'opaque-output',spec());store(m,ps,token,bad,20);assert.equal(lookup(m,ps,'opaque-output',spec()).row,undefined);
  }
  end(ps);
});
test('bounded entry count and replacement accounting remain safe',()=>{
  const {m,ps}=fixture();begin(m,ps);
  for(let seed=0;seed<520;seed++)saved(m,ps,'p',{seed});
  assert.equal(state(m,ps).entries.size,512);assert.equal(lookup(m,ps,'p',{seed:0}).row,undefined);
  for(let i=0;i<10;i++)saved(m,ps,'p',{seed:519});
  assert.equal(state(m,ps).entries.size,512);assert.ok(state(m,ps).bytes>0&&state(m,ps).bytes<=16*1024*1024);
  saved(m,ps,'p',{huge:'x'.repeat(9*1024*1024)});assert.ok(state(m,ps).bytes<=16*1024*1024);end(ps);
});
test('shared opt-out keeps inherited generators and avoids a cache scope',()=>{
  const {m,ps}=fixture();m.opts.botSharedForecastCache=false;let reached=false;
  [...steps(m,ps,{},(function*(){yield* [];reached=true;assert.equal(lookup(m,ps,'p',spec()),null);})())];assert.ok(reached);assert.equal(state(m,ps),null);
});

test('public Ready/end-prep cancellation closes only the selected persona cache',async()=>{
  const {cancelForecastScopes}=await import('../addons/shared/compute/index.js');
  const {m}=fixture(),a={m},b={m};begin(m,a,{namespace:'arturia'});begin(m,b,{namespace:'zumama'});
  cancelForecastScopes(m,a);assert.equal(state(m,a),null);assert.ok(state(m,b));
  cancelForecastScopes(m);assert.equal(state(m,b),null);
});
test('starting a Worker execution scope does not cancel its surrounding shared sample cache',async()=>{
  const {withForecastWorkers,cancelForecastScopes}=await import('../addons/shared/compute/index.js');
  const {m,ps}=fixture();begin(m,ps);let cancelled=0;
  const policy=withForecastWorkers({*finalBoardSteps(){assert.ok(state(m,ps));yield;}},{poolFactory:()=>({closed:false,cancelOwner(){cancelled++;}})});
  [...policy.finalBoardSteps(m,ps,{})];assert.equal(cancelled,1);assert.ok(state(m,ps));cancelForecastScopes(m);assert.equal(state(m,ps),null);
});


