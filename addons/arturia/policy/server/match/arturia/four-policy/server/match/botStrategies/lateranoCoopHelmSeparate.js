// [ASSUMED] Own R14 Helm finalizer: distinct high-ATK and medical anchors must lie outside each other's surrounding eight tiles.
// A hard feasible-set rule; damage forecasts retain the original raw-damage objective without risk penalties.
import { bossFormationSnapshot, linkedFormationPlan } from './lateranoBossFormation.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { withLateranoCoopBossSelf, coopSelfBossSession, ownBossSpec, createCoopSelfBossForecast } from './lateranoCoopBossSelf.js';
import { withCoopWorkerForecast } from './lateranoCoopWorkers.js';
import { withCoopBossPrepFinish, projectBossPrepFinish } from './lateranoCoopBossPrepFinish.js';
import { SharedBossPool } from '../../../../../../../../../finalAssault.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { createForecastBattle } from '../../../../../../../../../aiCompute/forecast.js';
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { summonPlacementGrid } from '../../../../../../../../../../../shared/summonPlacement.js';

const dirs = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const position = (p, uid) => p.get(uid).split(',').map(Number);
const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
function movableSummoners(ps) {
  const tokens = [...ps.board.values()].filter(u => u.kind === 'token'), spare = (ps.hand || []).filter(u => !u).length;
  // Restrict to one token: lifting multiple copies can merge stacks and change deployment UIDs.
  return new Set(tokens.filter(u => tokens.filter(t => t.ownerUid === u.ownerUid).length === 1 && spare >= 1 && (u.count || 1) === 1
    && tokens.filter(t => t.ownerUid === u.ownerUid).every(t => {
      const rec = ps.gd.token?.(t.id);
      return !rec?.ownerRange && !rec?.ownerRangeOutside && !summonPlacementGrid(t.id)
        && ![...(ps.hand || []), ...(ps.temp || [])].some(s => s?.kind === 'token' && s.ownerUid === t.ownerUid && s.id === t.id);
    })).map(u => u.ownerUid));
}

/** Moving a summoner lifts its tokens. Restore the exact unrestricted tokens through normal placement intents. */
export function applyHelmSeparatedPlan(ps, plan) {
  const expected = JSON.stringify(stealthBattleInput(ps, plan));
  const inventory = JSON.stringify(ps.allChess().map(u => [u.uid, u.id, u.items]).sort((a, b) => a[0] - b[0]));
  const tokens = [...ps.board].filter(([, u]) => u.kind === 'token').map(([key, u]) => ({ key, uid: u.uid, dir: u.dir }));
  applyControlPositions(ps, plan);
  for (const t of tokens) {
    const at = ps.find(t.uid);
    if (at?.area === 'board' && at.key === t.key && at.piece.dir === t.dir) continue;
    const [row, col] = t.key.split(',').map(Number), result = ps.move(t.uid, { area: 'board', row, col }, t.dir);
    if (result?.error) throw Error(`Helm token restoration rejected: ${result.error}`);
  }
  if (inventory !== JSON.stringify(ps.allChess().map(u => [u.uid, u.id, u.items]).sort((a, b) => a[0] - b[0]))
    || expected !== JSON.stringify(ps.battleInput())) throw Error('Helm placement differs from forecast');
}
export function helmSeparated(plan, anchors) {
  const ids = [...new Set(anchors)];
  return ids.every((u, i) => ids.slice(i + 1).every(v => distance(position(plan, u), position(plan, v)) > 1));
}

export function helmSeparationPlans(m, ps, h, recipe, ranked, maximum = 4) {
  const original = bossFormationSnapshot(ps, h), byUid = new Map(original.lineup.map(u => [u.uid, u]));
  const rec = u => h.rangeRec(ps, ps.gd.chess(u.id));
  const isMedic = u => rec(u).profession !== 'TANK' && (rec(u).attackKind === 'heal' || rec(u).subProfessionId === 'incantationmedic');
  const medics = original.lineup.filter(isMedic), high = ranked.filter(u => byUid.has(u.uid)).slice(0, 2).map(u => byUid.get(u.uid));
  const anchors = [...high.map(u => u.uid), ...medics.map(u => u.uid)];
  if (high.length < 2 || helmSeparated(original, anchors)) return { plans: [original], anchors, alreadySafe: true };
  const model = h.fieldModel(m, ps), bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  const movable = movableSummoners(ps);
  const tokenOwners = new Set([...ps.board.values()].filter(u => u.kind === 'token' && !movable.has(u.ownerUid)).map(u => u.ownerUid));
  // Keep every summon tile reserved, but allow an unrestricted drone's owner to move and redeploy it unchanged.
  const planning = Object.assign(Object.create(ps), { board: new Map([...ps.board].map(([k, u]) =>
    [k, u.kind === 'token' && movable.has(u.ownerUid) ? { ...u, ownerUid: null } : u])) });
  const tanks = original.lineup.filter(u => rec(u).profession === 'TANK');
  const mainIds = new Set([recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.executorAlter, recipe.ids.archetto]);
  const mains = original.lineup.filter(u => mainIds.has(ps.gd.baseIdOf(u.id)) || high.includes(u));
  const sources = original.lineup.filter(u => isMedic(u) || rec(u).subProfessionId === 'guardian');
  const skillful = original.lineup.filter(u => pieceBonds(ps.gd, u).includes('skillfulShip'));
  const cache = new Map();
  const cell = (u, key, dir) => {
    const id = `${u.uid}:${key}:${dir}`;
    if (!cache.has(id)) {
      const [r, c] = key.split(',').map(Number), cover = new Set(h.rangeTiles(rec(u), r, c, dir));
      cache.set(id, { uid: u.uid, key, dir, r, c, cover, heal: healingTiles(rec(u), r, c, dir),
        contact: [...bodies].filter(k => cover.has(k)).length / Math.max(1, bodies.size) });
    }
    return cache.get(id);
  };
  const location = (p, u) => cell(u, p.get(u.uid), p.dirs.get(u.uid));
  const healed = (p, u) => sources.some(med => location(p, med).heal.has(p.get(u.uid)));
  const aura = (p, u) => ps.bonds.skillfulShip?.active && skillful.some(source => {
    const a = position(p, source.uid), b = position(p, u.uid), dr = Math.abs(a[0] - b[0]), dc = Math.abs(a[1] - b[1]);
    return ps.bonds.skillfulShip.layers >= 40 ? Math.max(dr, dc) <= 1 : dr + dc <= 1;
  });
  const safe = p => helmSeparated(p, anchors)
    && tanks.every(u => p.get(u.uid) === original.get(u.uid) && p.dirs.get(u.uid) === original.dirs.get(u.uid))
    && mains.every(u => location(p, u).contact > 0 && (!acceptsHealing(rec(u)) || !healed(original, u) || healed(p, u))
      && (!aura(original, u) || aura(p, u)));
  const options = u => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) for (const dir of dirs) {
      const key = `${r},${c}`;
      if (!ps._legal(u, r, c) || tokenOwners.has(u.uid) && (key !== original.get(u.uid) || dir !== original.dirs.get(u.uid))) continue;
      out.push(cell(u, key, dir));
    }
    return out;
  };
  const highOptions = new Map(high.map(u => [u.uid, options(u).filter(l => l.contact > 0)]));
  const all = [], seen = new Set();
  const shortlist = (u, med) => {
    const list = highOptions.get(u.uid).filter(l => l.key !== med.key
      && distance([l.r, l.c], [med.r, med.c]) > 1 && (!acceptsHealing(rec(u)) || med.heal.has(l.key)))
      .sort((a, b) => b.contact - a.contact || distance([a.r, a.c], position(original, u.uid)) - distance([b.r, b.c], position(original, u.uid))
        || `${a.key}:${a.dir}`.localeCompare(`${b.key}:${b.dir}`));
    const out = [], tiles = new Set();
    for (const l of list) if (!tiles.has(l.key)) { out.push(l); tiles.add(l.key); if (out.length === 8) break; }
    return out;
  };
  for (const med of medics) for (const loc of options(med)) {
    for (const a of shortlist(high[0], loc)) for (const b of shortlist(high[1], loc)) {
      if (distance([a.r, a.c], [b.r, b.c]) <= 1) continue;
      const targets = new Map([[med.uid, loc], [a.uid, a], [b.uid, b]]);
      if (targets.size !== new Set([med.uid, ...high.map(u => u.uid)]).size) continue;
      const p = linkedFormationPlan(planning, h, original, [...targets.values()]);
      if (!p || !safe(p) || seen.has(signature(p))) continue;
      seen.add(signature(p));
      p.helmSeparation = { score: mains.reduce((n, u) => n + location(p, u).contact * 20 + Number(healed(p, u)) * 2, 0)
        - original.lineup.filter(u => p.get(u.uid) !== original.get(u.uid)).length * .2 };
      all.push(p);
    }
  }
  all.sort((a, b) => b.helmSeparation.score - a.helmSeparation.score || signature(a).localeCompare(signature(b)));
  // Keep different anchor assignments rather than spending the budget on mere facing duplicates.
  const plans = [], assignments = new Set();
  for (const p of all) {
    const key = anchors.map(uid => `${uid}:${p.get(uid)}`).join('|');
    if (assignments.has(key)) continue;
    assignments.add(key); plans.push(p); if (plans.length === maximum) break;
  }
  return { plans, anchors, alreadySafe: false, feasibleGenerated: all.length };
}

const eligible = m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound && m.bossId === 'boss_1';
export function withCoopHelmSeparate(parent, { fourFieldSteps = 2_100_000 } = {}) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    const started = performance.now(), historyStart = ps._botCoopSelfBossHistory?.length || 0;
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!eligible(m)) return;
    // Initial seat count stays fixed when partners are eliminated; this option never changes the inherited search.
    const totalBudget = m.order.length === 4 ? fourFieldSteps : 2_100_000;
    const used = (ps._botCoopSelfBossHistory || []).slice(historyStart).reduce((n, s) => n + s.fieldSteps, 0);
    const wallMs = m.sched.virtual ? 30_000 : 30_000 - (performance.now() - started);
    if (used >= totalBudget || wallMs <= 0) return;
    const extra = { *finalBoardSteps() {
      const session = coopSelfBossSession(ps), original = bossFormationSnapshot(ps, h);
      const input = projectBossPrepFinish(ps.gd, ps, original, stealthBattleInput(ps, original)).input;
      if (session.limits.fieldSteps < 16) return;
      const pool = new SharedBossPool(session.poolHP), spec = ownBossSpec(m, ps, input, pool, 'skill-attack-envelope', session);
      // Independent own-input sample: observe the same panel ATK the Boss reads, throughout channel/ammo/skill states.
      // No match RNG or actual battle seed is used; outcome and damage are not inputs to anchor selection.
      const panel = createForecastBattle(m, spec);
      let profileTicks = 0;
      try {
        const peaks = new Map(), cap = Math.ceil(session.horizon * 30);
        while (profileTicks < cap && !panel.finished && session.steps < session.limits.fieldSteps
          && (m.sched.virtual || performance.now() - session.started < session.limits.wallMs)) {
          panel.step(); session.steps++; profileTicks++;
          for (const u of panel.allyUnits.filter(u => u.kind === 'op' && u.alive)) {
            if (!peaks.has(u.uid)) peaks.set(u.uid, { uid: u.uid, name: u.name, initialAttack: u.s.atk,
              attack: 0, peakAt: 0, sumAttack: 0, observedTicks: 0 });
            const p = peaks.get(u.uid); p.sumAttack += u.s.atk; p.observedTicks++;
            if (u.s.atk > p.attack) { p.attack = u.s.atk; p.peakAt = panel.time; }
          }
        }
        if (panel.errorCount) return;
        const ranked = [...peaks.values()].map(p => ({ ...p, meanAttack: p.sumAttack / p.observedTicks }))
          .sort((a, b) => b.attack - a.attack || a.uid - b.uid);
        const result = helmSeparationPlans(m, ps, h, parent, ranked);
        const record = { round: m.round, totalBudget, ranked, profileTicks, profileTime: panel.time, ...result,
          plans: result.plans.map(p => ({ positions: [...p], dirs: [...p.dirs] })) };
        if (result.plans.length && !result.alreadySafe) {
          const plans = result.plans.length > 1 ? result.plans : [result.plans[0], result.plans[0]];
          const job = yield* createCoopSelfBossForecast(m, ps, plans, 10);
          if (job) { while (!job.run(4)) yield; record.index = job.bestIndex; record.outcomes = job.outcomes;
            if (!job.stale && job.outcomes.filter(r => r.index === job.bestIndex && r.valid).length === (job.sampleCount ?? 10))
              applyHelmSeparatedPlan(ps, job.best);
          }
        }
        record.satisfied = helmSeparated(bossFormationSnapshot(ps, h), result.anchors);
        (ps._botCoopHelmSeparateHistory ||= []).push(record);
      } finally { panel.dispose?.(); }
    } };
    yield* withCoopBossPrepFinish(withCoopWorkerForecast(withLateranoCoopBossSelf(extra,
      { fieldSteps: totalBudget - used, wallMs }))).finalBoardSteps(m, ps, h);
  } });
}
