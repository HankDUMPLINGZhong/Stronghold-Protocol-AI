// [ASSUMED] Independent owned-roster experiments. No purchases, sales or actual battle outcomes.
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { bossFormationSnapshot, bossLinkedPlans, linkedFormationPlan } from './lateranoBossFormation.js';
import { enemyRoleValue, enemyTypeInfo, enemyPositionPlans, selectEnemyRepair } from './lateranoEnemyTypes.js';
import { selectFinalSwap } from './lateranoFinalSwap.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions, controlBonds } from './lateranoControlBoss.js';
import { isLateranoHealing } from './lateranoLastHealing.js';

const CORE = 'lateranoShip';
const tank = r => r.profession === 'TANK' && (r.stats?.blockCnt || 0) >= 2;
const signature = p => [...p].map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');

/** A staged legal move lets a bench melee replace a ranged ally standing on high ground, even with a full bench. */
export function replacementPlan(ps, h, original, added, removed) {
  const key = original.get(removed.uid);
  let staging = original;
  if (!ps._legal(added, ...key.split(',').map(Number))) {
    staging = null;
    for (let r = 9; r <= 12 && !staging; r++) for (let c = 2; c <= 10 && !staging; c++) {
      if (!ps._legal(added, r, c)) continue;
      staging = linkedFormationPlan(ps, h, original, [{ uid: removed.uid, key: `${r},${c}`, dir: removed.dir }]);
    }
    if (!staging) return null;
  }
  const p = new h.LayoutPlan(); p.lineup = original.lineup.map(u => u.uid === removed.uid ? added : u);
  for (const u of p.lineup) {
    const from = u.uid === added.uid ? removed.uid : u.uid;
    p.set(u.uid, staging.get(from)); p.dirs.set(u.uid, staging.dirs.get(from));
  }
  p.replacement = { added: added.uid, removed: removed.uid, staging, swapKey: staging.get(removed.uid) };
  return p;
}

export function emergencyRosterPlans(m, ps, h, recipe, kind) {
  const original = bossFormationSnapshot(ps, h), rec = p => h.rangeRec(ps, ps.gd.chess(p.id));
  const id = p => ps.gd.baseIdOf(p.id), chosen = original.lineup;
  const main = [recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.executorAlter, recipe.ids.archetto, recipe.ids.faith];
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const threat = kind === 'quintus' ? null : enemyTypeInfo(m, ps.gd), proposals = [];
  if (kind !== 'quintus' && !threat.type) return [original];
  if (kind === 'quintus' && chosen.filter(p => tank(rec(p))).length >= 2) return [original];
  for (const added of ps.allChess().filter(p => !chosen.some(u => u.uid === p.uid))) for (const removed of chosen) {
    const a = rec(added), r = rec(removed);
    if (owners.has(removed.uid) || main.includes(id(removed)) && !(threat?.pureAir && !r.canHitFly && a.canHitFly)) continue;
    if (kind === 'quintus' && (!tank(a) || tank(r) || id(removed) === recipe.ids.mostima || r.subProfessionId === 'wandermedic')) continue;
    if (isLateranoHealing(r) && !isLateranoHealing(a) && !chosen.some(p => p !== removed && isLateranoHealing(rec(p)))) continue;
    if (!threat?.pureAir && tank(r) && !tank(a) && !chosen.some(p => p !== removed && tank(rec(p)))) continue;
    const p = replacementPlan(ps, h, original, added, removed); if (!p) continue;
    if ((controlBonds(ps, p.lineup)[CORE]?.count || 0) < Math.min(kind === 'quintus' ? 6 : 3, ps.bonds[CORE]?.count || 0)) continue;
    const score = kind === 'quintus' ? (a.stats?.maxHp || 0) * (1 + (a.stats?.def || 0) / 500) / 1000
      : enemyRoleValue(a, threat) - enemyRoleValue(r, threat) + (ps.gd.isGolden(added.id) ? 7 : 0) - (ps.gd.isGolden(removed.id) ? 7 : 0);
    if (score <= 0) continue;
    proposals.push({ plan: p, score });
  }
  proposals.sort((a, b) => b.score - a.score || a.plan.replacement.added - b.plan.replacement.added
    || a.plan.replacement.removed - b.plan.replacement.removed);
  const plans = [original], seen = new Set(), pairs = new Set();
  for (const { plan } of proposals) {
    const pair = `${plan.replacement.added}:${plan.replacement.removed}`; if (pairs.has(pair)) continue;
    pairs.add(pair);
    let layouts;
    if (kind === 'quintus') layouts = [plan, ...bossLinkedPlans(m, ps, h, recipe, plan)];
    else {
      const selected = new Set(plan.lineup.map(p => p.uid));
      const view = Object.assign(Object.create(ps), { board: new Map([...ps.board].filter(([, p]) => p.kind !== 'chess')),
        hand: ps.hand.map(p => selected.has(p?.uid) ? null : p), temp: ps.temp.filter(p => !selected.has(p?.uid)) });
      view.hand.push(...chosen.filter(p => !selected.has(p.uid)));
      for (const p of plan.lineup) view.board.set(plan.get(p.uid), { ...p, dir: plan.dirs.get(p.uid) });
      view.bonds = controlBonds(ps, plan.lineup);
      layouts = [plan, ...enemyPositionPlans(m, view, h, threat).slice(1)];
    }
    for (const layout of layouts.slice(0, 3)) {
      const sig = signature(layout); if (seen.has(sig)) continue; seen.add(sig);
      layout.replacement = plan.replacement; plans.push(layout);
    }
    if (pairs.size === 2) break;
  }
  return plans;
}

export function applyEmergencyRoster(ps, plan) {
  if (plan.replacement) {
    const { added, staging, swapKey } = plan.replacement;
    applyControlPositions(ps, staging);
    const [row, col] = swapKey.split(',').map(Number);
    const result = ps.move(added, { area: 'board', row, col }, plan.dirs.get(added));
    if (result?.error) throw Error(`Emergency replacement rejected: ${result.error}`);
  }
  const expected = stealthBattleInput(ps, plan); applyControlPositions(ps, plan);
  if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Emergency roster differs from forecast');
}

export function* emergencyRosterSteps(m, ps, h, recipe, kind) {
  if (!m.isSolo || m.botRehearsal < 3 || (kind === 'quintus'
    ? m.wave || m.round !== m.gd.bossRound || m.bossId !== 'boss_4'
    : !m.wave || m.round >= m.gd.bossRound)) return;
  const started = performance.now(), plans = emergencyRosterPlans(m, ps, h, recipe, kind);
  if (plans.length < 2) return;
  function* input(p) { yield; return stealthBattleInput(ps, p); }
  const policy = kind === 'quintus' ? { forecastSamples: 10, forecastContext: () => ({ samples: 10, aggregate: true }),
    observeForecast: () => () => ({}), selectForecast: selectFinalSwap }
    : { prepareForecastInput: (m, ps, chosen, p, input) => prepareDevelopmentInput(m, ps, p.lineup, p, input),
      forecastContext: () => ({}), observeForecast: () => () => ({}), selectForecast: selectEnemyRepair };
  let best = plans[0]; const batches = [];
  for (let i = 1; i < plans.length; i += 2) {
    const job = yield* createForecastSteps(m, ps, best.lineup, [best, ...plans.slice(i, i + 2)], input, policy);
    if (!job) continue; while (!job.run(4)) yield; best = job.best;
    batches.push({ index: job.bestIndex, outcomes: job.outcomes,
      candidates: job.plans.map(p => ({ added: p.replacement?.added, removed: p.replacement?.removed,
        positions: p.lineup.map(u => ({ uid: u.uid, id: u.id, key: p.get(u.uid), dir: p.dirs.get(u.uid) })) })) });
  }
  if (best !== plans[0]) applyEmergencyRoster(ps, best);
  (ps._botEmergencyRosterHistory ||= []).push({ kind, round: m.round, changed: best !== plans[0], batches, ms: performance.now() - started });
}

export function withLateranoEmergencyRoster(recipe, kind) {
  if (!['quintus', 'wave'].includes(kind)) throw Error('Unknown emergency roster factor');
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h);
    yield* emergencyRosterSteps(m, ps, h, recipe, kind);
  } });
}
