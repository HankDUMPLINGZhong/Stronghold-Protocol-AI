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
      // A visible missing late carry is a certain roster option. Do not spend its budget on the last growth merge
      // merely because the common scorer includes a large, stage-independent merge premium.
      if (lateCoopEconomy(m) && m.round >= m.gd.bossRound - 1 && ps.hand.some(p => !p)) {
        const gd = ps.gd, mostima = ps.shop.slots.find(s => s?.kind === 'chess' && !s.sold
          && gd.baseIdOf(s.id) === parent.ids.mostima && ps.completesChessMerge(s.id)
          && parent.purchaseAllowed(m, ps, gd.chess(s.id)) !== false);
        if (mostima && ps.priceOf(mostima) <= ps.funds) {
          const wanted = ps.shop.slots.map((s, index) => ({ s, index })).filter(({s}) => s?.kind === 'chess' && !s.sold
            && [parent.ids.exusiaiAlter, parent.ids.lemuen].includes(gd.baseIdOf(s.id))
            && !ps.allChess().some(p => gd.baseIdOf(p.id) === gd.baseIdOf(s.id))
            && parent.purchaseAllowed(m, ps, gd.chess(s.id)) !== false && ps.priceOf(s) <= ps.funds
            && ps.priceOf(s) + ps.priceOf(mostima) > ps.funds)
            .sort((a,b) => Number(gd.baseIdOf(b.s.id) === parent.ids.lemuen && ps._botRoute?.support === 'preciShip')
              - Number(gd.baseIdOf(a.s.id) === parent.ids.lemuen && ps._botRoute?.support === 'preciShip') || a.index - b.index)[0];
          if (wanted) {
            const before = parent.afterPurchase ? new Set(ps.allChess().map(p => p.uid)) : null;
            const settled = parent.observeSpend?.(m, ps), result = ps.buy(wanted.index); settled?.();
            if (result.ok) {
              if (before) parent.afterPurchase(m, ps, wanted.s, before);
              (ps._botCoopLateAcquisitionHistory ||= []).push({ round:m.round,kind:'visible-carry-before-growth-merge',
                bought:wanted.s.id,deferred:mostima.id });
              parent.useEconomy?.(m, ps); return true;
            }
          }
        }
      }
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
