// [ASSUMED] On the leader prep, reinforce unpromoted native members at level five instead of buying level six.
const CORE = 'lateranoShip';
export function lateranoUnpromotedNatives(m, ps) {
  const gd = ps.gd || m.gd, owned = ps.allChess(), elites = new Set(owned.filter(p => gd.isGolden(p.id)).map(p => gd.baseIdOf(p.id)));
  return [...new Set(owned.filter(p => gd.chess(p.id).bonds.includes(CORE) && !gd.isGolden(p.id)
    && !elites.has(gd.baseIdOf(p.id))).map(p => gd.baseIdOf(p.id)))];
}
export function withLateranoR14EliteHold(recipe) {
  const hold = (m, ps) => m.round === m.gd.bossRound && ps.shop.level === 5 && lateranoUnpromotedNatives(m, ps).length > 0;
  return Object.freeze({ ...recipe,
    levelTarget(m, ps, options) { const target = recipe.levelTarget(m, ps, options); return hold(m, ps) ? Math.min(5, target) : target; },
    priorityLevel(m, ps) { return !hold(m, ps) && recipe.priorityLevel(m, ps); },
    beforeUpgrade(m, ps, plan) { return !hold(m, ps) && recipe.beforeUpgrade(m, ps, plan); },
    spendReserve(m, ps) { return hold(m, ps) ? 0 : recipe.spendReserve(m, ps); }
  });
}
