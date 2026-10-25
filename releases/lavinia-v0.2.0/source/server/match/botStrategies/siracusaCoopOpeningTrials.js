// [ASSUMED] Retained four-seat trials and adopted co-op first-Aroma cash over R7-opening10/56.
// Public current-wave geometry and visible shops only; no actual battle seeds or future cards.
import { siracusaFourScope } from './siracusaCoopFour.js';
import { siracusaFirePlans } from './siracusaNormalFire.js';
import { siracusaContactInput, applySiracusaContact } from './siracusaCoopTactics.js';
import { siracusaKeyValuePlan } from './siracusaKeyValue.js';
import { botSell } from '../botSiracusaSales.js';

export const SIRACUSA_OPENING_FACTORS = Object.freeze(['coop-opening-fire-directions', 'coop-opening-lucien-right', 'coop-opening-first-aroma-cash']);
export const SIRACUSA_AROMA_CASH_BASELINE = 'coop-first-aroma-cash';
const AROMA = 'chess_char_4_10_a';
const ordinary = (m, ps) => siracusaFourScope(m, ps) && !!m.wave && m.round >= 1 && m.round <= 13;
const record = (ps, row) => (ps._botSiracusaCoopHistory ||= []).push(row);

export function firstAromaCashPlan(m, ps, parent, ctx = {}, { allCoop = false } = {}) {
  const eligible = allCoop ? m.mode === 'coop' && !m.isSolo && m.order.length >= 2 && !!m.wave && m.round >= 1 && m.round <= 13
    && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip' : ordinary(m, ps);
  if (!eligible || ps.allChess().some(p => ps.gd.baseIdOf(p.id) === AROMA)) return null;
  const valuation = { ...parent, importantBuy: (mm, pp, rec) => pp.gd.baseIdOf(rec.chessId) === AROMA || parent.importantBuy?.(mm, pp, rec) };
  return siracusaKeyValuePlan(m, ps, valuation, ctx, { emergency: true, targetBaseId: AROMA });
}

const cache = new WeakMap();
export function withSiracusaOpeningTrial(parent, factor, { snapshot, probe }) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const overrides = [SIRACUSA_AROMA_CASH_BASELINE, 'coop-opening-first-aroma-cash'].includes(factor) ? {
    trade(m, ps, ctx, helpers) {
      const plan = firstAromaCashPlan(m, ps, parent, ctx, { allCoop: factor === SIRACUSA_AROMA_CASH_BASELINE });
      if (!plan) return parent.trade(m, ps, ctx, helpers);
      const audit = { factor, round: m.round, target: plan.slot.id, price: plan.price, value: plan.value, cost: plan.cost,
        fundsBefore: ps.funds, sales: [], bought: false }; record(ps, audit);
      for (const sale of plan.sales) {
        if (!botSell(m, ps, sale.uid)?.ok) return false;
        audit.sales.push(sale);
      }
      const before = new Set(ps.allChess().map(p => p.uid)), result = ps.buy(plan.index);
      audit.bought = !!result.ok; audit.fundsAfter = ps.funds;
      if (!result.ok) return false;
      parent.afterPurchase?.(m, ps, plan.slot, before); parent.useEconomy?.(m, ps);
      return true;
    },
  } : factor === 'coop-opening-fire-directions' ? {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!ordinary(m, ps)) return;
      const plans = siracusaFirePlans(m, ps, h, { directionsOnly: true, limit: 5 }); if (plans.length < 2) return;
      const risk = yield* probe(m, ps, h, [snapshot(ps, h)], () => ({ index: 0 }), { input: siracusaContactInput });
      const rows = risk?.job.outcomes;
      if (!risk || risk.stale || rows?.length !== 2 || rows.some(r => !r.valid || r.leaks < 1)) return;
      const result = yield* probe(m, ps, h, plans, undefined, { input: siracusaContactInput }); if (!result) return;
      if (!result.stale && result.job.bestIndex) applySiracusaContact(ps, result.job.best);
      record(ps, { factor, round: m.round, index: result.job.bestIndex, stale: result.stale, risk: rows, outcomes: result.job.outcomes,
        plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    },
  } : {};
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
