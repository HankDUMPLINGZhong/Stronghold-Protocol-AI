import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,cpSync,symlinkSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {build,UPSTREAM_REF} from '../../addons/lavinia/build.mjs';import {build as buildArturia} from '../../addons/arturia/build.mjs';
const repo=process.env.SP_GAME_REPO;if(!repo)throw new Error('Set SP_GAME_REPO');
const source=resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
for(const ref of process.env.LAVINIA_TEST_REFS?.split(',')||[UPSTREAM_REF])for(const dual of [false,true]){
 test(`Lavinia real v0.1.0 to v0.1.1 name upgrade ${ref.slice(0,8)} dual=${dual}`,async()=>{
  mkdirSync('.cache',{recursive:true});const temp=mkdtempSync(resolve('.cache/lavinia-upgrade-')),root=resolve(temp,'game');mkdirSync(root);
  const tar=resolve(temp,'host.tar');execFileSync('git',['archive','--output',tar,ref],{cwd:repo});execFileSync('tar',['-xf',tar,'-C',root]);
  if(existsSync(resolve(repo,'node_modules')))symlinkSync(resolve(repo,'node_modules'),resolve(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const fresh=resolve(temp,'fresh'),old=resolve(temp,'old');build(fresh);cpSync(fresh,old,{recursive:true});
  cpSync(resolve(source,'test/fixtures/lavinia-v0.1.0-patches.mjs'),resolve(old,'patches.mjs'));
  const oldMeta=JSON.parse(readFileSync(resolve(source,'releases/lavinia-v0.1.0.json')));writeFileSync(resolve(old,'addon.json'),JSON.stringify(oldMeta));
  const {install}=await import(pathToFileURL(resolve(fresh,'install.mjs'))),{install:previous}=await import(pathToFileURL(resolve(old,'install.mjs')));
  let art;if(dual){const folder=resolve(temp,'arturia');buildArturia(folder);art=(await import(pathToFileURL(resolve(folder,'install.mjs')))).install;await art('install',root);}
  const target=resolve(root,'server/lobby.js'),before=readFileSync(target);await previous('install',root);
  assert.ok(readFileSync(target,'utf8').includes("'AI拉维妮娅'"));
  const oldJournal=JSON.parse(readFileSync(resolve(root,'.lavinia-addon/install.json')));
  const policy=new Map(Object.keys(oldMeta.files).map(name=>{const path='server/match/lavinia/'+(name==='runtime.js'?'index.js':name);return[path,hash(readFileSync(resolve(root,path)))];}));
  await install('check',root);const result=await install('install',root);assert.equal(result.upgradedFrom,'0.1.0');assert.equal(result.installed,'0.1.1');
  assert.ok(readFileSync(target,'utf8').includes("'AI·拉维妮娅'"));assert.equal(readFileSync(target,'utf8').includes("'AI拉维妮娅'"),false);
  for(const [path,digest]of policy)assert.equal(hash(readFileSync(resolve(root,path))),digest,path);
  const journal=JSON.parse(readFileSync(resolve(root,'.lavinia-addon/install.json')));for(const [path,entry]of Object.entries(oldJournal.files))assert.equal(journal.files[path]?.before,entry.before,path);
  assert.equal((await install('install',root)).alreadyInstalled,true);await assert.rejects(previous('install',root),/newer/);
  const {Lobby}=await import(pathToFileURL(resolve(root,'server/lobby.js'))),{SessionRegistry}=await import(pathToFileURL(resolve(root,'server/net.js'))),{getData}=await import(pathToFileURL(resolve(root,'server/data.js')));
  const lobby=new Lobby({registry:new SessionRegistry(),getData}),host={playerId:'host',name:'Host',connected:true,ws:{readyState:1,send(){}}};
  assert.equal(lobby.create(host,{mode:'coop',difficulty:'HARD'}).ok,true);assert.equal(lobby.addBot(host,{persona:'lavinia'}).ok,true);
  assert.equal(lobby.roomOf(host).seats.find(s=>s?.botPersona==='lavinia').name,'AI·拉维妮娅');lobby.dispose?.();
  await install('uninstall',root);assert.deepEqual(readFileSync(target),before);if(art)await art('uninstall',root);
  assert.deepEqual(readFileSync(target),execFileSync('git',['show',`${ref}:server/lobby.js`],{cwd:repo}));
 });
}
