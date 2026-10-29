// [ASSUMED] Three independent user-authorized four-seat ABYSS trials from manual84259.
// Current visible shop/own assets/current wave only. No seed-specific branch or future stock.
import { siracusaContactPlans, applySiracusaContact } from './siracusaCoopTactics.js';
import { siracusaCoopSnapshot } from './siracusaCoopExperiments.js';
import { probeContactRollback } from './siracusaContactRollback.js';
import { CONTACT_SAFE_NO_MICRO, contactGuardContext, selectGuardedContact } from './siracusaContactGuards.js';
import { siracusaVigilTokensLegal } from './siracusaCommunityTrials.js';
import { HUMAN_CONTACT_REVISED, HUMAN_CONTACT_RAID_ONLY, HUMAN_CONTACT_JOINT_RAID, withHumanContactRevised } from './siracusaHumanContactRevised.js';

export const HUMAN84259_FACTORS = Object.freeze(['opening-pair', 'income-doll-hold', 'contact-coverage', HUMAN_CONTACT_REVISED, HUMAN_CONTACT_RAID_ONLY, HUMAN_CONTACT_JOINT_RAID]);
const CORE = 'siracusaShip';
export const human84259Scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 4
  && m.difficulty === 'ABYSS' && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const active = (m, ps) => human84259Scope(m, ps) && m.round >= 1 && m.round <= 13;
const slots = ps => ps.shop.slots.filter(s => s && !s.sold);
const normal = (ps, id) => ps.allChess().filter(p => p.id === id && !ps.gd.isGolden(p.id));
const record = (ps, entry) => (ps._botHuman84259History ||= []).push(entry);
function nativePressure(ps) {
  return slots(ps).some(s => s.kind === 'chess' && ps.priceOf(s) <= ps.funds
    && ps.gd.chess(s.id).bonds.includes(CORE) && (!ps.allChess().some(p => ps.gd.baseIdOf(p.id) === ps.gd.baseIdOf(s.id)
      && ps.gd.isGolden(p.id)) || ps.completesChessMerge(s.id)));
}

/** R1 actual complete duplicate bundle; no sale, expected income or native is displaced. */
export function openingPairTargets(m, ps) {
  if (!active(m, ps) || m.round !== 1 || ps.shop.level !== 1 || ps.allChess().length
    || ps.hand.filter(p => !p).length < 2 || slots(ps).some(s => s.kind === 'chess' && ps.gd.chess(s.id).bonds.includes(CORE))) return [];
  const ids = [...new Set(slots(ps).filter(s => s.kind === 'chess').map(s => s.id))];
  return ids.flatMap(id => {
    const rec = ps.gd.chess(id), pair = slots(ps).filter(s => s.kind === 'chess' && s.id === id)
      .sort((a, b) => ps.priceOf(a) - ps.priceOf(b)).slice(0, 2), pool = ps.poolOf(id);
    if (rec.isGolden || rec.tier !== 1 || ps.gd.mergeCount(id) !== 3 || pair.length !== 2
      || pair.some(s => ps.priceOf(s) > 2) || pool.has(id) && pool.left(id) < 2) return [];
    const cost = pair.reduce((n, s) => n + ps.priceOf(s), 0);
    if (cost > ps.funds) return [];
    const s = rec.stats || {}, score = (s.blockCnt || 0) * 500 + (s.maxHp || 0) + (s.def || 0) * 5 + (s.atk || 0) * 2;
    return [{ id, pair, cost, score }];
  }).sort((a, b) => b.score - a.score || a.cost - b.cost || a.id.localeCompare(b.id));
}

/** Only the same two successful R1 purchases authorize the later third. Sold copies do not. */
export function openingThirdTarget(m, ps) {
  if (!active(m, ps) || m.round < 2 || nativePressure(ps)) return null;
  const pair = ps._botHuman84259OpeningPair;
  if (!pair || pair.completed) return null;
  const held = normal(ps, pair.id);
  if (held.length !== 2 || !pair.uids.every(uid => held.some(p => p.uid === uid)) || !ps.completesChessMerge(pair.id)) return null;
  const slot = slots(ps).find(s => s.kind === 'chess' && s.id === pair.id);
  return slot ? { id: pair.id, slot, index: ps.shop.slots.indexOf(slot), price: ps.priceOf(slot) } : null;
}

function openingWrapper(parent) {
  const held = (m, ps) => { const t = openingThirdTarget(m, ps); return !!t && (t.price > ps.funds || !ps.hand.some(p => !p)); };
  return Object.freeze({ ...parent,
    purchaseAllowed: (m, ps, rec) => openingThirdTarget(m, ps)?.id === rec.chessId || parent.purchaseAllowed(m, ps, rec),
    importantBuy: (m, ps, rec) => openingThirdTarget(m, ps)?.id === rec.chessId || parent.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec, ctx) => openingThirdTarget(m, ps)?.id === rec.chessId || parent.criticalBuy(m, ps, rec, ctx),
    keep: (m, ps, rec, ctx) => active(m, ps) && ps._botHuman84259OpeningPair?.id === rec.chessId
      && normal(ps, rec.chessId).length === 2 || parent.keep(m, ps, rec, ctx),
    trade(m, ps, ctx, h) {
      const opening = openingPairTargets(m, ps)[0];
      if (opening) {
        const before = new Set(ps.allChess().map(p => p.uid));
        for (const slot of opening.pair) {
          const prior = new Set(ps.allChess().map(p => p.uid));
          if (!ps.buy(ps.shop.slots.indexOf(slot))?.ok) throw Error('Validated R1 duplicate purchase rejected');
          parent.afterPurchase?.(m, ps, slot, prior);
        }
        const uids = ps.allChess().filter(p => p.id === opening.id && !before.has(p.uid)).map(p => p.uid);
        if (uids.length !== 2) throw Error('R1 duplicate provenance mismatch');
        ps._botHuman84259OpeningPair = { id: opening.id, uids };
        record(ps, { factor: 'opening-pair', kind: 'buy-pair', round: m.round, id: opening.id, cost: opening.cost, uids });
        return true;
      }
      const third = openingThirdTarget(m, ps);
      if (third && third.price <= ps.funds && ps.hand.some(p => !p)) {
        const before = new Set(ps.allChess().map(p => p.uid));
        if (!ps.buy(third.index)?.ok) throw Error('Validated opening third purchase rejected');
        parent.afterPurchase?.(m, ps, third.slot, before);
        ps._botHuman84259OpeningPair.completed = true;
        record(ps, { factor: 'opening-pair', kind: 'buy-third', round: m.round, id: third.id, price: third.price });
        return true;
      }
      return parent.trade(m, ps, ctx, h);
    },
    hasVisiblePair: (m, ps) => !!openingThirdTarget(m, ps) || parent.hasVisiblePair?.(m, ps),
    retainVisiblePair: (m, ps) => held(m, ps) || parent.retainVisiblePair?.(m, ps),
    holdShop: (m, ps) => held(m, ps) || parent.holdShop?.(m, ps),
    allowFundedHold: (m, ps) => held(m, ps) || parent.allowFundedHold?.(m, ps),
  });
}

/** Leftover expires. Only fixed next-round income/pending money/owned permanent effects count. */
export function incomeDollHold(m, ps) {
  if (!human84259Scope(m, ps) || m.round < 3 || m.round > 7 || ps.shop.level >= 4 || ps.shop.freeRefreshes > 0) return null;
  const fixed = ps.gd.income(m.round + 1) + Math.max(0, ps.pendingFunds || 0)
    + ps.effects.filter(e => e.key === 'effect:builtin_round_coin').reduce((n, e) => n + (e.params?.count || 0), 0);
  const slot = slots(ps).find(s => s.kind === 'item' && ps.gd.item(s.id)?.buffs?.some(b => b.key === 'gain_coin_when_round_start')
    && ps.priceOf(s) > ps.funds && ps.priceOf(s) <= fixed);
  return slot ? { id: slot.id, price: ps.priceOf(slot), fixed } : null;
}
function incomeWrapper(parent) {
  const held = (m, ps) => { const hold = incomeDollHold(m, ps); if (!hold) return false;
    const entry = { factor: 'income-doll-hold', kind: 'hold', round: m.round, funds: ps.funds, ...hold };
    const history = ps._botHuman84259History || [];
    if (JSON.stringify(history.at(-1)) !== JSON.stringify(entry)) record(ps, entry);
    return true;
  };
  return Object.freeze({ ...parent,
    holdShop: (m, ps) => parent.holdShop?.(m, ps) || held(m, ps),
    allowFundedHold: (m, ps) => parent.allowFundedHold?.(m, ps) || held(m, ps),
    hasVisiblePair: (m, ps) => parent.hasVisiblePair?.(m, ps) || held(m, ps),
    retainVisiblePair: (m, ps) => parent.retainVisiblePair?.(m, ps) || held(m, ps),
  });
}

function contactWrapper(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!human84259Scope(m, ps) || !m.wave || m.round < 5 || m.round > 13) return;
    const plans = siracusaContactPlans(m, ps, h, siracusaCoopSnapshot, { endurance: true, radius: 4, limit: 3 })
      .filter((p, i) => !i || siracusaVigilTokensLegal(ps, p));
    if (plans.length < 2) return;
    const context = contactGuardContext(m, ps, h, plans, CONTACT_SAFE_NO_MICRO);
    const result = yield* probeContactRollback(m, ps, h, plans, { corrected: true, context, select: selectGuardedContact });
    if (!result) return;
    const index = result.stale ? 0 : result.job.bestIndex;
    if (index) applySiracusaContact(ps, plans[index]);
    record(ps, { factor: 'contact-coverage', round: m.round, index, stale: result.stale, outcomes: result.job.outcomes,
      decision: result.job.decision, plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
  } });
}

const cache = new WeakMap();
function wrap(parent, factor) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (!variants.has(factor)) variants.set(factor, ({ 'opening-pair': openingWrapper, 'income-doll-hold': incomeWrapper,
    'contact-coverage': contactWrapper, [HUMAN_CONTACT_REVISED]: withHumanContactRevised,
    [HUMAN_CONTACT_RAID_ONLY]: p => withHumanContactRevised(p, { protectVigil: false }),
    [HUMAN_CONTACT_JOINT_RAID]: p => withHumanContactRevised(p, { protectVigil: false, jointRaid: true }) })[factor](parent));
  return variants.get(factor);
}

/** Adopt the measured opening pair and joint-contact combination in original four-seat ABYSS.
 * An explicit trial replaces the default contact choice; adoption options retain historical controls.
 */
export function selectHuman84259(parent, m) {
  const factor = m.opts?.botSiracusaHuman84259Trial
    ?? (m.opts?.botSiracusaJointRaidAdopted ? HUMAN_CONTACT_JOINT_RAID : false);
  if (factor && !HUMAN84259_FACTORS.includes(factor)) throw Error('Unknown manual84259 factor');
  if (!factor && !m.opts?.botSiracusaOpeningPairAdopted) return parent;
  if (m.mode !== 'coop' || m.isSolo || m.order.length !== 4 || m.difficulty !== 'ABYSS') return parent;
  if (m.opts?.botSiracusaOpeningPairAdopted) {
    parent = wrap(parent, 'opening-pair');
    if (factor === 'opening-pair') return parent;
  }
  return factor ? wrap(parent, factor) : parent;
}
