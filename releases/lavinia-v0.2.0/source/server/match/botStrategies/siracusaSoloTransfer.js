// [ASSUMED] ABYSS-only first-Aroma cash + wolf/melee contact baseline; historical trials remain reproducible.
import { createForecastSteps } from '../botForecast.js';
import { siracusaKeyValuePlan } from './siracusaKeyValue.js';
import { botSell } from '../botSiracusaSales.js';
import { siracusaContactPlans, siracusaContactInput, applySiracusaContact, placeHeldWolf } from './siracusaCoopTactics.js';
import { selectStealthRepair } from './lateranoStealthWave.js';

export const SIRACUSA_SOLO_TRANSFERS = Object.freeze(['solo-first-aroma-cash', 'solo-stealth-contact', 'solo-sale-protection']);
// HARD is frozen: the registry calls this selector only for solo ABYSS.
export function selectSiracusaSoloPolicy(parent, factor) {
  if (factor === 'solo-late-key-value-control') return parent;
  if (SIRACUSA_SOLO_TRANSFERS.includes(factor)) return withSiracusaSoloTransfer(parent, factor);
  const cash = withSiracusaSoloTransfer(parent, 'solo-first-aroma-cash');
  return withSiracusaSoloTransfer(cash, 'solo-stealth-contact');
}
export const siracusaSoloTransferScope = (m, ps) => m.mode === 'solo' && m.isSolo && m.difficulty === 'ABYSS'
  && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip';
const ordinary = (m, ps) => siracusaSoloTransferScope(m, ps) && !!m.wave && m.round >= 1 && m.round <= 13;
const record = (ps, row) => (ps._botSiracusaSoloHistory ||= []).push(row);
const stamp = (m, ps) => JSON.stringify([m.round, m.phase, ps.lp, ps.funds, ps.battleInput(), ps.hand, ps.temp, ps.shop.slots]);
const snapshot = (ps, h) => {
  const p = new h.LayoutPlan(); p.lineup = [...ps.board.values()].filter(u => u.kind === 'chess');
  for (const u of p.lineup) { p.set(u.uid, ps.find(u.uid).key); p.dirs.set(u.uid, u.dir); }
  return p;
};
export function soloFirstAromaCashPlan(m, ps, parent, ctx = {}) {
  if (!ordinary(m, ps) || ps.allChess().some(p => ps.gd.baseIdOf(p.id) === 'chess_char_4_10_a')) return null;
  const valuation = { ...parent, importantBuy: (mm, pp, rec) => pp.gd.baseIdOf(rec.chessId) === 'chess_char_4_10_a' || parent.importantBuy?.(mm, pp, rec) };
  return siracusaKeyValuePlan(m, ps, valuation, ctx, { emergency: true, targetBaseId: 'chess_char_4_10_a' });
}
const cache = new WeakMap();
export function withSiracusaSoloTransfer(parent, factor) {
  if (!SIRACUSA_SOLO_TRANSFERS.includes(factor)) return parent;
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const overrides = factor === 'solo-first-aroma-cash' ? {
    trade(m, ps, ctx, helpers) {
      const plan = soloFirstAromaCashPlan(m, ps, parent, ctx);
      if (!plan) return parent.trade(m, ps, ctx, helpers);
      const audit = { factor, round: m.round, target: plan.slot.id, price: plan.price, value: plan.value, cost: plan.cost, fundsBefore: ps.funds, sales: [], bought: false };
      record(ps, audit);
      for (const sale of plan.sales) { if (!botSell(m, ps, sale.uid)?.ok) return false; audit.sales.push(sale); }
      const before = new Set(ps.allChess().map(p => p.uid)), result = ps.buy(plan.index);
      audit.bought = !!result.ok; audit.fundsAfter = ps.funds;
      if (!result.ok) return false;
      parent.afterPurchase?.(m, ps, plan.slot, before); parent.useEconomy?.(m, ps); return true;
    },
  } : factor === 'solo-stealth-contact' ? {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!ordinary(m, ps) || (ps.bonds.siracusaShip?.count || 0) < 6) return;
      const deployedWolf = placeHeldWolf(m, ps, h), plans = siracusaContactPlans(m, ps, h, snapshot);
      if (deployedWolf) record(ps, { factor, round: m.round, kind: 'held-wolf', deployedWolf });
      if (plans.length < 2) return;
      const before = stamp(m, ps);
      function* inputs(plan) { yield; return siracusaContactInput(ps, plan); }
      const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputs, {
        forecastReadinessOnly: true, forecastLayerGainsEnabled: false, forecastContext: () => ({}),
        observeForecast: () => () => ({}), selectForecast: selectStealthRepair,
      });
      if (!job) return;
      while (!job.run(4)) yield;
      const stale = stamp(m, ps) !== before;
      if (!stale && job.bestIndex) applySiracusaContact(ps, job.best);
      record(ps, { factor, round: m.round, index: stale ? 0 : job.bestIndex, stale, outcomes: job.outcomes,
        plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    },
  } : {};
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
