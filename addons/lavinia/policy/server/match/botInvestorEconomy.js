// [ASSUMED] Optional Siracusa investment policy, using real buy/gain/merge/sell operations only.
// Values and liquidity thresholds are AI decisions; SERVER_GAIN repetition remains the engine's responsibility.
import { releaseSavings, savingsCash } from './botSavings.js';
import { botSell } from './botSiracusaSales.js';

export const siracusaAdjustment = (m, name) => m.opts?.botSiracusaAdjustments == null
  ? false : m.opts.botSiracusaAdjustments.includes(name);
const FLAME = 'chess_char_4_19_a', SWIRE = 'chess_char_3_03_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const stateOf = (ps) => ps._botInvestorEconomy ||= { gifts: [] };

// [ASSUMED] Investment is an optional branch: last search at R9, then value late members for combat only.
export const investorWindow = (m, ps) => !!ps.bonds.investShip?.active || m.round <= (m.opts?.botSiracusaInvestorDeadline ?? 9);
export function investorPurchaseAllowed(m, ps, rec) {
  const gd = gdOf(m, ps);
  return !rec?.bonds.includes('investShip') || !ps.allChess().some((p) => gd.baseIdOf(p.id) === gd.baseIdOf(rec.chessId));
}

export function trimInvestorCopies(m, ps) {
  const gd = gdOf(m, ps), groups = new Map();
  for (const p of ps.allChess()) {
    if (!gd.chess(p.id)?.bonds.includes('investShip')) continue;
    const base = gd.baseIdOf(p.id);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }
  for (const copies of groups.values()) {
    // Prefer the deployed/equipped representative; never sell locked gear to enforce a shopping rule.
    copies.sort((a, b) => Number(ps.find(b.uid)?.area === 'board') - Number(ps.find(a.uid)?.area === 'board')
      || (b.items?.length || 0) - (a.items?.length || 0) || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid);
    for (const p of copies.slice(1)) if (!p.items?.length && ps.find(p.uid)?.area !== 'board' && botSell(m, ps, p.uid)?.ok) {
      const stats = ps._botRecipeStats ||= {};
      stats.investorDuplicatesSold = (stats.investorDuplicatesSold || 0) + 1;
    }
  }
}

export function investorCycleValue(m, ps, rec) {
  const gd = gdOf(m, ps);
  if (!siracusaAdjustment(m, 'economy') || !ps.bonds.investShip?.active || rec?.isGolden
    || ![FLAME, SWIRE].includes(rec?.chessId) || ps.hand.filter((p) => !p).length < 3) return 0;
  // Do not pay for an empty gift pool. No peek at the next draw or mutation of its RNG.
  if (rec.chessId === FLAME) {
    const poolId = rec.garrisonIds.map((id) => gd.garrison(id)).find((g) => g.effectKey === 'SERVER_POOL_CHAR')?.bbStr?.pool;
    const pool = gd.choices?.pools?.[poolId];
    const members = pool?.items || pool?.weighted?.map((p) => p[0]) || [];
    if (!members.some((id) => !m.pool.has(id) || m.pool.left(id) > 0)) return 0;
  }
  return rec.chessId === FLAME ? 24 : 18;
}

export function afterInvestorPurchase(m, ps, slot, before) {
  if (!siracusaAdjustment(m, 'economy') || !ps.bonds.investShip?.active || ![FLAME, SWIRE].includes(slot.id)) return;
  const gd = gdOf(m, ps), state = stateOf(ps);
  state.round = m.round;
  for (const p of ps.allChess()) {
    const rec = gd.chess(p.id);
    // Only newly gained, ordinary off-core gifts are disposable; never tag merge rewards or earlier holdings.
    if (before.has(p.uid) || rec.isGolden || rec.tier >= 5
      || rec.bonds.some((b) => ['siracusaShip', 'investShip', 'swiftShip', 'arcaneShip', 'miraShip'].includes(b))) continue;
    if (gd.baseIdOf(p.id) === FLAME && !ps.allChess().some((q) => gd.baseIdOf(q.id) === FLAME && gd.isGolden(q.id))) continue;
    state.gifts.push(p.uid);
  }
  const stats = ps._botRecipeStats ||= {};
  stats.investorPurchases = (stats.investorPurchases || 0) + 1;
}

export function tradeInvestorGift(m, ps) {
  const gd = gdOf(m, ps), state = stateOf(ps);
  state.gifts = state.gifts.filter((uid) => ps.find(uid));
  for (const uid of state.gifts) {
    const found = ps.find(uid), p = found?.piece;
    if (!p || found.area === 'board' || p.items?.length || gd.isGolden(p.id)) continue;
    const copies = ps.allChess().filter((q) => gd.baseIdOf(q.id) === gd.baseIdOf(p.id));
    // A live pair can produce a next-tier offer; a leftover single after an elite is disposable.
    if (copies.filter((q) => !gd.isGolden(q.id)).length >= 2 && !copies.some((q) => gd.isGolden(q.id))) continue;
    if (botSell(m, ps, uid)?.ok) {
      const stats = ps._botRecipeStats ||= {};
      stats.investorGiftSales = (stats.investorGiftSales || 0) + 1;
      return true;
    }
  }
  return false;
}

export function useInvestorLiquidity(m, ps, usefulCard) {
  if (!siracusaAdjustment(m, 'liquidity')) return;
  const gd = gdOf(m, ps);
  const target = ps.shop.slots.filter((s) => s && !s.sold && s.kind === 'chess'
    && (usefulCard(gd.chess(s.id)) || investorCycleValue(m, ps, gd.chess(s.id)) > 0))
    .reduce((n, s) => Math.min(n, ps.priceOf(s)), Infinity);
  if (target > ps.funds && target < Infinity) releaseSavings(m, ps, { current: true, target });
  // Coins obtained from an active investment cycle can also complete a paid refresh; keep ordinary savings flexible.
  else if (ps.bonds.investShip?.active && stateOf(ps).round === m.round && ps.funds === 0 && !ps.shop.freeRefreshes
    && ps.shop.slots.every((s) => !s || s.sold || !savingsCash(gd.item(s.id)))) {
    releaseSavings(m, ps, { current: true, target: gd.refreshPrice });
  }
}
