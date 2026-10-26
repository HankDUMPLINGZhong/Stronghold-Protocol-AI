// [ASSUMED] Round-three correction: low-tier merges yield to six, then execute one funded search before other spending.
import { ids } from './sargonPepe.js';
import { createDynamicUpgradePolicy, dynamicUpgradePlan } from './sargonDynamicUpgrade.js';

const base = (ps, id) => ps.gd.baseIdOf(id);
const lowMerge = (ps, id) => ps.gd.chess(id)?.tier < 5 && ps.completesChessMerge(id);
const mainPrice = ps => Math.max(...[ids.pepe, ids.passenger].map(id =>
  ps.priceOf({ kind: 'chess', id, basePrice: ps.gd.chessPrice(id) })));

export function sixUpgradePlan(m, ps) {
  const plan = dynamicUpgradePlan(m, ps, 5), price = mainPrice(ps);
  const refreshBudget = Math.max(0, 2 - ps.shop.freeRefreshes) * ps.gd.refreshPrice;
  return { ...plan, mainPrice: price, refreshBudget,
    visible: plan.visible.filter(p => !lowMerge(ps, p.id)),
    reserve: Math.max(plan.reserve, price + refreshBudget) };
}

function mainOffers(m, ps) {
  return ps.shop.slots.flatMap((s, idx) => {
    if (!s || s.sold || s.kind !== 'chess' || ![ids.pepe, ids.passenger].includes(base(ps, s.id))) return [];
    const own = ps.allChess().filter(p => base(ps, p.id) === base(ps, s.id));
    if (own.some(p => ps.gd.isGolden(p.id))) return [];
    const merge = ps.completesChessMerge(s.id);
    // A lone second copy does not immediately improve the roster; keep the funded search for a new carry or elite.
    if (own.length && !merge) return [];
    return [{ idx, id: s.id, price: ps.priceOf(s), score: (merge ? 2000 : 1000) + (base(ps, s.id) === ids.passenger ? 100 : 0) }];
  }).sort((a, b) => b.score - a.score || a.idx - b.idx);
}

/** Consumes actual APIs only, at most one extra roll. The normal shopping loop resumes after this transaction. */
export function executeSixSearch(m, ps, helpers = {}) {
  const event = { factor: 'roster-dynamic-six', phase: 'six-search', round: m.round,
    startFunds: ps.funds, mainPrice: mainPrice(ps), extraRefresh: false, purchased: null };
  function buyMain() {
    let offer = mainOffers(m, ps)[0];
    if (!offer) return 'absent';
    if (offer.price > ps.funds) return 'unaffordable';
    if (!ps.hand.some(p => !p) && !helpers.freePurchaseSlot?.()) return 'capacity';
    // Consuming equipment to free a slot can grant chess, merge copies or change prices: inspect the live shop again.
    offer = mainOffers(m, ps)[0];
    if (!offer) return 'asset-changed';
    if (offer.price > ps.funds) return 'unaffordable';
    const result = ps.buy(offer.idx);
    if (!result?.ok) throw Error('Sargon funded main purchase rejected: ' + JSON.stringify(result));
    event.purchased = offer.id; event.purchasePrice = offer.price;
    return 'bought';
  }
  let status = buyMain(); event.firstShop = status;
  if (status === 'absent') {
    const cost = ps.shop.freeRefreshes > 0 ? 0 : ps.gd.refreshPrice;
    if (ps.funds >= cost + event.mainPrice) {
      const result = ps.refresh();
      if (!result?.ok) throw Error('Sargon funded extra refresh rejected: ' + JSON.stringify(result));
      event.extraRefresh = true; event.extraPrice = cost; event.afterExtraFunds = ps.funds;
      status = buyMain();
    } else status = 'extra-budget-short';
  }
  if (['capacity', 'unaffordable'].includes(status) && !ps.shop.frozen) ps.freeze();
  event.status = status; event.endFunds = ps.funds;
  (ps._sargonFactorHistory ||= []).push(event);
  return event;
}

export function createSixSearchPolicy(roster) {
  const previous = createDynamicUpgradePolicy(roster);
  const policy = {
    ...previous, name: 'Sargon dynamic six with funded extra search',
    beforeUpgrade(m, ps) {
      if (ps.shop.level !== 5) return previous.beforeUpgrade(m, ps);
      if (ps._sargonConversionRound === m.round) return false;
      const plan = sixUpgradePlan(m, ps);
      // Remove only low-tier merge blockers from the inherited gate, preserving fresh engine and high-tier priorities.
      const view = Object.assign(Object.create(ps), { shop: { ...ps.shop,
        slots: ps.shop.slots.map(s => s?.kind === 'chess' && !s.sold && lowMerge(ps, s.id) ? null : s) } });
      const baseReady = roster.beforeUpgrade(m, view);
      const buyNow = plan.visible.some(p => p.price <= ps.funds);
      const freeBudget = ps.shop.upgradePrice > 0 || ps.funds >= plan.reserve;
      const entry = { factor: 'roster-dynamic-six', phase: 'six-budget', ...plan,
        funds: ps.funds, price: ps.shop.upgradePrice,
        decision: !baseReady ? 'baseline-gate' : buyNow ? 'buy-visible' : !freeBudget ? 'free-conversion-budget' : 'budget-check' };
      const key = JSON.stringify(entry);
      if (ps._sargonLastSixCheck !== key) { ps._sargonLastSixCheck = key; (ps._sargonFactorHistory ||= []).push(entry); }
      return baseReady && !buyNow && freeBudget;
    },
    upgradeReserve: (m, ps) => ps.shop.level === 5 ? sixUpgradePlan(m, ps).reserve : previous.upgradeReserve(m, ps),
    priorityLevel: (m, ps) => ps.shop.level < roster.levelTarget(m, ps) && policy.beforeUpgrade(m, ps),
    spendReserve(m, ps) {
      if (ps.shop.level !== 5) return previous.spendReserve(m, ps);
      const budget = ps.shop.upgradePrice + policy.upgradeReserve(m, ps);
      return policy.priorityLevel(m, ps) && ps.funds >= budget ? budget : 0;
    },
    criticalBuy(m, ps, rec) {
      if (ps.shop.level === 5 && roster.levelTarget(m, ps) >= 6 && lowMerge(ps, rec.chessId || rec.id)
        && ps.funds >= ps.shop.upgradePrice + policy.upgradeReserve(m, ps)) return false;
      return roster.criticalBuy(m, ps, rec);
    },
    onLevelUp(m, ps, helpers) {
      if (ps.shop.level !== 6) { previous.onLevelUp(m, ps); return; }
      const plan = sixUpgradePlan(m, ps), fundsBeforeRefresh = ps.funds;
      roster.onLevelUp(m, ps);
      ps._sargonConversionRound = m.round;
      (ps._sargonFactorHistory ||= []).push({ factor: 'roster-dynamic-six', phase: 'conversion-shop', round: m.round,
        level: 6, risk: plan.risk, reserve: plan.reserve, mainPrice: plan.mainPrice,
        fundsBeforeRefresh, fundsAfterRefresh: ps.funds,
        shop: ps.shop.slots.filter(s => s && !s.sold).map(s => ({ kind: s.kind, id: s.id, price: ps.priceOf(s) })) });
      executeSixSearch(m, ps, helpers);
    }
  };
  return Object.freeze(policy);
}
