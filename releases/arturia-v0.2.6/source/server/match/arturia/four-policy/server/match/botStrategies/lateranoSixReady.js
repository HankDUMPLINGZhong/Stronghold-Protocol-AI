// [ASSUMED] Optional 27/9 follow-up: own six effective members before level six; fund a final missing member.
// Uses real buys/sales only. No battle, shop forecast, route-selection or positioning changes.
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';

const CORE = 'lateranoShip';
const retainedBonds = new Set([CORE, 'preciShip', 'skillfulShip', 'visiShip', 'maniShip']);
const gdOf = (m, ps) => ps.gd || m.gd;

/** Count a hypothetical deployment of already-owned pieces, including transfers and active Harmony. */
export function ownedLateranoCount(m, ps, pieces = ps.allChess()) {
  return computeBonds(gdOf(m, ps), { board: new Map(pieces.map((p, i) => [String(i), p])),
    hand: [], layers: ps.layers, bondCountBonus: ps.bondCountBonus })[CORE]?.count || 0;
}

export function withLateranoSixReady(recipe) {
  const blocked = (m, ps) => ps.shop.level === 5 && ownedLateranoCount(m, ps) < 6;
  function missingMember(m, ps) {
    if (m.round !== m.gd.bossRound || ownedLateranoCount(m, ps) >= 6) return null;
    const gd = gdOf(m, ps), owned = ps.allChess();
    return ps.shop.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => {
      if (!slot || slot.sold || slot.kind !== 'chess') return false;
      const rec = gd.chess(slot.id);
      if (recipe.purchaseAllowed(m, ps, rec) === false) return false;
      // Includes a real Harmony member if it completes the six threshold, not just native tags.
      return ownedLateranoCount(m, ps, [...owned, { kind: 'chess', id: slot.id, items: [] }]) >= 6;
    }).sort((a, b) => ps.priceOf(a.slot) - ps.priceOf(b.slot)
      || gd.tierOf(b.slot.id) - gd.tierOf(a.slot.id) || a.index - b.index)[0] || null;
  }
  function liquidate(m, ps) {
    recipe.liquidity?.(m, ps);
    const target = missingMember(m, ps);
    if (!target) return;
    const gd = gdOf(m, ps), canBuy = () => ps.funds >= ps.priceOf(target.slot) && ps.hand.some(p => !p);
    const candidates = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess' && !p.items?.length
      && !pieceBonds(gd, p).some(b => retainedBonds.has(b))
      && !(m.bossId === 'boss_4' && gd.chess(p.id).subProfessionId === 'wandermedic'))
      .sort((a, b) => Number(gd.isGolden(a.id)) - Number(gd.isGolden(b.id))
        || gd.tierOf(a.id) - gd.tierOf(b.id) || a.uid - b.uid);
    // Do not sell pieces speculatively when their base sale proceeds cannot make this purchase possible.
    if (!canBuy() && (!candidates.length || ps.funds + candidates.reduce((s, p) => s + gd.sellPrice(p.id), 0) < ps.priceOf(target.slot))) return;
    const sales = [];
    for (const p of candidates) {
      if (canBuy()) break;
      const result = ps.sell(p.uid);
      if (result.ok) sales.push(p.id);
    }
    if (!canBuy()) return;
    const before = recipe.afterPurchase ? new Set(ps.allChess().map(p => p.uid)) : null;
    const settled = recipe.observeSpend?.(m, ps), result = ps.buy(target.index);
    settled?.();
    if (!result.ok) return;
    if (before) recipe.afterPurchase(m, ps, target.slot, before);
    const stats = ps._botRecipeStats ||= {};
    stats.sixReadyPurchases = (stats.sixReadyPurchases || 0) + 1;
    stats.sixReadySales = (stats.sixReadySales || 0) + sales.length;
  }
  return Object.freeze({ ...recipe,
    levelTarget(m, ps, options) { const target = recipe.levelTarget(m, ps, options); return blocked(m, ps) ? Math.min(5, target) : target; },
    beforeUpgrade(m, ps, plan) { return !blocked(m, ps) && recipe.beforeUpgrade(m, ps, plan); },
    priorityLevel(m, ps) { return !blocked(m, ps) && recipe.priorityLevel(m, ps); },
    spendReserve(m, ps) { return blocked(m, ps) ? 0 : recipe.spendReserve(m, ps); },
    liquidity: liquidate
  });
}
