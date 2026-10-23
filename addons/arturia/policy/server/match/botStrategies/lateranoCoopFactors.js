// [ASSUMED] Independent multiplayer migrations over the measured9/56 combination; never combined here.
// Public current-wave forecasts only. Economics finish before roster trials; tempo has its own pre-economy probe.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { mostimaAmmoPlans, selectMostimaAmmo } from './lateranoMostimaAmmo.js';
import { mostimaVisionContext } from './lateranoVisionValue.js';
import { enemyRosterPlans, enemyTypeInfo } from './lateranoEnemyTypes.js';
import { stealthRosterPlans, stealthBattleInput, stealthWaveInfo } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { coopEntryState, selectCoopSafety, coopGrowthFirstEnabled } from './lateranoCoopSafety.js';
import { withLateranoIncomeDoll } from './lateranoIncomeDoll.js';
import { withLateranoMergeOrder } from './lateranoMergeOrder.js';

const CORE = 'lateranoShip';
const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_21_a']);
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const normal = (m, ps) => scoped(m, ps) && m.wave && m.round < m.gd.bossRound && m.botRehearsal >= 3;

function currentPlan(ps, h) {
  const plan = new h.LayoutPlan(); plan.lineup = field(ps);
  for (const p of plan.lineup) { plan.set(p.uid, ps.find(p.uid).key); plan.dirs.set(p.uid, p.dir); }
  return plan;
}

/** Initial Skillful coverage of this player's actual carries, including own members' self-buff. */
export function coopSkillfulCoverage(ps, plan) {
  const input = stealthBattleInput(ps, plan);
  if (!input.bonds.skillfulShip?.active) return 0;
  const diagonal = (ps.layers.skillfulShip || 0) >= 40;
  const sources = plan.lineup.filter(p => pieceBonds(ps.gd, p).includes('skillfulShip'));
  return plan.lineup.filter(p => MAIN.has(ps.gd.baseIdOf(p.id))).filter(p => {
    const [r, c] = plan.get(p.uid).split(',').map(Number);
    return sources.some(q => {
      if (p.uid === q.uid) return true;
      const [a, b] = plan.get(q.uid).split(',').map(Number);
      const dr = Math.abs(r - a), dc = Math.abs(c - b);
      return diagonal ? Math.max(dr, dc) <= 1 : dr + dc <= 1;
    });
  }).length;
}

function preserveBonds(ps, plan) {
  const bonds = stealthBattleInput(ps, plan).bonds;
  return (bonds[CORE]?.count || 0) >= Math.min(6, ps.bonds[CORE]?.count || 0)
    && ['preciShip', 'skillfulShip'].every(id => !ps.bonds[id]?.active || bonds[id]?.active
      && bonds[id].count >= Math.min(id === 'preciShip' ? 3 : 2, ps.bonds[id].count))
    && (!ps.bonds.visiShip?.active || bonds.visiShip?.active);
}

/** Supply may improve layers only with no loss of transferable critical survival, readiness or Skillful coverage. */
export function selectCoopSupply(plans, outcomes, visionContext, { ignoreReadiness = false, growthFirst = false, defenseFallback = false } = {}) {
  const base = outcomes.filter(r => r.index === 0).sort((a, b) => a.sample - b.sample);
  const filtered = outcomes.map(r => {
    if (r.index === 0) return r;
    const before = base[r.sample];
    const safe = before && [r.entryReady, r.criticalDown, r.skillfulCovered].every(Number.isFinite)
      && r.criticalDown <= before.criticalDown && (ignoreReadiness || growthFirst || r.entryReady + 1e-6 >= before.entryReady)
      && r.skillfulCovered >= before.skillfulCovered;
    return safe ? r : { ...r, valid: false };
  });
  const selected = selectMostimaAmmo(plans, filtered, { protectVision: 'value', visionContext });
  if (!defenseFallback || selected.index || !base.some(r => r.lost > 0)) return selected;
  // No extra risk or role loss: only a strict per-sample non-regressing LP improvement can release growth.
  const safer = new Set(plans.map((_, i) => i).filter(i => i > 0 && filtered.filter(r => r.index === i).length === FORECAST_SAMPLES
    && filtered.filter(r => r.index === i).every(r => r.valid && Number.isFinite(r.deaths)
      && r.deaths <= base[r.sample]?.deaths && r.lost <= base[r.sample]?.lost && r.leaks <= base[r.sample]?.leaks)
    && filtered.some(r => r.index === i && r.lost < base[r.sample]?.lost)));
  const fallback = selectCoopSafety(plans, filtered.filter(r => r.index === 0 || safer.has(r.index)), { growthFirst });
  return fallback.index ? { ...fallback, defenseFallback: true } : selected;
}

/** One-to-one roster swaps use the real placement API. No shop, sale or item actions are allowed here. */
export function applyCoopRoster(ps, original, best) {
  const added = best.lineup.filter(p => !original.lineup.includes(p));
  const removed = original.lineup.filter(p => !best.lineup.includes(p));
  if (added.length !== removed.length) throw Error('Co-op candidate changed roster size');
  for (let i = 0; i < added.length; i++) {
    const [row, col] = original.get(removed[i].uid).split(',').map(Number);
    const result = ps.move(added[i].uid, { area: 'board', row, col }, best.dirs.get(added[i].uid));
    if (result?.error) throw Error(`Co-op substitution rejected: ${result.error}`);
  }
  const expected = stealthBattleInput(ps, best); applyControlPositions(ps, best);
  if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Co-op candidate differs from forecast');
}

function* rosterJob(m, ps, plans, { select, extra = () => ({}) }) {
  if (plans.length < 2) return null;
  function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
  const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputSteps, {
    prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
    forecastContext: () => ({}),
    observeForecast(battle, context, plan) {
      let donorAmmo = 0;
      battle.on('ammoUsed', ({ unit }) => { if (unit.uid === plan.donorUid) donorAmmo++; });
      return pp => ({ ...coopEntryState(ps, plan, pp), donorAmmo,
        coreGain: (pp.layerGains?.[CORE] || 0) + (plan.development?.fin?.[CORE] || 0) + (plan.development?.next?.[CORE] || 0),
        visionGain: (pp.layerGains?.visiShip || 0) + (plan.development?.fin?.visiShip || 0) + (plan.development?.next?.visiShip || 0),
        ...extra(plan, pp) });
    }, selectForecast: select,
  });
  if (!job) return null;
  while (!job.run(4)) yield;
  if (job.bestIndex) applyCoopRoster(ps, plans[0], job.best);
  return { index: job.bestIndex, outcomes: job.outcomes, candidates: job.plans.map(p => ({
    positions: p.lineup.map(u => ({ uid: u.uid, id: u.id, key: p.get(u.uid), dir: p.dirs.get(u.uid) })) })) };
}

export function* coopSupplySteps(m, ps, h, recipe, { loneReadiness = false } = {}) {
  if (!normal(m, ps)) return;
  const start = performance.now();
  const plans = mostimaAmmoPlans(m, ps, h, recipe, { protectVision: 'value' });
  const context = mostimaVisionContext(m, ps, recipe);
  const ignoreReadiness = loneReadiness && m.alivePlayers().length === 1;
  const growthFirst=coopGrowthFirstEnabled(m,ps);
  const job = yield* rosterJob(m, ps, plans, {
    select: (plans, outcomes) => selectCoopSupply(plans, outcomes, context, { ignoreReadiness, growthFirst,
      defenseFallback: !!ps._botCoopSupplyDefenseFallback }),
    extra: plan => ({ skillfulCovered: coopSkillfulCoverage(ps, plan) }),
  });
  if (job) (ps._botCoopFactorHistory ||= []).push({ factor: 'supply', round: m.round, ...job, growthFirst,
    ...(ps._botCoopSupplyDefenseFallback ? { defenseFallback: true } : {}),
    ...(growthFirst?{visionContext:context}:{}),
    ...(loneReadiness ? { loneReadinessBypassed: ignoreReadiness } : {}), ms: performance.now() - start });
}

export function withLateranoCoopSupply(recipe, options = {}) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h);
    yield* coopSupplySteps(m, ps, h, recipe, options);
  } });
}

export function* coopEnemyRosterSteps(m, ps, h, recipe) {
  if (!normal(m, ps) || field(ps).length < 3) return;
  const threat = enemyTypeInfo(m, ps.gd), hidden = stealthWaveInfo(m, ps.gd).count;
  for (const kind of [...(threat.type ? ['typed'] : []), ...(hidden ? ['hidden'] : [])]) {
    const start = performance.now();
    const proposals = kind === 'typed' ? enemyRosterPlans(ps, h, recipe, threat, true) : stealthRosterPlans(ps, h, recipe);
    const plans = proposals.filter((p, i) => i === 0 || preserveBonds(ps, p));
    const job = yield* rosterJob(m, ps, plans, { select: selectCoopSafety });
    if (job) (ps._botCoopFactorHistory ||= []).push({ factor: 'roster', kind, round: m.round, ...job, ms: performance.now() - start });
  }
}

export function withLateranoCoopEnemyRoster(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h);
    yield* coopEnemyRosterSteps(m, ps, h, recipe);
  } });
}

/** Two complete all-clear samples, no downed critical unit, and a usable living board before early investment. */
export function coopTempoSafe(outcomes, { maxLoss = 0 } = {}) {
  return outcomes.length === FORECAST_SAMPLES && outcomes.every((r, i) => r.valid && r.sample === i
    && Number.isFinite(r.leaks) && Number.isFinite(r.lost) && r.leaks >= 0 && r.lost >= 0
    && r.leaks <= maxLoss && r.lost <= maxLoss && r.criticalDown === 0 && r.entryReady >= .6);
}

function tempoWindow(m, ps, { minLP = 16 } = {}) {
  return scoped(m, ps) && ps.lp >= minLP && (ps.shop.level === 1 && m.round >= 2 && m.round <= 3
    || ps.shop.level === 2 && m.round >= 3 && m.round <= 4);
}

export function coopTempoBoardReady(ps) {
  const all = field(ps), records = all.map(p => ps.gd.chess(p.id));
  const front = records.some(r => r.position !== 'RANGED' && (r.stats?.blockCnt || 0) >= 1);
  const ranged = records.some(r => r.position === 'RANGED' && !['heal', 'none'].includes(r.attackKind));
  return front && ranged && (ps.shop.level === 1 || new Set(all.map(p => ps.gd.baseIdOf(p.id))).size >= 4
    && records.filter(r => !['heal', 'none'].includes(r.attackKind)).length >= 2);
}

export function coopTempoReady(m, ps, options = {}) {
  const state = ps._botCoopTempo;
  return tempoWindow(m, ps, options) && coopTempoBoardReady(ps) && state?.round === m.round && state.level === ps.shop.level
    && state.signature === JSON.stringify(ps.battleInput()) && coopTempoSafe(state.outcomes, options);
}

export function* coopTempoSteps(m, ps, h, options = {}) {
  if (!normal(m, ps) || !tempoWindow(m, ps, options) || !coopTempoBoardReady(ps)) return;
  const start = performance.now(), plan = currentPlan(ps, h), signature = JSON.stringify(ps.battleInput());
  function* inputSteps() { yield; return ps.battleInput(); }
  const job = yield* createForecastSteps(m, ps, plan.lineup, [plan], inputSteps, {
    forecastReadinessOnly: true, forecastContext: () => ({}),
    observeForecast: (_battle, _ctx, plan) => pp => coopEntryState(ps, plan, pp), selectForecast: () => ({ index: 0 }),
  });
  if (!job) return; while (!job.run(4)) yield;
  const state = { factor: 'tempo', round: m.round, level: ps.shop.level, signature,
    outcomes: job.outcomes, ready: coopTempoSafe(job.outcomes, options), ms: performance.now() - start };
  ps._botCoopTempo = state; (ps._botCoopFactorHistory ||= []).push(state);
}

export function withLateranoCoopTempo(recipe) {
  return Object.freeze({ ...recipe,
    *beforeEconomySteps(m, ps, h) {
      if (recipe.beforeEconomySteps) yield* recipe.beforeEconomySteps(m, ps, h);
      yield* coopTempoSteps(m, ps, h);
    },
    readyForUpgrade: (m, ps) => coopTempoReady(m, ps) || recipe.readyForUpgrade?.(m, ps) || false,
    levelTarget: (m, ps, options) => coopTempoReady(m, ps) ? ps.shop.level + 1 : recipe.levelTarget(m, ps, options),
    priorityLevel: (m, ps) => coopTempoReady(m, ps) || recipe.priorityLevel(m, ps),
    spendReserve(m, ps) {
      if (!coopTempoReady(m, ps)) return recipe.spendReserve(m, ps);
      return ps.funds >= ps.shop.upgradePrice + recipe.upgradeReserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
    },
  });
}

export const withLateranoCoopDoll = recipe => withLateranoIncomeDoll(recipe, {
  scope: (m, ps) => scoped(m, ps) && m.round >= 1 && m.round <= 8, benchOnly: true,
});
export const withLateranoCoopMerge = recipe => withLateranoMergeOrder(recipe, { cooperative: true });
