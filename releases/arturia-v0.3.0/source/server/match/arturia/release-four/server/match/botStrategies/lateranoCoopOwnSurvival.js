// [ASSUMED] Narrow opt-in: preserve this player's LP before transferable individual end-state protection.
// Existing complete fixed-roster forecasts only; no combat replay, teammate roster or extra search.
const openings = new WeakMap();
// T3: the existing prepBegin adapter calls this module before any own economy action.
const bossOpenings = new WeakMap();
export function bossOpeningLP(m, ps) {
  const row = bossOpenings.get(ps);
  return row?.match === m && row.round === m.round ? row.lp : null;
}
export function bossOpeningAliveCount(m, ps) {
  const row = bossOpenings.get(ps);
  return row?.match === m && row.round === m.round ? row.aliveCount : null;
}
function captureBossOpening(m, ps) {
  if (m.mode !== 'coop' || m.isSolo || m.wave || m.round !== m.gd.bossRound
    || bossOpeningLP(m, ps) !== null || !Array.isArray(m.order) || !m.order.includes(ps)) return;
  // Read only public survival/LP fields, once. No unit, position, equipment, band or bond read.
  const lp = m.order.reduce((sum, p) => sum + (p.alive === true && Number.isFinite(p.lp) && p.lp > 0 ? p.lp : 0), 0);
  const aliveCount = m.order.filter(p => p.alive === true).length;
  bossOpenings.set(ps, Object.freeze({ match: m, round: m.round, lp, aliveCount }));
}
// Capture before the policy has chosen its first focus; activation is separately gated by the recipe.
const scoped = m => m.mode === 'coop' && !m.isSolo && m.wave && m.round < m.gd.bossRound;

export function ownSurvivalOpeningLP(m, ps) {
  const row = openings.get(ps);
  return row?.match === m && row.round === m.round ? row.lp : null;
}

export function captureOwnSurvivalOpening(m, ps) {
  captureBossOpening(m, ps);
  if (scoped(m) && ownSurvivalOpeningLP(m, ps) === null)
    openings.set(ps, { match: m, round: m.round, lp: ps.lp });
}

export function withCoopOwnLethalSurvival(recipe) {
  return Object.freeze({ ...recipe, coopOwnLethalSurvival: true,
    prepStart(m, ps) {
      captureOwnSurvivalOpening(m, ps);
      recipe.prepStart?.(m, ps);
    },
  });
}

const mean = (rows, key) => rows.reduce((n, r) => n + r[key], 0) / rows.length;
const worst = (rows, key) => Math.max(...rows.map(r => r[key]));
const sameRoster = (a, b) => Array.isArray(a?.lineup) && Array.isArray(b?.lineup)
  && a.lineup.length === b.lineup.length
  && a.lineup.every(p => b.lineup.some(q => q.uid === p.uid && q.id === p.id));

/** Return null outside the narrow exception, leaving the inherited selector unchanged. */
export function selectOwnLethalSurvival(plans, rows, ctx, { valid, aura }) {
  const lp = ctx.ownSurvivalOpeningLP;
  if (!ctx.ownLethalSurvival || !Number.isFinite(lp) || lp <= 0 || !valid(rows[0])
    || !rows[0].every(r => r.lost >= lp)) return null;
  let best = null, bestScore = null;
  for (let i = 1; i < rows.length; i++) {
    if (!sameRoster(plans[0], plans[i]) || !valid(rows[i]) || !rows[i].every((r, s) => {
      const b = rows[0][s];
      return r.lost >= 0 && r.lost < lp && r.lost <= b.lost && r.leaks >= 0 && r.leaks <= b.leaks
        && r.criticalDown <= b.criticalDown && aura(r, b)
        && [...ctx.protectedUids].every(uid => (r.protectedDeaths?.[uid] || 0) <= (b.protectedDeaths?.[uid] || 0)
          && (r.protectedFirstDeaths?.[uid] ?? Infinity) + 1 >= (b.protectedFirstDeaths?.[uid] ?? Infinity));
    })) continue;
    const score = [-worst(rows[i], 'lost'), -mean(rows[i], 'lost'), mean(rows[i], 'growth'),
      -worst(rows[i], 'criticalDown'), mean(rows[i], 'entryReady')];
    const first = bestScore ? score.findIndex((v, k) => Math.abs(v - bestScore[k]) > 1e-6) : -1;
    if (best === null || first >= 0 && score[first] > bestScore[first]) {
      best = i; bestScore = score;
    }
  }
  return best === null ? null : { index: best, safeIndex: best, cost: 0,
    worstLoss: worst(rows[best], 'lost'), growth: mean(rows[best], 'growth'),
    ownLethalSurvival: true, openingLP: lp };
}
