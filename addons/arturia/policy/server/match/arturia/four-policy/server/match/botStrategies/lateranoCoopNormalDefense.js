// [ASSUMED] Two independent ordinary-wave trials over the frozen multiplayer baseline.
// A completes fixed-roster medical/frontline firing windows; B reuses unused supply samples at the final boundary.
// Neither reads teammate deployments, actual battle results, historical formations, seed lists or shop state.
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { coopDevelopmentContext, observeCoopDevelopment } from './lateranoCoopDevelopment.js';
import { coopEntryState, coopGrowthFirstEnabled, selectCoopSafety } from './lateranoCoopSafety.js';
import { selectCoopNormalExchange } from './lateranoCoopNormalExchange.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { applyCoopRoster } from './lateranoCoopFactors.js';
import { Grid } from '../../../../../../../../../../sim/grid.js';
import { GEO } from '../../../../../../../../../../../shared/constants.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const eligible = (m, ps) => m.mode === 'coop' && !m.isSolo && !!m.wave && m.round < m.gd.bossRound
  && m.botRehearsal >= 3 && ps.bandId === 'band_paganini' && ps._botFocusId === 'lateranoShip';
const medical = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const signature = p => p.lineup.map(u => `${u.uid}:${p.get(u.uid)}:${p.dirs.get(u.uid)}`).sort().join('|');
const rosterKey = p => p.lineup.map(u => `${u.uid}:${u.id}`).sort().join('|');
const copy = (p, h) => Object.assign(new h.LayoutPlan(p), { lineup: p.lineup, dirs: new Map(p.dirs) });
const assets = ps => JSON.stringify({ funds: ps.funds, layers: ps.layers, bonds: ps.bonds,
  units: ps.allChess().map(u => [u.uid, u.id, u.items]).sort((a, b) => a[0] - b[0]),
  tokens: [...ps.board].filter(([, u]) => u.kind !== 'chess'), loadout: ps.loadout,
});
const restore = (ps, key, old) => { if (old === undefined) delete ps[key]; else ps[key] = old; };
const matched = (saved, current) => saved.plans.findIndex(p => rosterKey(p) === rosterKey(current) && signature(p) === signature(current));
const complete = rows => rows.length === FORECAST_SAMPLES && rows.every((r, i) => r.sample === i && r.valid);

/** A strict common-sample safety improvement can release supply's per-sample core-growth gate.
 * Equal-safety farming still follows its inherited selector; this is not permission to sacrifice defense or roles.
 */
export function selectSupplyDefenseReview(plans, outcomes, current = 0, { growthFirst = true } = {}) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const before = rows[current]; if (!complete(before) || !before.some(r => r.leaks > 0)) return { index: current };
  const order = [current, ...plans.map((_, i) => i).filter(i => i !== current && rosterKey(plans[i]) === rosterKey(plans[current]))];
  const accepted = outcomes.filter(r => order.includes(r.index)).map(r => {
    const b = before[r.sample];
    const safe = r.index === current || b && complete(rows[r.index]) && rows[r.index].some((v, s) => v.lost < before[s].lost)
      && [r.lost, r.leaks, r.deaths, r.criticalDown, r.entryReady, r.skillfulCovered, r.growth].every(Number.isFinite)
      && r.lost <= b.lost && r.leaks <= b.leaks && r.deaths <= b.deaths && r.criticalDown <= b.criticalDown
      && r.entryReady + 1e-6 >= b.entryReady && r.skillfulCovered >= b.skillfulCovered;
    return { ...r, index: order.indexOf(r.index), valid: r.valid && !!safe };
  });
  const result = selectCoopSafety(order.map(i => plans[i]), accepted, { growthFirst });
  return { ...result, index: order[result.index] };
}

/** B: no extra simulation. Reuse only a matching completed supply comparison from this exact preparation. */
export function withCoopFinalSupplyDefense(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!eligible(m, ps)) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const old = ps._botCoopRetainSupplyDefense; let saved;
    ps._botCoopRetainSupplyDefense = job => { old?.(job); saved = { ...job, assets: assets(ps), round: m.round }; };
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { restore(ps, '_botCoopRetainSupplyDefense', old); }
    if (!saved) return;
    const start = performance.now(), current = bossFormationSnapshot(ps, h), index = matched(saved, current);
    const stale = saved.round !== m.round || saved.assets !== assets(ps) || index < 0;
    const selected = stale ? { index } : selectSupplyDefenseReview(saved.plans, saved.outcomes, index,
      { growthFirst: coopGrowthFirstEnabled(m, ps) });
    if (!stale && selected.index !== index) {
      applyCoopRoster(ps, current, saved.plans[selected.index]);
      if (saved.assets !== assets(ps)) throw Error('Final defense review changed assets');
    }
    (ps._botCoopFactorHistory ||= []).push({ factor: 'final-supply-defense', round: m.round, stale, current: index,
      index: selected.index, changed: !stale && selected.index !== index, newSamples: 0, ms: performance.now() - start,
      outcomes: saved.outcomes, candidates: saved.plans.map(p => ({ positions: [...p], dirs: [...p.dirs] })) });
  } });
}

/** A: complete legal role assignments, not a carry move that leaves its displaced teammates exposed. */
export function* normalMedicalDefensePlans(m, ps, h, recipe, { beamSize = 16 } = {}) {
  const original = bossFormationSnapshot(ps, h), model = h.fieldModel(m, ps);
  const routes = model.routes.filter(rt => !rt.fallback && rt.n > 0), total = routes.reduce((n, rt) => n + rt.n, 0);
  const rec = u => h.rangeRec(ps, ps.gd.chess(u.id));
  const saint = recipe.ids.executorAlter;
  const front = u => rec(u).position === 'MELEE' && ['TANK', 'WARRIOR'].includes(rec(u).profession)
    && (rec(u).stats?.blockCnt || 0) > 0 && ps.gd.baseIdOf(u.id) !== saint;
  const medics = original.lineup.filter(u => medical(rec(u))), tanks = original.lineup.filter(front);
  if (!total || !medics.length || !tanks.length) return { plans: [original], generated: 0 };
  const reserved = new Set([...ps.board].filter(([, u]) => u.kind !== 'chess').map(([k]) => k));
  const owners = new Set([...ps.board.values()].filter(u => u.kind === 'token').map(u => u.ownerUid));
  const grid = new Grid(m.stage, GEO.NORMAL_RECT);
  const mains = new Set([recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto, saint]);
  const options = new Map(), keyed = new Map(), weights = new Map();
  for (const u of original.lineup) {
    const r = rec(u), s = r.stats || {}, out = [];
    weights.set(u.uid, Math.max(1, Math.sqrt(Math.max(0, s.atk || 0) * (s.aspd || 100) / (100 * Math.max(.3, s.bat || 1))) / 20)
      * (mains.has(ps.gd.baseIdOf(u.id)) ? 2 : 1));
    for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) for (const dir of DIRS) {
      const key = `${row},${col}`;
      if (reserved.has(key) || !ps._legal(u, row, col) || owners.has(u.uid)
        && (key !== original.get(u.uid) || dir !== original.dirs.get(u.uid))) continue;
      const cover = new Set(h.rangeTiles(r, row, col, dir));
      const heal = r.subProfessionId === 'incantationmedic' ? cover : healingTiles(r, row, col, dir);
      const indexes = routes.map(rt => rt.tiles.indexOf(key));
        out.push({ key, r: row, c: col, dir, cover, heal, indexes, blocks: front(u) && grid.blockable(row, col) && grid.groundPassable(row, col),
        contact: routes.reduce((n, rt) => n + ((!rt.fly || r.canHitFly) ? rt.n / total * rt.tiles.filter(k => cover.has(k)).length : 0), 0) });
    }
    options.set(u.uid, out); keyed.set(u.uid, new Map(out.map(l => [l.key + ':' + l.dir, l])));
  }
  const locate = (p, u) => keyed.get(u.uid).get(p.get(u.uid) + ':' + p.dirs.get(u.uid));
  if (original.lineup.some(u => !locate(original, u))) return { plans: [original], generated: 0 };
  const auraSources = original.lineup.filter(u => pieceBonds(ps.gd, u).includes('skillfulShip'));
  const aura = (p, u) => ps.bonds.skillfulShip?.active && auraSources.some(v => p.has(v.uid) &&
    ((ps.layers.skillfulShip || 0) >= 40 ? Math.max(Math.abs(locate(p, u).r - locate(p, v).r), Math.abs(locate(p, u).c - locate(p, v).c)) <= 1
      : Math.abs(locate(p, u).r - locate(p, v).r) + Math.abs(locate(p, u).c - locate(p, v).c) <= 1));
  const protectedAura = original.lineup.filter(u => mains.has(ps.gd.baseIdOf(u.id)) && aura(original, u));
  const score = (p, family, full = false) => {
    const present = original.lineup.filter(u => p.has(u.uid)); let value = 0;
    const stops = routes.map((rt, i) => {
      const indexes = present.filter(u => front(u) && locate(p, u).blocks).map(u => locate(p, u).indexes[i]).filter(n => n >= 0);
      return indexes.length ? Math.min(...indexes) : rt.tiles.length - 1;
    });
    for (const u of present) {
      const r = rec(u), l = locate(p, u), w = weights.get(u.uid), isMedical = medical(r), isFront = front(u);
      if (r.attackKind !== 'heal' && r.attackKind !== 'none' && r.subProfessionId !== 'bard') {
        if (!l.contact) value -= (isFront ? 2 : 18) * w;
        routes.forEach((rt, i) => {
          if (rt.fly && !r.canHitFly) return;
          const path = rt.tiles.slice(0, stops[i] + 1), before = rt.tiles[Math.max(0, stops[i] - 1)];
          value += rt.n / total * w * (Math.min(6, path.filter(k => l.cover.has(k)).length) * 2 + (l.cover.has(before) ? 5 : 0));
        });
      }
      routes.forEach((rt, i) => {
        if (rt.fly) return;
        if (isFront && l.blocks && l.indexes[i] >= 0) value += rt.n / total * 10;
        else if ((r.position === 'RANGED' || isMedical) && l.indexes[i] >= 0 && l.indexes[i] < stops[i])
          value -= rt.n / total * w * (family === 'safety' ? 32 : 24);
      });
      const healable = acceptsHealing(r), supported = medics.some(v => p.has(v.uid) && locate(p, v).heal.has(l.key)
        && (rec(v).subProfessionId !== 'incantationmedic' || locate(p, v).contact > 0));
      if (healable && (isFront || mains.has(ps.gd.baseIdOf(u.id)))) {
        if (supported) value += w * (family === 'healing' ? 16 : 8);
        else if (full || medics.every(v => p.has(v.uid))) value -= w * (family === 'healing' ? 12 : 5);
      }
      if (protectedAura.includes(u) && aura(p, u)) value += w * 8;
      value -= (p.get(u.uid) !== original.get(u.uid) ? .2 : 0);
    }
    return value;
  };
  const order = original.lineup.slice().sort((a, b) => {
    const role = u => owners.has(u.uid) ? 0 : front(u) ? 1 : medical(rec(u)) ? 2 : mains.has(ps.gd.baseIdOf(u.id)) ? 3 : 4;
    return role(a) - role(b) || weights.get(b.uid) - weights.get(a.uid) || a.uid - b.uid;
  });
  const proposals = [];
  for (const family of ['healing', 'safety']) {
    let beam = [Object.assign(new h.LayoutPlan(), { lineup: original.lineup, dirs: new Map() })];
    for (const u of order) {
      const next = [];
      for (const p of beam) for (const l of options.get(u.uid)) {
        if ([...p.values()].includes(l.key) || medical(rec(u)) && rec(u).subProfessionId === 'incantationmedic' && !l.contact) continue;
        const q = copy(p, h); q.set(u.uid, l.key); q.dirs.set(u.uid, l.dir); next.push({ p: q, value: score(q, family) });
      }
      next.sort((a, b) => b.value - a.value || signature(a.p).localeCompare(signature(b.p)));
      beam = []; const seen = new Set();
      for (const { p } of next) {
        const k = presentRoles(p, original.lineup.filter(v => front(v) || medical(rec(v)))).join('|') + `|${p.get(u.uid)}:${p.dirs.get(u.uid)}`;
        if (seen.has(k)) continue; seen.add(k); beam.push(p); if (beam.length === beamSize) break;
      }
      yield; if (!beam.length) break;
    }
    for (const p of beam) {
      if (p.size !== original.lineup.length || protectedAura.some(u => !aura(p, u))) continue;
      p.normalMedicalDefense = { family, score: score(p, family, true) }; proposals.push(p);
    }
  }
  const plans = [original], seen = new Set([signature(original)]);
  for (const family of ['healing', 'safety']) for (const p of proposals.filter(p => p.normalMedicalDefense.family === family)
    .sort((a, b) => b.normalMedicalDefense.score - a.normalMedicalDefense.score || signature(a).localeCompare(signature(b)))) {
    if (seen.has(signature(p))) continue; seen.add(signature(p)); plans.push(p); break;
  }
  return { plans, generated: proposals.length };
}

function presentRoles(plan, roles) {
  return roles.filter(u => plan.has(u.uid)).map(u => `${u.uid}:${plan.get(u.uid)}:${plan.dirs.get(u.uid)}`);
}

/** Independent extra search only when the inherited final comparison predicts leaks or deaths. */
export function withCoopNormalMedicalDefense(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!eligible(m, ps)) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const old = ps._botCoopRetainNormalDefense; let saved;
    ps._botCoopRetainNormalDefense = job => { old?.(job); saved = { ...job, assets: assets(ps), round: m.round }; };
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { restore(ps, '_botCoopRetainNormalDefense', old); }
    if (!saved || saved.round !== m.round || saved.assets !== assets(ps)) return;
    const current = bossFormationSnapshot(ps, h), index = matched(saved, current);
    const rows = saved.outcomes.filter(r => r.index === index).sort((a, b) => a.sample - b.sample);
    if (!complete(rows) || !rows.some(r => r.lost > 0 || r.deaths > 0)) return;
    const started = performance.now(), version = assets(ps), before = signature(current);
    const built = yield* normalMedicalDefensePlans(m, ps, h, parent), buildMs = performance.now() - started;
    if (built.plans.length < 2) return;
    const ctx = coopDevelopmentContext(m, ps, parent, built.plans, { risk: false }); ctx.growthFirst = coopGrowthFirstEnabled(m, ps);
    function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
    const job = yield* createForecastSteps(m, ps, current.lineup, built.plans, inputSteps, {
      prepareForecastInput: (m, ps, _chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
      forecastContext: () => ctx,
      observeForecast(battle, context, plan) {
        const observe = observeCoopDevelopment(battle, context, plan, ps);
        return pp => ({ ...observe(pp), ...coopEntryState(ps, plan, pp), forecastSteps: battle.tickCount });
      }, selectForecast: selectCoopNormalExchange,
    });
    if (!job) return;
    let stopped = !m.sched.virtual && performance.now() - started >= 4000;
    while (!stopped && !job.run(4)) { yield; stopped = !m.sched.virtual && performance.now() - started >= 4000; }
    const stale = version !== assets(ps) || before !== signature(bossFormationSnapshot(ps, h));
    if (!stopped && !stale && job.bestIndex) {
      const expected = JSON.stringify(stealthBattleInput(ps, job.best)); applyControlPositions(ps, job.best);
      if (JSON.stringify(ps.battleInput()) !== expected || assets(ps) !== version) throw Error('Normal medical defense changed assets or input');
    }
    (ps._botCoopFactorHistory ||= []).push({ factor: 'normal-medical-defense', round: m.round, generated: built.generated,
      index: stopped || stale ? 0 : job.bestIndex, stopped, stale, samples: 2, buildMs, ms: performance.now() - started,
      outcomes: job.outcomes, candidates: job.plans.map(p => ({ proposal: p.normalMedicalDefense, positions: [...p], dirs: [...p.dirs] })) });
  } });
}
