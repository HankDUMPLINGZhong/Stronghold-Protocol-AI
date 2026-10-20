import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from '../addons/arturia/build.mjs';
const root=resolve(import.meta.dirname,'..'),hash=b=>createHash('sha256').update(b).digest('hex');
const released=JSON.parse(readFileSync(resolve(root,'catalog.json'))).strategies.arturia;
const frozen=JSON.parse(readFileSync(resolve(root,released.manifest)));
test('standalone build reproduces all released policy and runtime hashes',()=>{
  mkdirSync(resolve(root,'.cache'),{recursive:true});
  const output=mkdtempSync(resolve(root,'.cache/package-test-'));
  build(output);
  const manifest=JSON.parse(readFileSync(resolve(output,'addon.json')));
  assert.deepEqual(manifest,frozen);
  for(const [name,expected] of Object.entries(manifest.files))assert.equal(hash(readFileSync(resolve(output,name))),expected,name);
  for(const f of ['安装插件.bat','install-windows.ps1','install.mjs','patches.mjs','README.md','CHANGELOG.md','LICENSE'])assert.ok(readFileSync(resolve(output,f)).length>0,f);
});
test('the checked-in addon is the same verified release',()=>{
  const meta=JSON.parse(readFileSync(resolve(root,'addons/arturia/addon.json')));
  assert.deepEqual(meta,frozen);
  for(const [name,expected]of Object.entries(meta.files))assert.equal(hash(readFileSync(resolve(root,'addons/arturia',name))),expected,name);
});
test('released source snapshot retains its original provenance',()=>{
  for(const [name,expected]of Object.entries(frozen.sources))assert.equal(hash(readFileSync(resolve(root,released.sourceRoot,name))),expected,name);
});

test('every previous release keeps its complete immutable source snapshot',()=>{
  for(const file of readdirSync(resolve(root,'releases')).filter(f=>/^arturia-v.*\.json$/.test(f))){
    const manifest=JSON.parse(readFileSync(resolve(root,'releases',file)));
    for(const [name,expected]of Object.entries(manifest.sources))
      assert.equal(hash(readFileSync(resolve(root,'releases',file.slice(0,-5),'source',name))),expected,file+':'+name);
  }
});
test('published headline benchmark has complete same-opening controls',()=>{
  const results=JSON.parse(readFileSync(resolve(root,'benchmarks/results.json')));
  for(const [name,wins]of [['legacy-laterano',[4,0]],['laterano',[27,16]],['legacy-siracusa',[3,0]],['siracusa',[28,12]]]){
    for(const [i,d]of ['HARD','ABYSS'].entries()){
      const rows=results.matches[name].filter(x=>x.config===`solo:${d}`);
      assert.equal(rows.length,28);assert.equal(rows.filter(x=>x.victory).length,wins[i]);
    }
  }
});
