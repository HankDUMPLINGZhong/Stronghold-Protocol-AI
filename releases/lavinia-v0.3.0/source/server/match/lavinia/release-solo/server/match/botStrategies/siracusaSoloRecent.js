// [ASSUMED] Adopted solo ABYSS18 pair protection plus late rewards. HARD is frozen.
import { withSiracusaEconomyTrial, siracusaSoloRecentFactor } from './siracusaEconomyTrials.js';
export const SIRACUSA_SOLO_RECENT = Object.freeze(['withdrawal-key-pairs', 'end-rewards', 'boss-four-samples']);
const cache = new WeakMap();
export function withSiracusaSoloRecent(parent, m, factor) {
  factor = siracusaSoloRecentFactor(m, factor);
  if (!factor) return parent;
  if (!SIRACUSA_SOLO_RECENT.includes(factor)) throw Error('Unknown Siracusa solo recent factor');
  if (m.mode !== 'solo' || !m.isSolo || m.order.length !== 1 || m.difficulty !== 'ABYSS') return parent;
  // Explicit historical factors select their own recipe; the adopted late-reward switch stacks only on pairs.
  if (factor === 'withdrawal-key-pairs') {
    const recipe = m.round >= 4 && m.round <= 13 ? withSiracusaEconomyTrial(parent, factor) : parent;
    return m.opts?.botSiracusaSoloEndRewardTrial && m.round >= 4 ? withSiracusaEconomyTrial(recipe, false, true) : recipe;
  }
  if (factor === 'end-rewards') return m.round >= 4 ? withSiracusaEconomyTrial(parent, false, true) : parent;
  if (m.round !== m.gd.bossRound) return parent;
  if (!cache.has(parent)) cache.set(parent, Object.freeze({ ...parent, bossRehearsalSamples: 4 }));
  return cache.get(parent);
}
