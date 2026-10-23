// [ASSUMED] Compare nominal pick-three rewards, not the seeded next offer or a combat replay.
// Copy weights use public initial stock minus this player's holdings; hidden pool depletion is not inspected.
import { readsTeammateRoster } from '../botCoreStrategies.js';
const gdOf = (m, ps) => ps.gd || m.gd;

/** Exact expected best value of up to three distinct, copy-weighted identities. No random draws. */
export function expectedMergeReward(entries, count = 3) {
  const rows = entries.filter(x => x.weight > 0).sort((a, b) => a.value - b.value);
  const n = Math.min(count, rows.length), total = rows.reduce((s, x) => s + x.weight, 0);
  if (!n) return 0;
  if (n === 1) return rows.reduce((s, x) => s + x.weight * x.value / total, 0);
  let value = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i].weight, b = rows[j].weight;
    const ab = a / total * b / (total - a), ba = b / total * a / (total - b);
    if (n === 2) { value += (ab + ba) * rows[j].value; continue; }
    for (let k = j + 1; k < rows.length; k++) {
      const c = rows[k].weight;
      const probability = (ab + ba) * c / (total - a - b)
        + (a / total * c / (total - a) + c / total * a / (total - c)) * b / (total - a - c)
        + (b / total * c / (total - b) + c / total * b / (total - c)) * a / (total - b - c);
      value += probability * rows[k].value;
    }
  }
  return value;
}

export function lateranoMergeOrder(m, ps, recipe, scoreReward, { publicTeammates = false, partialBundle = false } = {}) {
  const gd = gdOf(m, ps), level = ps.shop.level, price = Math.max(0, ps.shop.upgradePrice);
  if (level >= gd.maxShopLevel || gd.rewardOffer().count > 3 || !ps.hand.some(p => !p)) return null;
  const seen = new Set(), slots = [];
  for (const slot of ps.shop.slots) {
    if (!slot || slot.sold || slot.kind !== 'chess' || !ps.completesChessMerge(slot.id)) continue;
    const rec = gd.chess(slot.id), base = gd.baseIdOf(slot.id);
    if (seen.has(base) || recipe.purchaseAllowed(m, ps, rec) === false) continue;
    seen.add(base); slots.push(slot);
  }
  if (!slots.length) return null;
  const allSlots = slots.slice();
  let pendingSlots = [];
  if (partialBundle && ps.funds < price + slots.reduce((s, slot) => s + ps.priceOf(slot), 0)) {
    let best = null;
    for (let mask = 1; mask < 2 ** slots.length; mask++) {
      const subset = slots.filter((_, i) => mask & 2 ** i), cost = subset.reduce((s, p) => s + ps.priceOf(p), 0);
      if (cost + price > ps.funds) continue;
      const value = subset.reduce((s, p) => s + Math.max(0, scoreReward(p.id)), 0);
      if (!best || value > best.value || value === best.value && cost < best.cost) best = { subset, value, cost };
    }
    if (!best) return null;
    pendingSlots = slots.filter(s => !best.subset.includes(s));
    slots.splice(0, slots.length, ...best.subset);
  }
  const cost = slots.reduce((s, slot) => s + ps.priceOf(slot), 0);
  if (ps.funds < price + cost || ps.funds < price + recipe.upgradeReserve(m, ps)) return null;
  const owned = new Map();
  for (const p of ps.allChess()) {
    const base = gd.baseIdOf(p.id);
    const copies = gd.isGolden(p.id) ? gd.goldenCopies : 1;
    owned.set(base, (owned.get(base) || 0) + (publicTeammates ? copies : p.poolCopies ?? copies));
  }
  // Only visible deployed teammate holdings, never their private hands, shops or actual hidden pool depletion.
  if (publicTeammates && readsTeammateRoster(m, ps)) for (const other of m.players.values()) {
    if (other.playerId === ps.playerId || !other.alive) continue;
    for (const p of other.board.values()) if (p.kind === 'chess') {
      const base = gd.baseIdOf(p.id);
      owned.set(base, (owned.get(base) || 0) + (gd.isGolden(p.id) ? gd.goldenCopies : 1));
    }
  }
  const banned = new Set(m.bannedChess || []), ro = gd.rewardOffer();
  const estimate = tier => {
    let entries = [];
    // Match the documented fallback to lower tiers when the nominal tier has no available identities.
    for (let t = tier; t >= 1 && !entries.length; t--) entries = gd.visibleChess
      .filter(id => !banned.has(id) && gd.chess(id).tier === t)
      .map(id => ({ id, weight: Math.max(0, gd.poolCopies(id) - (owned.get(id) || 0)) }))
      .filter(e => e.weight > 0).map(e => ({ ...e, value: Math.max(0, scoreReward(e.id)) }));
    return { tier, value: expectedMergeReward(entries, ro.count), candidates: entries.length };
  };
  const current = estimate(Math.min(ro.maxTier, level + ro.tierOffset));
  const next = estimate(Math.min(ro.maxTier, level + 1 + ro.tierOffset));
  const upgradeFirst = next.value > current.value + 0.01;
  const view = Object.create(ps);
  // Keep all other inherited critical-card, equipment and six-member gates intact.
  view.shop = { ...ps.shop, slots: ps.shop.slots.map(s => s?.kind === 'chess' && seen.has(gd.baseIdOf(s.id)) ? null : s) };
  return { upgradeFirst, slots, gatePlayer: view, current, next, level, cost,
    ...(partialBundle ? { pendingSlots, allSlots } : {}) };
}

export function withLateranoMergeOrder(recipe, { cooperative = false } = {}) {
  return Object.freeze({ ...recipe,
    upgradeMergeOrder(m, ps, { scoreReward }) {
      if (cooperative && m.mode !== 'coop') return recipe.upgradeMergeOrder?.(m, ps, { scoreReward });
      return lateranoMergeOrder(m, ps, recipe, scoreReward, { publicTeammates: cooperative });
    },
  });
}
