// [ASSUMED] Independent two-seat ABYSS trials over the retained Lavinia recipe.
// Separate option preserves every inherited policy gate, including sale/large-body protection.
import { siracusaCoopSnapshot, siracusaCoopProbe } from './siracusaCoopExperiments.js';
import { siracusaContactPlans, siracusaContactInput, applySiracusaContact } from './siracusaCoopTactics.js';
import { siracusaFirePlans } from './siracusaNormalFire.js';
import { selectStealthRepair } from './lateranoStealthWave.js';
import { withRefinedContact, SIRACUSA_CONTACT_REFINED, SIRACUSA_CONTACT_LIFELINE } from './siracusaContactRefined.js';
import { SIRACUSA_CONTACT_ROLLBACK, contactRollbackPlans, rememberContactLayout, probeContactRollback } from './siracusaContactRollback.js';
import { SIRACUSA_CONTACT_INPUTS_ROLLBACK } from './siracusaContactInputs.js';
import { CONTACT_GUARDS, CONTACT_SAFE_GROWTH, CONTACT_SAFE_NO_MICRO, isContactGuard, hasContactGrowth, contactGuardContext, observeContactGuard, selectGuardedContact, rememberContactRepair } from './siracusaContactGuards.js';

export const SIRACUSA_MIXED_TRIALS = Object.freeze(['native-search-window', 'native-merge-first', 'contact-fire-window', SIRACUSA_CONTACT_REFINED, SIRACUSA_CONTACT_LIFELINE, SIRACUSA_CONTACT_ROLLBACK, SIRACUSA_CONTACT_INPUTS_ROLLBACK, ...CONTACT_GUARDS, CONTACT_SAFE_GROWTH, CONTACT_SAFE_NO_MICRO]);
const CORE = 'siracusaShip', THIRD = ['chess_char_3_18_a', 'chess_char_3_19_a'];
const scope = (m, ps, factor) => m.mode === 'coop' && !m.isSolo && m.difficulty === 'ABYSS'
  && (m.order.length === 2 && !isContactGuard(factor)
    || m.order.length === 4 && (factor === SIRACUSA_CONTACT_INPUTS_ROLLBACK || isContactGuard(factor)))
  && !!m.wave && m.round >= 3 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const record = (ps, entry) => (ps._botSiracusaCoopHistory ||= []).push(entry);
const missing = ps => THIRD.filter(id => !ps.allChess().some(p => ps.gd.baseIdOf(p.id) === id));

/** Release the promotion veto after two tier3 refreshes; reserve three coins inside that window. */
export function mixedSearchHeld(m, ps) {
  if (!scope(m, ps) || m.round !== 8 || ps.shop.level !== 3 || !missing(ps).length) return false;
  const cost = ps.shop.freeRefreshes > 0 ? 0 : ps.gd.refreshPrice;
  if (ps.funds < 3 + cost) return false;
  let state = ps._botSiracusaMixedSearch;
  if (!state || state.round !== m.round) {
    state = ps._botSiracusaMixedSearch = { round: m.round, startRefreshes: ps.round.refreshes };
    record(ps, { factor: SIRACUSA_MIXED_TRIALS[0], kind: 'search-window', round: m.round,
      funds: ps.funds, missing: missing(ps), startRefreshes: state.startRefreshes });
  }
  return ps.round.refreshes - state.startRefreshes < 2;
}

export function mixedNativeMerge(m, ps, rec) {
  if (!scope(m, ps) || !rec || !rec.bonds.includes(CORE) || ps.gd.isGolden(rec.chessId)) return false;
  const base = ps.gd.baseIdOf(rec.chessId);
  return !ps.allChess().some(p => ps.gd.baseIdOf(p.id) === base && ps.gd.isGolden(p.id))
    && ps.completesChessMerge(rec.chessId);
}

const signature = p => [...p].map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).join('|');
export function mixedContactPlans(m, ps, h) {
  const contact = siracusaContactPlans(m, ps, h, siracusaCoopSnapshot, { endurance: true, radius: 1, limit: 3 });
  const fire = siracusaFirePlans(m, ps, h);
  const plans = [], seen = new Set();
  // Prefer one firing-window candidate and one durable-contact candidate, on the same held roster.
  for (const p of [contact[0], fire[1], contact[1]]) if (p && !seen.has(signature(p))) {
    seen.add(signature(p)); plans.push(p);
  }
  return plans;
}

const cache = new WeakMap();
export function withSiracusaMixedTrial(parent, factor) {
  if (factor == null || factor === false) return parent;
  if (!SIRACUSA_MIXED_TRIALS.includes(factor)) throw Error('Unknown Siracusa mixed-team trial');
  if (factor === SIRACUSA_CONTACT_REFINED) return withRefinedContact(parent, mixedContactPlans);
  if (factor === SIRACUSA_CONTACT_LIFELINE) return withRefinedContact(parent, mixedContactPlans, { lifeline: true });
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const overrides = factor === 'native-search-window' ? {
    levelTarget: (m, ps, opts) => mixedSearchHeld(m, ps) ? 3 : parent.levelTarget(m, ps, opts),
    priorityLevel: (m, ps) => mixedSearchHeld(m, ps) ? false : parent.priorityLevel(m, ps),
    spendReserve: (m, ps) => mixedSearchHeld(m, ps) ? 3 : parent.spendReserve(m, ps),
    purchaseReserve: (m, ps) => mixedSearchHeld(m, ps) ? 3 : parent.purchaseReserve(m, ps),
    beforeUpgrade: (m, ps, ctx) => mixedSearchHeld(m, ps) ? false : parent.beforeUpgrade(m, ps, ctx),
  } : factor === 'native-merge-first' ? {
    criticalBuy: (m, ps, rec, ctx) => mixedNativeMerge(m, ps, rec) || parent.criticalBuy(m, ps, rec, ctx),
    importantBuy: (m, ps, rec) => mixedNativeMerge(m, ps, rec) || parent.importantBuy(m, ps, rec),
    beforeUpgrade(m, ps, ctx) {
      const target = ps.shop.slots.find(s => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds
        && mixedNativeMerge(m, ps, ps.gd.chess(s.id)));
      if (!target) return parent.beforeUpgrade(m, ps, ctx);
      const key = `${m.round}:${target.id}:${ps.funds}`;
      if (ps._botSiracusaMixedMergeLog !== key) {
        ps._botSiracusaMixedMergeLog = key;
        record(ps, { factor, kind: 'merge-before-upgrade', round: m.round, target: target.id, funds: ps.funds });
      }
      return false;
    },
  } : {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!scope(m, ps, factor) || m.round < 5) return;
      const plans = mixedContactPlans(m, ps, h);
      const guarded = isContactGuard(factor);
      const rollback = factor === SIRACUSA_CONTACT_ROLLBACK || factor === SIRACUSA_CONTACT_INPUTS_ROLLBACK || guarded;
      if (rollback) {
        const previous = ps._botSiracusaContactPrevious;
        ps._botSiracusaContactPrevious = rememberContactLayout(m, ps, plans[0]);
        const seen = new Set(plans.map(signature));
        for (const p of contactRollbackPlans(m, ps, h, plans[0], previous)) if (!seen.has(signature(p))) {
          seen.add(signature(p)); plans.push(p);
        }
      }
      if (plans.length < 2) return;
      const context = guarded ? contactGuardContext(m, ps, h, plans, factor) : undefined;
      const result = rollback ? yield* probeContactRollback(m, ps, h, plans, {
        corrected: factor === SIRACUSA_CONTACT_INPUTS_ROLLBACK || guarded,
        ...(guarded ? { context, select: selectGuardedContact,
          ...(hasContactGrowth(factor) ? { observe: (b, ctx) => observeContactGuard(b, ctx, ps.playerId) } : {}) } : {}),
      })
        : yield* siracusaCoopProbe(m, ps, h, plans, selectStealthRepair, { input: siracusaContactInput });
      if (!result) return;
      const index = result.stale ? 0 : result.job.bestIndex;
      if (index) applySiracusaContact(ps, plans[index]);
      if (factor === CONTACT_GUARDS[2] && !result.stale)
        ps._botSiracusaContactRepair = rememberContactRepair(context, plans, result.job.outcomes, index);
      record(ps, { factor, round: m.round, index, stale: result.stale, outcomes: result.job.outcomes,
        ...(guarded ? { decision: result.job.decision } : {}),
        ...(rollback ? { rollbacks: plans.map(p => p.rollback || null) } : {}),
        plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    },
  };
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
