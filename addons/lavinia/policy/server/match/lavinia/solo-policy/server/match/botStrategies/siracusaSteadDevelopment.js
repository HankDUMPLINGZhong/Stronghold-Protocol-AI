// [ASSUMED] One independent early-Stead policy: protect observable development opportunities,
// then pay for survival / a critical LP buffer, never for raw leak counts alone.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';

export function steadDevelopmentBudget(m, ps) {
  const refresh = Math.max(0, ps.gd.refreshPrice), band = ps.gd.band(ps.bandId);
  const every = band?.params?.refresh_count, cap = band?.params?.max_count;
  const given = ps.counters['band:chiave:r'] === m.round ? ps.counters['band:chiave'] || 0 : 0;
  const distance = every > 0 && given < cap ? every - (ps.counters['band:chiave:refreshes'] || 0) % every : null;
  const counts = new Map();
  for (const p of ps.allChess()) if (!ps.gd.isGolden(p.id) && pieceBonds(ps.gd, p).includes('siracusaShip')) {
    const id = ps.gd.baseIdOf(p.id); counts.set(id, (counts.get(id) || 0) + 1);
  }
  const pairs = [...counts].filter(([, n]) => n >= 2).map(([id]) => id);
  // No future shop identities, private pool state, reward dispatch, or assumed successful search.
  const pairReserve = Math.max(0, ...pairs.map(id => ps.gd.chessPrice(id) + refresh));
  const giftReserve = distance !== null && distance <= 2 ? distance * refresh + refresh : 0;
  return { defer: ps.shop.freeRefreshes > 0, freeRefreshes: ps.shop.freeRefreshes || 0,
    giftDistance: distance, pairs, reserve: Math.max(refresh, pairReserve, giftReserve) };
}

/** Complete paired forecasts. `lost` is the capped solo charge BEFORE any uncertain Unite rescue. */
export function steadDevelopmentWorth(before, after, price, lp, lossCap) {
  if (!(price > 0) || !(lossCap > 0)) return false;
  const lethal = before.some(r => r.lost >= lp);
  if (lethal) return after.every(r => r.lost < lp);
  if (lp - Math.max(...before.map(r => r.lost)) >= lossCap) return false;
  // With less than one complete loss-cap of buffer, require at least one robust LP per gold.
  return Math.min(...before.map((r, i) => r.lost - after[i].lost)) >= price;
}
