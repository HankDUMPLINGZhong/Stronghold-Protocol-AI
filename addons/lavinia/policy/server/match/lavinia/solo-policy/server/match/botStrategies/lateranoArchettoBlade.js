// [ASSUMED] Isolated purchase factor: Skillful route banks up to four normal-equivalent blades for Archetto.
// Two ordinary copies merge through PlayerState; no item stats, shop RNG, roster or positioning rules change.
const BLADE = 'chess_item_3_07_e_a', DOCTOR = 'chess_item_5_06_e_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id || p.chessId);
const inventory = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');

export function withLateranoArchettoBlade(recipe) {
  const isBlade = (gd, p) => base(gd, p) === BLADE;
  const skillful = ps => ps._botRoute?.support === 'skillfulShip';
  const ownedBlades = (m, ps) => inventory(ps).concat(ps.allChess().flatMap(p => p.items || []))
    .filter(p => isBlade(gdOf(m, ps), p));
  const purchased = ps => ps._botArchettoBladeBuys || 0;
  const handles = (m, ps, rec) => isBlade(gdOf(m, ps), rec) && (skillful(ps) || purchased(ps) > 0);
  const allowed = (m, ps, rec) => skillful(ps) && purchased(ps) < 4
    && ownedBlades(m, ps).reduce((n, p) => n + (gdOf(m, ps).isGolden(p.id) ? 2 : 1), 0)
      + (rec.isGolden ? 2 : 1) <= 4;
  function replacement(m, ps, p) {
    const gd = gdOf(m, ps);
    if ((p.items?.length || 0) < gd.equipPerChess) return null;
    // Do not destroy a pending next-round promotion or an already-equipped blade.
    return (p.items || []).filter(i => !isBlade(gd, i) && base(gd, i) !== DOCTOR)
      .sort((a, b) => gd.item(a.id).price - gd.item(b.id).price || a.uid - b.uid)[0]?.uid ?? false;
  }
  function target(m, ps, owned) {
    const gd = gdOf(m, ps);
    return owned.filter(p => base(gd, p) === recipe.ids.archetto && replacement(m, ps, p) !== false)
      .sort((a, b) => Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id))
        || Number(ps.find(b.uid)?.area === 'board') - Number(ps.find(a.uid)?.area === 'board') || a.uid - b.uid)[0] || null;
  }
  const out = { ...recipe,
    purchaseItemAllowed(m, ps, rec) { return isBlade(gdOf(m, ps), rec) ? allowed(m, ps, rec) : recipe.purchaseItemAllowed(m, ps, rec); },
    importantItem(m, ps, rec) { return isBlade(gdOf(m, ps), rec) ? allowed(m, ps, rec) : recipe.importantItem?.(m, ps, rec); },
    purchaseItemBonus(m, ps, rec) { return isBlade(gdOf(m, ps), rec) ? allowed(m, ps, rec) ? 80 : 0 : recipe.purchaseItemBonus?.(m, ps, rec) || 0; },
    beforeUpgrade(m, ps, plan) {
      return !ps.shop.slots.some(s => s && !s.sold && s.kind === 'item' && ps.priceOf(s) <= ps.funds
        && isBlade(gdOf(m, ps), s) && allowed(m, ps, gdOf(m, ps).item(s.id))) && recipe.beforeUpgrade(m, ps, plan);
    },
    afterPurchase(m, ps, slot, before) {
      if (slot.kind === 'item' && isBlade(gdOf(m, ps), slot)) ps._botArchettoBladeBuys = purchased(ps) + 1;
      recipe.afterPurchase?.(m, ps, slot, before);
    },
    holdItem(m, ps, rec) { return handles(m, ps, rec) ? !target(m, ps, ps.allChess()) : recipe.holdItem(m, ps, rec); },
    protectItem(m, ps, rec) { return handles(m, ps, rec) || recipe.protectItem?.(m, ps, rec); },
    ownedItemTarget(m, ps, rec, owned) { return handles(m, ps, rec) ? target(m, ps, owned) : recipe.ownedItemTarget(m, ps, rec, owned); },
    itemTargetAllowed(m, ps, rec, p) { return handles(m, ps, rec) ? base(gdOf(m, ps), p) === recipe.ids.archetto && replacement(m, ps, p) !== false : recipe.itemTargetAllowed(m, ps, rec, p); },
    itemReplacement(m, ps, rec, p) { return handles(m, ps, rec) ? replacement(m, ps, p) : recipe.itemReplacement(m, ps, rec, p); },
    useEconomy(m, ps) {
      recipe.useEconomy(m, ps);
      for (const item of inventory(ps)) {
        const rec = gdOf(m, ps).item(item.id);
        if (!handles(m, ps, rec)) continue;
        const p = target(m, ps, ps.allChess());
        if (p) ps.equip(item.uid, p.uid, replacement(m, ps, p));
      }
    }
  };
  return Object.freeze(out);
}
