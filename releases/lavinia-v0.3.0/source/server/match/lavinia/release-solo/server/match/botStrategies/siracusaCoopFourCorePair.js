// [ASSUMED] Opt-in four-seat gate over the selected two9/four11 recipe.
// Tighten the existing R7 opening latch only; keep every economic/combat callback.
import { siracusaFourScope } from './siracusaCoopFour.js';
import { siracusaOpeningCorePair } from './siracusaCoopTwoTrials.js';

const cache = new WeakMap();
export function withSiracusaFourCorePair(parent) {
  if (cache.has(parent)) return cache.get(parent);
  const recipe = Object.freeze({ ...parent,
    prepStart(m, ps) {
      const observe = siracusaFourScope(m, ps) && !!m.wave && m.round === 7 && !ps._botSiracusaFourCorePairOpening;
      const opening = observe ? { round: m.round, level: ps.shop.level, ...siracusaOpeningCorePair(ps) } : null;
      parent.prepStart?.(m, ps);
      if (!opening) return;
      const original = ps._botSiracusaR7Opening;
      const coverageEligible = opening.nativeKinds.length >= 4 || opening.pairs.length > 0;
      const eligible = original?.eligible === true && (opening.level !== 2 || coverageEligible);
      ps._botSiracusaFourCorePairOpening = { ...opening, eliteEligible: original?.eligible === true, coverageEligible, eligible };
      // The parent records its elite-only observation first; this row records the final, narrower decision.
      // Reentry cannot sample new holdings or reopen the parent's immutable opening qualification.
      if (original) original.eligible = eligible;
      (ps._botSiracusaCoopHistory ||= []).push({ factor: 'coop-four-r7-core-pair', kind: 'opening', ...ps._botSiracusaFourCorePairOpening });
    },
  });
  cache.set(parent, recipe); return recipe;
}
