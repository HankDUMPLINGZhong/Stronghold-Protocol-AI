// [ASSUMED] At level five, complete unpromoted native pairs for their elite and tier-six reward before upgrading.
// Off-core support pairs do not delay level six. Stop waiting at the leader prep; six-member gates still apply.
const CORE = 'lateranoShip';

export function lateranoNativePairs(m, ps) {
  const gd = ps.gd || m.gd, groups = new Map();
  for (const p of ps.allChess()) {
    const rec = gd.chess(p.id);
    if (!rec.bonds.includes(CORE)) continue;
    const id = gd.baseIdOf(p.id), group = groups.get(id) || { id, normal: 0, elite: false };
    if (gd.isGolden(p.id)) group.elite = true;
    else group.normal++;
    groups.set(id, group);
  }
  return [...groups.values()].filter(g => g.normal >= 2 && !g.elite && (m.pool.entries.get(g.id)?.left || 0) > 0);
}

export function withLateranoNativePairs(recipe) {
  const hold = (m, ps) => ps.shop.level === 5 && m.round >= 12 && m.round < m.gd.bossRound
    && lateranoNativePairs(m, ps).length > 0;
  return Object.freeze({ ...recipe,
    levelTarget(m, ps, options) { const target = recipe.levelTarget(m, ps, options); return hold(m, ps) ? Math.min(5, target) : target; },
    priorityLevel(m, ps) { return !hold(m, ps) && recipe.priorityLevel(m, ps); },
    beforeUpgrade(m, ps, plan) { return !hold(m, ps) && recipe.beforeUpgrade(m, ps, plan); },
    spendReserve(m, ps) { return hold(m, ps) ? 0 : recipe.spendReserve(m, ps); }
  });
}
