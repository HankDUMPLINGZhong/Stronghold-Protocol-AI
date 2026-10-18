import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {build,UPSTREAM_REF} from '../../addons/lavinia/build.mjs';
import {build as buildArturia} from '../../addons/arturia/build.mjs';

test('elite dropdown offers both teammates and displays Penance E2 with correct draft order',{
  skip:process.env.LAVINIA_E2E!=='1',timeout:180000,
},async()=>{
  const source=resolve(process.env.SP_GAME_REPO);
  mkdirSync('.cache',{recursive:true});
  const temp=mkdtempSync(resolve('.cache/lavinia-ui-')),root=resolve(temp,'game');mkdirSync(root);
  const tar=resolve(temp,'host.tar');
  writeFileSync(tar,execFileSync('git',['archive',UPSTREAM_REF],{cwd:source,maxBuffer:64*1024*1024}));
  execFileSync('tar',['-xf',tar,'-C',root]);
  for(const p of ['node_modules','public/vendor','public/assets'])symlinkSync(resolve(source,p),resolve(root,p),process.platform==='win32'?'junction':'dir');
  const artBundle=resolve(temp,'arturia'),lavBundle=resolve(temp,'lavinia');
  buildArturia(artBundle);build(lavBundle);
  for(const dir of [artBundle,lavBundle])await(await import(pathToFileURL(resolve(dir,'install.mjs')))).install('install',root);
  process.env.CHROME_PATH||='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const {Client}=await import(pathToFileURL(resolve(root,'test/e2e/client.mjs')));
  const {startServer}=await import(pathToFileURL(resolve(root,'server/index.js')));
  const P=(await import('puppeteer-core')).default,server=await startServer({port:0,host:'127.0.0.1',assetIndex:false});
  const shots=resolve('.cache/lavinia-shots');mkdirSync(shots,{recursive:true});
  try{
    for(const dual of [false,true]){
      const name=dual?'dual':'alone',client=new Client(P,server.url,name,{w:1600,h:1000});
      try{
        await client.open();await client.enter('精英菜单测试');
        await client.click('.mode-card','同盟模拟');await client.click('.diff-card','绝境模拟');
        await client.click('.create-box button','创建同盟');await client.waitFor(s=>!!s.room?.code,'room');
        await client.click('.seat--empty button','添加精英干员');await client.page.waitForSelector('[role="menuitem"]');
        assert.deepEqual(await client.page.$$eval('[role="menuitem"]',nodes=>nodes.map(n=>n.textContent.trim())),['阿尔图罗','拉维妮娅']);
        await client.page.screenshot({path:resolve(shots,`${name}-menu.png`)});
        await client.click('[role="menuitem"]','拉维妮娅');
        await client.page.waitForFunction(()=>globalThis.__SP__.store.get().room.seats.some(s=>s?.botPersona==='lavinia'));
        await client.page.waitForFunction(()=>[...document.querySelectorAll('.seat .avatar img')].some(img=>img.currentSrc.includes('char_4065_judge_2')&&img.complete&&img.naturalWidth>0));
        await client.click('.seat--empty button','添加精英干员');await client.page.waitForSelector('[role="menuitem"]');
        assert.deepEqual(await client.page.$$eval('[role="menuitem"]',nodes=>nodes.map(n=>n.disabled)),[false,true]);
        if(dual)await client.click('[role="menuitem"]','阿尔图罗');else await client.page.keyboard.press('Escape');
        if(dual)await client.page.waitForFunction(()=>[...document.querySelectorAll('.seat .avatar img')].some(img=>img.currentSrc.includes('char_245_cello')&&img.complete&&img.naturalWidth>0));
        await client.page.screenshot({path:resolve(shots,`${name}-room.png`)});
        await client.click('.room-screen button','开始模拟');await client.waitFor(s=>s.phase==='INFO_CHECK','briefing');
        await client.click('.brief__foot button','准备就绪');await client.waitFor(s=>s.phase==='BAND_DRAFT','draft');
        await client.page.waitForFunction(()=>globalThis.__SP__.store.get().match.public?.players?.some(s=>s.name==='AI拉维妮娅'&&s.bandId==='band_chiave'));
        const order=await client.page.$$eval('.dorder__name',nodes=>nodes.map(n=>n.textContent));
        assert.match(order[dual?1:0],/拉维妮娅/);if(dual)assert.match(order[0],/阿尔图罗/);
        await client.page.screenshot({path:resolve(shots,`${name}-draft.png`)});
        assert.deepEqual(client.problems.filter(s=>s.startsWith('pageerror:')),[]);
      }catch(e){console.error(client.problems);if(client.page)await client.page.screenshot({path:resolve(shots,`${name}-failure.png`)}).catch(()=>{});throw e;}
      finally{await client.close();}
    }
  }finally{await server.close();}
});
