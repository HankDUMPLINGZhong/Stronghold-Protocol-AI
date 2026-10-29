// [ASSUMED] R1–13 offense/defense experiment: an owned medic may replace a secondary component
// only when two public-current-wave forecasts both leak fewer enemies. Clear-wave farming stays intact.
import { createRng, deriveSeed } from '../../../../../../sim/rng.js';
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { isFormationAnchor } from '../botPositioning.js';
import { precisionFarmShadow } from './lateranoPrecisionFarming.js';

const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const medic = rec => rec.profession === 'MEDIC';

export function healingChoiceRosters(m, ps, recipe) {
  const original = field(ps), before = precisionFarmShadow(ps, original).bonds;
  const protectedIds = [recipe.ids.faith, recipe.ids.mostima, recipe.ids.executorAlter,
    recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const onBoard = new Set(original.map(p => base(ps, p)));
  const bench = ps.allChess().filter(p => !original.includes(p) && !onBoard.has(base(ps, p)) && medic(ps.gd.chess(p.id)));
  const out = [];
  for (const removed of original) {
    const rec = ps.gd.chess(removed.id);
    if (protectedIds.includes(base(ps, removed)) || isFormationAnchor(rec) || medic(rec)) continue;
    const [r, c] = ps.find(removed.uid).key.split(',').map(Number);
    for (const added of bench) {
      // A real board/hand swap also works with a completely full preparation area.
      if (!ps._legal(added, r, c)) continue;
      const lineup = original.map(p => p === removed ? added : p);
      const bonds = precisionFarmShadow(ps, lineup).bonds;
      if ((bonds.lateranoShip?.count || 0) < Math.min(6, before.lateranoShip?.count || 0)) continue;
      const white = [recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].includes(base(ps, added));
      const priority = (white ? 20 : 0) + ps.gd.chess(added.id).tier + (ps.gd.isGolden(added.id) ? 3 : 0)
        - rec.tier - (ps.gd.isGolden(removed.id) ? 3 : 0);
      out.push({ lineup, added, removed, priority });
    }
  }
  return out.sort((a, b) => b.priority - a.priority || a.removed.uid - b.removed.uid || a.added.uid - b.added.uid);
}

/** No prediction-based growth trade: both samples must strictly improve leaks without killing fewer enemies. */
export function selectHealingChoice(plans, outcomes, context) {
  const rows = plans.map((_, index) => outcomes.filter(r => r.index === index).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === 2 && rs.every((r, i) => r.valid && r.sample === i && Number.isFinite(r.leaks));
  if (!valid(rows[0]) || rows[0].some(r => r.leaks === 0)) return { index: 0 };
  let index = 0, best = Infinity;
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, s) => r.leaks >= rows[0][s].leaks || r.lost > rows[0][s].lost
      || r.killed < rows[0][s].killed || [...context.protectedUids].some(uid =>
        (r.protectedDeaths?.[uid] || 0) > (rows[0][s].protectedDeaths?.[uid] || 0)))) continue;
    const score = Math.max(...rows[i].map(r => r.leaks)) * 1000 + rows[i].reduce((n, r) => n + r.leaks, 0);
    if (score < best) { best = score; index = i; }
  }
  return { index };
}

export function* healingChoiceSteps(m, ps, recipe, helpers) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 2) return;
  const rosters = healingChoiceRosters(m, ps, recipe);
  if (!rosters.length) return;
  const start = performance.now(), original = field(ps), originalPlan = new helpers.LayoutPlan();
  originalPlan.lineup = original;
  for (const [key, p] of ps.board) if (p.kind === 'chess') { originalPlan.set(p.uid, key); originalPlan.dirs.set(p.uid, p.dir); }
  const plans = [originalPlan], { lineup } = rosters[0];
  // The best affordable-asset substitution gets two geometry variants, like the parent layout search.
  // Otherwise two poor arrangements can wrongly reject a useful medic before comparing the actual trade.
  for (let variant = 0; variant < 2; variant++) {
    const shadow = precisionFarmShadow(ps, lineup);
    const plan = yield* helpers.planLayoutSteps(shadow, lineup, { formationRoles: variant === 1 && m.opts.botFormationRoles === true,
      fireControl: variant === 1, seedPlan: variant === 1 ? plans[1] : null,
      // Match the parent's public proposal stream, isolating roster membership from random tie breaks.
      rng: createRng(deriveSeed(m.seed, `forecast-layout:${m.round}:${ps.seat}:${variant}`)) });
    if (plan.size !== lineup.length || new Set(plan.values()).size !== lineup.length) continue;
    plan.lineup = lineup; plans.push(plan);
  }
  if (plans.length < 2) return;
  const carryIds = [recipe.ids.faith, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const context = { protectedUids: new Set(original.filter(p => carryIds.includes(base(ps, p))).map(p => p.uid)) };
  const policy = {
    prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
    forecastContext: () => context,
    observeForecast(battle, ctx) {
      const deaths = {};
      battle.on('death', ({ unit, reason }) => {
        if (reason === 'killed' && ctx.protectedUids.has(unit?.uid)) deaths[unit.uid] = (deaths[unit.uid] || 0) + 1;
      });
      return () => ({ protectedDeaths: deaths });
    },
    selectForecast: selectHealingChoice,
  };
  const job = yield* createForecastSteps(m, ps, original, plans,
    p => helpers.bossInputSteps(m, ps, p.lineup, p, { keepWithdrawn: true }), policy);
  if (!job) return;
  while (!job.run(4)) yield;
  const snapshot = () => field(ps).map(p => ({ uid: p.uid, id: p.id, key: ps.find(p.uid).key, dir: p.dir }));
  const before = snapshot();
  if (job.bestIndex) {
    const added = job.chosen.find(p => !original.includes(p)), removed = original.find(p => !job.chosen.includes(p));
    const [row, col] = originalPlan.get(removed.uid).split(',').map(Number);
    const result = ps.move(added.uid, { area: 'board', row, col }, job.best.dirs.get(added.uid));
    if (result?.error) throw Error(`Healing choice swap rejected: ${result.error}`);
    yield* helpers.applyPlanSteps(m, ps, job.chosen, job.best);
    if ([...job.best].some(([uid, key]) => ps.find(uid)?.key !== key || ps.find(uid)?.piece.dir !== job.best.dirs.get(uid))) throw Error('Healing choice placement failed');
  }
  (ps._botHealingChoiceHistory ||= []).push({ round: m.round, index: job.bestIndex, before, after: snapshot(),
    candidates: job.plans.map(p => ({ lineup: p.lineup.map(u => ({ uid: u.uid, id: u.id })) })),
    outcomes: job.outcomes, ms: performance.now() - start });
}

export function withLateranoHealingChoice(recipe) {
  return Object.freeze({ ...recipe,
    *finalBoardSteps(m, ps, helpers) {
      if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
      yield* healingChoiceSteps(m, ps, recipe, helpers);
    },
  });
}
