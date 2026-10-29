// [ASSUMED] Owner's paid-draft correction, independently selectable over the retained two-seat baseline.
// After R1, Arcane/Raid buys no external Swift or investors, including duplicate/parking purchases. Rewards inherit.
const CORE = 'siracusaShip';
const scoped = (m, ps) => m.round >= 2 && m.mode === 'coop' && !m.isSolo && m.order.length === 2 && m.difficulty === 'ABYSS'
  && ps.bandId === 'band_chiave' && ps._botFocusId === CORE && ps._botRoute?.id === `${CORE}:arcane-raid`;

export function arcaneDraftPurchaseAllowed(m, ps, rec) {
  if (!scoped(m, ps) || !rec || rec.bonds.includes(CORE)) return true;
  return !rec.bonds.some(id => id === 'investShip' || id === 'swiftShip');
}

// Inherited funding/parking hooks close over their parent recipe. Hide forbidden slots from their planning
// view without changing real shop indices, ownership or state. All real PlayerState methods retain their receiver.
function paidView(m, ps) {
  return new Proxy(ps, {
    get(target, key) {
      if (key === 'shop') return new Proxy(target.shop, {
        get(shop, name) {
          if (name === 'slots') return shop.slots.map(s => s?.kind === 'chess' && !s.sold
            && !arcaneDraftPurchaseAllowed(m, target, target.gd.chess(s.id)) ? null : s);
          const value = Reflect.get(shop, name, shop);
          return typeof value === 'function' ? value.bind(shop) : value;
        },
      });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const cache = new WeakMap();
export function withSiracusaArcaneDraft(parent, enabled) {
  if (!enabled) return parent;
  if (enabled !== true) throw Error('Unknown Siracusa Arcane draft trial');
  if (!cache.has(parent)) cache.set(parent, Object.freeze({ ...parent,
    purchaseAllowed: (m, ps, rec) => arcaneDraftPurchaseAllowed(m, ps, rec) && parent.purchaseAllowed(m, ps, rec),
    criticalBuy: (m, ps, rec, plan) => arcaneDraftPurchaseAllowed(m, ps, rec) && parent.criticalBuy(m, ps, rec, plan),
    importantBuy: (m, ps, rec) => arcaneDraftPurchaseAllowed(m, ps, rec) && parent.importantBuy(m, ps, rec),
    beforeUpgrade: (m, ps, plan) => parent.beforeUpgrade(m, scoped(m, ps) ? paidView(m, ps) : ps, plan),
    trade: (m, ps, ctx) => parent.trade(m, scoped(m, ps) ? paidView(m, ps) : ps, ctx),
    bankRemainder: (m, ps, options) => parent.bankRemainder(m, scoped(m, ps) ? paidView(m, ps) : ps, options),
  }));
  return cache.get(parent);
}
