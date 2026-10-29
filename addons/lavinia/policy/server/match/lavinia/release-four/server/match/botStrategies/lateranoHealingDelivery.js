// [ASSUMED] Independent fixed-roster R14 medic/carry factor over measured27/19.
// Incantation medics heal allies inside attack range when dealing damage; coverage alone is not treatment.
import { createForecastSteps } from '../botForecast.js';
import { acceptsHealing, healingTiles } from '../botPositioning.js';
import { bossFormationSnapshot, bossLinkedPlans } from './lateranoBossFormation.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { selectFinalSwap } from './lateranoFinalSwap.js';

const eligible = m => m.isSolo && !m.wave && m.round === m.gd.bossRound && m.botRehearsal >= 3;
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).join('|');
export function deliveryHealingTiles(h, rec, r, c, dir) {
  return rec.subProfessionId === 'incantationmedic' ? new Set(h.rangeTiles(rec, r, c, dir)) : healingTiles(rec, r, c, dir);
}

/** Return actual HP added, after reductions and overheal. No self-heal, regeneration or unhealable Saint reward. */
export function observeHealingDelivery(battle, mains) {
  const metrics = { mainHealing: 0, mainDamage: 0, mainDeaths: 0 }, ids = new Set(mains);
  const heal = battle.heal.bind(battle);
  battle.heal = (source, target, amount, opts = {}) => {
    const actual = heal(source, target, amount, opts);
    if (ids.has(target?.uid) && source !== target && source?.side === 'ally' && !opts.regen) metrics.mainHealing += actual || 0;
    return actual;
  };
  battle.on('damaged', c => { if (ids.has(c.source?.uid) && c.target?.side === 'enemy' && c.type !== 'element') metrics.mainDamage += Math.max(0, c.amount || 0); });
  battle.on('death', ({ unit, reason }) => { if (ids.has(unit?.uid) && reason === 'killed') metrics.mainDeaths++; });
  return () => ({ ...metrics });
}

export function selectHealingDelivery(plans, outcomes, context) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i));
  const original = rows[0], valid = rs => rs.length === 10 && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(original)) return { index: 0 };
  const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] || 0), 0), healing = sum(original, 'mainHealing');
  const filtered = outcomes.filter(r => r.index === 0 || valid(rows[r.index])
    && sum(rows[r.index], 'mainHealing') > 0 && sum(rows[r.index], 'mainHealing') >= healing
    && sum(rows[r.index], 'mainDeaths') <= sum(original, 'mainDeaths'));
  return selectFinalSwap(plans, filtered, context);
}

export function* healingDeliverySteps(m, ps, h, recipe) {
  if (!eligible(m)) return;
  const started = performance.now(), original = bossFormationSnapshot(ps, h);
  const named = [recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const mains = original.lineup.filter(p => named.includes(ps.gd.baseIdOf(p.id)) && acceptsHealing(h.rangeRec(ps, ps.gd.chess(p.id)))).map(p => p.uid);
  if (!mains.length) return;
  const alternatives = bossLinkedPlans(m, ps, h, recipe, original,
    { healingRange: (rec, r, c, dir) => deliveryHealingTiles(h, rec, r, c, dir) });
  if (!alternatives.length) return;
  let best = original; const batches = [];
  for (let offset = 0; offset < alternatives.length; offset += 2) {
    function* input(p) { yield; return stealthBattleInput(ps, p); }
    const policy = { forecastSamples: 10, forecastBossMetrics: true, forecastContext: () => ({ samples: 10, aggregate: true }),
      observeForecast: battle => observeHealingDelivery(battle, mains), selectForecast: selectHealingDelivery };
    const job = yield* createForecastSteps(m, ps, best.lineup, [best, ...alternatives.slice(offset, offset + 2)], input, policy);
    if (!job) continue; while (!job.run(4)) yield; best = job.best;
    batches.push({ index: job.bestIndex, outcomes: job.outcomes,
      candidates: job.plans.map(p => ({ positions: [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) })) })) });
    const rows = job.outcomes.filter(r => r.index === job.bestIndex);
    if (rows.length === 10 && rows.every(r => r.valid && r.won)) break;
  }
  const expected = stealthBattleInput(ps, best); applyControlPositions(ps, best);
  if (JSON.stringify(expected) !== JSON.stringify(ps.battleInput())) throw Error('Healing delivery differs from forecast');
  (ps._botHealingDeliveryHistory ||= []).push({ round: m.round, changed: signature(best) !== signature(original),
    mains, batches, ms: performance.now() - started });
}

export function withLateranoHealingDelivery(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h);
    yield* healingDeliverySteps(m, ps, h, recipe);
  } });
}
