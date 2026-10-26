import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from '../../addons/zumama/build.mjs';
import { build as buildArturia } from '../../addons/arturia/legacy-build.mjs';
import { build as buildLavinia } from '../../addons/lavinia/legacy-build.mjs';
const source=process.env.SP_GAME_REPO,ref=process.env.ARTURIA_TEST_REF||'b3deebdae4a92642c007d217a1a4573e5d3612c5';
const repo=path.resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const load=p=>import(pathToFileURL(p)),json=p=>JSON.parse(fs.readFileSync(p));
function fixture(t){
  assert.ok(source,'Set SP_GAME_REPO');fs.mkdirSync(path.join(repo,'.cache'),{recursive:true});
  const temp=fs.mkdtempSync(path.join(repo,'.cache/zumama-integration-'));
  t.after(()=>{assert.ok(path.resolve(temp).startsWith(path.join(repo,'.cache')+path.sep));if(!process.env.SP_KEEP_TEST_TMP)fs.rmSync(temp,{recursive:true,force:true});});
  const root=path.join(temp,'game');fs.mkdirSync(root);
  const tar=path.join(temp,'host.tar');execFileSync('git',['archive','--output',tar,ref],{cwd:source});execFileSync('tar',['-xf',tar,'-C',root]);
  fs.symlinkSync(path.resolve(source,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const bundle=path.join(temp,'bundle');build(bundle);return{root,temp,bundle};
}
const hostNames=['shared/protocol.js','server/lobby.js','server/match/bot.js','server/match/match/phases.js','server/match/match/prep.js','server/match/match/platform.js','public/js/screens/room.js'];
const snapshot=(root,names)=>Object.fromEntries(names.map(n=>[n,fs.existsSync(path.join(root,n))?sha(fs.readFileSync(path.join(root,n))):null]));

test('Zumama installs alone, uses the correct identity/avatar and restores original bytes',async t=>{
  const {root,bundle}=fixture(t),before=snapshot(root,hostNames),installer=(await load(path.join(bundle,'install.mjs'))).install;
  assert.equal((await installer('check',root)).compatible,true);assert.deepEqual(snapshot(root,hostNames),before);
  await installer('install',root);assert.equal((await installer('install',root)).alreadyInstalled,true);
  const {ELITE_RECRUITS}=await load(path.join(root,'shared/aiAddons.js'));
  assert.deepEqual(ELITE_RECRUITS.map(p=>[p.id,p.avatar,p.e2]),[['zumama','char_416_zumama',true]]);
  const {Lobby}=await load(path.join(root,'server/lobby.js')),{SessionRegistry}=await load(path.join(root,'server/net.js')),{getData}=await load(path.join(root,'server/data.js'));
  const lobby=new Lobby({registry:new SessionRegistry(),getData}),host={playerId:'host',name:'Host',connected:true,ws:{readyState:1,send(){}}};
  assert.equal(lobby.create(host,{mode:'coop',difficulty:'HARD'}).ok,true);assert.equal(lobby.addBot(host,{persona:'zumama'}).ok,true);
  assert.equal(lobby.roomOf(host).seats.find(s=>s?.botPersona==='zumama').name,'AI·祖玛玛');
  assert.ok(lobby.addBot(host,{persona:'zumama'}).error);lobby.dispose?.();
  await installer('uninstall',root);assert.deepEqual(snapshot(root,hostNames),before);
});

test('three released personas migrate without changing old policies, play real battles and uninstall independently', {timeout:600000},async t=>{
  const {root,temp,bundle}=fixture(t),before=snapshot(root,hostNames);
  for(const [name,builder]of [['arturia',buildArturia],['lavinia',buildLavinia]]){
    const folder=path.join(temp,name);builder(folder);await(await load(path.join(folder,'install.mjs'))).install('install',root);
  }
  const protectedNames=[];
  for(const id of ['arturia','lavinia'])for(const name of Object.keys(json(path.join(root,'addons',id,'addon.json')).files))
    protectedNames.push('server/match/'+id+'/'+(name==='runtime.js'?'index.js':name));
  const originalPolicies=snapshot(root,protectedNames),installer=(await load(path.join(bundle,'install.mjs'))).install;
  await installer('install',root);assert.deepEqual(snapshot(root,protectedNames),originalPolicies);
  const state=json(path.join(root,'.ai-addons/install.json'));assert.deepEqual(Object.keys(state.plugins).sort(),['ai-arturia','ai-lavinia','ai-zumama']);
  assert.equal(state.plugins['ai-arturia'].meta.version,'0.2.4');assert.equal(state.plugins['ai-lavinia'].meta.version,'0.2.0');
  const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
  const seats=['zumama','lavinia','arturia'].map((botPersona,seat)=>({seat,playerId:botPersona,name:botPersona,isBot:true,connected:true,botPersona}));
  const h=makeMatch({mode:'coop',difficulty:'HARD',seed:7,seats,captureFrames:false,aiPicksLast:true});
  try{
    h.start().toPrep(1);h.run(()=>seats.every(s=>h.ps(s.playerId).ready));
    assert.deepEqual(h.m.draft.groups?.[0]?.order||h.m.draft.order,['arturia','lavinia','zumama']);
    for(const [id,band]of [['arturia','band_paganini'],['lavinia','band_chiave'],['zumama','band_pepe']])assert.equal(h.ps(id).bandId,band);
    h.toPrep(3);h.run(()=>seats.every(s=>h.ps(s.playerId).ready));assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
  }finally{h.m.dispose();}
  await installer('uninstall',root);
  await(await load(path.join(root,'addons/lavinia/install.mjs'))).install('check',root);
  await(await load(path.join(root,'addons/lavinia/install.mjs'))).install('uninstall',root);
  await(await load(path.join(root,'addons/arturia/install.mjs'))).install('uninstall',root);
  assert.deepEqual(snapshot(root,hostNames),before);assert.equal(fs.existsSync(path.join(root,'.ai-addons/install.json')),false);
});

test('shared upgrades roll back and reject incompatible runtime or same-version changes before writes',async t=>{
  const {root,temp,bundle}=fixture(t),installer=(await load(path.join(bundle,'install.mjs'))).install;
  await installer('install',root);
  const journal=fs.readFileSync(path.join(root,'.ai-addons/install.json')),state=JSON.parse(journal),names=Object.keys(state.files),before=snapshot(root,names);
  const candidate=path.join(temp,'candidate');fs.cpSync(bundle,candidate,{recursive:true});
  const meta=json(path.join(candidate,'addon.json'));meta.version='0.1.1';fs.writeFileSync(path.join(candidate,'addon.json'),JSON.stringify(meta,null,2)+'\n');
  const manager=(await load(path.join(candidate,'common/install.mjs'))).install;
  await assert.rejects(manager('install',root,candidate,{onWrite:n=>{if(n==='server/match/aiAddons/zumama/index.js')throw new Error('Injected transaction failure');}}),/Injected/);
  assert.deepEqual(fs.readFileSync(path.join(root,'.ai-addons/install.json')),journal);assert.deepEqual(snapshot(root,names),before);
  meta.sharedRuntime.version='2.0.0';fs.writeFileSync(path.join(candidate,'addon.json'),JSON.stringify(meta,null,2)+'\n');
  // A single plugin may update its runtime; a compatible peer makes a conflicting replacement invalid.
  const peer=path.join(temp,'peer');fs.cpSync(bundle,peer,{recursive:true});const p=json(path.join(peer,'addon.json'));
  p.id='ai-peer';p.persona={...p.persona,id:'peer',name:'Peer',band:'band_chiave'};fs.writeFileSync(path.join(peer,'addon.json'),JSON.stringify(p,null,2)+'\n');
  await(await load(path.join(peer,'install.mjs'))).install('install',root);
  const both=fs.readFileSync(path.join(root,'.ai-addons/install.json'));
  await assert.rejects(manager('check',root,candidate),/Shared computation runtime differs/);
  assert.deepEqual(fs.readFileSync(path.join(root,'.ai-addons/install.json')),both);
  const same=path.join(temp,'same');fs.cpSync(bundle,same,{recursive:true});const s=json(path.join(same,'addon.json'));s.policy='sha256:'+'0'.repeat(64);fs.writeFileSync(path.join(same,'addon.json'),JSON.stringify(s,null,2)+'\n');
  await assert.rejects((await load(path.join(same,'install.mjs'))).install('check',root),/Same version/);
  await(await load(path.join(peer,'install.mjs'))).install('uninstall',root);await installer('uninstall',root);
});

test('installed Zumama executes R14 and the shared real worker reproduces a serial battle', {timeout:600000},async t=>{
  const {root,bundle}=fixture(t);await(await load(path.join(bundle,'install.mjs'))).install('install',root);
  const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
  const {forecastPool,closeForecastWorkers}=await load(path.join(root,'server/match/aiCompute/workers.js'));
  const {resultDigest}=await load(path.join(root,'server/sim/spec.js'));
  const h=makeMatch({mode:'solo',difficulty:'HARD',seed:7,captureFrames:false,seats:[{seat:0,playerId:'zumama',name:'AI·祖玛玛',isBot:true,connected:true,botPersona:'zumama'}]});
  try{
    h.start().toPrep(1);h.run(()=>h.ps('zumama').ready);
    const ps=h.ps('zumama'),spec=h.m._normalOpts(ps),serial=h.m.newBattle(spec);
    let expected;try{while(!serial.finished)serial.step();expected=resultDigest(serial.result());}finally{serial.dispose?.();}
    const pool=forecastPool(h.m);assert.ok(pool);assert.equal(forecastPool(h.m),pool,'one pool per host process');
    const request=pool.submit('zumama-test',{spec,playerId:ps.playerId,cap:40000,projection:'battle-result'});assert.ok(request);
    const row=request.poll(true);assert.ok(row&&!row.error&&!row.canceled,JSON.stringify(row));
    assert.equal(row.row.valid,true);assert.deepEqual(resultDigest(row.row.result),expected);
    ps.lp=10000;if(h.m.teamLp!=null)h.m.teamLp=10000;
    h.toPrep(14);ps.lp=24;if(h.m.teamLp!=null)h.m.teamLp=24;
    assert.ok(h.run(()=>h.m.round>14||h.ended!=null));assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
  }finally{closeForecastWorkers();h.m.dispose();}
});

test('extended host keeps all three priorities and reservations local to their pool group',async t=>{
  const {root,temp,bundle}=fixture(t);
  if(!fs.readFileSync(path.join(root,'server/match/match/phases.js'),'utf8').includes('installDraftFacade'))return t.skip('extended host only');
  for(const [name,builder]of [['arturia',buildArturia],['lavinia',buildLavinia]]){
    const dir=path.join(temp,name);builder(dir);await(await load(path.join(dir,'install.mjs'))).install('install',root);
  }
  await(await load(path.join(bundle,'install.mjs'))).install('install',root);
  const {makeMatch}=await load(path.join(root,'test/match/harness.js'));
  const {policyMatch}=await load(path.join(root,'server/match/aiAddons/index.js'));
  for(const count of [4,8,20]){
    const seats=Array.from({length:count},(_,seat)=>({seat,playerId:'ai'+seat,name:'Bot'+seat,isBot:true,connected:true,
      ...(seat>=count-3?{botPersona:['arturia','lavinia','zumama'][seat-count+3]}:{})}));
    const opts={mode:'coop',difficulty:'HARD',seed:7,seats,fake:true,captureFrames:false,aiPicksLast:true};
    const h=makeMatch(opts),control=makeMatch({...opts,seats:seats.map(({botPersona,...s})=>s)});
    try{
      for(const x of [h,control]){x.start();x.run(()=>x.m.phase==='BAND_DRAFT');}
      const last=h.m.draft.groups.at(-1),original=control.m.draft.groups.at(-1),priority=[count-3,count-2,count-1].map(i=>'ai'+i);
      assert.deepEqual(last.order,[...priority,...original.order.filter(id=>!priority.includes(id))]);
      assert.equal(h.m.rngDraft(),control.m.rngDraft());
      assert.equal(h.m.bandTaken('band_pepe','ai'+(count-4)),true);
      if(count>4)assert.equal(h.m.bandTaken('band_pepe','ai0'),false);
      const ps=h.ps('ai'+(count-1)),view=policyMatch(h.m,ps);assert.equal(view.pool,ps.pool);assert.equal(view.itemPool,h.m.itemPoolFor(ps.playerId));
      assert.deepEqual(h.logs.error,[]);
    }finally{h.m.dispose();control.m.dispose();}
  }
});

test('three-item elite menu shows two rows, scrolls with the keyboard and displays Eunectes E2', {skip:process.env.ZUMAMA_E2E!=='1',timeout:240000},async t=>{
  const {root,temp,bundle}=fixture(t);
  for(const name of ['public/vendor','public/assets']){
    const target=path.resolve(source,name);if(fs.existsSync(path.join(root,name)))fs.rmSync(path.join(root,name),{recursive:true,force:true});
    fs.symlinkSync(target,path.join(root,name),process.platform==='win32'?'junction':'dir');
  }
  if(fs.existsSync(path.resolve(source,'data/assets.json')))fs.copyFileSync(path.resolve(source,'data/assets.json'),path.join(root,'data/assets.json'));
  for(const [name,builder]of [['arturia',buildArturia],['lavinia',buildLavinia]]){
    const dir=path.join(temp,name);builder(dir);await(await load(path.join(dir,'install.mjs'))).install('install',root);
  }
  await(await load(path.join(bundle,'install.mjs'))).install('install',root);
  process.env.CHROME_PATH||='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const {Client}=await load(path.join(root,'test/e2e/client.mjs'));
  const {startServer}=await load(path.join(root,'server/index.js'));
  const P=(await load(createRequire(path.resolve(source,'package.json')).resolve('puppeteer-core'))).default;
  const server=await startServer({port:0,host:'127.0.0.1',assetIndex:false}),client=new Client(P,server.url,'zumama',{w:1600,h:1000});
  const shots=path.join(repo,'.cache/zumama-ui');fs.mkdirSync(shots,{recursive:true});
  try{
    await client.open();await client.enter('精英菜单测试');
    await client.click('.mode-card','同盟模拟');await client.click('.diff-card','绝境模拟');
    await client.click('.create-box button','创建同盟');await client.waitFor(s=>!!s.room?.code,'room');
    await client.click('.seat--empty button','添加精英干员');await client.page.waitForSelector('[role="menuitem"]');
    assert.deepEqual(await client.page.$$eval('[role="menuitem"]',nodes=>nodes.map(n=>n.textContent.trim())),['阿尔图罗','拉维妮娅','祖玛玛']);
    const metrics=await client.page.$eval('[role="menu"]',menu=>{
      const m=menu.getBoundingClientRect(),rs=[...menu.querySelectorAll('[role="menuitem"]')].map(n=>n.getBoundingClientRect());
      return {overflow:menu.scrollHeight>menu.clientHeight,visible:rs.filter(r=>r.top>=m.top&&r.bottom<=m.bottom).length};
    });
    assert.equal(metrics.overflow,true);assert.equal(metrics.visible,2);
    await client.page.screenshot({path:path.join(shots,'menu-two-rows.png')});
    await client.page.keyboard.press('End');
    await client.page.waitForFunction(()=>document.activeElement?.textContent.trim()==='祖玛玛'&&document.querySelector('[role="menu"]').scrollTop>0);
    await client.page.screenshot({path:path.join(shots,'menu-scrolled.png')});
    await client.page.keyboard.press('Enter');
    await client.page.waitForFunction(()=>globalThis.__SP__.store.get().room.seats.some(s=>s?.botPersona==='zumama'&&s.name==='AI·祖玛玛'));
    await client.page.waitForFunction(()=>[...document.querySelectorAll('.seat .avatar img')].some(img=>img.currentSrc.includes('char_416_zumama_2')&&img.complete&&img.naturalWidth>0));
    await client.page.screenshot({path:path.join(shots,'zumama-e2.png')});
    assert.deepEqual(client.problems.filter(s=>s.startsWith('pageerror:')),[]);
    console.log(JSON.stringify({twoRows:true,keyboardScroll:true,eunectesE2:true,screenshots:shots}));
  }catch(error){console.error(client.problems);await client.page?.screenshot({path:path.join(shots,'failure.png')}).catch(()=>{});throw error;}
  finally{await client.close();await server.close();}
});
