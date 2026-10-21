import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const load=f=>JSON.parse(readFileSync(resolve(root,'benchmarks',f),'utf8'));
const suite=load('enemy-diversity-v1.json'),results=load('results.json'),policies=load('policies.json');
assert.equal(suite.id,'enemy-diversity-v1');
assert.equal(suite.selection.usesOutcomes,false);
assert.equal(suite.selection.candidatesPerDifficulty,10000);
assert.equal(suite.randomBans,false);
assert.equal(suite.cases.length,56);
assert.equal(createHash('sha256').update(JSON.stringify(suite)).digest('hex'),results.suiteSha256);
const expected={'legacy-laterano':[4,0],laterano:[28,20],'legacy-siracusa':[3,0],siracusa:[28,12]};
for(const [i,d]of ['HARD','ABYSS'].entries()){
  const cases=suite.cases.filter(c=>c.config===`solo:${d}`);
  assert.equal(cases.length,28);assert.equal(new Set(cases.map(c=>c.seed)).size,28);
  for(const field of ['bossId','stageId']){
    const counts=new Map();for(const c of cases)counts.set(c[field],(counts.get(c[field])||0)+1);
    assert.equal(counts.size,7);assert.ok([...counts.values()].every(n=>n===4));
  }
  const factions=new Map();for(const c of cases)for(const f of c.factions)factions.set(f,(factions.get(f)||0)+1);
  assert.equal(factions.size,6);assert.ok([...factions.values()].every(n=>n===14));
  for(const [name,wins]of Object.entries(expected)){
    assert.ok(policies[name]);
    const rows=results.matches[name].filter(c=>c.config===`solo:${d}`);
    assert.equal(rows.length,28);assert.deepEqual(rows.map(c=>c.seed).sort((a,b)=>a-b),cases.map(c=>c.seed).sort((a,b)=>a-b));
    assert.equal(rows.filter(c=>c.victory).length,wins[i],name+' '+d);
  }
}
assert.equal(results.totalMatches,224);
assert.deepEqual(Object.keys(results.matches).sort(),Object.keys(expected).sort());
console.log('Verified: 56 fixed cases, 4 complete variants / 224 results, outcome-blind selection; Laterano28/20 and Siracusa28/12.');
