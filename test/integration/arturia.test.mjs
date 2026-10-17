import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build, UPSTREAM_REF, POLICY_REF } from '../../addons/arturia/build.mjs';

const gameRepository = process.env.SP_GAME_REPO;
if (!gameRepository) throw new Error('Set SP_GAME_REPO to an upstream game Git checkout (see docs/DEVELOPMENT.md)');
let root, bundle, runInstall, load, harness, constants, adapter;
before(async () => {
  mkdirSync('.cache', { recursive: true });
  const temp = mkdtempSync(resolve('.cache/arturia-test-'));
  root = resolve(temp, 'game 游戏'); bundle = resolve(temp, 'bundle'); mkdirSync(root);
  const tar = resolve(temp, 'upstream.tar');
  writeFileSync(tar, execFileSync('git', ['archive', process.env.ARTURIA_TEST_REF || UPSTREAM_REF], { cwd: gameRepository, maxBuffer: 64 * 1024 * 1024 }));
  execFileSync('tar', ['-xf', tar, '-C', root]);
  const dependencies = resolve(gameRepository, 'node_modules');
  if (existsSync(dependencies)) symlinkSync(dependencies, resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  build(bundle);
  ({ install: runInstall } = await import(pathToFileURL(resolve(bundle, 'install.mjs'))));
  load = path => import(pathToFileURL(resolve(root, path)));
  if (process.platform === 'win32') {
    for (const mode of ['check', 'install']) execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(bundle, 'install-windows.ps1'), '-GameDirectory', root, '-Mode', mode], { encoding: 'utf8' });
  } else await runInstall('install', root);
  harness = await load('test/match/harness.js');
  constants = await load('shared/constants.js');
  adapter = await load('server/match/arturia/index.js');
});
after(() => { console.log(`Arturia upstream fixture: ${root}`); });

const seats = () => [
  { seat: 0, playerId: 'human', name: 'AI·阿尔图罗', isBot: false, connected: true },
  { seat: 1, playerId: 'normal', name: 'AI·华法琳', isBot: true, connected: true },
  { seat: 2, playerId: 'arturia', name: 'AI·阿尔图罗', isBot: true, connected: true, botPersona: 'arturia' },
];
function draft(h) {
  h.start();
  for (const ps of h.m.order) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.run(() => h.m.phase === 'BAND_DRAFT');
  return h;
}

test('protocol accepts only an optional known persona', async () => {
  const { validateC2S } = await load('shared/protocol.js');
  for (const persona of [undefined, 'arturia']) assert.equal(validateC2S({ t: 'room.addBot', persona }), null);
  for (const persona of ['laterano', 'legacy', '', null, 123, {}, []]) assert.notEqual(validateC2S({ t: 'room.addBot', persona }), null);
});

test('Arturia always leads, preserves the remaining order and reserves Paganini against racing requests', () => {
  for (const aiPicksLast of [false, true]) for (let seed = 1; seed <= 12; seed++) {
    const h = draft(harness.makeMatch({ mode: 'coop', difficulty: 'HARD', seats: seats(), seed, aiPicksLast }));
    const normalSeats = seats().map(s => { const copy = { ...s }; delete copy.botPersona; return copy; });
    const control = draft(harness.makeMatch({ mode: 'coop', difficulty: 'HARD', seats: normalSeats, seed, aiPicksLast }));
    try {
      assert.equal(h.m.draft.order[0], 'arturia');
      assert.deepEqual(h.m.draft.order.slice(1), control.m.draft.order.filter(id => id !== 'arturia'));
      assert.equal(h.m.rngDraft(), control.m.rngDraft(), 'no extra shuffle or random draws');
      assert.equal(adapter.isArturia(h.m, h.ps('human')), false, 'a human name cannot impersonate the policy');
      assert.equal(h.m.bandTaken(adapter.BAND, 'human'), true);
      assert.equal(h.m.bandTaken(adapter.BAND, 'normal'), true);
      assert.equal(h.m.bandTaken(adapter.BAND, 'arturia'), false);
      assert.ok(h.m.handle('human', { t: 'g.band', bandId: adapter.BAND }).error, 'a racing request is rejected');
      h.run(() => h.ps('arturia').bandId != null);
      assert.equal(h.ps('arturia').bandId, adapter.BAND);
      assert.equal(h.m.defaultBand('arturia'), adapter.BAND, 'fallback keeps the promise');
      h.run(() => h.m.draftTurn() === 'human');
      assert.ok(h.m.handle('human', { t: 'g.band', bandId: adapter.BAND }).error, 'cannot take the reserved band on a legal turn either');
      assert.notEqual(h.m.defaultBand('human'), adapter.BAND);
      assert.equal(h.logs.error.length, 0);
    } finally { h.m.dispose(); control.m.dispose(); }
  }
});

test('named AI executes the frozen Laterano policy alongside upstream AI without shared option mutations', async () => {
  const { bondPlan } = await load('server/match/arturia/policy/server/match/botDevelopment.js');
  const h = harness.makeMatch({ mode: 'coop', difficulty: 'HARD', seats: seats(), seed: 7, fake: true });
  const original = h.m.opts, view = adapter.policyView(h.m);
  try {
    h.start().toPrep(1);
    h.run(() => h.ps('arturia').ready && h.ps('normal').ready);
    assert.equal(h.ps('arturia').bandId, adapter.BAND);
    assert.equal(h.ps('arturia')._botFocusId, adapter.CORE);
    assert.equal(h.ps('normal')._botCoreCommitted, undefined, 'the ordinary AI did not enter growth');
    assert.equal(h.m.opts, original);
    assert.equal(h.m.opts.botFormationRoles, undefined);
    assert.deepEqual(view.opts.botLateranoLessons, ['quintus', 'roster']);
    assert.equal(view.opts.botFormationRoles, true);
    assert.equal(view.opts.botLateranoExperiment, 'repair19-white-five');
    assert.equal(view.botRehearsal, 3);
    const recipe = bondPlan(view, h.ps('arturia')).strategy;
    assert.equal(recipe.core, adapter.CORE);
    assert.equal(recipe.forecast, true);
    assert.equal(recipe.shoppingRepair, true);
    assert.equal(recipe.developmentForecast, undefined);
    const manifest = JSON.parse(readFileSync(resolve(bundle, 'addon.json')));
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.policy, POLICY_REF);
    assert.equal(manifest.policyObject, view.opts.botLateranoExperiment);
    assert.equal(manifest.benchmark.hard, '21/28'); assert.equal(manifest.benchmark.abyss, '4/28');
    assert.deepEqual(readFileSync(resolve(root, 'addons/arturia/addon.json')), readFileSync(resolve(bundle, 'addon.json')));
    assert.ok(existsSync(resolve(root, 'addons/arturia/安装插件.bat')));
    h.invariants();
    assert.deepEqual(h.logs.error, []);
  } finally { h.m.dispose(); }
});

test('real upstream battles and later rounds accept the retained policy', () => {
  const h = harness.makeMatch({ mode: 'coop', difficulty: 'HARD', seats: seats(), seed: 7 });
  try {
    h.start().toPrep(3);
    h.run(() => h.ps('arturia').ready && h.ps('normal').ready);
    assert.equal(h.ps('arturia')._botFocusId, adapter.CORE);
    assert.deepEqual(h.logs.error, []);
    assert.deepEqual(h.logs.warn, [], 'rehearsals must not silently fall back after an engine API error');
    h.invariants();
  } finally { h.m.dispose(); }
});

test('frozen policy executes shopping and boss rehearsals through R14 on the target engine', { timeout: 180_000 }, () => {
  const h = harness.makeMatch({ mode: 'coop', difficulty: 'HARD', seed: 7, captureFrames: false,
    seats: seats().filter(s => s.isBot).map((s, seat) => ({ ...s, seat })) });
  try {
    h.start().toPrep(1);
    // Compatibility exercise, not a benchmark: prevent early elimination from skipping late APIs.
    for (const ps of h.m.players.values()) ps.lp = 10000;
    if (h.m.teamLp != null) h.m.teamLp = 10000;
    h.toPrep(14);
    assert.ok(h.run(() => h.m.round > 14 || h.ended != null), 'R14 battle completes');
    assert.deepEqual(h.logs.error, []);
    assert.deepEqual(h.logs.warn, [], 'no hidden engine API fallback in late prep or rehearsals');
    h.invariants();
  } finally { h.m.dispose(); }
});

test('lobby permissions, identity, uniqueness, room mode and seat forwarding', async () => {
  const { Lobby } = await load('server/lobby.js');
  const { SessionRegistry } = await load('server/net.js');
  const { getData } = await load('server/data.js');
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData });
  const host = { playerId: 'host', name: 'Host', connected: true, ws: { readyState: 1, send() {} } };
  const guest = { playerId: 'guest', name: 'Guest', connected: true, ws: { readyState: 1, send() {} } };
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'HARD' }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(lobby.join(guest, { code: room.code }).ok, true);
  assert.equal(lobby.addBot(guest, { persona: 'arturia' }).error, constants.ERR.NOT_HOST);
  assert.equal(lobby.addBot(host, { persona: 'arturia' }).ok, true);
  assert.equal(lobby.addBot(host, { persona: 'arturia' }).error, constants.ERR.ALREADY);
  assert.equal(lobby.addBot(host).ok, true);
  const persona = room.seats.find(s => s?.botPersona === 'arturia');
  assert.equal(persona.name, 'AI·阿尔图罗');
  assert.equal(room.seats.find(s => s?.isBot && !s.botPersona).name, 'AI·华法琳');
  assert.equal(lobby.setDifficulty(host, { difficulty: 'FUNNY' }).error, constants.ERR.BAD_TARGET);
  assert.equal(lobby.ready(guest, { ready: true }).ok, true);
  // Use the real Match so this verifies the lobby-to-match boundary, not merely a stub's options.
  assert.equal(lobby.start(host).ok, true);
  assert.equal(room.match.opts.seats.find(s => s.playerId === persona.playerId).botPersona, 'arturia');
  assert.equal(lobby.addBot(host, { persona: 'arturia' }).error, constants.ERR.ROOM_STARTED);
  room.match.dispose();
  lobby.dispose?.();
});

test('installer refuses changed anchors without partial writes; uninstall is lossless and guards later edits', async () => {
  const file = resolve(root, 'server/lobby.js');
  const installed = readFileSync(file);
  writeFileSync(file, Buffer.concat([installed, Buffer.from('\n// user edit\n')]));
  await assert.rejects(runInstall('uninstall', root), /Changed since install/);
  assert.ok(existsSync(resolve(root, '.arturia-addon/install.json')));
  writeFileSync(file, installed);
  if (process.platform === 'win32') {
    // No directory argument: find the game from the installed addons/arturia entry point.
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(root, 'addons/arturia/install-windows.ps1'), '-Mode', 'uninstall'], { encoding: 'utf8' });
  } else await runInstall('uninstall', root);
  assert.equal(existsSync(resolve(root, 'addons/arturia/install.mjs')), false, 'copied installer is removed on uninstall');
  for (const name of ['server/lobby.js', 'server/match/bot.js', 'public/i18n/en.json']) {
    assert.deepEqual(readFileSync(resolve(root, name)), execFileSync('git', ['show', `${process.env.ARTURIA_TEST_REF || UPSTREAM_REF}:${name}`], { cwd: gameRepository }));
  }
  const original = readFileSync(file);
  writeFileSync(file, original.toString().replace('addBot(session)', 'addBotRenamed(session)'));
  await assert.rejects(runInstall('install', root), /Unsupported installation/);
  assert.equal(existsSync(resolve(root, '.arturia-addon/install.json')), false);
  writeFileSync(file, original);
});
