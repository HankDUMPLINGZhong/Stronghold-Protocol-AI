// [ASSUMED] A single acquisition ablation over the retained 27/10 recipe; no roster or layout changes.
const WILD = 'chess_char_1_19_a', TIN = 'chess_char_2_19_a';
const GOALS = new Set(['lateranoShip', 'preciShip', 'skillfulShip', 'visiShip', 'steadShip']);
const gdOf = (m, ps) => ps.gd || m.gd;

export function withLateranoReducedSwift(recipe) {
  const base = (m, ps, rec) => gdOf(m, ps).baseIdOf(rec.chessId || rec.id);
  const wanted = rec => rec.bonds?.some(b => GOALS.has(b));
  const fallback = (m, ps, rec) => !!rec && ([TIN, WILD, recipe.ids.tippi].includes(base(m, ps, rec))
    || rec.bonds?.includes('swiftShip') && !wanted(rec));
  const otherBuy = (m, ps, rec) => ps.shop.slots.some(s => {
    if (!s || s.sold || s.kind !== 'chess' || s.id === rec.chessId || ps.priceOf(s) > ps.funds) return false;
    const other = gdOf(m, ps).chess(s.id);
    return other && !fallback(m, ps, other) && wanted(other) && recipe.purchaseAllowed(m, ps, other) !== false;
  });
  function purchaseAllowed(m, ps, rec) {
    const id = base(m, ps, rec);
    if (id === recipe.ids.tippi) return false;
    if (recipe.purchaseAllowed(m, ps, rec) === false) return false;
    if (id === WILD) return m.round === 1 && !ps.allChess().some(p => gdOf(m, ps).baseIdOf(p.id) === WILD)
      && !otherBuy(m, ps, rec);
    // Tin Man remains a legal low-cost fallback, never taken before an affordable relevant shop member.
    return id !== TIN || !otherBuy(m, ps, rec);
  }
  function rewardPriority(m, ps, slot) {
    const offer = ps.offers[0];
    if (!offer?.slots.some(s => !s.sold && s.kind === 'chess' && fallback(m, ps, gdOf(m, ps).chess(s.id)))) return 0;
    if (slot.kind !== 'chess') return 1;
    const rec = gdOf(m, ps).chess(slot.id);
    return !fallback(m, ps, rec) && wanted(rec) && recipe.purchaseAllowed(m, ps, rec) !== false ? 1 : 0;
  }
  return Object.freeze({ ...recipe, purchaseAllowed, rewardPriority,
    buyBonus(m, ps, rec, ...args) {
      const value = recipe.buyBonus(m, ps, rec, ...args);
      return fallback(m, ps, rec) ? Math.min(0, value) : value;
    },
  });
}
