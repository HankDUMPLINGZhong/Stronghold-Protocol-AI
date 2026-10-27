// [ASSUMED] Optional one-copy farming support, checked against the incumbent on two public-wave forecasts.
// Game effect: garrison_59_a/b adds 1/2 to the in-battle garrison gain caused by the ally directly in front.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { computeBonds } from '../../../../../bondsMeta.js';

const CORE = 'lateranoShip', MAGIC = 'char_4134_cetsyr';
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const isMagic = (gd, rec) => rec?.charId === MAGIC || ['chess_char_4_25_a', 'chess_char_5_09_a'].includes(gd.baseIdOf(rec?.id ?? rec?.chessId));
const useful = (m, ps, recipe) => m.round < m.gd.bossRound
  && ps.allChess().some(p => ps.gd.baseIdOf(p.id) === recipe.ids.mostima)
  && ps.allChess().some(p => recipe.ammoWeight(ps.gd.chess(p.id)) > 0);
const coreCount = (ps, chosen) => {
  const selected = new Set(chosen.map(p => p.uid));
  return computeBonds(ps.gd, { ...ps, board: new Map(chosen.map(p => [p.uid, p])),
    hand: [...ps.hand.filter(p => !selected.has(p?.uid)), ...field(ps).filter(p => !selected.has(p.uid))] })[CORE]?.count || 0;
};

/** No output/leak/death regression in either independent sample, including when six drops to five.
 * A dead/invalid forecast or a small apparent gain never displaces the incumbent.
 */
export function selectMostimaAmplifier(plans, outcomes) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === FORECAST_SAMPLES && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(rows[0])) return { index: 0 };
  const gain = rs => rs.reduce((n, r) => n + r.coreGain, 0) / FORECAST_SAMPLES;
  let index = 0, score = gain(rows[0]);
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, j) => r.lost > rows[0][j].lost || r.leaks > rows[0][j].leaks
      || r.killed < rows[0][j].killed || r.deaths > rows[0][j].deaths || r.coreGain < rows[0][j].coreGain)) continue;
    const next = gain(rows[i]);
    if (next >= gain(rows[0]) + 2 && next > score) { index = i; score = next; }
  }
  return { index };
}

/** Keep Mostima and her current donors in place where possible; move only a support and its substitute.
 * Geometry generates candidates, never claims that a five-member army has sufficient damage.
 */
export function mostimaAmplifierPlans(m, ps, recipe, helpers) {
  const original = field(ps), mostima = original.find(p => ps.gd.baseIdOf(p.id) === recipe.ids.mostima);
  const magic = ps.allChess().find(p => isMagic(ps.gd, ps.gd.chess(p.id)));
  if (!mostima || !magic) return [];
  const { LayoutPlan } = helpers;
  const incumbent = new LayoutPlan(); incumbent.lineup = original;
  for (const [key, p] of ps.board) if (p.kind === 'chess') { incumbent.set(p.uid, key); incumbent.dirs.set(p.uid, p.dir); }
  const [mr, mc] = incumbent.get(mostima.uid).split(',').map(Number), proposals = [];
  const donors = plan => plan.lineup.filter(p => p !== mostima && recipe.ammoWeight(ps.gd.chess(p.id)) > 0
    && plan.has(p.uid)).filter(p => {
    const [r, c] = plan.get(p.uid).split(',').map(Number);
    return Math.abs(r - mr) + Math.abs(c - mc) === 1;
  });
  if (!donors(incumbent).length) return [];
  const bonus = p => (recipe.unitBonus(m, ps, ps.gd.chess(p.id), { route: ps._botRoute }) || 0)
    + ps.gd.chess(p.id).tier * 3 + (ps.gd.isGolden(p.id) ? 8 : 0);
  for (const [dr, dc, dir] of [[-1, 0, 'UP'], [1, 0, 'DOWN'], [0, -1, 'RIGHT'], [0, 1, 'LEFT']]) {
    const r = mr + dr, c = mc + dc, key = `${r},${c}`;
    if (!ps._legal(magic, r, c) || ps.board.get(key)?.kind && ps.board.get(key).kind !== 'chess') continue;
    const occupant = original.find(p => incumbent.get(p.uid) === key && p.uid !== magic.uid);
    const removals = original.includes(magic) || original.length < ps.deployCap ? [null]
      : original.filter(p => p !== mostima && ![recipe.ids.faith, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen]
        .includes(ps.gd.baseIdOf(p.id)));
    for (const removed of removals) {
      if (removed) {
        const [rr, cc] = incumbent.get(removed.uid).split(',').map(Number);
        if (!ps._legal(magic, rr, cc)) continue;
      }
      const plan = new LayoutPlan(); plan.lineup = original.filter(p => p !== removed);
      if (!plan.lineup.includes(magic)) plan.lineup.push(magic);
      for (const p of plan.lineup) if (incumbent.has(p.uid)) { plan.set(p.uid, incumbent.get(p.uid)); plan.dirs.set(p.uid, p.dir); }
      if (occupant && occupant !== removed) {
        const to = original.includes(magic) ? incumbent.get(magic.uid) : removed ? incumbent.get(removed.uid) : null;
        if (!to) continue;
        const [rr, cc] = to.split(',').map(Number);
        if (!ps._legal(occupant, rr, cc)) continue;
        plan.set(occupant.uid, to);
      }
      plan.set(magic.uid, key); plan.dirs.set(magic.uid, dir);
      if (new Set(plan.values()).size !== plan.lineup.length || coreCount(ps, plan.lineup) < 3 || !donors(plan).length) continue;
      // Avoid displacing ammunition donors and mature branch engines before a safer spare is tried.
      const donor = occupant && occupant !== magic ? recipe.ammoWeight(ps.gd.chess(occupant.id)) : 0;
      const cost = (removed ? bonus(removed) : 0) + donor * 12 + (occupant && occupant !== removed ? 2 : 0);
      proposals.push({ plan, cost, six: coreCount(ps, plan.lineup) >= 6 });
    }
  }
  proposals.sort((a, b) => a.cost - b.cost);
  const chosen = [];
  // If available, test both retaining six and sacrificing the breakpoint rather than assume either wins.
  for (const six of [true, false]) { const p = proposals.find(p => p.six === six); if (p) chosen.push(p); }
  for (const p of proposals) if (!chosen.includes(p) && chosen.length < 2) chosen.push(p);
  return [incumbent, ...chosen.slice(0, 2).map(p => p.plan)];
}

export function* mostimaAmplifierSteps(m, ps, recipe, helpers) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 2 || (ps.layers[CORE] || 0) >= 999) return;
  const plans = mostimaAmplifierPlans(m, ps, recipe, helpers);
  if (plans.length < 2) return;
  const start = performance.now(), original = plans[0].lineup;
  const policy = {
    prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
    forecastContext: () => ({}),
    observeForecast: (battle, context, plan) => pp => ({ coreGain: (pp.layerGains?.[CORE] || 0)
      + (plan.development?.fin?.[CORE] || 0) + (plan.development?.next?.[CORE] || 0) }),
    selectForecast: selectMostimaAmplifier,
  };
  const job = yield* createForecastSteps(m, ps, original, plans,
    p => helpers.bossInputSteps(m, ps, p.lineup, p, { keepWithdrawn: true }), policy);
  if (!job) return;
  while (!job.run(4)) yield;
  const best = job.best, before = original.map(p => ({ uid: p.uid, id: p.id, key: plans[0].get(p.uid), dir: p.dir }));
  if (job.bestIndex) {
    const added = best.lineup.filter(p => !original.includes(p)), removed = original.filter(p => !best.lineup.includes(p));
    // A hand-to-occupied-board swap also preserves all assets with an entirely full bench.
    for (let i = 0; i < added.length && i < removed.length; i++) {
      const [row, col] = plans[0].get(removed[i].uid).split(',').map(Number);
      const result = ps.move(added[i].uid, { area: 'board', row, col }, best.dirs.get(added[i].uid));
      if (result?.error) throw Error(`Mostima amplifier swap rejected: ${result.error}`);
    }
    yield* helpers.applyPlanSteps(m, ps, best.lineup, best);
    for (const p of best.lineup) if (ps.find(p.uid)?.key !== best.get(p.uid) || p.dir !== best.dirs.get(p.uid)) {
      throw Error('Mostima amplifier failed to apply its legal forecast board');
    }
  }
  (ps._botMostimaAmplifierHistory ||= []).push({ round: m.round, index: job.bestIndex,
    before, after: field(ps).map(p => ({ uid: p.uid, id: p.id, key: ps.find(p.uid).key, dir: p.dir })),
    candidates: job.plans.map(p => ({ core: coreCount(ps, p.lineup), positions: [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) })) })),
    outcomes: job.outcomes, ms: performance.now() - start });
}

export function withLateranoMostimaAmplifier(recipe) {
  return Object.freeze({ ...recipe,
    purchaseAllowed(m, ps, rec) {
      if (!isMagic(ps.gd, rec)) return recipe.purchaseAllowed(m, ps, rec);
      return useful(m, ps, recipe) && !ps.allChess().some(p => isMagic(ps.gd, ps.gd.chess(p.id)));
    },
    buyBonus(m, ps, rec, ...args) { return isMagic(ps.gd, rec) ? 18 : recipe.buyBonus(m, ps, rec, ...args); },
    keep(m, ps, rec) { return isMagic(ps.gd, rec) ? useful(m, ps, recipe) : recipe.keep(m, ps, rec); },
    preserve(m, ps, rec) { return isMagic(ps.gd, rec) ? useful(m, ps, recipe) : recipe.preserve(m, ps, rec); },
    // Buying a support does not itself license replacing six; only the paired forecast below may do so.
    unitBonus(m, ps, rec, ...args) { return isMagic(ps.gd, rec) ? -200 : recipe.unitBonus(m, ps, rec, ...args); },
    *finalBoardSteps(m, ps, helpers) {
      if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
      yield* mostimaAmplifierSteps(m, ps, recipe, helpers);
    },
  });
}
