// User experiment: at shop tier two skip Wild Mane/Tippi, except a third copy of an opening pair.
// Purchases, not rewards, earn the one-use exception. No extra forecast or random draw.
const TARGETS = new Set(['chess_char_1_19_a', 'chess_char_2_13_a']);
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && m.round <= 13
  && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip';
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const state = ps => ps._botSiracusaEarlyCore ||= { opening: {}, used: {} };

export function earlyCorePurchaseAllowed(m, ps, rec) {
  if (!scoped(m, ps) || ps.shop.level !== 2 || !rec || !TARGETS.has(base(ps, rec))) return true;
  const id = base(ps, rec), s = ps._botSiracusaEarlyCore;
  if (rec.isGolden || (s?.opening[id] || 0) < 2 || s?.used[id]) return false;
  const own = ps.allChess().filter(p => base(ps, p) === id);
  return own.length === 2 && own.every(p => !ps.gd.isGolden(p.id));
}

const cache = new WeakMap();
export function withSiracusaEarlyCore(parent) {
  if (!cache.has(parent)) cache.set(parent, Object.freeze({ ...parent,
    purchaseAllowed(m, ps, rec) {
      return earlyCorePurchaseAllowed(m, ps, rec) && parent.purchaseAllowed(m, ps, rec);
    },
    afterPurchase(m, ps, slot, before) {
      if (scoped(m, ps) && slot.kind === 'chess' && TARGETS.has(base(ps, slot))) {
        const s = state(ps), id = base(ps, slot);
        if (ps.shop.level === 1) s.opening[id] = (s.opening[id] || 0) + 1;
        if (ps.shop.level === 2) s.used[id] = true;
      }
      parent.afterPurchase?.(m, ps, slot, before);
    },
    bankRemainder(m, ps) {
      return parent.bankRemainder(m, ps, { chessAllowed: rec => earlyCorePurchaseAllowed(m, ps, rec) });
    },
  }));
  return cache.get(parent);
}
