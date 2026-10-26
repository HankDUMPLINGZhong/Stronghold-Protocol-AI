import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build, UPSTREAM_REF } from '../../addons/arturia/legacy-build.mjs';
import { build as buildLavinia } from '../../addons/lavinia/legacy-build.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stateNames = ['.arturia-addon/install.json', '.lavinia-addon/install.json'];
const journal = (root, name) => JSON.parse(readFileSync(resolve(root, name)));
function snapshot(root) {
  const names = new Set(stateNames);
  for (const name of stateNames) if (existsSync(resolve(root, name)))
    for (const file of Object.keys(journal(root, name).files)) names.add(file);
  return Object.fromEntries([...names].sort().map(name => [name,
    existsSync(resolve(root, name)) ? hash(readFileSync(resolve(root, name))) : null]));
}
async function fixture({ laviniaOnly = false, fault = false } = {}) {
  assert.ok(process.env.SP_GAME_REPO, 'Set SP_GAME_REPO');
  mkdirSync('.cache', { recursive: true });
  const temp = mkdtempSync(resolve('.cache/arturia-coexist-')), root = resolve(temp, 'game 游戏'); mkdirSync(root);
  const tar = resolve(temp, 'host.tar');
  execFileSync('git', ['archive', '--output', tar, process.env.ARTURIA_TEST_REF || UPSTREAM_REF], { cwd: process.env.SP_GAME_REPO });
  execFileSync('tar', ['-xf', tar, '-C', root]);
  const old = resolve(temp, 'old'), fresh = resolve(temp, 'fresh'), lav = resolve(temp, 'lavinia');
  build(old, { manifest: 'releases/arturia-v0.2.3.json', sourceRoot: 'releases/arturia-v0.2.3/source', runtime: 'releases/arturia-v0.2.3/runtime.js' });
  build(fresh); buildLavinia(lav);
  if (fault) {
    const path = resolve(fresh, 'install.mjs'), source = readFileSync(path, 'utf8');
    const anchor = 'for (const [name, bytes] of writes.entries()) {'; assert.ok(source.includes(anchor));
    writeFileSync(path, source.replace(anchor, anchor + "\n        if (name === 'server/match/arturia/index.js') throw new Error('Injected coexistence failure');"));
  }
  const previous = await import(pathToFileURL(resolve(old, 'install.mjs')));
  const current = await import(pathToFileURL(resolve(fresh, 'install.mjs')));
  const companion = await import(pathToFileURL(resolve(lav, 'install.mjs')));
  if (!laviniaOnly) await previous.install('install', root);
  await companion.install('install', root);
  return { root, temp, current, companion, fresh };
}

test('Arturia upgrade preserves installed Lavinia, supports read-only preflight and remains idempotent', async () => {
  const { root, current, companion } = await fixture();
  const old = snapshot(root), lavinia = journal(root, stateNames[1]);
  assert.equal((await current.install('check', root)).companionPreserved, '0.2.0');
  assert.deepEqual(snapshot(root), old);
  const result = await current.install('install', root);
  assert.equal(result.upgradedFrom, '0.2.3'); assert.equal(result.installed, '0.2.4');
  assert.equal(result.companionPreserved, '0.2.0');
  assert.equal(journal(root, stateNames[1]).version, '0.2.0');
  for (const [name, entry] of Object.entries(lavinia.files))
    if (name.startsWith('server/match/lavinia/') || name.startsWith('addons/lavinia/'))
      assert.equal(hash(readFileSync(resolve(root, name))), entry.after, name);
  assert.equal((await companion.install('check', root)).alreadyInstalled, true);
  const upgraded = snapshot(root);
  assert.equal((await current.install('install', root)).alreadyInstalled, true);
  assert.deepEqual(snapshot(root), upgraded);
  const load = name => import(pathToFileURL(resolve(root, name)));
  const { makeMatch } = await load('test/match/harness.js');
  const h = makeMatch({mode:'coop',difficulty:'HARD',seed:7,fake:true,seats:[
    {seat:0,playerId:'lavinia',isBot:true,connected:true,botPersona:'lavinia'},
    {seat:1,playerId:'arturia',isBot:true,connected:true,botPersona:'arturia'},
  ]});
  try {
    h.start().toPrep(1); h.run(() => h.m.order.every(ps => ps.ready));
    assert.equal(h.ps('arturia').bandId,'band_paganini'); assert.equal(h.ps('lavinia').bandId,'band_chiave');
    assert.deepEqual(h.logs.error,[]); assert.deepEqual(h.logs.warn,[]); h.invariants();
  } finally { h.m.dispose(); }
  const arturia = journal(root,stateNames[0]);
  await companion.install('uninstall',root); await current.install('uninstall',root);
  for (const [name,entry] of Object.entries(arturia.files)) {
    if (entry.before == null) assert.equal(existsSync(resolve(root,name)),false,name);
    else assert.deepEqual(readFileSync(resolve(root,name)),Buffer.from(entry.before,'base64'),name);
  }
});

test('edited companion files block the entire upgrade without changing either installation', async () => {
  const { root, current } = await fixture();
  const path = resolve(root,'server/match/lavinia/index.js');
  writeFileSync(path,Buffer.concat([readFileSync(path),Buffer.from('// local edit\n')]));
  const before=snapshot(root);
  await assert.rejects(current.install('check',root),/Changed since install/);
  await assert.rejects(current.install('install',root),/Changed since install/);
  assert.deepEqual(snapshot(root),before);
});

test('a failure while committing a coexistence upgrade restores both journals and all original bytes', async () => {
  const { root, current } = await fixture({fault:true}); const before=snapshot(root);
  await assert.rejects(current.install('install',root),/Injected coexistence failure/);
  assert.deepEqual(snapshot(root),before);
  assert.equal(existsSync(resolve(root,'.arturia-addon/coexist-upgrade.json')),false);
  assert.equal(existsSync(resolve(root,'server/match/arturia/policy/server/match/botStrategies/lateranoCoopRegressionFactors.js')),false);
});

test('interrupted coexistence upgrades recover both plugins before retrying', async () => {
  const { root, current } = await fixture({fault:true}); const before=snapshot(root);
  const files=Object.fromEntries(Object.keys(before).map(name=>[name,readFileSync(resolve(root,name)).toString('base64')]));
  writeFileSync(resolve(root,'.arturia-addon/coexist-upgrade.json'),JSON.stringify({files}));
  writeFileSync(resolve(root,'shared/protocol.js'),'partial');
  writeFileSync(resolve(root,stateNames[1]),'partial journal');
  await assert.rejects(current.install('check',root),/Interrupted coexistence upgrade/);
  await assert.rejects(current.install('install',root),/Injected coexistence failure/);
  assert.deepEqual(snapshot(root),before);
});

test('Arturia can be installed after Lavinia without removing or upgrading the companion', async () => {
  const { root,current,companion }=await fixture({laviniaOnly:true});
  assert.equal((await current.install('install',root)).companionPreserved,'0.2.0');
  assert.equal((await companion.install('check',root)).alreadyInstalled,true);
  await companion.install('uninstall',root); await current.install('uninstall',root);
  assert.equal(existsSync(resolve(root,'server/match/arturia/index.js')),false);
  assert.equal(existsSync(resolve(root,'server/match/lavinia/index.js')),false);
});
