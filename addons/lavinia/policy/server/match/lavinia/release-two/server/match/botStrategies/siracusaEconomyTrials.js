// [ASSUMED] Independent, unselected economy trials over the adopted two-seat recipe.
// Current own assets and visible shop only; no future rewards, actual battle seed or hidden stock.
import { pieceBonds, computeBonds } from '../../../../../../../../../bondsMeta.js';
import { botSaleAllowed, botSell } from '../botSiracusaSales.js';
import { lateranoMergeOrder } from './lateranoMergeOrder.js';

export const SIRACUSA_ECONOMY_FACTORS = Object.freeze(['withdrawal-key-pairs', 'zero-missing-native-lock', 'funded-merge-order']);
const CORE = 'siracusaShip', PAIRS = new Set(['chess_char_3_18_a', 'chess_char_4_10_a']);
const FIRST = new Set([...PAIRS, 'chess_char_4_16_a', 'chess_char_5_10_a', 'chess_char_5_20_a']);
export const economyTrialScope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 2
  && m.difficulty === 'ABYSS' && m.round >= 1 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const normal = (ps, id) => ps.allChess().filter(p => base(ps, p) === id && !ps.gd.isGolden(p.id));
const count = (ps, xs) => new Set(xs.filter(p => pieceBonds(ps.gd, p).includes(CORE)).map(p => base(ps, p))).size;
const log = (ps, e) => (ps._botSiracusaEconomyHistory ||= []).push(e);
export function withdrawalKeyPair(m, ps, p) {
  if (!economyTrialScope(m, ps) || p?.kind !== 'chess' || ps.gd.isGolden(p.id) || !PAIRS.has(base(ps, p))) return false;
  const id = base(ps, p);
  return normal(ps, id).length >= ps.gd.mergeCount(id) - 1
    && !ps.allChess().some(q => base(ps, q) === id && ps.gd.isGolden(q.id));
}
function rosterBonds(ps, pieces) {
  const view = Object.create(ps); view.board = new Map(pieces.map((p, i) => [String(i), p]));
  const selected = new Set(pieces.map(p => p.uid));
  view.hand = [...ps.hand, ...ps.board.values()].filter(p => p && !selected.has(p.uid)); view.temp = ps.temp;
  return computeBonds(ps.gd, view);
}
function safeReserveBonds(ps, p) {
  const view = Object.create(ps); view.hand = ps.hand.filter(q => q?.uid !== p.uid);
  const after = computeBonds(ps.gd, view);
  return Object.entries(ps.bonds).every(([id, b]) => !b.active || after[id]?.active);
}
function sameNativeAndBonds(ps, before, after) {
  if (count(ps, after) < Math.min(6, count(ps, before))) return false;
  const a = rosterBonds(ps, before), b = rosterBonds(ps, after);
  return Object.entries(a).every(([id, bond]) => !bond.active || b[id]?.active);
}
function parkWithdrawalDress(m, ps) {
  const dress = ps.hand.find(p => p?.kind === 'item' && ps.gd.item(p.id)?.giveBondId === CORE);
  if (!dress) return false;
  const targets = ps.allChess().filter(p => !ps.gd.chess(p.id).bonds.includes(CORE)
    && (p.items?.length || 0) < ps.gd.equipPerChess)
    .sort((a, b) => Number(base(ps, b) === 'chess_char_5_07_a') - Number(base(ps, a) === 'chess_char_5_07_a')
      || ps.gd.chess(b.id).tier - ps.gd.chess(a.id).tier || a.uid - b.uid);
  for (const carrier of targets) if (ps.equip(dress.uid, carrier.uid)?.ok) {
    log(ps, { factor: 'withdrawal-key-pairs', kind: 'park-dress', round: m.round, item: dress.id, carrier: carrier.id });
    return true;
  }
  return false;
}

/** Only run for an actual unchosen board pair and a full hand. Shopping/funding sales remain inherited. */
export function repairPairWithdrawals(parent, m, ps, original, h) {
  if (!economyTrialScope(m, ps) || ps.hand.some(p => !p)) return original;
  let chosen = original.slice();
  for (const p of [...ps.board.values()].filter(p => p.kind === 'chess')) {
    if (chosen.some(q => q.uid === p.uid) || !withdrawalKeyPair(m, ps, p) || ps.hand.some(q => !q)) continue;
    // Park the actual dress on a legal free carrier; never destroy retained gear or open random gifts for room.
    parkWithdrawalDress(m, ps);
    if (!ps.hand.some(q => !q)) {
      const all = ps.allChess(), selected = new Set(chosen.map(q => q.uid));
      const candidates = ps.hand.filter(q => q?.kind === 'chess' && !selected.has(q.uid) && !q.items?.length
        && q.boughtRound !== m.round && (!ps._botSeenUids || ps._botSeenUids.has(q.uid))
        && !h.preserved(q) && !parent.keep?.(m, ps, ps.gd.chess(q.id), h.context) && botSaleAllowed(m, ps, q)
        && safeReserveBonds(ps, q)
        && (ps.gd.isGolden(q.id) || normal(ps, base(ps, q)).length < ps.gd.mergeCount(q.id) - 1)
        && count(ps, all.filter(x => x.uid !== q.uid)) >= Math.min(6, count(ps, all))
        && (!FIRST.has(base(ps, q)) || all.some(x => x.uid !== q.uid && base(ps, x) === base(ps, q))))
        .sort((a, b) => h.value(a) - h.value(b) || a.uid - b.uid);
      const sale = candidates[0];
      if (sale && botSell(m, ps, sale.uid)?.ok) log(ps, { factor: 'withdrawal-key-pairs', kind: 'room-sale', round: m.round, kept: p.id, sold: sale.id });
    }
    if (ps.hand.some(q => !q)) {
      log(ps, { factor: 'withdrawal-key-pairs', kind: 'safe-room', round: m.round, kept: p.id }); continue;
    }
    // A protected body must appear in the real chosen roster, not remain as an unmodelled ninth unit.
    const onBoard = new Set([...ps.board.values()].map(q => q.uid));
    const replacements = chosen.filter(q => !onBoard.has(q.uid))
      .map(q => ({ q, roster: chosen.map(x => x.uid === q.uid ? p : x) }))
      .filter(x => sameNativeAndBonds(ps, chosen, x.roster))
      .sort((a, b) => h.value(a.q) - h.value(b.q) || a.q.uid - b.q.uid);
    if (replacements[0]) {
      const { q, roster } = replacements[0]; chosen = roster;
      log(ps, { factor: 'withdrawal-key-pairs', kind: 'defer-swap', round: m.round, kept: p.id, deferred: q.id });
    } else log(ps, { factor: 'withdrawal-key-pairs', kind: 'hard-roster-override', round: m.round, id: p.id });
  }
  return chosen;
}

export function missingNativeLocks(parent, m, ps) {
  if (!economyTrialScope(m, ps) || ps.funds !== 0) return [];
  const own = ps.allChess(), owned = new Set(own.map(p => base(ps, p))), nativeCount = count(ps, own);
  return ps.shop.slots.filter(s => s?.kind === 'chess' && !s.sold && ps.gd.chess(s.id)?.bonds.includes(CORE)
    && !owned.has(base(ps, s)) && (nativeCount < 6 || FIRST.has(base(ps, s)))
    && parent.purchaseAllowed?.(m, ps, ps.gd.chess(s.id)) !== false);
}

const cache = new WeakMap();
export function withSiracusaEconomyTrial(parent, factor, endRewards = false) {
  if (endRewards) {
    const inherited = withSiracusaEconomyTrial(parent, factor);
    let variants = cache.get(inherited); if (!variants) { variants = new Map(); cache.set(inherited, variants); }
    if (!variants.has('end-rewards')) variants.set('end-rewards', Object.freeze({ ...inherited, settleEndOffers: true }));
    return variants.get('end-rewards');
  }
  if (!factor) return parent;
  if (!SIRACUSA_ECONOMY_FACTORS.includes(factor)) throw Error('Unknown Siracusa economy trial');
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (!variants.has(factor)) {
    let recipe;
    if (factor === 'withdrawal-key-pairs') recipe = { ...parent,
      repairWithdrawals: (m, ps, chosen, h) => repairPairWithdrawals(parent, m, ps, chosen, h) };
    if (factor === 'zero-missing-native-lock') recipe = { ...parent,
      holdShop(m, ps) { const old = parent.holdShop?.(m, ps), slots = missingNativeLocks(parent, m, ps);
        if (slots.length) { const e = { factor, kind: 'lock-missing', round: m.round, ids: slots.map(s => s.id) };
          if (JSON.stringify(ps._botSiracusaEconomyHistory?.at(-1)) !== JSON.stringify(e)) log(ps, e); }
        return old || slots.length > 0; } };
    if (factor === 'funded-merge-order') recipe = { ...parent,
      upgradeMergeOrder(m, ps, h) {
        if (!economyTrialScope(m, ps) || m.round < 6 || ![2, 3, 4].includes(ps.shop.level)) return parent.upgradeMergeOrder?.(m, ps, h);
        const order = lateranoMergeOrder(m, ps, parent, h.scoreReward, { partialBundle: true });
        if (order) log(ps, { factor, kind: 'compare-order', round: m.round, level: ps.shop.level,
          upgradeFirst: order.upgradeFirst, cost: order.cost, current: order.current, next: order.next });
        return order;
      } };
    variants.set(factor, Object.freeze(recipe));
  }
  return variants.get(factor);
}
