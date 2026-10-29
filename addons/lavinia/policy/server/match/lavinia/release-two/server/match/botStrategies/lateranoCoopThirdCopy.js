// [ASSUMED] Complete visible pairs, retaining inherited upgrade/reward valuation and locking unaffordable thirds.
// Real own resources only; no teammate rosters, future offers or combat outcomes. Independent opt-in trial.
import { computeBonds, pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { freeShoppingSlot } from '../botDevelopment.js';
import { lateranoMergeOrder } from './lateranoMergeOrder.js';

const CORE = 'lateranoShip', VISION = 'visiShip';
const RELEVANT = [CORE, 'preciShip', 'skillfulShip', VISION];
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini'
  && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const normal = (ps, pieces, id) => pieces.filter(p => !ps.gd.isGolden(p.id) && base(ps, p) === id);
const count = (ps, pieces, id) => new Set(pieces.filter(p => pieceBonds(ps.gd, p).includes(id)).map(p => base(ps, p))).size;
const healer = rec => ['heal'].includes(rec.attackKind) || rec.dmgType === 'heal'
  || ['guardian', 'incantationmedic'].includes(rec.subProfessionId);
const blocker = rec => rec.position !== 'RANGED' && (rec.stats?.blockCnt || 0) > 0;

export function visibleLateranoThirds(m, ps) {
  if (!scoped(m, ps)) return [];
  return ps.shop.slots.map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot?.kind === 'chess' && !slot.sold && ps.completesChessMerge(slot.id));
}

/** Read-only: sell only unselected reserves, retaining real fielded units and jointly needed bond/role assets. */
export function lateranoThirdSalePlan(m, ps, recipe, target, { lineupFor } = {}) {
  if (ps.funds >= ps.priceOf(target) && ps.hand.some(p => !p)) return { sales: [], funds: ps.funds, selected: [] };
  const owned = ps.allChess(), chosen = lineupFor?.(ps)?.set
    || [...ps.board.values()].filter(p => p.kind === 'chess');
  const selected = new Set(chosen.map(p => p.uid)), targetBase = base(ps, target);
  const visiblePairs = new Set(visibleLateranoThirds(m, ps).map(({ slot }) => base(ps, slot)));
  const engineIds = new Set(['mostima', 'executorAlter', 'exusiaiAlter', 'lemuen', 'archetto', 'faith',
    'ptilopsis4', 'ptilopsis5', 'titi', 'astgenne'].map(k => recipe.ids[k]).filter(Boolean));
  let remaining = owned.slice(), funds = ps.funds, room = ps.hand.some(p => !p);
  const sales = [];
  const rank = p => {
    const id = base(ps, p), rec = ps.gd.chess(p.id), bonds = pieceBonds(ps.gd, p);
    if (!remaining.some(q => q.uid === p.uid) || p.items?.length || selected.has(p.uid)
      || id === targetBase || visiblePairs.has(id) || bonds.includes('maniShip')) return null;
    const loc = ps.find(p.uid);
    if (!loc || !['hand', 'temp'].includes(loc.area)) return null;
    const after = remaining.filter(q => q.uid !== p.uid), same = after.filter(q => base(ps, q) === id);
    const paired = normal(ps, remaining, id).length >= 2 && !ps.gd.isGolden(p.id);
    const related = bonds.some(b => RELEVANT.includes(b));
    // Native/engine projects remain protected; a surplus elite may yield only to an equal elite of the same base.
    if (paired && related || engineIds.has(id) && (!ps.gd.isGolden(p.id) || !same.some(q => ps.gd.isGolden(q.id)))) return null;
    if (count(ps, after, CORE) < Math.min(6, count(ps, remaining, CORE))) return null;
    if (healer(rec) && !after.some(q => healer(ps.gd.chess(q.id)))) return null;
    if (blocker(rec) && !after.some(q => blocker(ps.gd.chess(q.id)))) return null;
    if (m.bossId === 'boss_4' && rec.subProfessionId === 'wandermedic') return null;
    const removed = new Set(owned.filter(q => !after.some(x => x.uid === q.uid)).map(q => q.uid));
    const future = computeBonds(ps.gd, { board: ps.board, hand: ps.hand.filter(q => q && !removed.has(q.uid)),
      layers: ps.layers, bondCountBonus: ps.bondCountBonus });
    if (ps.bonds[VISION]?.active && !future[VISION]?.active) return null;
    if (after.some(q => base(ps, q) === recipe.ids.executorAlter)
      && remaining.some(q => base(ps, q) !== recipe.ids.executorAlter && pieceBonds(ps.gd, q).includes(VISION))
      && !after.some(q => base(ps, q) !== recipe.ids.executorAlter && pieceBonds(ps.gd, q).includes(VISION))) return null;
    if (related && !same.length) {
      // A distinct reserve is surplus only when the retained chosen lineup already supplies every relevant tier.
      const caps = { [CORE]: 6, preciShip: 3, skillfulShip: 2, [VISION]: 2 };
      if (bonds.some(b => RELEVANT.includes(b) && count(ps, chosen, b) < caps[b])) return null;
    }
    return [Number(paired), Number(related), Number(ps.gd.isGolden(p.id)), rec.tier, p.uid];
  };
  while (funds < ps.priceOf(target) || !room) {
    const candidates = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess' && ps.gd.sellPrice(p.id) > 0)
      .map(p => ({ p, rank: rank(p) })).filter(x => x.rank)
      .sort((a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return 0; });
    if (!candidates.length) return null; // Never partially liquidate a plan that still cannot buy the visible card.
    const { p } = candidates[0]; sales.push({ uid: p.uid, id: p.id, paired: normal(ps, remaining, base(ps, p)).length >= 2 });
    remaining = remaining.filter(q => q.uid !== p.uid); funds += ps.gd.sellPrice(p.id);
    // Selling a hand card with no overflow guarantees a real buying slot. With overflow, freed slots refill.
    room = ps.hand.filter(q => q && !sales.some(s => s.uid === q.uid)).length
      + ps.temp.filter(q => q && !sales.some(s => s.uid === q.uid)).length < ps.hand.length;
  }
  return { sales, funds, selected: [...selected] };
}

const record = (ps, row) => {
  row.factor = 'visible-third';
  (ps._botCoopThirdHistory ||= []).push(row);
  (ps._botCoopFactorHistory ||= []).push(row);
};

export function withCoopVisibleThird(recipe) {
  const pending = (m, ps) => visibleLateranoThirds(m, ps);
  const isTarget = (m, ps, rec) => pending(m, ps).some(({ slot }) => base(ps, slot) === base(ps, rec));
  const lock = (m, ps, target, reason) => {
    if (!ps.shop.frozen) ps.freeze();
    const key = `${m.round}:${ps.round.refreshes}:${target.index}:${target.slot.id}:${ps.funds}:${reason}`;
    if (ps._botCoopThirdLockKey !== key) {
      ps._botCoopThirdLockKey = key;
      record(ps, { action: 'lock', round: m.round, id: target.slot.id, funds: ps.funds, price: ps.priceOf(target.slot), reason });
    }
  };
  const out = { ...recipe,
    purchaseAllowed(m, ps, rec, ...xs) {
      return isTarget(m, ps, rec) || recipe.purchaseAllowed(m, ps, rec, ...xs);
    },
    importantBuy: (m, ps, rec, ...xs) => isTarget(m, ps, rec) || recipe.importantBuy(m, ps, rec, ...xs),
    criticalBuy: (m, ps, rec, ...xs) => isTarget(m, ps, rec) || recipe.criticalBuy(m, ps, rec, ...xs),
    keep: (m, ps, rec, ...xs) => isTarget(m, ps, rec) || recipe.keep(m, ps, rec, ...xs),
    preserve: (m, ps, rec, ...xs) => isTarget(m, ps, rec) || recipe.preserve(m, ps, rec, ...xs),
    upgradeMergeOrder(m, ps, h) {
      // Reuse the existing own-information expected-reward algorithm, including now-admitted transition thirds.
      // It reserves both actions when affordable and buys immediately after upgrading. All original level gates stay.
      return pending(m, ps).length
        ? lateranoMergeOrder(m, ps, out, h.scoreReward, { publicTeammates: false })
        : recipe.upgradeMergeOrder?.(m, ps, h);
    },
    *beforeEconomySteps(m, ps, h) {
      if (!pending(m, ps).length && recipe.beforeEconomySteps) yield* recipe.beforeEconomySteps(m, ps, h);
    },
    liquidity(m, ps, ...xs) { if (!pending(m, ps).length) return recipe.liquidity?.(m, ps, ...xs); },
    cleanupAcquisitions(m, ps, ...xs) { if (!pending(m, ps).length) return recipe.cleanupAcquisitions?.(m, ps, ...xs); },
    trade(m, ps, ctx, h) {
      const targets = pending(m, ps);
      if (!targets.length) return recipe.trade(m, ps, ctx, h);
      targets.sort((a, b) => Number(pieceBonds(ps.gd, b.slot).includes(CORE)) - Number(pieceBonds(ps.gd, a.slot).includes(CORE))
        || ps.priceOf(a.slot) - ps.priceOf(b.slot) || a.index - b.index);
      // Affordable targets precede fundraising, allowing the resulting reward to settle before the next purchase.
      const target = targets.find(t => ps.priceOf(t.slot) <= ps.funds) || targets[0];
      const pool = ps.poolOf(base(ps, target.slot));
      if (pool.has(base(ps, target.slot)) && pool.left(base(ps, target.slot)) <= 0) {
        lock(m, ps, target, 'stock-empty'); return false;
      }
      if (!ps.hand.some(p => !p)) freeShoppingSlot(m, ps);
      const plan = lateranoThirdSalePlan(m, ps, recipe, target.slot, h);
      if (!plan) { lock(m, ps, target, 'no-safe-funding-or-space'); return false; }
      const before = new Set(ps.allChess().map(p => p.uid)), funds = ps.funds;
      const audit = { action: 'buy', round: m.round, level: ps.shop.level, id: target.slot.id,
        funds, price: ps.priceOf(target.slot), selected: plan.selected, sales: [], bought: false };
      record(ps, audit);
      for (const sale of plan.sales) {
        if (ps.funds >= ps.priceOf(target.slot) && ps.hand.some(p => !p)) break;
        const loc = ps.find(sale.uid);
        if (!loc || !['hand', 'temp'].includes(loc.area) || !ps.sell(sale.uid)?.ok) {
          lock(m, ps, target, 'sale-failed'); return false;
        }
        audit.sales.push(sale);
      }
      const settled = recipe.observeSpend?.(m, ps), result = ps.buy(target.index); settled?.();
      audit.bought = !!result?.ok; audit.fundsAfter = ps.funds;
      if (!result?.ok) { lock(m, ps, target, 'buy-failed'); return false; }
      audit.merged = !ps.completesChessMerge(target.slot.id);
      recipe.afterPurchase?.(m, ps, target.slot, before); recipe.useEconomy?.(m, ps);
      return true; // The shared shopping loop takes the actual queued merge reward immediately.
    },
    *beforeRefreshSteps(m, ps, h) {
      const target = pending(m, ps)[0];
      if (target) { lock(m, ps, target, 'still-pending'); return true; }
      return recipe.beforeRefreshSteps ? yield* recipe.beforeRefreshSteps(m, ps, h) : false;
    },
  };
  return Object.freeze(out);
}
