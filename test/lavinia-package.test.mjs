import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from '../addons/lavinia/build.mjs';
const root=resolve(import.meta.dirname,'..'),hash=b=>createHash('sha256').update(b).digest('hex');
test('Lavinia standalone build preserves its immutable policy and independent identity',()=>{
  mkdirSync(resolve(root,'.cache'),{recursive:true});
  const output=mkdtempSync(resolve(root,'.cache/lavinia-package-'));build(output);
  const catalog=JSON.parse(readFileSync(resolve(root,'catalog.json'))).strategies.lavinia;
  const frozen=JSON.parse(readFileSync(resolve(root,catalog.manifest)));
  assert.deepEqual(JSON.parse(readFileSync(resolve(output,'addon.json'))),frozen);
  assert.deepEqual(JSON.parse(readFileSync(resolve(root,'addons/lavinia/addon.json'))),frozen);
  assert.equal(frozen.id,'ai-lavinia');assert.equal(frozen.version,'0.1.2');
  assert.equal(frozen.name,'AI·拉维妮娅');
  const previous=JSON.parse(readFileSync(resolve(root,'releases/lavinia-v0.1.1.json')));
  assert.notDeepEqual(frozen.sources,previous.sources);
  assert.notEqual(frozen.policy,previous.policy);
  assert.ok(frozen.sources['server/match/botStrategies/siracusaLucienRight.js']);
  assert.equal(frozen.files['runtime.js'],previous.files['runtime.js'],'the named teammate adapter remains unchanged');
  assert.deepEqual(frozen.benchmark.hard,'28/28');
  assert.deepEqual(frozen.benchmark.abyss,'12/28');
  for(const [name,expected]of Object.entries(frozen.files)){
    assert.equal(hash(readFileSync(resolve(output,name))),expected,name);
    assert.equal(hash(readFileSync(resolve(root,'addons/lavinia',name))),expected,name);
  }
  for(const [name,expected]of Object.entries(frozen.sources))assert.equal(hash(readFileSync(resolve(root,catalog.sourceRoot,name))),expected,name);
});

test('every Lavinia release retains its immutable original policy snapshot',()=>{
  for(const file of readdirSync(resolve(root,'releases')).filter(f=>/^lavinia-v.*\.json$/.test(f))){
    const manifest=JSON.parse(readFileSync(resolve(root,'releases',file)));
    const source=manifest.sourceRoot||'releases/lavinia-v0.1.0/source';
    for(const [name,expected]of Object.entries(manifest.sources))
      assert.equal(hash(readFileSync(resolve(root,source,name))),expected,file+':'+name);
  }
});
