import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from '../../addons/zumama/build.mjs';
import { build as buildArturia } from '../../addons/arturia/build.mjs';
import { build as buildLavinia } from '../../addons/lavinia/build.mjs';
const source=process.env.SP_GAME_REPO,ref=process.env.ARTURIA_TEST_REF||'b3deebdae4a92642c007d217a1a4573e5d3612c5';
const repo=path.resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const load=p=>import(pathToFileURL(p)),json=p=>JSON.parse(fs.readFileSync(p));
function fixture(t){
  assert.ok(source,'Set SP_GAME_REPO');fs.mkdirSync(path.join(repo,'.cache'),{recursive:true});
  const temp=fs.mkdtempSync(path.join(repo,'.cache/current-browser-'));
  t.after(()=>{assert.ok(path.resolve(temp).startsWith(path.join(repo,'.cache')+path.sep));if(!process.env.SP_KEEP_TEST_TMP)fs.rmSync(temp,{recursive:true,force:true});});
  const root=path.join(temp,'game');fs.mkdirSync(root);
  const tar=path.join(temp,'host.tar');execFileSync('git',['archive','--output',tar,ref],{cwd:source});execFileSync('tar',['-xf',tar,'-C',root]);
  fs.symlinkSync(path.resolve(source,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const bundle=path.join(temp,'bundle');build(bundle);return{root,temp,bundle};
}
const hostNames=['shared/protocol.js','server/lobby.js','server/match/bot.js','server/match/match/phases.js','server/match/match/prep.js','server/match/match/platform.js','public/js/screens/room.js'];
const snapshot=(root,names)=>Object.fromEntries(names.map(n=>[n,fs.existsSync(path.join(root,n))?sha(fs.readFileSync(path.join(root,n))):null]));

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
  const shots=path.join(repo,'.cache/current-ui');fs.mkdirSync(shots,{recursive:true});
  try{
    await client.open();await client.enter('精英菜单测试');
    await client.click('.mode-card','同盟模拟');
    await client.click('[data-testid="alliance-create"]','创建同盟');await client.waitFor(s=>!!s.room?.code,'room');
    await client.page.click('.rs-pill__diff');await client.click('.diff-card','绝境模拟');
    await client.click('.proto-start','确认');
    await client.page.waitForFunction(()=>globalThis.__SP__.store.get().room?.difficulty==='HARD');
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
    await client.page.waitForFunction(()=>[...document.querySelectorAll('.seat.is-bot')].some(s=>s.textContent.includes('祖玛玛')&&!s.classList.contains('is-flash')&&parseFloat(getComputedStyle(s).opacity)>.95));
    await client.page.screenshot({path:path.join(shots,'zumama-e2.png')});
    await client.page.setViewport({width:390,height:844});
    await client.page.click('.seat--empty [aria-haspopup="menu"]');
    const mobile=await client.page.$eval('[role="menu"]',menu=>{
      const m=menu.getBoundingClientRect();return {visible:[...menu.querySelectorAll('[role="menuitem"]')].filter(n=>{const r=n.getBoundingClientRect();return r.top>=m.top&&r.bottom<=m.bottom;}).length,overflow:menu.scrollHeight>menu.clientHeight};
    });
    assert.deepEqual(mobile,{visible:2,overflow:true});
    await client.page.screenshot({path:path.join(shots,'menu-mobile.png')});
    assert.deepEqual(client.problems.filter(s=>s.startsWith('pageerror:')),[]);
    console.log(JSON.stringify({twoRows:true,keyboardScroll:true,eunectesE2:true,screenshots:shots}));
  }catch(error){console.error(client.problems);await client.page?.screenshot({path:path.join(shots,'failure.png')}).catch(()=>{});throw error;}
  finally{await client.close();await server.close();}
});
