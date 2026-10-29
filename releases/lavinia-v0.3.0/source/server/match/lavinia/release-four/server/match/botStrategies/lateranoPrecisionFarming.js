// [ASSUMED] Independent R1–13 experiment: sacrifice the third Precision member only for safe, useful growth.
// Acquisitions, upgrades, equipment and final-assault policy are inherited from retained27/14 verbatim.
import { createRng, deriveSeed } from '../../../../../../sim/rng.js';
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';
import { createForecastSteps } from '../botForecast.js';
import { developmentCarries, developmentLayoutValue, developmentValue, observeDevelopment,
  prepareDevelopmentInput } from '../botLateranoDevelopment.js';

const CORE = 'lateranoShip', PRECI = 'preciShip';
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const has = (ps, p, bond) => pieceBonds(ps.gd, p).includes(bond);
export function precisionFarmShadow(ps, lineup) {
  const selected = new Set(lineup.map(p => p.uid));
  const shadow = Object.assign(Object.create(ps), { board: new Map(),
    hand: [...ps.hand.map(p => selected.has(p?.uid) ? null : p), ...field(ps).filter(p => !selected.has(p.uid))],
    temp: ps.temp.map(p => selected.has(p?.uid) ? null : p) });
  const vacant = [...ps.board].filter(([, p]) => p.kind === 'chess' && !selected.has(p.uid)).map(([key]) => key);
  for (const p of lineup) {
    const loc = ps.find(p.uid);
    const key = loc?.area === 'board' ? loc.key : vacant.shift();
    // At most one legal board substitution is proposed; never invent an operator coordinate.
    if (key) shadow.board.set(key, p);
  }
  // Counting must also work AFTER applying an empty-slot proposal: the withdrawn original then has no
  // replacement board tile. Membership is a property of the proposed roster, not the current positions.
  shadow.bonds = computeBonds(ps.gd, { ...shadow, board: new Map(lineup.map(p => [p.uid, p])) });
  return shadow;
}

/** Roster-only proposals: retain six and the named carries, release one non-essential Precision slot.
 * No new cards are bought to make a farming branch available.
 */
export function precisionFarmRosters(m, ps, recipe) {
  const original = field(ps), before = precisionFarmShadow(ps, original).bonds;
  if ((before[PRECI]?.count || 0) !== 3 || !(before[CORE]?.active)) return [];
  const protectedIds = [recipe.ids.mostima, recipe.ids.faith, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const bench = ps.allChess().filter(p => !original.includes(p) && !has(ps, p, PRECI)
    && [CORE, 'skillfulShip', 'visiShip'].some(id => has(ps, p, id)));
  const out = [];
  for (const removed of original.filter(p => has(ps, p, PRECI) && !protectedIds.includes(base(ps, p)))) {
    const [r, c] = ps.find(removed.uid).key.split(',').map(Number);
    for (const added of [...bench, null]) {
      if (added ? !ps._legal(added, r, c) : !ps.hand.some(p => !p)) continue;
      const lineup = original.filter(p => p !== removed); if (added) lineup.push(added);
      const bonds = precisionFarmShadow(ps, lineup).bonds;
      if (bonds[PRECI]?.count !== 2 || (bonds[CORE]?.count || 0) < Math.min(6, before[CORE].count)) continue;
      const rec = added && ps.gd.chess(added.id);
      const priority = added ? (recipe.unitBonus(m, ps, rec, { route: ps._botRoute }) || 0)
        + rec.tier + (ps.gd.isGolden(added.id) ? 3 : 0)
        + ([recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].includes(base(ps, added)) ? 12 : 0)
        + (base(ps, added) === recipe.ids.astgenne ? 10 : 0) : -100;
      out.push({ lineup, removed, added, priority });
    }
  }
  return out.sort((a, b) => b.priority - a.priority || a.removed.uid - b.removed.uid || (a.added?.uid || 0) - (b.added?.uid || 0));
}

/** Both forecasts must preserve current-wave kills, losses and survival; no LP is bought for growth. */
export function selectPrecisionFarming(plans, outcomes, context) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === 2 && rs.every((r, i) => r.valid && r.sample === i && Number.isFinite(r.farmGrowth));
  if (!valid(rows[0])) return { index: 0 };
  let index = 0, best = rows[0].reduce((n, r) => n + r.farmGrowth, 0);
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, s) => {
      const ref = rows[0][s];
      return r.lost > ref.lost || r.leaks > ref.leaks || r.killed < ref.killed || r.deaths > ref.deaths
        || r.farmGrowth < ref.farmGrowth + 1
        || context.skillful && r.auraMinimum + .01 < Math.min(.8, ref.auraMinimum)
        || [...context.protectedUids].some(uid => (r.protectedDeaths?.[uid] || 0) > (ref.protectedDeaths?.[uid] || 0)
          || (r.protectedFirstDeaths?.[uid] ?? Infinity) + 1 < (ref.protectedFirstDeaths?.[uid] ?? Infinity));
    })) continue;
    const score = rows[i].reduce((n, r) => n + r.farmGrowth, 0);
    if (score > best) { best = score; index = i; }
  }
  return { index };
}

export function* precisionFarmingSteps(m, ps, recipe, helpers) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 2) return;
  const rosters = precisionFarmRosters(m, ps, recipe);
  if (!rosters.length) return;
  const start = performance.now(), original = field(ps), originalPlan = new helpers.LayoutPlan();
  originalPlan.lineup = original;
  for (const [key, p] of ps.board) if (p.kind === 'chess') { originalPlan.set(p.uid, key); originalPlan.dirs.set(p.uid, p.dir); }
  const plans = [originalPlan], offered = new Set();
  for (const { lineup, added } of rosters) {
    const identity = added ? base(ps, added) : 'empty'; if (offered.has(identity)) continue;
    const shadow = precisionFarmShadow(ps, lineup);
    // Planning is geometry only on an isolated membership snapshot, with its own tie-break stream.
    const plan = yield* helpers.planLayoutSteps(shadow, lineup, { fireControl: true, developmentPhase: 'precision-farm',
      rng: createRng(deriveSeed(m.seed, `precision-farm-layout:${m.round}:${ps.seat}:${plans.length}`)) });
    if (plan.size !== lineup.length || new Set(plan.values()).size !== lineup.length) continue;
    plan.lineup = lineup; plans.push(plan); offered.add(identity); if (plans.length === 3) break;
  }
  if (plans.length < 2) return;
  const carryIds = [recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto, recipe.ids.insider];
  const carries = developmentCarries(original.filter(p => carryIds.includes(base(ps, p))).map(p => ({ uid: p.uid, rec: ps.gd.chess(p.id) })));
  const context = { carries, protectedUids: new Set(original.filter(p => carryIds.includes(base(ps, p)) || base(ps, p) === recipe.ids.faith).map(p => p.uid)),
    skillful: plans.some(p => precisionFarmShadow(ps, p.lineup).bonds.skillfulShip?.active),
    layers: { ...ps.layers }, remaining: m.gd.bossRound - m.round, lemuen: original.some(p => base(ps, p) === recipe.ids.lemuen) };
  const policy = {
    prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
    forecastContext: () => context,
    observeForecast(battle, ctx, plan) {
      const observe = observeDevelopment(battle, ctx, plan);
      return pp => {
        const measured = observe(pp), gains = { ...measured.gains, preciShip: 0 };
        return { ...measured, farmGrowth: developmentValue(ctx.layers, gains, measured.coverage, ctx) };
      };
    },
    selectForecast: selectPrecisionFarming,
  };
  const job = yield* createForecastSteps(m, ps, original, plans,
    p => helpers.bossInputSteps(m, ps, p.lineup, p, { keepWithdrawn: true }), policy);
  if (!job) return;
  while (!job.run(4)) yield;
  const snapshot = () => field(ps).map(p => ({ uid: p.uid, id: p.id, key: ps.find(p.uid).key, dir: p.dir }));
  const before = snapshot();
  if (job.bestIndex) {
    const added = job.chosen.filter(p => !original.includes(p)), removed = original.filter(p => !job.chosen.includes(p));
    for (let i = 0; i < added.length; i++) {
      const [row, col] = originalPlan.get(removed[i].uid).split(',').map(Number);
      const result = ps.move(added[i].uid, { area: 'board', row, col }, job.best.dirs.get(added[i].uid));
      if (result?.error) throw Error(`Precision farming swap rejected: ${result.error}`);
    }
    yield* helpers.applyPlanSteps(m, ps, job.chosen, job.best);
    if ([...job.best].some(([uid, key]) => ps.find(uid)?.key !== key || ps.find(uid)?.piece.dir !== job.best.dirs.get(uid))) throw Error('Precision farming placement failed');
  }
  (ps._botPrecisionFarmingHistory ||= []).push({ round: m.round, index: job.bestIndex, before, after: snapshot(),
    candidates: job.plans.map(p => ({ core: precisionFarmShadow(ps, p.lineup).bonds[CORE]?.count || 0,
      precision: precisionFarmShadow(ps, p.lineup).bonds[PRECI]?.count || 0, lineup: p.lineup.map(u => ({ uid: u.uid, id: u.id })) })),
    outcomes: job.outcomes, ms: performance.now() - start });
}

export function withLateranoPrecisionFarming(recipe) {
  return Object.freeze({ ...recipe,
    layoutValue(gd, units, plan, bonds, model) {
      return recipe.layoutValue(gd, units, plan, bonds, model) + (plan.developmentPhase === 'precision-farm'
        ? developmentLayoutValue(gd, units, { ...plan, developmentPhase: 'farm' }, bonds, model, recipe) : 0);
    },
    *finalBoardSteps(m, ps, helpers) {
      if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
      yield* precisionFarmingSteps(m, ps, recipe, helpers);
    },
  });
}
