// [ASSUMED] R1–13 duplicate-layerer experiment. Compare keeping vs relaxing the automatic elite-bond tier.
// Both objects inherit27/14: no extra purchase/sale/upgrade/equipment rules and no final-round farming.
import { createRng, deriveSeed } from '../../../../../../sim/rng.js';
import { rotateOffset } from '../../../../../../sim/dir.js';
import { layerGainRoom } from '../../../../../../../shared/constants.js';
import { createForecastSteps } from '../botForecast.js';
import { developmentCarries, developmentLayoutValue, observeDevelopment, prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { precisionFarmShadow } from './lateranoPrecisionFarming.js';

const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const passive = new Set(['chess_char_3_03_a', 'chess_char_3_14_a']);

/** Extra projection is local to this experiment: the shared projector already handles positions/refresh/spend.
 * Plain prep-start/end layer traits (including copying them as the copier's own effect) must not be invisible.
 */
export function duplicatePrepExtra(gd, units, bonds, event) {
  const at = new Map(units.map(u => [u.key, u])), gains = {};
  const traits = u => (u.rec.garrisonIds || []).map(id => gd.garrison(id)).filter(g => g?.eventType === event);
  const front = u => {
    const [dr, dc] = rotateOffset(0, 1, u.dir); return at.get(`${u.r + dr},${u.c + dc}`);
  };
  for (const u of units) {
    let gs = traits(u), target = u;
    const seen = new Set();
    while (gs.length && gs.every(g => g.effectKey.startsWith('SERVER_FRONT_SAME_EFFECT_'))) {
      seen.add(target.uid); target = front(target);
      if (!target || seen.has(target.uid)) { gs = []; break; }
      gs = traits(target);
    }
    for (const g of gs) {
      const ids = g.effectKey === 'SERVER_ADD_BOND_CHESS_ALL' ? u.bonds || u.rec.bonds
        : g.effectKey === 'SERVER_ADD_BOND' ? (g.bbStr?.bond || '').split(',') : [];
      for (const id of ids) if (bonds[id]?.active) gains[id] = (gains[id] || 0) + (g.bb?.count || 0);
    }
  }
  return Object.fromEntries(Object.entries(gains).map(([id, n]) => [id, layerGainRoom(bonds[id]?.layers || 0, n)]));
}

export function duplicateGrowthRosters(m, ps, recipe, { retainElite = true } = {}) {
  const original = field(ps), before = precisionFarmShadow(ps, original).bonds;
  const layerers = [recipe.ids.archetto, recipe.ids.ayerscarpe, recipe.ids.ines, recipe.ids.tippi];
  const bench = ps.allChess().filter(p => !original.includes(p) && !ps.gd.isGolden(p.id)
    && layerers.includes(base(ps, p)) && original.some(q => base(ps, q) === base(ps, p)));
  const out = [];
  for (const removed of original.filter(p => passive.has(base(ps, p)))) {
    const [r, c] = ps.find(removed.uid).key.split(',').map(Number);
    for (const added of bench) {
      if (!ps._legal(added, r, c)) continue;
      const lineup = original.map(p => p === removed ? added : p), bonds = precisionFarmShadow(ps, lineup).bonds;
      if ((bonds.lateranoShip?.count || 0) < Math.min(6, before.lateranoShip?.count || 0)
        || retainElite && (bonds.suntShip?.tier || 0) < (before.suntShip?.tier || 0)) continue;
      const priority = layerers.length - layerers.indexOf(base(ps, added));
      out.push({ lineup, added, removed, priority });
    }
  }
  return out.sort((a, b) => b.priority - a.priority || a.removed.uid - b.removed.uid || a.added.uid - b.added.uid);
}

export function selectDuplicateGrowth(plans, outcomes, context) {
  const rows = plans.map((_, index) => outcomes.filter(r => r.index === index).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === 2 && rs.every((r, i) => r.valid && r.sample === i && Number.isFinite(r.duplicateGrowth));
  if (!valid(rows[0])) return { index: 0 };
  let index = 0, best = -Infinity;
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, s) => {
      const b = rows[0][s];
      return r.lost > b.lost || r.leaks > b.leaks || r.killed < b.killed || r.deaths > b.deaths
        || r.duplicateGrowth < b.duplicateGrowth + 1
        || context.skillful && r.auraMinimum + .01 < Math.min(.8, b.auraMinimum)
        || [...context.protectedUids].some(uid => (r.protectedDeaths?.[uid] || 0) > (b.protectedDeaths?.[uid] || 0));
    })) continue;
    const score = rows[i].reduce((n, r) => n + r.duplicateGrowth, 0);
    if (score > best) { best = score; index = i; }
  }
  return { index };
}

export function* duplicateGrowthSteps(m, ps, recipe, helpers, options = {}) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 2) return;
  const rosters = duplicateGrowthRosters(m, ps, recipe, options); if (!rosters.length) return;
  const original = field(ps), originalPlan = new helpers.LayoutPlan(), start = performance.now(); originalPlan.lineup = original;
  for (const [key, p] of ps.board) if (p.kind === 'chess') { originalPlan.set(p.uid, key); originalPlan.dirs.set(p.uid, p.dir); }
  const plans = [originalPlan], { lineup } = rosters[0];
  for (let variant = 0; variant < 2; variant++) {
    const plan = yield* helpers.planLayoutSteps(precisionFarmShadow(ps, lineup), lineup, {
      formationRoles: variant === 1 && m.opts.botFormationRoles === true, fireControl: variant === 1,
      seedPlan: variant === 1 ? plans[1] : null, developmentPhase: variant === 1 ? 'duplicate-farm' : null,
      rng: createRng(deriveSeed(m.seed, `forecast-layout:${m.round}:${ps.seat}:${variant}`)) });
    if (plan.size !== lineup.length || new Set(plan.values()).size !== lineup.length) continue;
    plan.lineup = lineup; plans.push(plan);
  }
  if (plans.length < 2) return;
  const protectedIds = [recipe.ids.faith, recipe.ids.mostima, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const carries = developmentCarries(original.map(p => ({ uid: p.uid, rec: ps.gd.chess(p.id) })));
  const context = { carries, protectedUids: new Set(original.filter(p => protectedIds.includes(base(ps, p))).map(p => p.uid)),
    skillful: !!ps.bonds.skillfulShip?.active, layers: { ...ps.layers }, remaining: m.gd.bossRound - m.round,
    lemuen: original.some(p => base(ps, p) === recipe.ids.lemuen) };
  const policy = {
    prepareForecastInput(m, ps, chosen, plan, input) {
      prepareDevelopmentInput(m, ps, plan.lineup, plan, input);
      const d = plan.development, fin = duplicatePrepExtra(ps.gd, d.units, input.bonds, 'SERVER_PREP_FIN');
      for (const [id, n] of Object.entries(fin)) { input.bonds[id].layers += n; d.fin[id] = (d.fin[id] || 0) + n; }
      const next = m.round < m.gd.bossRound - 1 ? duplicatePrepExtra(ps.gd, d.units, input.bonds, 'SERVER_PREP_START') : {};
      for (const [id, n] of Object.entries(next)) d.next[id] = (d.next[id] || 0) + n;
      return input;
    },
    forecastContext: () => context,
    observeForecast(battle, ctx, plan) {
      const observe = observeDevelopment(battle, ctx, plan);
      return pp => {
        const measured = observe(pp);
        return { ...measured, duplicateGrowth: measured.growth + .3 * ((measured.gains.steadShip || 0) + (measured.gains.swiftShip || 0)) };
      };
    },
    selectForecast: selectDuplicateGrowth,
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
    if (result?.error) throw Error(`Duplicate growth swap rejected: ${result.error}`);
    yield* helpers.applyPlanSteps(m, ps, job.chosen, job.best);
    if ([...job.best].some(([uid, key]) => ps.find(uid)?.key !== key || ps.find(uid)?.piece.dir !== job.best.dirs.get(uid))) throw Error('Duplicate growth placement failed');
  }
  (ps._botDuplicateGrowthHistory ||= []).push({ round: m.round, retainElite: options.retainElite, index: job.bestIndex,
    before, after: snapshot(), candidates: job.plans.map(p => ({ elite: precisionFarmShadow(ps, p.lineup).bonds.suntShip?.count || 0,
      tier: precisionFarmShadow(ps, p.lineup).bonds.suntShip?.tier || 0, lineup: p.lineup.map(u => ({ uid: u.uid, id: u.id })) })),
    outcomes: job.outcomes, ms: performance.now() - start });
}

export function withLateranoDuplicateGrowth(recipe, { retainElite = true } = {}) {
  return Object.freeze({ ...recipe,
    layoutValue(gd, units, plan, bonds, model) {
      return recipe.layoutValue(gd, units, plan, bonds, model) + (plan.developmentPhase === 'duplicate-farm'
        ? developmentLayoutValue(gd, units, { ...plan, developmentPhase: 'farm' }, bonds, model, recipe) : 0);
    },
    *finalBoardSteps(m, ps, helpers) {
      if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
      yield* duplicateGrowthSteps(m, ps, recipe, helpers, { retainElite });
    },
  });
}
