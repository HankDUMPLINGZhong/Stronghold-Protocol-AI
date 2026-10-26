// [ASSUMED] Upgrade liquidity on the frozen 21/5 roster policy. Only previous combat and the visible shop are read.
import { sargonPepe, ids } from './sargonPepe.js';

const CORE = 'sargonShip', PRECISION = 'preciShip';
const engines = new Set([ids.philae, ids.gavial4, ids.gavial5, ids.titi, ids.passenger, ids.pepe]);
const front = r => r.position === 'MELEE' && (r.stats?.blockCnt || 0) >= 2;
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const distinct = (ps, bond) => new Set(ps.allChess().filter(p => ps.gd.chess(p.id).bonds.includes(bond)).map(p => base(ps, p))).size;

function previousCombat(m, ps) {
  const result = m.lastResults?.get(ps.playerId);
  if (!result || m.round <= 1) return null;
  return { round: m.round - 1, leaks: (result.leaked || []).filter(p => p && p.counted !== false).length,
    deaths: Number(result.deaths) || 0 };
}

function health(m, ps) {
  const last = previousCombat(m, ps);
  const recent = [...(ps._sargonUpgradeMemory || []).filter(r => r.round >= m.round - 2 && r.round !== last?.round), ...(last ? [last] : [])];
  const leaks = recent.reduce((n, r) => n + r.leaks, 0);
  const owned = ps.allChess().map(p => ps.gd.chess(p.id));
  const roles = owned.some(front) && owned.some(healer);
  const risk = !roles || ps.lp <= 8 || (last?.leaks || 0) >= 4 || leaks >= 6 ? 'fragile'
    : roles && ps.lp >= 16 && recent.length >= 2 && leaks <= 2 && (last?.deaths || 0) <= 2 ? 'stable' : 'uncertain';
  return { risk, lp: ps.lp, recent, roles };
}

/** A material purchase can be made now; this never queries a future roll or its RNG. */
export function dynamicMaterial(m, ps, rec) {
  if (!rec || !sargonPepe.purchaseAllowed(m, ps, rec)) return null;
  const id = base(ps, rec), own = ps.allChess().filter(p => base(ps, p) === id);
  if (ps.completesChessMerge(rec.chessId || rec.id) && (rec.bonds.includes(CORE) || rec.bonds.includes(PRECISION))) return 'merge';
  if (!own.length && rec.tier >= 3 && rec.bonds.includes(CORE) && (engines.has(id) || distinct(ps, CORE) < 6)) return 'core';
  if (!own.length && rec.tier >= 4 && rec.bonds.includes(PRECISION) && distinct(ps, PRECISION) === 2) return 'third-precision';
  if (health(m, ps).risk !== 'stable') {
    const owned = ps.allChess().map(p => ps.gd.chess(p.id));
    if (healer(rec) && !owned.some(healer) || front(rec) && !owned.some(front)) return 'role';
  }
  return null;
}

export function dynamicUpgradePlan(m, ps, fromLevel = ps.shop.level) {
  const state = health(m, ps), special = [3, 5].includes(fromLevel);
  const refresh = ps.shop.freeRefreshes > 0 ? 0 : ps.gd.refreshPrice;
  const mainId = fromLevel === 3 ? ids.gavial4 : ids.pepe;
  // Public catalog price with current price modifiers, not a sampled future shop.
  const mainPrice = ps.priceOf({ kind: 'chess', id: mainId, basePrice: ps.gd.chessPrice(mainId) });
  const visible = ps.shop.slots.flatMap((slot, idx) => {
    if (!slot || slot.sold || slot.kind !== 'chess') return [];
    const reason = dynamicMaterial(m, ps, ps.gd.chess(slot.id));
    return reason ? [{ idx, id: slot.id, price: ps.priceOf(slot), reason }] : [];
  });
  const buffer = state.risk === 'fragile' ? ps.gd.chessPrice(ids.papyrus) : state.risk === 'uncertain' ? ps.gd.refreshPrice : 0;
  return { ...state, round: m.round, fromLevel, nextLevel: fromLevel + 1, special, refresh, mainPrice, buffer, visible,
    reserve: special ? refresh + mainPrice + buffer : sargonPepe.upgradeReserve(m, ps) };
}

function logCheck(ps, entry) {
  const key = JSON.stringify(entry);
  if (ps._sargonLastDynamicCheck === key) return;
  ps._sargonLastDynamicCheck = key;
  (ps._sargonFactorHistory ||= []).push({ factor: 'roster-dynamic', phase: 'upgrade-budget', ...entry });
}

export function createDynamicUpgradePolicy(roster) {
  const policy = {
    ...roster, name: 'Sargon roster with dynamic conversion budget',
    useEconomy(m, ps) {
      roster.useEconomy(m, ps);
      const last = previousCombat(m, ps);
      if (last && !ps._sargonUpgradeMemory?.some(r => r.round === last.round)) {
        ps._sargonUpgradeMemory = [...(ps._sargonUpgradeMemory || []), last].slice(-2);
      }
    },
    beforeUpgrade(m, ps) {
      if (ps._sargonConversionRound === m.round) return false;
      if (![3, 5].includes(ps.shop.level)) return roster.beforeUpgrade(m, ps);
      const plan = dynamicUpgradePlan(m, ps);
      const buyNow = plan.visible.some(p => p.price <= ps.funds);
      const baseReady = roster.beforeUpgrade(m, ps);
      // The inherited reserve check skips free upgrades. Keep the conversion budget even when the upgrade is free.
      const freeBudget = ps.shop.upgradePrice > 0 || ps.funds >= plan.reserve;
      logCheck(ps, { ...plan, funds: ps.funds, price: ps.shop.upgradePrice,
        decision: !baseReady ? 'baseline-gate' : buyNow ? 'buy-visible' : !freeBudget ? 'free-conversion-budget' : 'budget-check' });
      return baseReady && !buyNow && freeBudget;
    },
    upgradeReserve: (m, ps) => dynamicUpgradePlan(m, ps).reserve,
    priorityLevel: (m, ps) => ps.shop.level < roster.levelTarget(m, ps) && policy.beforeUpgrade(m, ps),
    spendReserve(m, ps) {
      return policy.priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice + policy.upgradeReserve(m, ps) ? ps.shop.upgradePrice : 0;
    },
    importantBuy: (m, ps, rec) => roster.importantBuy(m, ps, rec)
      || [3, 5].includes(ps.shop.level) && !!dynamicMaterial(m, ps, rec),
    onLevelUp(m, ps) {
      if (![4, 6].includes(ps.shop.level)) { roster.onLevelUp(m, ps); return; }
      const plan = dynamicUpgradePlan(m, ps, ps.shop.level - 1), fundsBeforeRefresh = ps.funds;
      roster.onLevelUp(m, ps);
      // Buying from the new special shop precedes another level-up this prep.
      ps._sargonConversionRound = m.round;
      (ps._sargonFactorHistory ||= []).push({ factor: 'roster-dynamic', phase: 'conversion-shop', round: m.round,
        level: ps.shop.level, risk: plan.risk, reserve: plan.reserve, mainPrice: plan.mainPrice,
        fundsBeforeRefresh, fundsAfterRefresh: ps.funds,
        shop: ps.shop.slots.filter(s => s && !s.sold).map(s => ({ kind: s.kind, id: s.id, price: ps.priceOf(s) })) });
    }
  };
  return Object.freeze(policy);
}
