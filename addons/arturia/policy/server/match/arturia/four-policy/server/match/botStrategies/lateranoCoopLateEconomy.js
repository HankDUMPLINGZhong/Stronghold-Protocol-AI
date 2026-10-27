// [ASSUMED] Independent late acquisition-value and partial-merge trials over repaired20. No future outcomes.
import { lateranoMergeOrder } from './lateranoMergeOrder.js';

const cooperative = m => m.mode === 'coop' && !m.isSolo;
export const lateCoopEconomy = m => cooperative(m) && m.round >= m.gd.bossRound - 2 && m.round <= m.gd.bossRound;

/** Remove the remaining-growth premium gradually; an elite and its nominal reward still retain value. */
export function coopLateAcquisitionBonus(m, ps, rec, recipe) {
  if (!lateCoopEconomy(m)) return 0;
  const gd = ps.gd, id = gd.baseIdOf(rec.chessId || rec.id), own = ps.allChess();
  const same = own.filter(p => gd.baseIdOf(p.id) === id), urgency = 3 - (gd.bossRound - m.round);
  if (id === recipe.ids.mostima && same.length && !gd.isGolden(rec.chessId || rec.id)) return -10 * urgency;
  if ([recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(id) && !same.length) return 6 * urgency;
  return 0;
}

export function withCoopLateAcquisition(parent) {
  return Object.freeze({ ...parent,
    buyBonus(m, ps, rec, ...xs) { return parent.buyBonus(m, ps, rec, ...xs) + coopLateAcquisitionBonus(m, ps, rec, parent); },
    trade(m, ps, ...xs) {
      const old = ps._botCoopLateAcquisition;
      ps._botCoopLateAcquisition = lateCoopEconomy(m);
      try { return parent.trade(m, ps, ...xs); }
      finally { if (old === undefined) delete ps._botCoopLateAcquisition; else ps._botCoopLateAcquisition = old; }
    },
  });
}

export function withCoopPartialMerge(parent) {
  return Object.freeze({ ...parent,
    upgradeMergeOrder(m, ps, h) {
      if (!cooperative(m)) return parent.upgradeMergeOrder?.(m, ps, h);
      return lateranoMergeOrder(m, ps, parent, h.scoreReward, { publicTeammates: true, partialBundle: true });
    },
  });
}
