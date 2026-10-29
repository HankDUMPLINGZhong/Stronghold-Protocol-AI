// [ASSUMED] Independent own-information economy trials: first White as a permanent Skillful healer,
// and mature six-member access to tier-six carries without the inherited two-fund buffer.
// No teammate roster, future shop, extra forecast or recorded outcome is consulted.
import { freeShoppingSlot } from '../botDevelopment.js';
import { ownedLateranoCount } from './lateranoSixReady.js';
import { lateranoThirdSalePlan, visibleLateranoThirds } from './lateranoCoopThirdCopy.js';

const CORE = 'lateranoShip';
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const white = (ps, recipe, r) => [recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].includes(base(ps, r));
const heals = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const log = (ps, row) => (ps._botCoopFactorHistory ||= []).push(row);

export function coopWhiteNeeded(m, ps, recipe) {
  return scope(m, ps) && m.round >= 8 && m.round <= m.gd.bossRound && ps.shop.level >= 4
    && ownedLateranoCount(m, ps) >= 6 && ps.allChess().some(p => base(ps, p) === recipe.ids.faith)
    && ps.allChess().some(p => base(ps, p) === recipe.ids.archetto)
    // Do not pre-fund a healer the developing army may bench. Prioritize an acquired VI carry's protection;
    // at the final round a genuinely missing healer is useful even without a VI native carry.
    && (m.round === m.gd.bossRound && !ps.allChess().some(p => heals(ps.gd.chess(p.id)))
      || ps.allChess().some(p => [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(base(ps, p))))
    && !ps.allChess().some(p => white(ps, recipe, p));
}

export function withCoopWhiteAccess(parent) {
  const key = (m, ps, rec) => !!rec && white(ps, parent, rec) && coopWhiteNeeded(m, ps, parent);
  const retain = (m, ps, rec) => scope(m, ps) && m.round >= 8 && white(ps, parent, rec)
    && ps.allChess().some(p => base(ps, p) === parent.ids.archetto);
  const target = (m, ps) => ps.shop.slots.map((slot, index) => ({ slot, index })).find(({ slot }) => {
    if (!slot || slot.sold || slot.kind !== 'chess' || !key(m, ps, ps.gd.chess(slot.id))) return false;
    const pool = ps.poolOf(slot.id);
    return !pool.has(slot.id) || pool.left(slot.id) > 0;
  });
  return Object.freeze({ ...parent,
    purchaseAllowed: (m, ps, rec, ...xs) => key(m, ps, rec) || parent.purchaseAllowed(m, ps, rec, ...xs),
    importantBuy: (m, ps, rec, ...xs) => key(m, ps, rec) || parent.importantBuy(m, ps, rec, ...xs),
    criticalBuy: (m, ps, rec, ...xs) => key(m, ps, rec) || parent.criticalBuy(m, ps, rec, ...xs),
    keep: (m, ps, rec, ...xs) => retain(m, ps, rec) || parent.keep(m, ps, rec, ...xs),
    preserve: (m, ps, rec, ...xs) => retain(m, ps, rec) || parent.preserve(m, ps, rec, ...xs),
    beforeUpgrade(m, ps, ...xs) {
      const t = target(m, ps);
      return !(t && ps.priceOf(t.slot) <= ps.funds) && parent.beforeUpgrade(m, ps, ...xs);
    },
    trade(m, ps, ctx, h) {
      // Keep the retained visible-third contract ahead of a new first support.
      if (visibleLateranoThirds(m, ps).length) return parent.trade(m, ps, ctx, h);
      const t = target(m, ps);
      if (!t) return parent.trade(m, ps, ctx, h);
      if (!ps.hand.some(p => !p)) freeShoppingSlot(m, ps);
      const incoming = { uid: -1, kind: 'chess', id: t.slot.id, items: [] };
      const plan = lateranoThirdSalePlan(m, ps, parent, t.slot, { ...h, incoming });
      if (!plan) return parent.trade(m, ps, ctx, h);
      const row = { factor: 'white-access', action: 'buy', round: m.round, level: ps.shop.level,
        id: t.slot.id, fundsBefore: ps.funds, sales: [], bought: false };
      log(ps, row);
      for (const s of plan.sales) {
        if (ps.funds >= ps.priceOf(t.slot) && ps.hand.some(p => !p)) break;
        const loc = ps.find(s.uid);
        if (!loc || !['hand', 'temp'].includes(loc.area) || !ps.sell(s.uid)?.ok) return false;
        row.sales.push(s);
      }
      if (ps.funds < ps.priceOf(t.slot) || !ps.hand.some(p => !p)) return false;
      const before = new Set(ps.allChess().map(p => p.uid)), settle = parent.observeSpend?.(m, ps);
      const result = ps.buy(t.index); settle?.();
      row.bought = !!result?.ok; row.fundsAfter = ps.funds;
      if (!result?.ok) return false;
      parent.afterPurchase?.(m, ps, t.slot, before); parent.useEconomy?.(m, ps);
      return true;
    },
    *beforeRefreshSteps(m, ps, h) {
      const t = target(m, ps);
      if (t) {
        if (!ps.shop.frozen) ps.freeze();
        log(ps, { factor: 'white-access', action: 'lock', round: m.round, id: t.slot.id, funds: ps.funds });
        return true;
      }
      return parent.beforeRefreshSteps ? yield* parent.beforeRefreshSteps(m, ps, h) : false;
    },
  });
}

export function coopMatureSixAccess(m, ps, recipe) {
  if (!scope(m, ps) || ps.shop.level !== 5 || m.round < 12 || m.round > m.gd.bossRound
    || ownedLateranoCount(m, ps) < 6) return false;
  const own = ps.allChess(), elite = id => own.some(p => base(ps, p) === id && ps.gd.isGolden(p.id));
  return elite(recipe.ids.mostima) && elite(recipe.ids.archetto)
    && own.some(p => base(ps, p) === recipe.ids.faith) && own.some(p => heals(ps.gd.chess(p.id)))
    && !own.some(p => [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(base(ps, p)));
}

export function withCoopMatureSixAccess(parent) {
  const due = (m, ps) => coopMatureSixAccess(m, ps, parent);
  return Object.freeze({ ...parent,
    upgradeReserve(m, ps) {
      if (!due(m, ps)) return parent.upgradeReserve(m, ps);
      const stamp = `${m.round}:${ps.funds}:${ps.shop.upgradePrice}`;
      if (ps._botCoopMatureSixAccessStamp !== stamp) {
        ps._botCoopMatureSixAccessStamp = stamp;
        log(ps, { factor: 'mature-six-access', action: 'waive-buffer', round: m.round,
          funds: ps.funds, cost: ps.shop.upgradePrice });
      }
      return 0;
    },
    spendReserve: (m, ps) => due(m, ps) && parent.priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice
      ? Math.max(0, ps.shop.upgradePrice) : parent.spendReserve(m, ps),
  });
}
