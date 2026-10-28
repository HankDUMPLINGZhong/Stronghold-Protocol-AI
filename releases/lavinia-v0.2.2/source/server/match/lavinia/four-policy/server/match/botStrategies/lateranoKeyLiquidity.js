// [ASSUMED] Fund a visible critical card, never a speculative future refresh, with lower-value bench assets.
// Inherits all ordinary acquisition, upgrade, formation and forecast decisions from the retained policy.
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';
import { ownedLateranoCount } from './lateranoSixReady.js';
import { isFormationAnchor } from '../botPositioning.js';

const CORE = 'lateranoShip', VISION = 'visiShip';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id || p.chessId);
const healer = rec => rec.attackKind === 'heal' || rec.dmgType === 'heal' || rec.subProfessionId === 'guardian';

function targetRank(m, ps, recipe, slot) {
  const gd = gdOf(m, ps), rec = gd.chess(slot.id), id = base(gd, slot), own = ps.allChess().filter(p => base(gd, p) === id);
  if (recipe.purchaseAllowed(m, ps, rec) === false || !recipe.importantBuy(m, ps, rec)
    || own.some(p => gd.isGolden(p.id))) return 0;
  const merge = ps.completesChessMerge(slot.id), { ids } = recipe;
  const members = ownedLateranoCount(m, ps);
  const missingCore = !own.length && rec.bonds.includes(CORE) && members >= 4 && members < 6;
  if (m.round === gd.bossRound && missingCore) return 1200;
  if (id === ids.mostima) return merge ? 1000 : m.round < gd.bossRound ? 800 : 0;
  const main = [ids.executorAlter, ids.exusiaiAlter, ids.lemuen].includes(id);
  if (merge && rec.bonds.includes(CORE)) return 900 + (main ? 80 : rec.tier);
  if (main && !own.length) return 700 + rec.tier;
  if (missingCore) return 750;
  if (merge && [ids.ptilopsis4, ids.ptilopsis5, ids.titi, ids.astgenne].includes(id)) return 600 + rec.tier;
  return 0;
}

function saleRank(m, ps, recipe, p, remaining, target, valuation = null) {
  const gd = gdOf(m, ps), rec = gd.chess(p.id), id = base(gd, p), { ids } = recipe;
  if (ps._botCoopPrecisionSaleGuard?.(p, remaining)) return -1;
  if (p.items?.length || id === base(gd, target) || !remaining.some(x => x.uid === p.uid)) return -1;
  const hard = [ids.mostima, ids.executorAlter, ids.exusiaiAlter, ids.lemuen, ids.archetto, ids.faith,
    ids.ptilopsis4, ids.ptilopsis5, ids.titi, ids.astgenne];
  const bonds = pieceBonds(gd, p), same = remaining.filter(x => base(gd, x) === id);
  // The optional outer co-op pair policy is a hard sale veto, including valuation overrides and cash-out plans.
  if (ps._botCoopKeepLowTierPairs && rec.tier <= 3 && !gd.isGolden(p.id)
    && ps.allChess().filter(x => base(gd, x) === id && !gd.isGolden(x.id)).length >= 2) return -1;
  if (hard.includes(id) || bonds.includes('maniShip') || rec.tier >= 5 && bonds.some(b => ['preciShip', 'skillfulShip'].includes(b))) return -1;
  if (bonds.includes(CORE) && same.filter(x => !gd.isGolden(x.id)).length >= 2) return -1;
  const after = remaining.filter(x => x.uid !== p.uid), removed = new Set(ps.allChess().filter(x => !after.some(y => y.uid === x.uid)).map(x => x.uid));
  if (ownedLateranoCount(m, ps, after) < Math.min(6, ownedLateranoCount(m, ps))) return -1;
  // Preserve existing healing/tank options; fielded pieces are never sale candidates.
  if (healer(rec) && !after.some(x => healer(gd.chess(x.id)))) return -1;
  if (isFormationAnchor(rec) && !after.some(x => isFormationAnchor(gd.chess(x.id)))) return -1;
  if (m.bossId === 'boss_4' && rec.subProfessionId === 'wandermedic') return -1;
  const currentVision = ps.bonds[VISION];
  const future = computeBonds(gd, { board: ps.board, hand: ps.hand.filter(x => x && !removed.has(x.uid)),
    layers: ps.layers, bondCountBonus: ps.bondCountBonus });
  if (currentVision?.active && !future[VISION]?.active) return -1;
  const hasSaint = base(gd, target) === ids.executorAlter || ps.allChess().some(x => base(gd, x) === ids.executorAlter);
  const partner = x => base(gd, x) !== ids.executorAlter && pieceBonds(gd, x).includes(VISION);
  // Keep a distinct partner through R14 even above150. Also protect a just-acquired Saint awaiting arrangement.
  if (hasSaint && remaining.some(partner) && !after.some(partner)) return -1;
  const view = Object.create(ps), alive = new Set(remaining.map(x => x.uid));
  view.hand = ps.hand.map(x => x && alive.has(x.uid) ? x : null);
  view.temp = ps.temp.map(x => x && alive.has(x.uid) ? x : null);
  view.allChess = () => remaining;
  view.bonds = computeBonds(gd, view);
  // Optional developer valuation may release a retired transition only after ALL hard guards above.
  const override = valuation?.saleRank?.(m, view, recipe, p, remaining, target);
  if (Number.isFinite(override)) return override;
  if (!recipe.keep(m, view, rec) && !recipe.preserve(m, view, rec)) return 0;
  // Only split surplus ordinary transition copies; engines and all native pairs have been excluded above.
  if (!bonds.includes(CORE) && !gd.isGolden(p.id) && same.length >= 2) return 1;
  // A dormant speculative Foresight single may yield to a tangible key; existing activation remains protected.
  if (!bonds.includes(CORE) && bonds.includes(VISION) && !hasSaint && !currentVision?.active) return 2;
  return -1;
}

/** Read-only plan. Every planned sale must be necessary and together fund the immediate real purchase. */
export function lateranoKeyLiquidityPlan(m, ps, recipe, valuation = null) {
  const gd = gdOf(m, ps);
  if (m.round > gd.bossRound || !ps.hand.some(p => !p)) return null;
  const owned = ps.allChess(), targets = ps.shop.slots.map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot?.kind === 'chess' && !slot.sold && ps.priceOf(slot) > ps.funds)
    .map(x => {
      const rank = targetRank(m, ps, recipe, x.slot);
      return { ...x, rank: valuation?.targetRank?.(m, ps, recipe, x.slot, rank) ?? rank };
    }).filter(x => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || ps.priceOf(a.slot) - ps.priceOf(b.slot) || a.index - b.index);
  for (const target of targets) {
    const pool = ps.poolOf?.(target.slot.id) || m.pool;
    if (pool.has(target.slot.id) && pool.left(target.slot.id) <= 0) continue;
    let remaining = owned.slice(), funds = ps.funds;
    const sales = [];
    while (funds < ps.priceOf(target.slot)) {
      const candidates = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess' && gd.sellPrice(p.id) > 0)
        .map(p => ({ p, rank: saleRank(m, ps, recipe, p, remaining, target.slot, valuation),
          cost: valuation?.saleCost(m, ps, recipe, p, remaining) || 0 })).filter(x => x.rank >= 0)
        .sort((a, b) => a.cost - b.cost || a.rank - b.rank || Number(gd.isGolden(a.p.id)) - Number(gd.isGolden(b.p.id))
          || gd.tierOf(a.p.id) - gd.tierOf(b.p.id) || a.p.uid - b.p.uid);
      if (!candidates.length) break;
      const { p, rank } = candidates[0];
      sales.push({ uid: p.uid, id: p.id, rank }); remaining = remaining.filter(x => x.uid !== p.uid); funds += gd.sellPrice(p.id);
    }
    if (funds >= ps.priceOf(target.slot)) {
      const plan = { ...target, funds: ps.funds, price: ps.priceOf(target.slot), sales };
      if (!valuation || valuation.accept(m, ps, recipe, plan)) return plan;
    }
  }
  return null;
}

export function withLateranoKeyLiquidity(recipe, valuation = null) {
  return Object.freeze({ ...recipe,
    trade(m, ps, ctx) {
      if (recipe.trade(m, ps, ctx)) return true;
      const plan = lateranoKeyLiquidityPlan(m, ps, recipe, valuation);
      if (!plan) return false;
      const audit = { round: m.round, level: ps.shop.level, target: plan.slot.id, funds: ps.funds,
        price: plan.price, plannedSales: plan.sales, sold: [], bought: false,
        ...(plan.valuation ? { valuation: plan.valuation } : {}) };
      (ps._botKeyLiquidity ||= []).push(audit);
      for (const sale of plan.sales) {
        if (ps.funds >= ps.priceOf(plan.slot)) break;
        const p = ps.find(sale.uid)?.piece;
        if (!p || !['hand', 'temp'].includes(ps.find(p.uid).area)
          || saleRank(m, ps, recipe, p, ps.allChess(), plan.slot, valuation) < 0) return false;
        if (!ps.sell(p.uid).ok) return false;
        audit.sold.push(sale);
      }
      if (ps.funds < ps.priceOf(plan.slot) || !ps.hand.some(p => !p)) return false;
      const before = recipe.afterPurchase ? new Set(ps.allChess().map(p => p.uid)) : null;
      const settled = recipe.observeSpend?.(m, ps), result = ps.buy(plan.index); settled?.();
      audit.bought = !!result.ok; audit.fundsAfter = ps.funds;
      if (!result.ok) return false;
      if (before) recipe.afterPurchase(m, ps, plan.slot, before);
      recipe.useEconomy(m, ps);
      // The shared trade hook takes queued rewards immediately, then rebuilds context before further shopping.
      return true;
    },
  });
}
