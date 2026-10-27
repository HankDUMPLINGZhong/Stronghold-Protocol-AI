// [ASSUMED] Focused R14 moves over the R11-development recipe. Economy, roster and sample seeds are inherited.
import { lateranoProtectionPlans, protectionScore } from './lateranoProtection.js';
import { legalTiles, canPlace, placeClass, parseKey, tileKey } from '../../../../../board.js';

/** Short-radius fixed enemies expose a medic to direct targeting; Empire's plus strike can also splash a neighbour. */
export function medicalExposure(model, units, radius, plus = false) {
  if (!(radius > 0 && radius <= 8) || !model.bossBodies?.length) return 0;
  const inside = u => model.bossBodies.some(({ center: [r, c] }) => (u.r - r) ** 2 + (u.c - c) ** 2 <= radius * radius);
  let risk = 0;
  for (const u of units.filter(u => u.heal)) {
    if (inside(u)) risk += 4;
    if (plus && units.some(v => v !== u && inside(v) && Math.abs(v.r - u.r) + Math.abs(v.c - u.c) <= 1)) risk += 2;
  }
  return risk;
}

/** Keep the first whole-team proposal from the 23/6 experiment, then change only medical / primary roles. */
export function* lateranoLocalProtectionPlans(m, ps, chosen, plans, helpers) {
  if (m.round !== m.gd.bossRound || m.wave || !m.isSolo) return [];
  const prior = yield* lateranoProtectionPlans(m, ps, chosen, plans, helpers);
  const { model, unitOf, recOf, makePlan, ids } = helpers;
  const gd = ps.gd || m.gd, map = ps.deployMap(), pieces = new Map(chosen.map(p => [p.uid, p]));
  const starts = plans.map(p => [...p].map(([uid, key]) => {
    const [r, c] = parseKey(key), u = unitOf(recOf(pieces.get(uid)), key, r, c, p.dirOf(uid), model);
    u.uid = uid; return u;
  }));
  const wave = m.bossGroupOf?.(ps)?.wave;
  const enemy = gd.enemy(wave?.spawns.find(s => s.tag === 'boss')?.enemyKey);
  const radius = enemy?.stats?.rangeRadius;
  const rank = units => protectionScore(gd, units, model, ids, m.bossId, 1.5)
    - medicalExposure(model, units, radius, m.bossId === 'boss_6');
  const out = prior.length ? [prior[0]] : [];
  const main = u => [ids.exusiaiAlter, ids.lemuen].includes(gd.baseIdOf(u.rec.chessId));
  for (const role of ['medical', 'primary']) {
    let best = null, bestScore = -Infinity;
    // Keep all three control skeletons in the proposal search; do not assume the analytic favourite wins combat.
    for (const start of starts) {
      let units = start.slice();
      const targets = units.filter(u => role === 'medical' ? u.healCover.size > 0 : !u.heal && u.dps > 0)
        .sort((a, b) => Number(main(b)) - Number(main(a)) || b.dps - a.dps || a.uid - b.uid)
        .slice(0, role === 'medical' ? 2 : 3).map(u => u.uid);
      for (let pass = 0; pass < 2; pass++) for (const uid of targets) {
        const i = units.findIndex(u => u.uid === uid), initial = units[i];
        if (pieces.get(uid)?.kind !== 'chess') continue;
        let preferred = units.slice(), score = rank(units);
        for (const [r, c] of legalTiles(map, placeClass(ps, gd.chess(pieces.get(uid).id)))) {
          const key = tileKey(r, c), j = units.findIndex((u, n) => n !== i && u.key === key), other = j >= 0 ? units[j] : null;
          if (other && (pieces.get(other.uid)?.kind !== 'chess'
            || !canPlace(map, placeClass(ps, gd.chess(pieces.get(other.uid).id)), initial.r, initial.c))) continue;
          for (const dir of ['RIGHT', 'UP', 'DOWN', 'LEFT']) {
            const trial = units.slice(), u = unitOf(initial.rec, key, r, c, dir, model); u.uid = uid; trial[i] = u;
            if (other) { const v = unitOf(other.rec, initial.key, initial.r, initial.c, other.dir, model); v.uid = other.uid; trial[j] = v; }
            const value = rank(trial);
            if (value > score + 1e-6) { preferred = trial; score = value; }
          }
        }
        units = preferred; yield;
      }
      const value = rank(units);
      if (value > bestScore + 1e-6) { best = units; bestScore = value; }
    }
    if (best) {
      const plan = makePlan();
      for (const u of best) { plan.set(u.uid, u.key); plan.dirs.set(u.uid, u.dir); }
      plan.protection = true; plan.protectionRole = role; out.push(plan);
    }
  }
  return out;
}

export function withLateranoLocalProtection(recipe) {
  return Object.freeze({ ...recipe, finalProtectionPlans: lateranoLocalProtectionPlans, forecastPlanLimit: 6 });
}
