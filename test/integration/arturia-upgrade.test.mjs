import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build, UPSTREAM_REF } from '../../addons/arturia/build.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
let root, fresh, previous, install, oldInstall, temp, oldMeta;
const journal = () => JSON.parse(readFileSync(resolve(root, '.arturia-addon/install.json')));
const snapshot = () => Object.fromEntries(['.arturia-addon/install.json', ...Object.keys(journal().files)]
  .map(name => [name, sha(readFileSync(resolve(root, name)))]));
before(async () => {
  assert.ok(process.env.SP_GAME_REPO, 'Set SP_GAME_REPO to an upstream checkout');
  mkdirSync('.cache', { recursive: true }); temp = mkdtempSync(resolve('.cache/arturia-upgrade-'));
  root = resolve(temp, 'game'); mkdirSync(root);
  const tar = resolve(temp, 'game.tar');
  execFileSync('git', ['archive', '--output', tar, process.env.ARTURIA_TEST_REF || UPSTREAM_REF],
    { cwd: process.env.SP_GAME_REPO });
  execFileSync('tar', ['-xf', tar, '-C', root]);
  fresh = resolve(temp, 'new'); previous = resolve(temp, 'old'); build(fresh);
  build(previous, { manifest: 'releases/arturia-v0.2.0.json', sourceRoot: 'releases/arturia-v0.2.0/source', runtime: 'releases/arturia-v0.2.0/runtime.js' });
  oldMeta = JSON.parse(readFileSync(resolve(previous, 'addon.json')));
  assert.notEqual(oldMeta.files['runtime.js'], JSON.parse(readFileSync(resolve(fresh, 'addon.json'))).files['runtime.js']);
  // Add one obsolete payload to the real prior policy to exercise cleanup as well as migration.
  const obsolete = 'policy/obsolete.js'; writeFileSync(resolve(previous, obsolete), 'export const previous = true;\n');
  oldMeta.files[obsolete] = sha(readFileSync(resolve(previous, obsolete)));
  writeFileSync(resolve(previous, 'addon.json'), JSON.stringify(oldMeta));
  ({ install } = await import(pathToFileURL(resolve(fresh, 'install.mjs'))));
  ({ install: oldInstall } = await import(pathToFileURL(resolve(previous, 'install.mjs'))));
  await oldInstall('install', root);
});

test('upgrade preflight is read-only; edited old files and downgrades are rejected before writes', async () => {
  const before = snapshot(); assert.equal((await install('check', root)).compatible, true); assert.deepEqual(snapshot(), before);
  const path = resolve(root, 'server/match/arturia/index.js'), bytes = readFileSync(path);
  writeFileSync(path, Buffer.concat([bytes, Buffer.from('// user edit\n')])); const edited = snapshot();
  await assert.rejects(install('install', root), /Changed since install/); assert.deepEqual(snapshot(), edited);
  writeFileSync(path, bytes);
  writeFileSync(resolve(previous, 'addon.json'), JSON.stringify({ ...oldMeta, version: '0.1.0' }));
  await assert.rejects(oldInstall('install', root), /newer/); assert.deepEqual(snapshot(), before);
  writeFileSync(resolve(previous, 'addon.json'), JSON.stringify(oldMeta));
});

test('install upgrades a recorded old version, removes obsolete payloads and is idempotent', async () => {
  const old = journal(), result = await install('install', root), current = journal();
  assert.equal(result.upgradedFrom, '0.2.0'); assert.equal(current.version, '0.2.1');
  assert.equal(existsSync(resolve(root, 'server/match/arturia/policy/obsolete.js')), false);
  for (const [name, entry] of Object.entries(current.files)) {
    assert.equal(sha(readFileSync(resolve(root, name))), entry.after, name);
    if (Object.hasOwn(old.files, name)) assert.equal(entry.before, old.files[name].before, 'original bytes preserved: ' + name);
  }
  const before = snapshot(); assert.equal((await install('install', root)).alreadyInstalled, true); assert.deepEqual(snapshot(), before);
  assert.equal(existsSync(resolve(root, '.arturia-addon/upgrade.json')), false);
});

test('an injected failure after partial replacement restores the exact previous installation', async () => {
  await install('uninstall', root); await oldInstall('install', root); const before = snapshot();
  const fault = resolve(temp, 'fault'); cpSync(fresh, fault, { recursive: true });
  const path = resolve(fault, 'install.mjs'), source = readFileSync(path, 'utf8');
  const anchor = 'for (const [name, bytes] of writes) {'; assert.ok(source.includes(anchor));
  writeFileSync(path, source.replace(anchor, anchor + "\n        if (name === 'server/match/arturia/index.js') throw new Error('Injected upgrade failure');"));
  const { install: failing } = await import(pathToFileURL(path));
  await assert.rejects(failing('install', root), /Injected upgrade failure/);
  assert.deepEqual(snapshot(), before); assert.equal(existsSync(resolve(root, '.arturia-addon/upgrade.json')), false);
});

test('a persistent interrupted-upgrade backup recovers before retry, and uninstall restores host originals', async () => {
  const old = journal(), bytes = readFileSync(resolve(root, '.arturia-addon/install.json'));
  const extra = 'server/match/arturia/interrupted.js';
  const files = Object.fromEntries(Object.keys(old.files).map(name => [name, readFileSync(resolve(root, name)).toString('base64')])); files[extra] = null;
  writeFileSync(resolve(root, '.arturia-addon/upgrade.json'), JSON.stringify({ journal: bytes.toString('base64'), files }));
  writeFileSync(resolve(root, extra), 'partial'); writeFileSync(resolve(root, 'shared/protocol.js'), 'partial');
  writeFileSync(resolve(root, '.arturia-addon/install.json'), 'partial');
  await assert.rejects(install('check', root), /Interrupted upgrade/);
  assert.equal((await install('install', root)).upgradedFrom, '0.2.0');
  assert.equal(existsSync(resolve(root, extra)), false);
  const current = journal(); await install('uninstall', root);
  for (const [name, entry] of Object.entries(current.files)) {
    const path = resolve(root, name);
    if (entry.before == null) assert.equal(existsSync(path), false, name);
    else assert.deepEqual(readFileSync(path), Buffer.from(entry.before, 'base64'), name);
  }
});
