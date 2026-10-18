import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync} from 'node:fs';
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
  assert.equal(frozen.id,'ai-lavinia');assert.equal(frozen.version,'0.1.1');
  assert.equal(frozen.name,'AI·拉维妮娅');
  const previous=JSON.parse(readFileSync(resolve(root,'releases/lavinia-v0.1.0.json')));
  assert.deepEqual(frozen.sources,previous.sources);
  assert.deepEqual(frozen.files,previous.files);
  assert.equal(frozen.policy,previous.policy);
  for(const [name,expected]of Object.entries(frozen.files)){
    assert.equal(hash(readFileSync(resolve(output,name))),expected,name);
    assert.equal(hash(readFileSync(resolve(root,'addons/lavinia',name))),expected,name);
  }
  for(const [name,expected]of Object.entries(frozen.sources))assert.equal(hash(readFileSync(resolve(root,catalog.sourceRoot,name))),expected,name);
});
