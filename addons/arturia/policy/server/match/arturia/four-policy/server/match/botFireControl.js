// [ASSUMED] A public-wave formation objective, not a combat simulator or a prediction of future enemy events.
// All blocking points remain traversable. Capacity, effective health and existing healing estimate finite holds;
// shared fire at the strongest sustainable hold is rewarded alongside interception and rear cleanup.
import { acceptsHealing, isFormationAnchor } from './botPositioning.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const bulk = u => {
  const s = u.rec.stats || {};
  return (s.maxHp || 1000) * (1 + (s.def || 0) / 500);
};
const healing = (u, units) => acceptsHealing(u.rec)
  ? Math.min(2, units.filter(v => v.healCover?.has(u.key)).length) : 0;
const arrivalsCache = new WeakMap();

/** Public spawn schedule + unimpeded travel time, shared by routes that meet at the same block tile.
 * No simulated trajectories, post-adjustment battle outcomes, future rounds or private RNG are read.
 */
export function blockArrivalTimes(model, key) {
  let cache = arrivalsCache.get(model);
  if (!cache) arrivalsCache.set(model, (cache = new Map()));
  if (!cache.has(key)) {
    const arrivals = [];
    for (const rt of model.routes) {
      if (rt.fly || rt.fallback) continue;
      const index = rt.tiles.indexOf(key); if (index < 0) continue;
      for (const t of rt.spawnTimes || []) if (Number.isFinite(t)) arrivals.push(t + index * (rt.tileTime || 2));
    }
    cache.set(key, arrivals.sort((a,b) => a-b));
  }
  return cache.get(key);
}

/** Fraction of a finite hold available per arriving enemy when a short burst exceeds blocking capacity. */
export function capacityShare(arrivals, hold, capacity) {
  let peak = 0, left = 0;
  for (let right = 0; right < arrivals.length; right++) {
    while (arrivals[right] - arrivals[left] >= hold && left < right) left++;
    peak = Math.max(peak, right - left + 1);
  }
  return peak > 0 ? Math.min(1, capacity / peak) : 1;
}

/** Strongest sustainable blocker on this route; an earlier one-block interceptor is not the route's endpoint. */
export function routeFront(rt, units, p, anchorUid = null) {
  if (rt.fly || rt.fallback) return { blocks: [], main: null };
  const blocks = [];
  for (const u of units) {
    if (!(u.block > 0)) continue;
    const index = rt.tiles.indexOf(u.key);
    if (index < 0) continue;
    const health = bulk(u), heal = healing(u, units);
    const quality = clamp(Math.sqrt(health / 6500), 0.35, 1.6) * (1 + p.healHold * heal);
    blocks.push({ u, index, health, hold: p.hold * u.block * quality,
      strength: u.block * health * (1 + 0.25 * heal) * (isFormationAnchor(u.rec) ? 1.25 : 1) });
  }
  blocks.sort((a, b) => a.index - b.index || a.u.uid - b.u.uid);
  const main = blocks.find(b => b.u.uid === anchorUid)
    || blocks.reduce((best, b) => !best || b.strength > best.strength ? b : best, null);
  return { blocks, main };
}

/** Expected kills plus a bounded joint-window term. Same objective for facing, movement, swaps and adjacency. */
export function assessFireControl(model, units, p, fronts = null) {
  let value = 0, expectedKills = 0, minClear = 1, enemies = 0;
  for (const rt of model.routes) {
    if (rt.fallback || !(rt.n > 0)) continue;
    const { blocks, main } = routeFront(rt, units, p, fronts?.get(rt));
    const holds = new Map(blocks.map(b => [b.index,
      b.hold * capacityShare(blockArrivalTimes(model, b.u.key), b.hold, b.u.block)]));
    const dealers = units.filter(u => !u.heal && u.dps > 0 && (rt.fly ? u.air : u.ground));
    let exposure = 0, jointDps = 0;
    for (const u of dealers) {
      const at = rt.tiles.indexOf(u.key);
      // Off-road units avoid blocking pressure, but are not assumed immune to ranged attacks or AoE.
      const vulnerable = u.rec.position === 'RANGED' || u.rec.subProfessionId === 'lord';
      const exposed = !rt.fly && vulnerable && at >= 0 && (!main || at < main.index);
      const protection = exposed ? clamp(bulk(u) / (main?.health || 6500), 0.35, 1) : 1;
      const dps = u.dps * protection;
      let window = 0;
      for (let i = 0; i < rt.tiles.length; i++) {
        if (!u.cover.has(rt.tiles[i])) continue;
        window += (rt.tileTime || 2) + (i < 2 ? rt.dwell || 0 : 0) + (holds.get(i) || 0);
      }
      exposure += dps * window;
      // Concentrate useful damage at the main hold, without deleting approach or downstream opportunities.
      if (main && u.cover.has(main.u.key)) jointDps += dps;
    }
    const clear = 1 - Math.exp(-exposure / (p.kill * rt.hp));
    value += rt.n * clear; expectedKills += rt.n * clear; enemies += rt.n;
    minClear = Math.min(minClear, clear);
    if (main) value += rt.n * 0.15 * (1 - Math.exp(-jointDps * holds.get(main.index) / (p.kill * rt.hp)));
  }
  return { value, expectedKills, minClear, enemies };
}

export const fireControlValue = (model, units, p, fronts = null) => assessFireControl(model, units, p, fronts).value;
