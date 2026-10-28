// [ASSUMED] Fixed-roster normal-wave exchanges over the occupied-swap boss trial.
// Public paths shortlist combat/farming proposals; two common forecasts protect defense and growth.
import { bossFormationSnapshot, linkedFormationPlan } from './lateranoBossFormation.js';
import { acceptsHealing, healingTiles, isFormationAnchor } from '../botPositioning.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { createForecastSteps } from '../botForecast.js';
import { developmentLayoutValue, prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { coopEntryState, coopGrowthFirstEnabled, selectCoopSafety } from './lateranoCoopSafety.js';
import { coopDevelopmentContext, coopDevelopmentStamp, observeCoopDevelopment } from './lateranoCoopDevelopment.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const eligible = (m, ps) => m.mode === 'coop' && !m.isSolo && !!m.wave && m.round < m.gd.bossRound
  && m.botRehearsal >= 3 && ps.bandId === 'band_paganini' && ps._botFocusId === 'lateranoShip';
const signature = p => [...p].map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).join('|');
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);

/** All proposals use the same occupied tiles, pieces and equipment; blockers and summons stay pinned. */
export function coopNormalExchangePlans(m, ps, h, recipe) {
  const original = bossFormationSnapshot(ps, h);
  if (!eligible(m, ps) || original.lineup.length < 3) return [original];
  const model = h.fieldModel(m, ps), routes = model.routes.filter(r => !r.fallback && r.n > 0);
  if (!routes.length) return [original];
  const pinned = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const recs = new Map(original.lineup.map(p => [p.uid, h.rangeRec(ps, ps.gd.chess(p.id))]));
  const mains = new Set([recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto, recipe.ids.executorAlter]);
  const unitsOf = plan => plan.lineup.map(p => {
    const rec = recs.get(p.uid), [r, c] = plan.get(p.uid).split(',').map(Number), dir = plan.dirs.get(p.uid);
    const dps = ['heal', 'none'].includes(rec.attackKind) ? 0 : (rec.stats?.atk || 0) * (rec.stats?.aspd || 100)
      / (100 * Math.max(.3, rec.stats?.bat || 1));
    return { uid: p.uid, rec, r, c, dir, key: plan.get(p.uid), bonds: pieceBonds(ps.gd, p), dps,
      cover: new Set(h.rangeTiles(rec, r, c, dir)), heal: healer(rec), air: !!rec.canHitFly,
      ground: !['heal', 'none'].includes(rec.attackKind), block: rec.position === 'MELEE' ? rec.stats?.blockCnt || 0 : 0 };
  });
  const before = unitsOf(original), critical = before.filter(u => mains.has(ps.gd.baseIdOf(u.rec.chessId)) || isFormationAnchor(u.rec));
  const healCoverage = (units, uid) => {
    const u = units.find(u => u.uid === uid);
    return units.some(v => v.heal && (v.rec.subProfessionId === 'incantationmedic' ? v.cover
      : healingTiles(v.rec, v.r, v.c, v.dir)).has(u.key));
  };
  const auraCoverage = (units, uid) => {
    if (!ps.bonds.skillfulShip?.active) return false;
    const u = units.find(u => u.uid === uid), wide = (ps.bonds.skillfulShip.layers || 0) >= 40;
    return units.some(v => v.bonds.includes('skillfulShip') && (wide
      ? Math.max(Math.abs(u.r - v.r), Math.abs(u.c - v.c)) <= 1 : Math.abs(u.r - v.r) + Math.abs(u.c - v.c) <= 1));
  };
  const safe = units => critical.every(u => (!acceptsHealing(u.rec) || !healCoverage(before, u.uid) || healCoverage(units, u.uid))
    && (!auraCoverage(before, u.uid) || auraCoverage(units, u.uid)));
  const total = routes.reduce((s, rt) => s + rt.n, 0);
  const score = units => {
    let combat = 0;
    for (const rt of routes) {
      const blockers = units.filter(u => !rt.fly && u.block > 0).map(u => rt.tiles.indexOf(u.key)).filter(n => n >= 0);
      const stop = blockers.length ? Math.min(...blockers) : rt.tiles.length - 1;
      const ahead = rt.tiles[Math.max(0, stop - 1)], path = rt.tiles.slice(0, stop + 1);
      for (const u of units) {
        if (!u.ground || rt.fly && !u.air) continue;
        const weight = Math.sqrt(Math.max(0, u.dps)) * (mains.has(ps.gd.baseIdOf(u.rec.chessId)) ? 1.5 : 1);
        combat += rt.n / total * weight * (Math.min(5, path.filter(k => u.cover.has(k)).length)
          + (u.cover.has(ahead) ? 3 : 0));
        const index = rt.tiles.indexOf(u.key);
        if (!rt.fly && !isFormationAnchor(u.rec) && (u.rec.position === 'RANGED' || healer(u.rec)) && index >= 0 && index < stop)
          combat -= rt.n / total * weight * 6;
      }
    }
    const farm = developmentLayoutValue(ps.gd, units, { ps, developmentPhase: 'farm' }, ps.bonds, model, recipe);
    return { combat, farm };
  };
  const proposals = [], seen = new Set([signature(original)]);
  for (let i = 0; i < original.lineup.length; i++) {
    const u = original.lineup[i];
    if (pinned.has(u.uid) || isFormationAnchor(recs.get(u.uid))) continue;
    for (let j = i + 1; j < original.lineup.length; j++) {
      const v = original.lineup[j];
      if (pinned.has(v.uid) || isFormationAnchor(recs.get(v.uid))) continue;
      // Turn either participant independently, retaining the other's inherited facing.
      for (const turn of [u, v]) for (const dir of DIRS) {
        const plan = linkedFormationPlan(ps, h, original, [
          { uid: u.uid, key: original.get(v.uid), dir: turn === u ? dir : original.dirs.get(u.uid) },
          { uid: v.uid, key: original.get(u.uid), dir: turn === v ? dir : original.dirs.get(v.uid) },
        ]);
        if (!plan || seen.has(signature(plan))) continue;
        seen.add(signature(plan));
        const units = unitsOf(plan); if (!safe(units)) continue;
        plan.coopNormalExchange = { pair: [u.uid, v.uid], ...score(units) }; proposals.push(plan);
      }
    }
  }
  const result = [original];
  // Preserve diversity: one fire-window proposal and one distinct growth proposal, at most six battles.
  for (const family of ['combat', 'farm']) {
    proposals.sort((a, b) => b.coopNormalExchange[family] - a.coopNormalExchange[family]
      || b.coopNormalExchange[family === 'combat' ? 'farm' : 'combat'] - a.coopNormalExchange[family === 'combat' ? 'farm' : 'combat']
      || signature(a).localeCompare(signature(b)));
    const next = proposals.find(p => !result.includes(p)); if (next) result.push(next);
  }
  return result;
}

/** Reuse ordinary-wave safety/growth ranking; a new swap cannot sacrifice critical survivors or aura. */
export function selectCoopNormalExchange(plans, outcomes, ctx) {
  const base = new Map(outcomes.filter(r => r.index === 0).map(r => [r.sample, r]));
  const filtered = outcomes.map(r => {
    if (!r.index) return r;
    const b = base.get(r.sample);
    const roleSafe = b && [...ctx.protectedUids].every(uid =>
      (r.protectedDeaths?.[uid] || 0) <= (b.protectedDeaths?.[uid] || 0)
      && (r.protectedFirstDeaths?.[uid] ?? Infinity) + 1 >= (b.protectedFirstDeaths?.[uid] ?? Infinity)
      && r.critical?.[uid] && (!b.critical?.[uid]?.alive || r.critical[uid].alive));
    const auraSafe = !ctx.skillful || ['coverage', 'auraMinimum', 'saintCoverage'].every(k =>
      Number.isFinite(r[k]) && Number.isFinite(b?.[k]) && r[k] + .01 >= Math.min(.8, b[k]));
    return roleSafe && auraSafe ? r : { ...r, valid: false };
  });
  return selectCoopSafety(plans, filtered, { growthFirst: ctx.growthFirst });
}

export function* coopNormalExchangeSteps(m, ps, h, recipe) {
  if (!eligible(m, ps)) return;
  const started = performance.now(), plans = coopNormalExchangePlans(m, ps, h, recipe);
  if (plans.length < 2) return;
  const stamp = coopDevelopmentStamp(m, ps), funds = ps.funds;
  const assets = () => JSON.stringify(ps.allChess().map(p => [p.uid, p.id, p.items]).sort((a, b) => a[0] - b[0]));
  const beforeAssets = assets(), ctx = coopDevelopmentContext(m, ps, recipe, plans, { risk: false });
  ctx.growthFirst = coopGrowthFirstEnabled(m, ps);
  function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
  const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputSteps, {
    prepareForecastInput: (m, ps, _chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
    forecastContext: () => ctx,
    observeForecast(battle, context, plan) {
      const observe = observeCoopDevelopment(battle, context, plan, ps);
      return pp => ({ ...observe(pp), ...coopEntryState(ps, plan, pp) });
    },
    selectForecast: selectCoopNormalExchange,
  });
  if (!job) return; while (!job.run(4)) yield;
  const stale = coopDevelopmentStamp(m, ps) !== stamp || ps.funds !== funds || assets() !== beforeAssets;
  if (!stale && job.bestIndex) {
    const expected = stealthBattleInput(ps, job.best); applyControlPositions(ps, job.best);
    if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Normal exchange differs from forecast');
    if (ps.funds !== funds || assets() !== beforeAssets) throw Error('Normal exchange changed owned assets');
  }
  (ps._botCoopFactorHistory ||= []).push({ factor: 'normal-exchange', round: m.round, index: stale ? 0 : job.bestIndex,
    stale, samples: 2, ms: performance.now() - started, outcomes: job.outcomes,
    candidates: plans.map(p => ({ proposal: p.coopNormalExchange, positions: [...p], dirs: [...p.dirs] })) });
}

export function withCoopNormalExchange(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    yield* coopNormalExchangeSteps(m, ps, h, parent);
  } });
}
