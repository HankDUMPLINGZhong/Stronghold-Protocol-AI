// [ASSUMED] Active purchases of transitional off-core components stop at one currently owned copy.
// Native members, final Precision carries and the explicit development/healing engines keep their old rules.
const CORE = 'lateranoShip';

export function withLateranoSupportSingles(recipe) {
  const { ids } = recipe;
  const engines = new Set([ids.ptilopsis4, ids.ptilopsis5, ids.titi, ids.astgenne, ids.leonhardt, ids.kroosAlter]);
  const limited = (m, ps, rec) => {
    const gd = ps.gd || m.gd, id = gd.baseIdOf(rec.chessId || rec.id);
    return !rec.bonds.includes(CORE) && !engines.has(id) && !(rec.tier >= 5 && rec.bonds.includes('preciShip'))
      && ps.allChess().some(p => gd.baseIdOf(p.id) === id);
  };
  const purchaseAllowed = (m, ps, rec) => !limited(m, ps, rec) && recipe.purchaseAllowed(m, ps, rec) !== false;
  return Object.freeze({ ...recipe,
    purchaseAllowed,
    // The free-offer scorer keeps the old soft eligibility and its all-poor fallback. No reward filter is added.
    rewardScoreAllowed: recipe.rewardScoreAllowed || recipe.purchaseAllowed,
    importantBuy: (m, ps, rec) => purchaseAllowed(m, ps, rec) && recipe.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec, ...args) => purchaseAllowed(m, ps, rec) && recipe.criticalBuy(m, ps, rec, ...args),
    beforeUpgrade(m, ps, plan) {
      const gd = ps.gd || m.gd;
      const slots = ps.shop.slots.map(s => s?.kind === 'chess' && !s.sold && limited(m, ps, gd.chess(s.id)) ? null : s);
      if (slots.every((s, i) => s === ps.shop.slots[i])) return recipe.beforeUpgrade(m, ps, plan);
      // Inherited key-buy closures must not hold an upgrade for a purchase this candidate forbids.
      const view = Object.create(ps); view.shop = { ...ps.shop, slots };
      return recipe.beforeUpgrade(m, view, plan);
    }
  });
}
