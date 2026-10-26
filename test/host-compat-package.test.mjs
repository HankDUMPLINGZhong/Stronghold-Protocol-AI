import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const repo=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const cat=JSON.parse(fs.readFileSync(resolve(repo,'catalog.json')));
for(const [id,oldVersion] of [['arturia','0.2.4'],['lavinia','0.2.0'],['zumama','0.1.0']]){
  test(`${id} compatibility patch retains the adopted policy and verifies every portable file`,()=>{
    const meta=JSON.parse(fs.readFileSync(resolve(repo,cat.strategies[id].manifest)));
    const old=JSON.parse(fs.readFileSync(resolve(repo,`releases/${id}-v${oldVersion}.json`)));
    assert.equal(meta.policy,old.policy);assert.deepEqual(meta.sources,old.sources);
    assert.deepEqual(meta.benchmark,old.benchmark);assert.equal(meta.files['runtime.js'],old.files['runtime.js']);
    const changed=Object.keys(old.files).filter(p=>old.files[p]!==meta.files[p]);
    assert.ok(changed.length>0);
    assert.ok(changed.every(p=>p.endsWith('/botDevelopment.js')),JSON.stringify(changed));
    for(const[p,h]of Object.entries(meta.portableFiles)){
      const path=p.startsWith('common/')?'addons/shared/'+p.slice(7):p==='LICENSE'?p:`addons/${id}/${p}`;
      assert.equal(sha(fs.readFileSync(resolve(repo,path))),h,path);
    }
    assert.ok(meta.files['compat/settlement.js']);
  });
  test(`${id} historical installer remains byte-exact`,()=>{
    const folder=resolve(repo,`releases/${id}-v${oldVersion}/installer`);
    const snapshot=JSON.parse(fs.readFileSync(resolve(folder,'sha256.json')));
    for(const[p,h]of Object.entries(snapshot.files))assert.equal(sha(fs.readFileSync(resolve(folder,p))),h,p);
  });
}
