// [ASSUMED] User-requested acquisition/use windows are bot policy, not item mechanics.
// Ordinary Doctor Projection promotes at next round start; Mimic grants a real third copy via the normal API.
const DOCTOR = 'chess_item_5_06_e_a', MIMIC = 'chess_item_5_05_e_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, rec) => gd.baseIdOf(rec.chessId || rec.id);
const inventory = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');

export function withLateranoPromotion(recipe, { deadlineFallback = false, eligibleTarget = () => true } = {}) {
  const { ids } = recipe, main = new Set([ids.executorAlter, ids.exusiaiAlter, ids.lemuen]);
  const special = (gd, rec) => [DOCTOR, MIMIC].includes(base(gd, rec));
  const pending = (gd, p) => p.items?.some(i => base(gd, i) === DOCTOR);
  function allowed(m, ps, rec) {
    const gd = gdOf(m, ps), id = base(gd, rec);
    if (id === MIMIC) return m.round < 14;
    if (id === DOCTOR) return m.round < 13 && !inventory(ps).concat(ps.allChess().flatMap(p => p.items || []))
      .some(i => base(gd, i) === DOCTOR);
    return recipe.purchaseItemAllowed(m, ps, rec);
  }
  function target(m, ps, rec) {
    const gd = gdOf(m, ps), mimic = base(gd, rec) === MIMIC, owned = ps.allChess();
    const auxiliary = ps._botRoute?.support === 'preciShip' ? ids.titi
      : ps._botRoute?.support === 'skillfulShip' ? ids.astgenne : null;
    if (!mimic && ps.funds > 0) return null;
    const preferred = owned.filter(p => {
      const id = base(gd, p);
      if (!eligibleTarget(gd.chess(p.id))) return false;
      if (gd.isGolden(p.id) || pending(gd, p) || owned.some(v => base(gd, v) === id && gd.isGolden(v.id))) return false;
      if (!main.has(id) && !(id === auxiliary && m.round < (mimic ? 13 : 12))) return false;
      const count = owned.filter(v => base(gd, v) === id && !gd.isGolden(v.id)).length;
      return mimic ? count >= 2 : count === 1;
    }).sort((a, b) => Number(main.has(base(gd, b))) - Number(main.has(base(gd, a)))
      || gd.chess(b.id).tier - gd.chess(a.id).tier || a.uid - b.uid)[0] || null;
    if (preferred || !deadlineFallback || m.round !== (mimic ? 14 : 13)) return preferred;
    // Deadline: only deployed non-elites; Mimic may now grant a random same-bond single.
    const plan = { ps, route: ps._botRoute };
    return [...ps.board.values()].filter(p => p.kind === 'chess' && !gd.isGolden(p.id)
      && eligibleTarget(gd.chess(p.id))
      && (mimic || !pending(gd, p)))
      .sort((a, b) => gd.chess(b.id).tier - gd.chess(a.id).tier
        || recipe.unitBonus(m, ps, gd.chess(b.id), plan) - recipe.unitBonus(m, ps, gd.chess(a.id), plan)
        || a.uid - b.uid)[0] || null;
  }
  const out = { ...recipe,
    purchaseItemAllowed: allowed,
    importantItem(m, ps, rec) { return special(gdOf(m, ps), rec) && allowed(m, ps, rec); },
    // Shared itemBonus also scores free item choices. Leave those decisions exactly as the retained recipe.
    purchaseItemBonus(m, ps, rec) { return special(gdOf(m, ps), rec) && allowed(m, ps, rec) ? 80 : 0; },
    beforeUpgrade(m, ps, plan) {
      return !ps.shop.slots.some(s => s && !s.sold && s.kind === 'item' && ps.priceOf(s) <= ps.funds
        && out.importantItem(m, ps, gdOf(m, ps).item(s.id))) && recipe.beforeUpgrade(m, ps, plan);
    },
    holdItem(m, ps, rec) { return special(gdOf(m, ps), rec) ? !target(m, ps, rec) : recipe.holdItem(m, ps, rec); },
    protectItem(m, ps, rec) { return special(gdOf(m, ps), rec) || recipe.protectItem?.(m, ps, rec); },
    ownedItemTarget(m, ps, rec, owned) { return special(gdOf(m, ps), rec) ? target(m, ps, rec) : recipe.ownedItemTarget(m, ps, rec, owned); },
    itemTargetAllowed(m, ps, rec, p) { return special(gdOf(m, ps), rec) ? target(m, ps, rec)?.uid === p.uid : recipe.itemTargetAllowed(m, ps, rec, p); },
    useEconomy(m, ps) {
      recipe.useEconomy(m, ps);
      // Recompute after every use: a Mimic merge changes both copy counts and target identity.
      for (const item of inventory(ps)) {
        const rec = gdOf(m, ps).item(item.id);
        if (!special(gdOf(m, ps), rec)) continue;
        const p = target(m, ps, rec);
        if (p && (p.items?.length || 0) < gdOf(m, ps).equipPerChess) ps.equip(item.uid, p.uid);
      }
    },
  };
  return Object.freeze(out);
}
