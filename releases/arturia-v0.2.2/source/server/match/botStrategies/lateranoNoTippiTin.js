// [ASSUMED] Purchase-only ablation over retained27/14. Free rewards and owned copies keep their old value.
export function withLateranoNoTippiTin(recipe) {
  const blocked = (m, ps, rec) => [recipe.ids.tippi, 'chess_char_2_19_a'].includes((ps.gd || m.gd).baseIdOf(rec.chessId || rec.id));
  const purchaseAllowed = (m, ps, rec) => !blocked(m, ps, rec) && recipe.purchaseAllowed(m, ps, rec) !== false;
  return Object.freeze({ ...recipe, purchaseAllowed,
    // The shared reward scorer otherwise falls back to purchaseAllowed, unintentionally suppressing free choices.
    rewardScoreAllowed: recipe.rewardScoreAllowed || recipe.purchaseAllowed,
    importantBuy: (m, ps, rec) => purchaseAllowed(m, ps, rec) && recipe.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec, ...args) => purchaseAllowed(m, ps, rec) && recipe.criticalBuy(m, ps, rec, ...args),
    beforeUpgrade(m, ps, plan) {
      const slots = ps.shop.slots.map(s => s?.kind === 'chess' && !s.sold && blocked(m, ps, (ps.gd || m.gd).chess(s.id)) ? null : s);
      if (slots.every((s, i) => s === ps.shop.slots[i])) return recipe.beforeUpgrade(m, ps, plan);
      // A forbidden third copy must not keep an upgrade waiting. The real shop and upgrade gates stay intact.
      const view = Object.create(ps); view.shop = { ...ps.shop, slots };
      return recipe.beforeUpgrade(m, view, plan);
    },
  });
}
