// [ASSUMED] Independent reserve ablations; all member gates and visible key-purchase priorities stay inherited.
// The protected upgrade budget must use the same affordability threshold as the real upgrade action.
export function withLateranoUpgradeReserve(recipe, { lateSixOnly = true } = {}) {
  const release = (m, ps) => !lateSixOnly || m.round >= 12 && ps.shop.level === 5;
  return Object.freeze({ ...recipe,
    upgradeReserve(m, ps) { return release(m, ps) ? 0 : recipe.upgradeReserve(m, ps); },
    spendReserve(m, ps) {
      if (!release(m, ps)) return recipe.spendReserve(m, ps);
      return recipe.priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice ? Math.max(0, ps.shop.upgradePrice) : 0;
    }
  });
}
