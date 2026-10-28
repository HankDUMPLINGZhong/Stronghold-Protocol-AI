// [ASSUMED] Buy at most one owned ordinary Precision scope before the final assault, even before a sphere.
// Keep it loose for a real transfer; no extra shop weight, funding, upgrade hold or disposal protection.
const SCOPE = 'chess_item_3_02_e_a', SPHERE = 'chess_item_6_09_e_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.chessId || p.id);
const owns = (gd, ps, id) => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item')
  .concat(ps.allChess().flatMap(p => p.items || [])).some(p => base(gd, p) === id);

export function withLateranoPrecisionReserve(recipe) {
  return Object.freeze({ ...recipe,
    purchaseItemAllowed(m, ps, rec) {
      if (recipe.purchaseItemAllowed(m, ps, rec)) return true;
      const gd = gdOf(m, ps);
      return base(gd, rec) === SCOPE && !gd.isGolden(rec.chessId || rec.id) && m.round < gd.bossRound
        && (ps.bonds.preciShip?.count || 0) < 3 && !owns(gd, ps, SPHERE) && !owns(gd, ps, SCOPE);
    },
    holdItem(m, ps, rec) {
      return base(gdOf(m, ps), rec) === SCOPE && !owns(gdOf(m, ps), ps, SPHERE) || recipe.holdItem(m, ps, rec);
    },
    itemTargetAllowed(m, ps, rec, target) {
      if (base(gdOf(m, ps), rec) === SCOPE && !owns(gdOf(m, ps), ps, SPHERE)) return false;
      return recipe.itemTargetAllowed(m, ps, rec, target);
    },
  });
}
