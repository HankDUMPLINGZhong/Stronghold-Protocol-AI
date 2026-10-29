// [ASSUMED] At the leader prep, complete any owned unpromoted pair at level five before upgrading.
// Supports count too; ordinary singles and redundant pairs beside an elite do not hold level six.
export function lateranoUnpromotedPairs(m, ps) {
  const gd = ps.gd || m.gd, groups = new Map();
  for (const p of ps.allChess()) {
    const id = gd.baseIdOf(p.id), group = groups.get(id) || { id, normal: 0, elite: false };
    if (gd.isGolden(p.id)) group.elite = true;
    else group.normal++;
    groups.set(id, group);
  }
  return [...groups.values()].filter(g => g.normal >= 2 && !g.elite);
}

export function withLateranoR14PairHold(recipe) {
  const hold = (m, ps) => m.round === m.gd.bossRound && ps.shop.level === 5 && lateranoUnpromotedPairs(m, ps).length > 0;
  return Object.freeze({ ...recipe,
    levelTarget(m, ps, options) { const target = recipe.levelTarget(m, ps, options); return hold(m, ps) ? Math.min(5, target) : target; },
    priorityLevel(m, ps) { return !hold(m, ps) && recipe.priorityLevel(m, ps); },
    beforeUpgrade(m, ps, plan) { return !hold(m, ps) && recipe.beforeUpgrade(m, ps, plan); },
    spendReserve(m, ps) { return hold(m, ps) ? 0 : recipe.spendReserve(m, ps); }
  });
}
