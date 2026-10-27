// [ASSUMED] Price a visible key against the complete opportunity cost of a necessary bench-sale bundle.
// No future shops, battle predictions, extra rerolls or direct mutations of game resources.
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';
import { routeLayerEngine, draftRouteBonds } from './siracusaFocusedDraft.js';
import { isFormationAnchor } from '../botPositioning.js';

const CORE = 'siracusaShip', base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const count = (gd, xs, bond) => new Set(xs.filter(p => pieceBonds(gd, p).includes(bond)).map(p => base(gd, p))).size;
const ids = { lap: 'chess_char_2_16_a', aroma: 'chess_char_4_10_a', texas: 'chess_char_4_16_a',
  honey: 'chess_char_3_18_a', angel: 'chess_char_5_20_a', suzu: 'chess_char_5_10_a',
  surtr: 'chess_char_5_07_a', alter: 'chess_char_6_18_a' };
const keys = new Set(Object.values(ids));

export function keyBenefit(m, ps, recipe, slot, ctx) {
  const gd = ps.gd || m.gd, rec = gd.chess(slot.id), id = base(gd, slot);
  if (!rec || recipe.purchaseAllowed?.(m, ps, rec) === false) return 0;
  const own = ps.allChess(), same = own.filter(p => base(gd, p) === id);
  if (same.some(p => gd.isGolden(p.id))) return 0;
  const merge = ps.completesChessMerge(slot.id), native = pieceBonds(gd, { id: slot.id }).includes(CORE);
  if (!same.length && native && count(gd, own, CORE) === 5) return 14;
  if (!same.length && id === ids.alter) return 15;
  if (!recipe.criticalBuy?.(m, ps, rec, ctx) && !recipe.importantBuy?.(m, ps, rec) && !merge) return 0;
  if (merge && native) return keys.has(id) ? 12 : m.round < gd.bossRound ? 8 : 4;
  if (merge && routeLayerEngine(gd, rec, draftRouteBonds(ps))) return m.round < gd.bossRound ? 9 : 5;
  if (!same.length && native) {
    if (id === ids.angel) return m.round < gd.bossRound ? 14 : 9;
    if (keys.has(id)) return 11;
    return count(gd, own, CORE) < 3 ? 12 : 8;
  }
  if (!same.length && id === ids.surtr && ps._botRoute?.id === 'siracusaShip:arcane-raid') return 12;
  if (!same.length && rec.tier >= 5 && rec.bonds.some(b => draftRouteBonds(ps).includes(b))) return 10;
  return 0;
}

function saleCost(m, ps, recipe, pieces, target, ctx) {
  const gd = ps.gd || m.gd, own = ps.allChess(), removed = new Set(pieces.map(p => p.uid));
  const remaining = own.filter(p => !removed.has(p.uid));
  if (count(gd, remaining, CORE) < Math.min(6, count(gd, own, CORE))) return Infinity;
  const view = Object.create(ps);
  view.hand = ps.hand.map(p => p && !removed.has(p.uid) ? p : null);
  view.temp = ps.temp.filter(p => p && !removed.has(p.uid));
  view.allChess = () => remaining; view.bonds = computeBonds(gd, view);
  for (const b of ['investShip', 'miraShip']) if (ps.bonds[b]?.active && !view.bonds[b]?.active) return Infinity;
  if (ps._botRoute?.id === 'siracusaShip:arcane-raid') for (const b of ['arcaneShip', 'raidShip']) {
    if (count(gd, remaining, b) < Math.min(2, count(gd, own, b))) return Infinity;
  }
  let cost = 0;
  for (const p of pieces) {
    const id = base(gd, p), rec = gd.chess(p.id), same = own.filter(q => base(gd, q) === id);
    const last = !remaining.some(q => base(gd, q) === id), bonds = pieceBonds(gd, p);
    if (p.items?.length || id === base(gd, target) || ps.find(p.uid)?.area === 'board'
      || recipe.preserve?.(m, ps, rec)) return Infinity;
    const normals = same.filter(q => !gd.isGolden(q.id));
    if (normals.length >= 2 && remaining.filter(q => base(gd, q) === id && !gd.isGolden(q.id)).length < 2
      && bonds.includes(CORE)) return Infinity;
    if (last && keys.has(id)) return Infinity;
    cost += 1 + Number(gd.isGolden(p.id)) * 3;
    if (last) cost += rec.tier >= 5 ? 5 : rec.tier >= 4 ? 3 : 1;
    if (last && bonds.includes(CORE)) cost += 3;
    if (routeLayerEngine(gd, rec, draftRouteBonds(ps))) cost += last ? 5 : 2;
    if (last && isFormationAnchor(rec)) cost += rec.tier >= 5 ? 3 : 1;
    if (recipe.keep?.(m, view, rec, ctx)) cost += 3;
  }
  // Price the lost merge opportunity once per base, beyond the price of each individual copy.
  for (const id of new Set(pieces.map(p => base(gd, p)))) {
    if (own.filter(p => base(gd, p) === id && !gd.isGolden(p.id)).length >= 2
      && remaining.filter(p => base(gd, p) === id && !gd.isGolden(p.id)).length < 2) cost += 5;
  }
  return cost;
}

/** Pure plan; at most three necessary bench sales, funded in full before touching an asset. */
export function siracusaKeyValuePlan(m, ps, recipe, ctx = {}) {
  const gd = ps.gd || m.gd;
  if (m.round < gd.bossRound || m.round > gd.hiddenRound) return null;
  const all = ps.shop.slots.map((slot, index) => ({ slot, index }))
    .filter(x => x.slot?.kind === 'chess' && !x.slot.sold)
    .map(x => ({ ...x, price: ps.priceOf(x.slot), value: keyBenefit(m, ps, recipe, x.slot, ctx) })).filter(x => x.value > 0);
  const affordable = Math.max(0, ...all.filter(x => x.price <= ps.funds).map(x => x.value));
  const targets = all.filter(x => x.price > ps.funds && x.value > affordable).sort((a, b) => b.value - a.value || a.price - b.price || a.index - b.index);
  const pool = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess' && !p.items?.length && gd.sellPrice(p.id) > 0);
  for (const target of targets) {
    const stock = ps.poolOf?.(target.slot.id) || m.pool;
    if (stock.has(target.slot.id) && stock.left(target.slot.id) <= 0) continue;
    const deficit = target.price - ps.funds; let best = null;
    function visit(at, chosen, refund) {
      if (refund >= deficit) {
        if (chosen.some(p => refund - gd.sellPrice(p.id) >= deficit)) return;
        // Selling a hand piece immediately pulls a queued temporary piece into its slot.
        const handSales = chosen.filter(p => ps.find(p.uid)?.area === 'hand').length;
        const tempSales = chosen.filter(p => ps.find(p.uid)?.area === 'temp').length;
        if (ps.hand.filter(p => !p).length + handSales - Math.max(0, ps.temp.filter(Boolean).length - tempSales) < 1) return;
        const cost = saleCost(m, ps, recipe, chosen, target.slot, ctx);
        if (target.value < cost + 3) return;
        if (!best || cost < best.cost || cost === best.cost && (chosen.length < best.sales.length
          || chosen.length === best.sales.length && refund < best.refund)) best = { ...target, cost, refund,
          sales: chosen.map(p => ({ uid: p.uid, id: p.id, refund: gd.sellPrice(p.id) })) };
        return;
      }
      if (chosen.length === 3) return;
      for (let i = at; i < pool.length; i++) visit(i + 1, [...chosen, pool[i]], refund + gd.sellPrice(pool[i].id));
    }
    visit(0, [], 0);
    if (best) return best;
  }
  return null;
}

const cache = new WeakMap();
export function withSiracusaKeyValue(recipe) {
  if (!cache.has(recipe)) cache.set(recipe, Object.freeze({ ...recipe,
    trade(m, ps, ctx) {
      if (recipe.trade(m, ps, ctx)) return true;
      const plan = siracusaKeyValuePlan(m, ps, recipe, ctx);
      if (!plan) return false;
      const audit = { round: m.round, level: ps.shop.level, target: plan.slot.id, funds: ps.funds,
        price: plan.price, value: plan.value, cost: plan.cost, sales: [], bought: false };
      (ps._botSiracusaKeyTrades ||= []).push(audit);
      for (const sale of plan.sales) {
        const location = ps.find(sale.uid);
        if (!location || !['hand', 'temp'].includes(location.area) || !ps.sell(sale.uid).ok) return false;
        audit.sales.push(sale);
      }
      const before = new Set(ps.allChess().map(p => p.uid)), result = ps.buy(plan.index);
      audit.bought = !!result.ok; audit.fundsAfter = ps.funds;
      if (!result.ok) return false;
      recipe.afterPurchase?.(m, ps, plan.slot, before);
      recipe.useEconomy?.(m, ps);
      const stats = ps._botRecipeStats ||= {};
      stats.keyValuePurchases = (stats.keyValuePurchases || 0) + 1;
      stats.keyValueSales = (stats.keyValueSales || 0) + audit.sales.length;
      return true;
    },
    shopLockAudit(m, ps) {
      const audit = recipe.shopLockAudit?.(m, ps), trades = ps._botSiracusaKeyTrades?.filter(t => t.round === m.round);
      return trades?.length ? { ...audit, keyTrades: trades.map(t => ({ ...t, sales: t.sales.map(s => ({ ...s })) })) } : audit;
    },
  }));
  return cache.get(recipe);
}
