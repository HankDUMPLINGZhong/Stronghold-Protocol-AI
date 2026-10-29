// [ASSUMED] Bounded final-round search: exchange existing damage dealers' legal tiles,
// keeping their own facings, roster and equipment. Common forecasts, never actual battle results.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { stealthBattleInput } from './lateranoStealthWave.js';

const MAX_SWAPS = 8;
const dealer = r => r.attackKind !== 'heal' && !['MEDIC', 'TANK'].includes(r.profession)
  && !['bard', 'guardian'].includes(r.subProfessionId) && (r.stats?.atk || 0) > 0;
const rank = (ps, p) => { const r = ps.gd.chess(p.id);
  return r.tier * 10 + (ps.gd.isGolden(p.id) ? 30 : 0);
};

/** Highest-tier elite carries receive all legal partner tiles before lower-priority carries.
 * No stage, operator, boss or seed-specific positions. Summon owners remain pinned.
 */
export function finalSwapPlans(ps, helpers) {
  const original = new helpers.LayoutPlan();
  original.lineup = [...ps.board.values()].filter(p => p.kind === 'chess');
  for (const p of original.lineup) { original.set(p.uid, ps.find(p.uid).key); original.dirs.set(p.uid, p.dir); }
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const carries = original.lineup.filter(p => dealer(ps.gd.chess(p.id)) && !owners.has(p.uid))
    .sort((a, b) => rank(ps, b) - rank(ps, a) || a.uid - b.uid);
  const plans = [original], seen = new Set();
  for (const a of carries) {
    const partners = carries.filter(b => b !== a).sort((p, q) => {
      const [pr, pc] = original.get(p.uid).split(',').map(Number), [qr, qc] = original.get(q.uid).split(',').map(Number);
      return pc - qc || pr - qr || p.uid - q.uid;
    });
    for (const b of partners) {
      const signature = [a.uid, b.uid].sort((x, y) => x - y).join(':');
      if (seen.has(signature)) continue; seen.add(signature);
      const ak = original.get(a.uid), bk = original.get(b.uid);
      if (!ps._legal(a, ...bk.split(',').map(Number)) || !ps._legal(b, ...ak.split(',').map(Number))) continue;
      const plan = new helpers.LayoutPlan(); plan.lineup = original.lineup;
      for (const [uid, key] of original) { plan.set(uid, key); plan.dirs.set(uid, original.dirs.get(uid)); }
      plan.set(a.uid, bk); plan.set(b.uid, ak); plans.push(plan);
      if (plans.length > MAX_SWAPS) return plans;
    }
  }
  return plans;
}

/** Preserve every paired sample's win and LP result. Ignore stacking entirely in the final. */
export function selectFinalSwap(plans, outcomes, { samples = FORECAST_SAMPLES, aggregate = false } = {}) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === samples && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(rows[0]) || rows[0].every(r => r.won)) return { index: 0 };
  const score = rs => [Math.min(...rs.map(r => r.won)), rs.reduce((s, r) => s + r.won, 0),
    Math.min(...rs.map(r => r.damageShare)), rs.reduce((s, r) => s + r.damageShare, 0),
    Math.min(...rs.map(r => r.lp)), rs.reduce((s, r) => s + r.lp, 0)];
  const better = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return a[i] > b[i]; return false; };
  let index = 0, best = score(rows[0]);
  for (let i = 1; i < plans.length; i++) {
    // [ASSUMED] Separate multi-sample boss experiment: compare aggregate wins instead of a paired veto.
    if (!valid(rows[i]) || !aggregate && rows[i].some((r, j) => r.won < rows[0][j].won || r.lp < rows[0][j].lp)) continue;
    const next = score(rows[i]); if (better(next, best)) { index = i; best = next; }
  }
  return { index };
}

export function* lateranoFinalSwapSteps(m, ps, helpers) {
  if (!m.isSolo || m.wave || m.round !== m.gd.bossRound || m.botRehearsal < 3) return;
  const plans = finalSwapPlans(ps, helpers); if (plans.length < 2) return;
  const started = performance.now(), batches = [];
  let best = plans[0];
  for (let i = 1; i < plans.length; i += 2) {
    const candidates = [best, ...plans.slice(i, i + 2)];
    function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
    const policy = { forecastContext: () => ({}), observeForecast: () => () => ({}), selectForecast: selectFinalSwap };
    const job = yield* createForecastSteps(m, ps, best.lineup, candidates, inputSteps, policy);
    if (!job) break; while (!job.run(4)) yield;
    best = job.best;
    batches.push({ index: job.bestIndex, outcomes: job.outcomes, candidates: candidates.map(p =>
      [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    if (job.outcomes.filter(r => r.index === job.bestIndex).length === FORECAST_SAMPLES
      && job.outcomes.filter(r => r.index === job.bestIndex).every(r => r.valid && r.won)) break;
  }
  const expected = stealthBattleInput(ps, best);
  applyControlPositions(ps, best);
  if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Final swap differs from forecast input');
  (ps._botFinalSwapHistory ||= []).push({ round: m.round, candidates: plans.length, batches, ms: performance.now() - started });
}

export function withLateranoFinalSwap(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* lateranoFinalSwapSteps(m, ps, helpers);
  } });
}
