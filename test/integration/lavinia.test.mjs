import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build, UPSTREAM_REF } from '../../addons/lavinia/build.mjs';
import { build as buildArturia } from '../../addons/arturia/build.mjs';

const repository = process.env.SP_GAME_REPO;
if (!repository) throw new Error('Set SP_GAME_REPO to a game Git checkout');
const refs = process.env.LAVINIA_TEST_REFS?.split(',') || [UPSTREAM_REF];
for (const ref of refs) for (const dual of [false, true]) {
  test(`Lavinia ${ref.slice(0,8)} ${dual ? 'with Arturia' : 'alone'}`, { timeout: 240000 }, async t => {
    mkdirSync('.cache', { recursive: true });
    const temp = mkdtempSync(resolve('.cache/lavinia-test-')), root = resolve(temp, 'game 游戏');
    mkdirSync(root);
    const archive = resolve(temp, 'host.tar');
    writeFileSync(archive, execFileSync('git', ['archive', ref], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }));
    execFileSync('tar', ['-xf', archive, '-C', root]);
    if (existsSync(resolve(repository, 'node_modules'))) symlinkSync(resolve(repository, 'node_modules'), resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const bundle = resolve(temp, 'bundle'); build(bundle);
    const { install } = await import(pathToFileURL(resolve(bundle, 'install.mjs')));
    let removeArturia;
    if (dual) {
      const artBundle = resolve(temp, 'arturia'); buildArturia(artBundle);
      const art = await import(pathToFileURL(resolve(artBundle, 'install.mjs')));
      await art.install('install', root); removeArturia = art.install;
    }
    const paths = ['server/lobby.js','server/match/bot.js','server/match/match/phases.js','public/js/screens/room.js','shared/protocol.js','public/i18n/en.json'];
    const before = new Map(paths.map(p => [p, readFileSync(resolve(root,p))]));
    await install('check',root); await install('install',root); await install('install',root);
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve(bundle,'install-windows.ps1'),'-GameDirectory',root,'-Mode','check'], {encoding:'utf8'});
    const load = p => import(pathToFileURL(resolve(root,p)));
    const harness = await load('test/match/harness.js'), adapter = await load('server/match/lavinia/index.js');
    const constants = await load('shared/constants.js');
    const seats = () => [
      {seat:0,playerId:'human',name:'AI拉维妮娅',isBot:false,connected:true},
      {seat:1,playerId:'lavinia',name:'AI拉维妮娅',isBot:true,connected:true,botPersona:'lavinia'},
      {seat:2,playerId:'other',name:dual?'AI·阿尔图罗':'AI·华法琳',isBot:true,connected:true,...(dual?{botPersona:'arturia'}:{})},
    ];
    const draft = h => {
      h.start();
      for (const ps of h.m.order) if (!ps.isBot) h.m.handle(ps.playerId,{t:'g.infoReady'});
      h.run(() => h.m.phase === 'BAND_DRAFT'); return h;
    };
    await t.test('protocol, UI and draft priority preserve ordinary order and random draws', () => {
      const ui=readFileSync(resolve(root,'public/js/screens/room.js'),'utf8');
      execFileSync(process.execPath,['--check',resolve(root,'public/js/screens/room.js')]);
      assert.ok(ui.includes('char_4065_judge')); assert.ok(ui.includes('{ e2: true }'));
      assert.equal(ui.includes('id: "arturia"'),dual);
      for (const last of [false,true]) for (let seed=1;seed<=12;seed++) {
        const h=draft(harness.makeMatch({mode:'coop',difficulty:'HARD',seats:seats(),seed,aiPicksLast:last}));
        const plain=seats().map(({botPersona,...s})=>s);
        const control=draft(harness.makeMatch({mode:'coop',difficulty:'HARD',seats:plain,seed,aiPicksLast:last}));
        try {
          const priority=dual?['other','lavinia']:['lavinia'];
          assert.deepEqual(h.m.draft.order,[...priority,...control.m.draft.order.filter(id=>!priority.includes(id))]);
          assert.equal(h.m.rngDraft(),control.m.rngDraft());
          assert.equal(adapter.isLavinia(h.m,h.ps('human')),false);
          assert.equal(h.m.bandTaken(adapter.BAND,'human'),true);
          assert.ok(h.m.handle('human',{t:'g.band',bandId:adapter.BAND}).error);
          h.run(()=>h.ps('lavinia').bandId!=null);
          assert.equal(h.ps('lavinia').bandId,adapter.BAND);
          assert.equal(h.m.defaultBand('lavinia'),adapter.BAND);
          if(dual) assert.equal(h.ps('other').bandId,'band_paganini');
          assert.notEqual(h.m.defaultBand('human'),adapter.BAND);
          assert.deepEqual(h.logs.error,[]);
        } finally {h.m.dispose();control.m.dispose();}
      }
    });
    await t.test('both policy adapters remain isolated and execute real battles through R14', () => {
      const bots=seats().filter(s=>s.isBot).map((s,seat)=>({...s,seat}));
      const h=harness.makeMatch({mode:'coop',difficulty:'HARD',seats:bots,seed:7,captureFrames:false});
      const original=h.m.opts;
      try {
        h.start().toPrep(1);h.run(()=>h.ps('lavinia').ready&&h.ps('other').ready);
        assert.equal(h.ps('lavinia')._botFocusId,adapter.CORE);
        if(dual)assert.equal(h.ps('other')._botFocusId,'lateranoShip');
        else assert.equal(h.ps('other')._botCoreCommitted,undefined);
        assert.equal(h.m.opts,original);assert.equal(h.m.opts.botFormationRoles,undefined);
        assert.deepEqual(adapter.policyView(h.m).opts.botSiracusaEngines,['promotion','hybrid','boss']);
        assert.equal(adapter.policyView(h.m).opts.botLateranoLessons,false);
        // Compatibility only: sufficient LP keeps late preparation/rehearsal APIs reachable.
        for(const ps of h.m.players.values())ps.lp=10000;
        if(h.m.teamLp!=null)h.m.teamLp=10000;
        h.toPrep(14);assert.ok(h.run(()=>h.m.round>14||h.ended!=null));
        assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
      } finally {h.m.dispose();}
    });
    await t.test('lobby accepts both identities, prevents duplicates and forwards them to Match', async () => {
      const {validateC2S}=await load('shared/protocol.js');
      assert.equal(validateC2S({t:'room.addBot',persona:'lavinia'}),null);
      assert.notEqual(validateC2S({t:'room.addBot',persona:'unknown'}),null);
      if(dual)assert.equal(validateC2S({t:'room.addBot',persona:'arturia'}),null);
      const {Lobby}=await load('server/lobby.js'),{SessionRegistry}=await load('server/net.js'),{getData}=await load('server/data.js');
      const lobby=new Lobby({registry:new SessionRegistry(),getData});
      const host={playerId:'host',name:'Host',connected:true,ws:{readyState:1,send(){}}};
      assert.equal(lobby.create(host,{mode:'coop',difficulty:'HARD'}).ok,true);
      const room=lobby.roomOf(host);
      assert.equal(lobby.addBot(host,{persona:'lavinia'}).ok,true);
      assert.equal(lobby.addBot(host,{persona:'lavinia'}).error,constants.ERR.ALREADY);
      assert.equal(lobby.addBot(host,dual?{persona:'arturia'}:{}).ok,true);
      assert.equal(lobby.setDifficulty(host,{difficulty:'FUNNY'}).error,constants.ERR.BAD_TARGET);
      assert.equal(lobby.start(host).ok,true);
      assert.equal(room.match.opts.seats.filter(s=>s.botPersona==='lavinia').length,1);
      room.match.dispose();lobby.dispose?.();
    });
    await t.test('uninstall protects edits and restores the exact previous installation', async () => {
      if(dual)await assert.rejects(removeArturia('uninstall',root),/Changed since install/);
      const path=resolve(root,'server/lobby.js'),bytes=readFileSync(path);
      writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n// user edit\n')]));
      await assert.rejects(install('uninstall',root),/Changed since install/);writeFileSync(path,bytes);
      await install('uninstall',root);
      for(const [name,bytes]of before)assert.deepEqual(readFileSync(resolve(root,name)),bytes,name);
      if(dual)await removeArturia('uninstall',root);
      for(const name of paths)assert.deepEqual(readFileSync(resolve(root,name)),execFileSync('git',['show',`${ref}:${name}`],{cwd:repository}),name);
    });
    console.log(`Lavinia fixture: ${root}`);
  });
}
