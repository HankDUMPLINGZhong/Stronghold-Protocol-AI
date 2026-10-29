// [ASSUMED] Two independent multiplayer economy trials over retained14/56.
// Read current public wave, own assets and visible shop only; never future cards or actual battle outcomes.
import { coopTempoSteps, coopTempoReady } from './lateranoCoopFactors.js';

const CORE = 'lateranoShip', DOLL = 'chess_item_2_05_e_a';
const EARLY = Object.freeze({ minLP: 20, maxLoss: 2 });
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const healing = r => r.attackKind === 'heal' || r.dmgType === 'heal'
  || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tank = r => r.profession === 'TANK' && r.stats.blockCnt >= 2;

/** Visible, affordable first key copy or real third; no protection for speculative second support copies. */
export function coopUpgradePurchases(m, ps, recipe, { early = false } = {}) {
  if (!scope(m, ps) || (early ? m.round < 2 || m.round > 4 || ps.shop.level > 2
    : m.round < 6 || m.round >= m.gd.bossRound || ps.shop.level < 3 || ps.shop.level > 5)) return [];
  const gd = ps.gd || m.gd, pieces = ps.allChess(), records = pieces.map(p => gd.chess(p.id));
  const finalSupports = new Set([recipe.ids.ptilopsis4, recipe.ids.ptilopsis5, recipe.ids.titi]);
  const rows = [];
  for (const [index, slot] of ps.shop.slots.entries()) {
    if (!slot || slot.sold || ps.priceOf(slot) > ps.funds) continue;
    if (early && slot.kind === 'item' && slot.id === DOLL
      && recipe.purchaseItemAllowed(m, ps, gd.item(slot.id)) !== false) {
      rows.push({ index, slot, cost: ps.priceOf(slot), reason: 'income-doll' }); continue;
    }
    if (slot.kind !== 'chess') continue;
    const rec = gd.chess(slot.id), base = gd.baseIdOf(slot.id);
    if (recipe.purchaseAllowed(m, ps, rec) === false) continue;
    const own = pieces.filter(p => gd.baseIdOf(p.id) === base);
    if (gd.isGolden(slot.id) || own.some(p => gd.isGolden(p.id))) continue;
    const native = rec.bonds.includes(CORE);
    const support = finalSupports.has(base) || base === recipe.ids.astgenne && ps._botRoute?.support === 'skillfulShip';
    const third = ps.completesChessMerge(slot.id);
    let reason;
    if (!own.length && native) reason = 'first-native';
    else if (third && (native || support)) reason = 'key-third';
    else if (!early && !own.length && support) reason = 'first-final-support';
    else if (!early && !own.length && rec.bonds.some(b => ['steadShip', 'skillfulShip', 'preciShip', 'visiShip'].includes(b))
      && (healing(rec) && !records.some(healing) || tank(rec) && !records.some(tank))) reason = 'first-missing-role';
    if (reason) rows.push({ index, slot, cost: ps.priceOf(slot), reason });
  }
  return rows.sort((a, b) => Number(b.reason === 'key-third') - Number(a.reason === 'key-third') || a.index - b.index);
}

function constrainedPurchases(m, ps, recipe, options) {
  return coopUpgradePurchases(m, ps, recipe, options).filter(p => ps.funds - Math.max(0, ps.shop.upgradePrice) < p.cost);
}

/** Healthy LP may buy an earlier tier with at most two forecast leaks/LP, retaining readiness and all parent gates. */
export function withLateranoCoopEarlyInvestment(recipe) {
  const targets = (m, ps) => coopTempoReady(m, ps, EARLY)
    ? constrainedPurchases(m, ps, recipe, { early: true }) : [];
  const ready = (m, ps) => coopTempoReady(m, ps, EARLY) && !targets(m, ps).length;
  return Object.freeze({ ...recipe,
    *beforeEconomySteps(m, ps, h) {
      if (recipe.beforeEconomySteps) yield* recipe.beforeEconomySteps(m, ps, h);
      yield* coopTempoSteps(m, ps, h, EARLY);
    },
    readyForUpgrade: (m, ps) => ready(m, ps) || recipe.readyForUpgrade?.(m, ps) || false,
    levelTarget: (m, ps, options) => ready(m, ps) ? ps.shop.level + 1 : recipe.levelTarget(m, ps, options),
    priorityLevel: (m, ps) => ready(m, ps) || recipe.priorityLevel(m, ps),
    beforeUpgrade: (m, ps, plan) => !targets(m, ps).length && recipe.beforeUpgrade(m, ps, plan),
    spendReserve(m, ps) {
      if (targets(m, ps).length) return 0;
      if (!ready(m, ps)) return recipe.spendReserve(m, ps);
      return ps.funds >= ps.shop.upgradePrice + recipe.upgradeReserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
    },
  });
}

/** Only protect a real current-shop purchase when upgrading would make it unaffordable. No extra search deadline. */
export function withLateranoCoopVisibleUpgrade(recipe) {
  const targets = (m, ps) => scope(m, ps) && recipe.priorityLevel(m, ps)
    && recipe.levelTarget(m, ps) > ps.shop.level
    && ps.funds >= Math.max(0, ps.shop.upgradePrice) + recipe.upgradeReserve(m, ps)
    ? constrainedPurchases(m, ps, recipe) : [];
  const protects = (m, ps, rec) => targets(m, ps).some(p => p.slot.kind === 'chess' && p.slot.id === rec.chessId);
  return Object.freeze({ ...recipe,
    beforeUpgrade(m, ps, plan) {
      const pending = targets(m, ps);
      if (!pending.length) return recipe.beforeUpgrade(m, ps, plan);
      const row = { round: m.round, level: ps.shop.level, funds: ps.funds, cost: ps.shop.upgradePrice,
        targets: pending.map(p => ({ id: p.slot.id, cost: p.cost, reason: p.reason })) };
      const history = ps._botCoopUpgradeHistory ||= [];
      if (JSON.stringify(history.at(-1)) !== JSON.stringify(row)) history.push(row);
      return false;
    },
    priorityLevel: (m, ps) => !targets(m, ps).length && recipe.priorityLevel(m, ps),
    spendReserve: (m, ps) => targets(m, ps).length ? 0 : recipe.spendReserve(m, ps),
    criticalBuy: (m, ps, rec, ctx) => protects(m, ps, rec) || recipe.criticalBuy(m, ps, rec, ctx),
    importantBuy: (m, ps, rec) => protects(m, ps, rec) || recipe.importantBuy(m, ps, rec),
  });
}
