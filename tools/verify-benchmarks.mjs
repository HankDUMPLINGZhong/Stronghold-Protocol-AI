import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {laviniaRows} from './release-lavinia-report.mjs';
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

const zsolo=load('zumama-v0.1.0-solo.json'),zcoop=load('zumama-v0.1.0-multiplayer.json');
const zcontrol=load('zumama-v0.1.0-same-opening-controls.json'),zvalidation=load('zumama-v0.1.0-validation.json');
const coopSuite=load('coop-abyss-diversity-v1.json');
assert.equal(zsolo.suiteSha256,results.suiteSha256);
assert.equal(zcontrol.suiteSha256,results.suiteSha256);
assert.equal(createHash('sha256').update(JSON.stringify(coopSuite)).digest('hex'),zcoop.suiteSha256);
for(const [i,d]of ['HARD','ABYSS'].entries()){
  const seeds=suite.cases.filter(c=>c.config===`solo:${d}`).map(c=>c.seed).sort((a,b)=>a-b);
  const own=zsolo.matches.filter(g=>g.difficulty===d),control=zcontrol.matches.filter(g=>g.config===`solo:${d}`);
  for(const games of [own,control]){
    assert.deepEqual(games.map(g=>g.seed).sort((a,b)=>a-b),seeds);
    assert.ok(games.every(g=>g.errors===0));
  }
  assert.ok(own.every(g=>g.completed));
  assert.equal(own.filter(g=>g.victory).length,[28,15][i]);
  assert.equal(control.filter(g=>g.victory).length,[2,0][i]);
}
for(const [scenario,wins]of [['zumama2',18],['zumama4',13]]){
  const games=zcoop.matches.filter(g=>g.scenario===scenario);
  assert.equal(games.length,56);assert.equal(games.filter(g=>g.victory).length,wins);
  assert.deepEqual(games.map(g=>g.seed).sort((a,b)=>a-b),coopSuite.cases.map(g=>g.seed).sort((a,b)=>a-b));
}
assert.equal(zvalidation.complete,true);assert.equal(zvalidation.allFieldsExact,true);
assert.equal(zvalidation.matches.length,168);assert.ok(zvalidation.matches.every(g=>g.exact&&g.different.length===0));
assert.equal(zsolo.policy,zvalidation.policy);assert.equal(zcoop.policy,zvalidation.policy);
console.log('Verified: Zumama 168 exact common-runtime replays, solo28/15, co-op18/13, same-Pepe controls2/0; complete frozen seed sets.');

const lcoop=load('lavinia-v0.2.2-multiplayer.json'),lsolo=load('lavinia-v0.2.2-solo.json');
for(const scenario of ['siracusa2','siracusa4']){
  const games=lcoop.matches.filter(g=>g.scenario===scenario);
  assert.equal(games.length,56);assert.equal(games.filter(g=>g.victory).length,13);
  assert.deepEqual(games.map(g=>g.seed).sort((a,b)=>a-b),coopSuite.cases.map(g=>g.seed).sort((a,b)=>a-b));
  for(const g of games)assert.equal(g.uniteEvidence.reduce((n,r)=>n+r.creditedToLavinia,0),g.lavinia.uniteKills);
}
assert.deepEqual(laviniaRows(lcoop.matches),lcoop.rows);
assert.equal(lsolo.matches.length,28);assert.equal(lsolo.matches.filter(g=>g.victory).length,12);
assert.deepEqual(lsolo.matches.map(g=>g.seed).sort((a,b)=>a-b),suite.cases.filter(c=>c.config==='solo:ABYSS').map(c=>c.seed).sort((a,b)=>a-b));
console.log('Verified: Lavinia solo12/28 and both co-op13/56; complete fixed seed sets and personal attributed metrics.');
