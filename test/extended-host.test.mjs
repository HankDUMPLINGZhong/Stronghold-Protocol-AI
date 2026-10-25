import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deserialize } from 'node:v8';
import { build as buildArturia } from '../addons/arturia/build.mjs';
import { build as buildLavinia } from '../addons/lavinia/build.mjs';
import { patchFiles as patchArturia, PATCH_PATHS } from '../addons/arturia/patches.mjs';
import { patchFiles as patchLavinia } from '../addons/lavinia/patches.mjs';

const dual=true;
const cache=path.resolve('.cache'); fs.mkdirSync(cache,{recursive:true});
const temp=fs.mkdtempSync(path.join(cache,'extended-compat-'));
const base=process.env.SP_BASE_REPO;
test('original upstream produces byte-identical patches for either plugin and coexistence', {skip:!base}, async () => {
  const originals={};
  for (const id of ['arturia','lavinia']) {
    const file=path.join(temp,`original-${id}.mjs`);
    fs.writeFileSync(file,execFileSync('git',['show',`042bae6:addons/${id}/patches.mjs`],{cwd:path.resolve('.')}));
    originals[id]=(await import(pathToFileURL(file))).patchFiles;
  }
  for (const ref of ['3e589285584828a20075893a0575a9e5660dcc10','b3deebdae4a92642c007d217a1a4573e5d3612c5','c9d804f470b8d7422ae04eb66faf671cef21ad52']) {
    const names=[...PATCH_PATHS,...execFileSync('git',['ls-tree','-r','--name-only',ref,'public/i18n'],{cwd:base,encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.json'))];
    const files=new Map(names.map(p=>[p,execFileSync('git',['show',`${ref}:${p}`],{cwd:base,encoding:'utf8',maxBuffer:8e6}).replaceAll('\r\n','\n')]));
    assert.deepEqual(patchArturia(files),originals.arturia(files),`${ref} Arturia`);
    assert.deepEqual(patchLavinia(files),originals.lavinia(files),`${ref} Lavinia`);
    assert.deepEqual(patchLavinia(patchArturia(files)),originals.lavinia(originals.arturia(files)),`${ref} coexistence`);
  }
});

test('extended host: explicit detection, grouped draft, recovery and exact uninstall', {skip:!process.env.SP_GAME_REPO}, async t => {
  const source=process.env.SP_GAME_REPO,ref=process.env.ARTURIA_TEST_REF||'HEAD';
  const root=path.join(temp,'game'),tar=path.join(temp,'host.tar'); fs.mkdirSync(root);
  execFileSync('git',['archive','--output',tar,ref],{cwd:source}); execFileSync('tar',['-xf',tar,'-C',root]);
  fs.symlinkSync(path.resolve(source,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  const artBundle=path.join(temp,'arturia'),lavBundle=path.join(temp,'lavinia'); buildArturia(artBundle);buildLavinia(lavBundle);
  const art=(await import(pathToFileURL(path.join(artBundle,'install.mjs')))).install;
  const lav=(await import(pathToFileURL(path.join(lavBundle,'install.mjs')))).install;
  const names=[...PATCH_PATHS,'server/match/rewind.js',...fs.readdirSync(path.join(root,'public/i18n')).filter(p=>p.endsWith('.json')).map(p=>'public/i18n/'+p)];
  const before=new Map(names.map(p=>[p,fs.readFileSync(path.join(root,p))]));
  const load=p=>import(pathToFileURL(path.join(root,p)));
  await t.test('check is read-only; Arturia installer generates valid UI modules',async()=>{
    await art('check',root);if(dual)await lav('check',root);
    for(const[p,b]of before)assert.deepEqual(fs.readFileSync(path.join(root,p)),b);
    const damaged=new Map([...before].map(([p,b])=>[p,b.toString('utf8').replaceAll('\r\n','\n')]));
    damaged.set('public/js/screens/room.js',damaged.get('public/js/screens/room.js').replace('portraits, onPickCard','unknownPortraits, onPickCard'));
    assert.throws(()=>patchArturia(damaged),/Unsupported extended host/);
    await art('install',root);if(dual)await lav('install',root);
    execFileSync(process.execPath,['--check',path.join(root,'public/js/screens/room.js')]);
  });
  const {makeMatch,DATA}=await load('test/match/harness.js');
  const artAdapter=await load('server/match/arturia/index.js'),lavAdapter=dual?await load('server/match/lavinia/index.js'):null;
  const {extendedPolicyMatch}=await load('server/match/bot.js');
  await t.test('4/5/8/20 seats: elites lead their own groups, other groups retain bands and RNG',()=>{
    for(const count of [4,5,8,20])for(const last of [false,true])for(const seed of [1,7]){
      const seats=Array.from({length:count},(_,seat)=>({seat,playerId:'p'+seat,name:'P'+seat,isBot:false,connected:true}));
      seats[3]={...seats[3],isBot:true,botPersona:'arturia'};
      const lavSeat=count===4?2:4;if(dual)seats[lavSeat]={...seats[lavSeat],isBot:true,botPersona:'lavinia'};
      const options={mode:'coop',difficulty:'HARD',fake:true,seed,aiPicksLast:last,seats};
      const h=makeMatch(options),control=makeMatch({...options,seats:seats.map(({botPersona,...s})=>s)});
      const start=x=>{x.start();for(const s of seats)if(!s.isBot)x.m.handle(s.playerId,{t:'g.infoReady'});x.run(()=>x.m.phase==='BAND_DRAFT');};
      try{
        start(h);start(control);
        for(const [i,g]of h.m.draft.groups.entries()){
          const priority=(dual?['p3','p'+lavSeat]:['p3']).filter(id=>g.playerIds.includes(id));
          assert.deepEqual(g.order,[...priority,...control.m.draft.groups[i].order.filter(id=>!priority.includes(id))]);
          for(const pid of g.playerIds.filter(id=>!priority.includes(id))) {
            assert.equal(h.m.bandTaken('band_paganini',pid),g.playerIds.includes('p3'));
            assert.equal(h.m.bandTaken('band_chiave',pid),dual&&g.playerIds.includes('p'+lavSeat));
          }
        }
        assert.equal(h.m.rngDraft(),control.m.rngDraft());
        for(const pid of (dual?['p3','p'+lavSeat]:['p3'])){
          const ps=h.ps(pid),view=extendedPolicyMatch(h.m,ps);
          assert.equal(view.pool,ps.pool);assert.equal(view.itemPool,h.m.itemPoolFor(pid));
          assert.equal(view.opts,h.m.opts);
        }
        h.run(()=>h.ps('p3').bandId&&(!dual||h.ps('p'+lavSeat).bandId));
        assert.equal(h.ps('p3').bandId,'band_paganini');if(dual)assert.equal(h.ps('p'+lavSeat).bandId,'band_chiave');
        assert.deepEqual(h.logs.error,[]);
      }finally{h.m.dispose();control.m.dispose();}
    }
  });
  await t.test('round rewind and full disk recovery preserve named policy identity',async()=>{
    const seats=[{seat:0,playerId:'human',name:'Host',isBot:false,connected:true},...(dual?['arturia','lavinia']:['arturia']).map((botPersona,i)=>({seat:i+1,playerId:botPersona,name:botPersona,isBot:true,connected:true,botPersona}))];
    const h=makeMatch({mode:'coop',difficulty:'HARD',fake:true,seed:7,seats}).start().toPrep(3);
    const {rewindToPrep}=await load('server/match/rewind.js');
    const {createRecovery}=await load('server/recovery.js'),{Lobby,Room}=await load('server/lobby.js'),{SessionRegistry}=await load('server/net.js');
    const {Match}=await load('server/match/Match.js'),{VirtualScheduler}=await load('server/match/scheduler.js'),{FakeBattle}=await load('test/match/fakeBattle.js');
    const registry=new SessionRegistry(),log={info(){},warn(){},error(){}};
    const lobby=new Lobby({registry,getData:()=>DATA,log}),room=new Room('TEST','coop','HARD',Date.now());
    room.seats=[...seats,null];room.hostId='human';room.match=h.m;room.matchCount=1;lobby.rooms.set('TEST',room);
    const recovery=createRecovery({lobby,root,dir:path.join(temp,'recovery'),identity:'test',log});
    let restoredLobby,restoredRecovery;
    try{
      h.run(()=>h.ps('arturia').ready&&(!dual||h.ps('lavinia').ready));
      assert.ok(h.m.prepSnapshots.has(2),'strategy caches must not prevent later-round snapshots');
      assert.deepEqual(rewindToPrep(h.m,3),{ok:true,round:3});
      h.run(()=>h.ps('arturia').ready&&(!dual||h.ps('lavinia').ready));
      recovery.save(room,h.m,h.m.prepSnapshots.get(3));
      const record=deserialize(fs.readFileSync(path.join(temp,'recovery/room-TEST.bin')));
      assert.equal(record.seats.find(s=>s.playerId==='arturia').botPersona,undefined,'host saves a reduced seat list');
      class RestoredMatch extends Match{constructor(opts){super({...opts,scheduler:new VirtualScheduler(),BattleClass:FakeBattle,clientCombat:false});}}
      restoredLobby=new Lobby({registry:new SessionRegistry(),MatchClass:RestoredMatch,getData:()=>DATA,log});
      restoredRecovery=createRecovery({lobby:restoredLobby,root,dir:path.join(temp,'recovery'),identity:'test',log});
      restoredRecovery.restore();assert.deepEqual(restoredRecovery.status().issues,[]);
      const m=restoredLobby.rooms.get('TEST').match;
      assert.equal(artAdapter.isArturia(m,m.players.get('arturia')),true);
      if(dual)assert.equal(lavAdapter.isLavinia(m,m.players.get('lavinia')),true);
      assert.deepEqual(h.logs.error,[]);
    }finally{recovery.prepareShutdown();restoredRecovery?.prepareShutdown();restoredLobby?.shutdown();lobby.shutdown();h.m.dispose();}
  });
  await t.test('8/20-player AI preparation runs with elites outside the first pool',()=>{
    for(const count of [8,20]){
      const seats=Array.from({length:count},(_,seat)=>({seat,playerId:'ai'+seat,name:'AI'+seat,isBot:true,connected:true,...(seat===5?{botPersona:'arturia'}:dual&&seat===6?{botPersona:'lavinia'}:{})}));
      const h=makeMatch({mode:'coop',difficulty:'HARD',seed:7,fake:true,seats,captureFrames:false});
      try{
        h.start().toPrep(count===8?3:1);h.run(()=>h.ps('ai5').ready&&(!dual||h.ps('ai6').ready));
        assert.notEqual(h.ps('ai5').pool,h.m.pool);
        assert.equal(h.ps('ai5')._botFocusId,artAdapter.CORE);if(dual)assert.equal(h.ps('ai6')._botFocusId,lavAdapter.CORE);
        assert.equal(extendedPolicyMatch(h.m,h.ps('ai5')).pool,h.ps('ai5').pool);
        assert.deepEqual(h.logs.error,[]);assert.deepEqual(h.logs.warn,[]);h.invariants();
      }finally{h.m.dispose();}
    }
  });
  await t.test('uninstall restores every touched host file byte for byte',async()=>{
    if(dual)await lav('uninstall',root);await art('uninstall',root);
    for(const[p,b]of before)assert.deepEqual(fs.readFileSync(path.join(root,p)),b,p);
  });
  console.log(`Extended-host fixture: ${root}`);
});
