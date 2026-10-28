// [ASSUMED] Independent, opt-in two-seat opening priorities over the retained9/56 recipe.
// Actual holdings only. No extra cash sales, shop locks, future cards or new layout rules.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';

export const SIRACUSA_CORE_PRIORITY_FACTORS = Object.freeze(['coop-two-missing-core', 'coop-two-distinct-core']);
const CORE = 'siracusaShip', PRIORITY_BONUS = 10000;
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.difficulty === 'ABYSS' && m.order.length === 2
  && !!m.wave && m.round >= 1 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);

export function missingSiracusaCore(m, ps, rec) {
  return scope(m, ps) && !!rec?.bonds.includes(CORE) && !ps.allChess().some(p => base(ps, p) === base(ps, rec));
}
export function siracusaDistinctRequirement(m, ps) {
  if (!scope(m, ps) || ps.gd.modeInactiveBonds.has(CORE)) return 0;
  return Math.min(6, ps.deployCap, new Set(ps.allChess().filter(p => pieceBonds(ps.gd, p).includes(CORE))
    .map(p => base(ps, p))).size);
}

const cache = new WeakMap();
export function withSiracusaCorePriority(parent, factor) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (!variants.has(factor)) variants.set(factor, Object.freeze({ ...parent,
    ...(factor === 'coop-two-distinct-core' ? {
      requiredCoreMembers: (m, ps) => Math.max(parent.requiredCoreMembers?.(m, ps) || 0, siracusaDistinctRequirement(m, ps)),
    } : {
      importantBuy: (m, ps, rec) => missingSiracusaCore(m, ps, rec) || parent.importantBuy(m, ps, rec),
      criticalBuy: (m, ps, rec, ctx) => missingSiracusaCore(m, ps, rec) || parent.criticalBuy(m, ps, rec, ctx),
      buyBonus: (m, ps, rec, ...args) => parent.buyBonus(m, ps, rec, ...args)
        + (missingSiracusaCore(m, ps, rec) ? PRIORITY_BONUS : 0),
      rewardPriority(m, ps, slot) {
        const prior = parent.rewardPriority?.(m, ps, slot) || 0;
        return prior + (slot.kind === 'chess' && missingSiracusaCore(m, ps, ps.gd.chess(slot.id)) ? PRIORITY_BONUS : 0);
      },
      beforeUpgrade(m, ps, ctx) {
        // The owner's unconditional R2 tier-one upgrade remains the opening rule.
        if (m.round === 2 && ps.shop.level === 1) return parent.beforeUpgrade(m, ps, ctx);
        if (scope(m, ps) && ps.shop.slots.some(s => s?.kind === 'chess' && !s.sold && ps.priceOf(s) <= ps.funds
          && missingSiracusaCore(m, ps, ps.gd.chess(s.id)) && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id)))) return false;
        return parent.beforeUpgrade(m, ps, ctx);
      },
    }),
  }));
  return variants.get(factor);
}
