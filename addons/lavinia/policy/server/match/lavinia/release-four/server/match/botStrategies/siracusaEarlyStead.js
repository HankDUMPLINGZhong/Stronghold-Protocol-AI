// [ASSUMED] Opt-in two-seat adaptation of Sargon's dynamic early Stead transition.
// Only a second distinct foreign Stead; native progress and executable budgets come first.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';

export const SIRACUSA_EARLY_STEAD = 'coop-two-early-stead';
const CORE = 'siracusaShip';
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const foreign = r => r.bonds.includes('steadShip') && !r.bonds.includes(CORE);
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.difficulty === 'ABYSS' && m.order.length === 2
  && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const opening = (m, ps) => scope(m, ps) && m.round >= 1 && m.round <= 7 && ps.shop.level < 4;

export function siracusaSteadDecision(parent, m, ps, rec) {
  const owned = ps.allChess(), id = base(ps, rec);
  const held = new Set(owned.filter(p => {
    const b = pieceBonds(ps.gd, p); return b.includes('steadShip') && !b.includes(CORE);
  }).map(p => base(ps, p)));
  const nativeKinds = new Set(owned.filter(p => pieceBonds(ps.gd, p).includes(CORE)).map(p => base(ps, p))).size;
  const paid = ps._botSiracusaEarlySteadPaid || [];
  let reason = 'accepted', budget = null, price = null;
  if (!opening(m, ps)) reason = 'inactive';
  else if (!foreign(rec)) reason = 'not-foreign-stead';
  else if (owned.some(p => base(ps, p) === id) || paid.includes(id)) reason = 'no-new-pairs';
  else if (held.size !== 1) reason = 'needs-one-held-foreign';
  else if (paid.length >= 2) reason = 'paid-cap';
  else if (nativeKinds >= 4) reason = 'native-progress-first';
  else {
    const slots = ps.shop.slots.filter(s => s && !s.sold && s.kind === 'chess');
    const slot = slots.find(s => base(ps, s) === id);
    if (!slot) reason = 'not-in-shop';
    else if (slots.some(s => ps.priceOf(s) <= ps.funds && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id))
      && (ps.gd.chess(s.id).bonds.includes(CORE) || parent.importantBuy?.(m, ps, ps.gd.chess(s.id))))) reason = 'visible-key-first';
    else {
      price = ps.priceOf(slot);
      const target = parent.levelTarget(m, ps), upgradePrice = Math.max(0, ps.shop.upgradePrice);
      const extra = Math.max(0, parent.upgradeReserve(m, ps));
      const spend = Math.max(0, parent.spendReserve(m, ps) || 0), purchase = Math.max(0, parent.purchaseReserve?.(m, ps) || 0);
      const ready = owned.length >= (m.round <= 4 ? ps.deployCap : Math.min(ps.deployCap, 6)) || parent.readyForUpgrade?.(m, ps) === true;
      const executable = ps.shop.level < target && ps.funds >= upgradePrice + extra && (ready || m.round >= 6)
        && parent.beforeUpgrade(m, ps, { route: ps._botRoute });
      budget = { target, upgradePrice, extra, spend, purchase, executable,
        reserve: Math.max(spend, purchase, executable ? upgradePrice + extra : 0) };
      if (ps.funds - price < budget.reserve) reason = 'upgrade-main-budget';
    }
  }
  return { allowed: reason === 'accepted', reason, id, nativeKinds, held: [...held], paid, price, budget };
}

const cache = new WeakMap();
export function withSiracusaEarlyStead(parent) {
  if (!cache.has(parent)) cache.set(parent, Object.freeze({ ...parent,
    purchaseAllowed: (m, ps, rec) => parent.purchaseAllowed(m, ps, rec) || siracusaSteadDecision(parent, m, ps, rec).allowed,
    keep: (m, ps, rec, plan) => parent.keep(m, ps, rec, plan) || opening(m, ps) && foreign(rec),
    afterPurchase(m, ps, slot, before) {
      parent.afterPurchase?.(m, ps, slot, before);
      if (!opening(m, ps) || slot.kind !== 'chess' || !foreign(ps.gd.chess(slot.id))) return;
      const paid = new Set(ps._botSiracusaEarlySteadPaid || []); paid.add(base(ps, slot)); ps._botSiracusaEarlySteadPaid = [...paid];
      (ps._botSiracusaCoopHistory ||= []).push({ factor: SIRACUSA_EARLY_STEAD, kind: 'purchase', round: m.round,
        id: slot.id, fundsAfter: ps.funds, paid: [...paid] });
    },
  }));
  return cache.get(parent);
}
