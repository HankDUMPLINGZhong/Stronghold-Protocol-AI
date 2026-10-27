// [ASSUMED] Experimental hard deadline: entry prep plus two further tier-four preps.
// On the next prep, buy level five first using real funds, even if development/member gates are unmet.
// The existing level-six gate and all acquisition / roster / positioning callbacks remain intact.
export function lateranoFourLimitDue(m, ps) {
  return ps.shop.level === 4 && Number.isInteger(ps._botFourAt)
    && m.round - ps._botFourAt >= 3;
}

export function withLateranoFourLimit(recipe) {
  return Object.freeze({ ...recipe,
    levelTarget: (m, ps, options) => lateranoFourLimitDue(m, ps) ? 5 : recipe.levelTarget(m, ps, options),
    beforeUpgrade: (m, ps, plan) => lateranoFourLimitDue(m, ps) || recipe.beforeUpgrade(m, ps, plan),
    priorityLevel: (m, ps) => lateranoFourLimitDue(m, ps) || recipe.priorityLevel(m, ps),
    upgradeReserve: (m, ps) => lateranoFourLimitDue(m, ps) ? 0 : recipe.upgradeReserve(m, ps),
    spendReserve: (m, ps) => lateranoFourLimitDue(m, ps)
      ? ps.funds >= ps.shop.upgradePrice ? Math.max(0, ps.shop.upgradePrice) : 0
      : recipe.spendReserve(m, ps),
  });
}
