// Reproduce the reported ordinary-AI fallback when files are installed into an already loaded server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build as buildArturia } from '../../addons/arturia/build.mjs';
import { build as buildLavinia } from '../../addons/lavinia/build.mjs';

test('v0.3.1 running before installation keeps the original addBot handler until restart', { timeout: 120_000 }, async () => {
  const repository = process.env.SP_GAME_REPO;
  assert.ok(repository, 'Set SP_GAME_REPO');
  mkdirSync('.cache', { recursive: true });
  const temp = mkdtempSync(resolve('.cache/stale-server-')), root = resolve(temp, 'game');
  mkdirSync(root);
  const archive = resolve(temp, 'game.tar');
  execFileSync('git', ['archive', '--output', archive, process.env.ARTURIA_TEST_REF || 'b3deebdae4a92642c007d217a1a4573e5d3612c5'], { cwd: repository });
  execFileSync('tar', ['-xf', archive, '-C', root]);
  if (existsSync(resolve(repository, 'node_modules')))
    symlinkSync(resolve(repository, 'node_modules'), resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const load = name => import(pathToFileURL(resolve(root, name)));
  const { startServer } = await load('server/index.js');
  const { TestClient } = await load('test/helpers/wsClient.js');
  const errors = [], log = { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) };
  const server = await startServer({ port: 0, host: '127.0.0.1', assetIndex: false, log });
  let client;
  try {
    const arturia = resolve(temp, 'arturia'), lavinia = resolve(temp, 'lavinia');
    buildArturia(arturia); buildLavinia(lavinia);
    const art = await import(pathToFileURL(resolve(arturia, 'install.mjs')));
    const lav = await import(pathToFileURL(resolve(lavinia, 'install.mjs')));
    await art.install('install', root); await lav.install('install', root);
    client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    await client.hello('缓存复现');
    assert.equal((await client.request({ t: 'room.create', mode: 'coop', difficulty: 'HARD' })).t, 'ok');
    await client.waitFor('room.state');
    const observed = [];
    for (const persona of ['arturia', 'lavinia']) {
      client.clearInbox();
      assert.equal((await client.request({ t: 'room.addBot', persona })).t, 'ok');
      const state = await client.waitFor('room.state');
      const bots = state.seats.filter(s => s?.isBot);
      assert.equal(bots.length, observed.length + 1);
      const added = bots.at(-1);
      assert.equal(added.botPersona, undefined);
      assert.equal(added.name, observed.length ? 'AI·阿米娅' : 'AI·华法琳');
      observed.push({ requested: persona, returned: added.name });
    }
    const publicSource = await fetch(`http://127.0.0.1:${server.port}/js/screens/room.js`).then(r => r.text());
    assert.ok(publicSource.includes('ELITE_RECRUITS'), 'the server already serves the newly installed elite menu');
    assert.deepEqual(errors, []);
    console.log('Reproduced stale server:', JSON.stringify(observed));
  } finally {
    await client?.terminate();
    await server.close();
  }
  // A fresh process is necessary: closing the HTTP listener alone does not clear Node's ESM module cache.
  const probe = `
    const {startServer} = await import(${JSON.stringify(pathToFileURL(resolve(root, 'server/index.js')).href)});
    const {TestClient} = await import(${JSON.stringify(pathToFileURL(resolve(root, 'test/helpers/wsClient.js')).href)});
    const quiet = {info(){},warn(){},error(){},debug(){}};
    const server = await startServer({port:0,host:'127.0.0.1',assetIndex:false,log:quiet});
    let client;
    try {
      client = await TestClient.connect('ws://127.0.0.1:'+server.port+'/ws');
      await client.hello('重启验证');
      await client.request({t:'room.create',mode:'coop',difficulty:'HARD'});
      await client.waitFor('room.state');
      for(const persona of ['arturia','lavinia']) {
        client.clearInbox();
        const reply = await client.request({t:'room.addBot',persona});
        if(reply.t !== 'ok') throw new Error(JSON.stringify(reply));
        await client.waitFor('room.state');
      }
      await client.request({t:'room.start'});
      await client.request({t:'g.infoReady'});
      const state = await client.waitFor('m.public', s => s.players?.some(p => p.name === 'AI·阿尔图罗' && p.bandId === 'band_paganini') && s.players?.some(p => p.name === 'AI·拉维妮娅' && p.bandId === 'band_chiave'));
      console.log(JSON.stringify(state.players.filter(p=>p.isBot).map(p=>({name:p.name,band:p.bandId}))));
    } finally {await client?.terminate();await server.close();}
  `;
  const restarted = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 60_000 }).trim());
  assert.deepEqual(restarted, [
    { name: 'AI·阿尔图罗', band: 'band_paganini' },
    { name: 'AI·拉维妮娅', band: 'band_chiave' },
  ]);
});
