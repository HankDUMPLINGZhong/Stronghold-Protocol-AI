import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build as arturia } from '../../addons/arturia/build.mjs';
import { build as lavinia } from '../../addons/lavinia/build.mjs';
import { build as zumama } from '../../addons/zumama/build.mjs';
import { build as legacyArturia } from '../../addons/arturia/legacy-build.mjs';
import { build as legacyLavinia } from '../../addons/lavinia/legacy-build.mjs';
import { build as legacyZumama } from '../../addons/zumama/legacy-build.mjs';

const repo = path.resolve(import.meta.dirname, '../..'), source = process.env.SP_GAME_REPO;
const ref = process.env.ARTURIA_TEST_REF || 'f07b8965061bbc311ad7aa815879b09264a1e47d';
const ids = ['arturia','lavinia','zumama'], builders = {arturia,lavinia,zumama};
const load = p => import(pathToFileURL(p)), json = p => JSON.parse(fs.readFileSync(p));
const sha = b => createHash('sha256').update(b).digest('hex');
const bundles = {};
let suite;
let modernHost=false;
before(() => {
  assert.ok(source, 'Set SP_GAME_REPO');fs.mkdirSync(path.join(repo,'.cache'),{recursive:true});
  modernHost=execFileSync('git',['show',ref+':server/match/bot.js'],{cwd:source,encoding:'utf8',maxBuffer:4*1024*1024}).includes('export function* botPrepBeginSteps(m, ps, options = {})');
  suite = fs.mkdtempSync(path.join(repo,'.cache/current-bundles-'));
  for (const id of ids) { bundles[id]=path.join(suite,id); builders[id](bundles[id]); }
});

for(const [label,mode,names] of [
  ['Arturia solo','solo',['arturia']],['Lavinia solo','solo',['lavinia']],['Zumama solo','solo',['zumama']],
  ['Zumama two-player','coop',['zumama','ordinary']],
  ['Lavinia two-player','coop',['lavinia','ordinary']],
  ['Lavinia four-player','coop',['lavinia','ordinary','ordinary2','ordinary3']],
  ['all three elites four-player','coop',[...ids,'ordinary']],
])test(`terminal ABYSS recipes on 0.3.3: ${label}`,{timeout:1200000},async t=>{
  if(!modernHost)return t.skip('new upstream settlement/prep API regression');
  const {root}=fixture(t);
  for(const id of names.filter(id=>ids.includes(id)))await install(id,'install',root);
  const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
  const h=makeMatch({mode,difficulty:'ABYSS',seed:7,captureFrames:false,seats:seats(names)});
  try{
    h.start().toPrep(1);h.run(()=>h.m.order.every(p=>p.ready));
    // Compatibility, not win-rate measurement: retain every seat to exercise late-game branches.
    for(const ps of h.m.order)ps.lp=10000;if(h.m.teamLp!=null)h.m.teamLp=10000;
    h.toPrep(14);assert.ok(h.run(()=>h.m.round>14||h.ended!=null));
    assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
  }finally{h.m.dispose();}
  for(const id of names.filter(id=>ids.includes(id)))await install(id,'uninstall',root);
});
function fixture(t) {
  const temp=fs.mkdtempSync(path.join(repo,'.cache/current-host-')),root=path.join(temp,'game 游戏');fs.mkdirSync(root);
  const tar=path.join(temp,'host.tar');execFileSync('git',['archive','--output',tar,ref],{cwd:source});execFileSync('tar',['-xf',tar,'-C',root]);
  fs.symlinkSync(path.resolve(source,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  t.after(()=>{assert.ok(path.resolve(temp).startsWith(path.join(repo,'.cache')+path.sep));if(!process.env.SP_KEEP_TEST_TMP)fs.rmSync(temp,{recursive:true,force:true});});
  return {root,temp};
}
const hostNames=['shared/protocol.js','server/lobby.js','server/match/bot.js','server/match/Match.js','server/match/match/phases.js','server/match/match/prep.js','server/match/match/platform.js','server/match/rewind.js','public/js/screens/room.js'];
const snapshot=(root,names=hostNames)=>Object.fromEntries(names.map(n=>[n,fs.existsSync(path.join(root,n))?sha(fs.readFileSync(path.join(root,n))):null]));
// Older immutable bundles can be managed by the installed manager's public bundle-path API.
const install=async(id,mode,root)=>{
  const installed=path.join(root,'server/match/aiAddons/manage.mjs');
  if(fs.existsSync(installed)){
    // Each CLI invocation starts fresh; mirror that when the test replaces a manager at one path.
    const manager=await import(pathToFileURL(installed).href+'?sha='+sha(fs.readFileSync(installed)));
    if(manager.MANAGER_API>=2)return manager.install(mode,root,bundles[id]);
  }
  return(await load(path.join(bundles[id],'install.mjs'))).install(mode,root);
};
const seats=names=>names.map((id,seat)=>({seat,playerId:id,name:id,isBot:true,connected:true,...(ids.includes(id)?{botPersona:id}:{})}));

for(const id of ids)test(`current ${id} installs alone, uses host settlement and runs real combat through R14`,{timeout:600000},async t=>{
  const {root}=fixture(t),before=snapshot(root);
  assert.equal((await install(id,'check',root)).compatible,true);assert.deepEqual(snapshot(root),before);
  await install(id,'install',root);assert.equal((await install(id,'install',root)).alreadyInstalled,true);
  const meta=json(path.join(bundles[id],'addon.json')),mount=meta.bridgeMount||`server/match/aiAddons/${id}`;
  const settlement=await load(path.join(root,mount,'compat/settlement.js'));
  const host=await load(path.join(root,fs.existsSync(path.join(root,'server/sim/attack.js'))?'server/sim/attack.js':'server/sim/damage.js'));
  assert.equal(settlement.mitigate,host.mitigate);
  const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
  const h=makeMatch({mode:'solo',difficulty:'HARD',seed:7,captureFrames:false,seats:seats([id])});
  try{
    h.start().toPrep(1);const ps=h.ps(id);h.run(()=>ps.ready);assert.equal(ps.bandId,meta.persona.band);
    assert.ok(ps.allChess().length>0);ps.lp=10000;if(h.m.teamLp!=null)h.m.teamLp=10000;
    h.toPrep(14);assert.ok(h.run(()=>h.m.round>14||h.ended!=null));
    assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
  }finally{h.m.dispose();}
  await install(id,'uninstall',root);assert.deepEqual(snapshot(root),before);
});

test('all six installation orders share one menu and uninstall in any order with exact restoration',{timeout:600000},async t=>{
  for(const order of [['arturia','lavinia','zumama'],['arturia','zumama','lavinia'],['lavinia','arturia','zumama'],['lavinia','zumama','arturia'],['zumama','arturia','lavinia'],['zumama','lavinia','arturia']]){
    const {root}=fixture(t),before=snapshot(root);
    for(const id of order)await install(id,'install',root);
    const state=json(path.join(root,'.ai-addons/install.json'));
    assert.deepEqual(Object.keys(state.plugins).sort(),ids.map(id=>'ai-'+id));
    const {ELITE_RECRUITS}=await load(path.join(root,'shared/aiAddons.js'));
    assert.deepEqual(ELITE_RECRUITS.map(p=>p.id),ids);assert.ok(ELITE_RECRUITS.every(p=>p.e2));
    execFileSync(process.execPath,['--check',path.join(root,'public/js/screens/room.js')]);
    const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
    const h=makeMatch({mode:'coop',difficulty:'HARD',seed:7,seats:seats(['zumama','ordinary','lavinia','arturia']),fake:true,aiPicksLast:true,captureFrames:false});
    try{
      h.start();h.run(()=>h.m.phase==='BAND_DRAFT');
      assert.deepEqual(h.m.draft.groups?.[0]?.order||h.m.draft.order,['arturia','lavinia','zumama','ordinary']);
      for(const id of ids)assert.equal(h.m.bandTaken(state.plugins['ai-'+id].meta.persona.band,'ordinary'),true);
      assert.deepEqual(h.logs.error,[]);
    }finally{h.m.dispose();}
    for(const id of [order[1],order[0],order[2]])await install(id,'uninstall',root);
    assert.deepEqual(snapshot(root),before);assert.equal(fs.existsSync(path.join(root,'.ai-addons/install.json')),false);
  }
});

test('the 0.3.3 adapter routes named seats before custom decide/prep while ordinary seats retain their adapter',{timeout:600000},async t=>{
  const {root}=fixture(t);
  if(!fs.existsSync(path.join(root,'server/match/botStrategyContract.js')))return t.skip('modern strategy API only');
  if(!fs.readFileSync(path.join(root,'server/match/Match.js'),'utf8').includes('this.bot = getBotStrategy('))return t.skip('registered strategy selection only');
  for(const id of ids)await install(id,'install',root);
  const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
  const {LEGACY_BOT}=await load(path.join(root,'server/match/botStrategyContract.js'));
  const calls=[];
  const selected={id:'routing-test',decide(m,ps){calls.push(['decide',ps.playerId]);return ids.includes(ps.playerId);},
    *prepBegin(m,ps,options){calls.push(['begin',ps.playerId]);return yield* LEGACY_BOT.prepBegin(m,ps,options);},
    *prepEnd(m,ps,job){calls.push(['end',ps.playerId]);return yield* LEGACY_BOT.prepEnd(m,ps,job);}};
  const h=makeMatch({mode:'coop',difficulty:'HARD',seed:7,captureFrames:false,seats:seats([...ids,'ordinary']),botStrategy:selected});
  try{
    h.start().toPrep(1);assert.ok(h.run(()=>h.m.order.every(p=>p.ready)));
    h.toPrep(3);h.run(()=>h.m.order.every(p=>p.ready));
    assert.ok(calls.some(([hook,id])=>hook==='begin'&&id==='ordinary'));
    assert.ok(calls.some(([hook,id])=>hook==='decide'&&id==='ordinary'));
    assert.ok(calls.every(([,id])=>id==='ordinary'),JSON.stringify(calls));
    for(const id of ids)assert.ok(h.ps(id).allChess().length>0);
    assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
  }finally{h.m.dispose();}
});

test('official-version switching cannot leave named seats on an unsupported content version',async t=>{
  const {root}=fixture(t);
  if(!fs.readFileSync(path.join(root,'server/match/bot.js'),'utf8').includes('export function* botPrepBeginSteps(m, ps, options = {})'))return t.skip('official version switch API only');
  await install('arturia','install',root);
  const {Lobby}=await load(path.join(root,'server/lobby.js'));
  const {SessionRegistry}=await load(path.join(root,'server/net.js'));
  const {getData}=await load(path.join(root,'server/data.js'));
  const lobby=new Lobby({registry:new SessionRegistry(),getData}),host={playerId:'host',name:'Host',connected:true,ws:{readyState:1,send(){}}};
  try{
    assert.equal(lobby.create(host,{mode:'coop',difficulty:'HARD'}).ok,true);
    const room=lobby.roomOf(host);room.version='act1autochess';
    assert.ok(lobby.addBot(host,{persona:'arturia'}).error);
    room.version='act2autochess';room.versionVote={version:'act1autochess'};
    assert.ok(lobby.addBot(host,{persona:'arturia'}).error);room.versionVote=null;
    assert.equal(lobby.addBot(host,{persona:'arturia'}).ok,true);
    assert.ok(lobby.proposeVersion(host,{version:'act1autochess'}).error);
    assert.equal(room.version,'act2autochess');
  }finally{lobby.dispose?.();}
});

test('released three-persona installations upgrade independently without changing untouched peers',{timeout:600000},async t=>{
  const {root,temp}=fixture(t);
  if(fs.readFileSync(path.join(root,'server/match/bot.js'),'utf8').includes('export function* botPrepBeginSteps(m, ps, options = {})'))return t.skip('old packages cannot install into 0.3.3; upgrades are exercised on their supported hosts');
  const old={};
  for(const[id,builder]of [['arturia',legacyArturia],['lavinia',legacyLavinia],['zumama',legacyZumama]]){
    old[id]=path.join(temp,'old-'+id);builder(old[id]);await(await load(path.join(old[id],'install.mjs'))).install('install',root);
  }
  let state=json(path.join(root,'.ai-addons/install.json'));
  const peerFiles=Object.keys(state.files).filter(p=>p.startsWith('server/match/arturia/')||p.startsWith('server/match/lavinia/'));
  const before=snapshot(root,peerFiles);
  assert.equal((await install('zumama','install',root)).upgradedFrom,'0.1.0');assert.deepEqual(snapshot(root,peerFiles),before);
  assert.equal((await install('arturia','install',root)).upgradedFrom,'0.2.4');
  assert.equal((await install('lavinia','install',root)).upgradedFrom,'0.2.0');
  state=json(path.join(root,'.ai-addons/install.json'));
  assert.deepEqual(ids.map(id=>state.plugins['ai-'+id].meta.version),['0.2.6','0.2.2','0.1.2']);
  const manage=(await load(path.join(bundles.zumama,'common/install.mjs'))).install;
  const bytes=fs.readFileSync(path.join(root,'.ai-addons/install.json'));
  await assert.rejects(manage('check',root,old.zumama),/newer/);
  assert.deepEqual(fs.readFileSync(path.join(root,'.ai-addons/install.json')),bytes);
  for(const id of ['arturia','zumama','lavinia'])await install(id,'uninstall',root);
});
