// [ASSUMED] Laterano acquisition policy only: one promoted copy ends shop purchases of that base.
// Free offers remain legal fallbacks; this must not affect Siracusa's acquisition-trigger farming.
const gdOf = (m, ps) => ps.gd || m.gd;

export function withLateranoEliteCap(recipe) {
  const promoted = (m, ps, rec) => {
    const gd = gdOf(m, ps), id = gd.baseIdOf(rec.chessId || rec.id);
    return ps.allChess().some(p => gd.baseIdOf(p.id) === id && gd.isGolden(p.id));
  };
  const purchaseAllowed = (m, ps, rec) => !promoted(m, ps, rec) && recipe.purchaseAllowed(m, ps, rec) !== false;
  return Object.freeze({ ...recipe,
    purchaseAllowed,
    // Do not add rewardAllowed: the shared free-offer scorer ranks forbidden purchases at -1000,
    // yet still takes a fallback when every offer is poor. Adding a filter would discard unrelated free offers.
    importantBuy: (m, ps, rec) => purchaseAllowed(m, ps, rec) && recipe.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec, ...args) => purchaseAllowed(m, ps, rec) && recipe.criticalBuy(m, ps, rec, ...args),
    beforeUpgrade(m, ps, plan) {
      const gd = gdOf(m, ps);
      const slots = ps.shop.slots.map(s => s?.kind === 'chess' && promoted(m, ps, gd.chess(s.id)) ? null : s);
      if (slots.every((s, i) => s === ps.shop.slots[i])) return recipe.beforeUpgrade(m, ps, plan);
      // Earlier wrappers close over their own purchase checks. Give these read-only gates a filtered view,
      // so a now-forbidden extra pair cannot block upgrading. Do not mutate the real shop or player.
      const view = Object.create(ps);
      view.shop = { ...ps.shop, slots };
      return recipe.beforeUpgrade(m, view, plan);
    },
  });
}
