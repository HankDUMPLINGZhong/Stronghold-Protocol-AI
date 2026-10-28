// [ASSUMED] Independent27/16 economy factor: visible permanent-income dolls precede upgrades through R8.
// May cash out ordinary transition bodies on the board or bench, never speculate on future shop/battle outcomes.
import { useEconomyItems } from '../botEconomy.js';
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';

const DOLL = 'chess_item_2_05_e_a', CORE = 'lateranoShip', VISION = 'visiShip';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id || p.chessId);
const scoped = (m, ps) => m.mode === 'solo' && ps.bandId === 'band_paganini'
  && ps._botFocusId === CORE && m.round >= 1 && m.round <= 8;
const damage = rec => !['heal', 'none'].includes(rec.attackKind);
const front = rec => rec.position !== 'RANGED' && (rec.stats?.blockCnt || 0) >= 1;
const ranged = rec => rec.position === 'RANGED' && damage(rec);
const healing = rec => rec.attackKind === 'heal' || rec.dmgType === 'heal'
  || ['guardian', 'incantationmedic'].includes(rec.subProfessionId);

function saleCost(m, ps, recipe, p, remaining) {
  const gd = gdOf(m, ps), rec = gd.chess(p.id), id = base(gd, p);
  if (!remaining.some(x => x.uid === p.uid) || p.items?.length || gd.isGolden(p.id) || rec.tier >= 5) return null;
  const bonds = pieceBonds(gd, p);
  const engines = [recipe.ids.mostima, recipe.ids.archetto, recipe.ids.faith, recipe.ids.executorAlter,
    recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.ptilopsis4, recipe.ids.ptilopsis5, recipe.ids.titi,
    recipe.ids.astgenne, recipe.ids.leonhardt, recipe.ids.kroosAlter, recipe.ids.ayerscarpe, recipe.ids.tippi];
  if (bonds.includes(CORE) || bonds.includes('maniShip') || engines.includes(id)) return null;
  if (m.bossId === 'boss_4' && rec.subProfessionId === 'wandermedic') return null;
  const after = remaining.filter(x => x.uid !== p.uid), records = after.map(x => gd.chess(x.id));
  if (after.length < 2 || !records.some(front) || !records.some(ranged)) return null;
  if (remaining.some(x => healing(gd.chess(x.id))) && !records.some(healing)) return null;
  const alive = new Set(after.map(x => x.uid)), view = Object.create(ps);
  view.board = new Map([...ps.board].filter(([, x]) => x.kind !== 'chess' || alive.has(x.uid)));
  view.hand = ps.hand.map(x => x?.kind === 'chess' && !alive.has(x.uid) ? null : x);
  view.temp = ps.temp.map(x => x?.kind === 'chess' && !alive.has(x.uid) ? null : x);
  const future = computeBonds(gd, view);
  if (ps.bonds[VISION]?.active && !future[VISION]?.active) return null;
  const partner = x => base(gd, x) !== recipe.ids.executorAlter && pieceBonds(gd, x).includes(VISION);
  if (remaining.some(x => base(gd, x) === recipe.ids.executorAlter)
    && remaining.some(partner) && !after.some(partner)) return null;
  const fielded = ps.find(p.uid)?.area === 'board';
  const duplicate = remaining.filter(x => base(gd, x) === id).length > 1;
  return (fielded ? 10 : 0) + rec.tier + (duplicate ? 0 : 3)
    + (bonds.some(b => ['steadShip', 'skillfulShip', 'preciShip', VISION].includes(b)) ? 3 : 0);
}

/** Plan only real sales that together afford one visible doll; no mutation or RNG. */
export function lateranoIncomeDollPlan(m, ps, recipe, { deferredIndex = null, scope = scoped, benchOnly = false } = {}) {
  if (!scope(m, ps) && deferredIndex == null) return null;
  const gd = gdOf(m, ps), owned = ps.allChess();
  if (!owned.some(p => (p.items?.length || 0) < gd.equipPerChess)) return null;
  const targets = ps.shop.slots.map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => (deferredIndex == null || index === deferredIndex)
      && slot?.kind === 'item' && !slot.sold && slot.id === DOLL
      && recipe.purchaseItemAllowed(m, ps, gd.item(slot.id)) !== false && m.itemPool.canGain(slot.id));
  for (const target of targets) {
    const price = ps.priceOf(target.slot), sales = [];
    let funds = ps.funds, remaining = owned.slice();
    while (funds < price) {
      const candidates = remaining.filter(p => !benchOnly || ['hand', 'temp'].includes(ps.find(p.uid)?.area))
        .map(p => ({ p, cost: saleCost(m, ps, recipe, p, remaining) }))
        .filter(x => x.cost != null && gd.sellPrice(x.p.id) > 0)
        .sort((a, b) => a.cost - b.cost || a.p.uid - b.p.uid);
      if (!candidates.length) break;
      const { p, cost } = candidates[0];
      sales.push({ uid: p.uid, id: p.id, area: ps.find(p.uid)?.area, cost });
      funds += gd.sellPrice(p.id); remaining = remaining.filter(x => x.uid !== p.uid);
    }
    if (funds < price || !remaining.some(p => (p.items?.length || 0) < gd.equipPerChess)) continue;
    const opensHand = sales.some(p => ['hand', 'temp'].includes(p.area));
    if (!ps.hand.some(p => !p) && !opensHand) continue;
    return { ...target, sales, price };
  }
  return null;
}

export function withLateranoIncomeDoll(recipe, { lockAt = Infinity, skipAt = Infinity, scope = scoped, benchOnly = false } = {}) {
  const pending = (m, ps) => {
    const held = ps._botIncomeDollHeld;
    if (!held || m.mode !== 'solo' || ps.bandId !== 'band_paganini' || ps._botFocusId !== CORE
      || m.round < held.round || m.round > held.round + 1) return null;
    const index = gdOf(m, ps).shopSlots(ps.shop.level).chess + held.itemIndex, slot = ps.shop.slots[index];
    return slot?.id === DOLL && !slot.sold ? { ...held, index } : null;
  };
  // An R8 lock may be collected at R9; newly rolled R9 dolls still use the original forbidden window.
  const deferred = (m, ps) => Number.isFinite(lockAt) && m.round === 9 && pending(m, ps)?.round === 8;
  const local = Number.isFinite(lockAt) ? Object.freeze({ ...recipe,
    purchaseItemAllowed: (m, ps, rec) => rec.id === DOLL && deferred(m, ps)
      || recipe.purchaseItemAllowed(m, ps, rec),
  }) : recipe;
  const planFor = (m, ps) => lateranoIncomeDollPlan(m, ps, local,
    { scope, benchOnly, ...(deferred(m, ps) ? { deferredIndex: pending(m, ps).index } : {}) });
  function purchase(m, ps) {
    let changed = false;
    for (let guard = 0; guard < 4; guard++) {
      const plan = planFor(m, ps);
      if (!plan) break;
      if (plan.sales.length >= skipAt) {
        const seen = ps._botIncomeDollSkippedSlot;
        if (seen?.round !== m.round || seen?.slot !== plan.slot) {
          (ps._botIncomeDollSkipHistory ||= []).push({ round: m.round, level: ps.shop.level,
            funds: ps.funds, threshold: skipAt, plannedSales: plan.sales });
        }
        ps._botIncomeDollSkippedSlot = { round: m.round, slot: plan.slot };
        break;
      }
      if (plan.sales.length >= lockAt) {
        const itemIndex = plan.index - gdOf(m, ps).shopSlots(ps.shop.level).chess;
        if (ps._botIncomeDollHeld?.round !== m.round || ps._botIncomeDollHeld?.itemIndex !== itemIndex) {
          (ps._botIncomeDollLockHistory ||= []).push({ round: m.round, level: ps.shop.level,
            funds: ps.funds, plannedSales: plan.sales, threshold: lockAt, itemIndex });
        }
        ps._botIncomeDollHeld = { round: m.round, itemIndex };
        if (!ps.shop.frozen) ps.freeze();
        break;
      }
      const audit = { round: m.round, level: ps.shop.level, funds: ps.funds, price: plan.price,
        sales: [], bought: false };
      (ps._botIncomeDollHistory ||= []).push(audit);
      for (const sale of plan.sales) {
        const p = ps.find(sale.uid)?.piece;
        if (!p || saleCost(m, ps, recipe, p, ps.allChess()) == null || !ps.sell(p.uid)?.ok) return changed;
        audit.sales.push(sale); changed = true;
      }
      if (ps.funds < ps.priceOf(plan.slot) || !ps.hand.some(p => !p)) break;
      const settled = recipe.observeSpend?.(m, ps), result = ps.buy(plan.index); settled?.();
      audit.bought = !!result?.ok; audit.fundsAfter = ps.funds;
      if (!result?.ok) break;
      if (Number.isFinite(lockAt)) ps._botIncomeDollHeld = null;
      changed = true;
      useEconomyItems(m, ps);
      recipe.useEconomy(m, ps);
    }
    return changed;
  }
  return Object.freeze({ ...recipe,
    incomeDollPlan: planFor,
    useEconomy(m, ps) { recipe.useEconomy(m, ps); purchase(m, ps); },
    trade(m, ps, ctx, tools) { return purchase(m, ps) || recipe.trade(m, ps, ctx, tools); },
    beforeUpgrade(m, ps, plan) { return !purchase(m, ps) && recipe.beforeUpgrade(m, ps, plan); },
    importantItem(m, ps, rec) {
      return (scope(m, ps) || deferred(m, ps)) && rec.id === DOLL || recipe.importantItem?.(m, ps, rec) || false;
    },
    ...(Number.isFinite(lockAt) ? { purchaseItemAllowed: local.purchaseItemAllowed,
      holdShop: (m, ps) => !!pending(m, ps) || recipe.holdShop?.(m, ps) || false } : {}),
  });
}
