// [ASSUMED] Independent two-seat follow-ups over the selected first-Aroma-cash recipe.
// Opening facts are latched before prep actions. Public waves and independent forecasts only.
import { siracusaNativeEliteKinds } from './siracusaCoopFour.js';
import { siracusaFirePlans } from './siracusaNormalFire.js';
import { siracusaContactInput, applySiracusaContact } from './siracusaCoopTactics.js';
import { allCoopForecastsFatal } from './lateranoCoopRescue.js';
import { selectStealthRepair } from './lateranoStealthWave.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

export const SIRACUSA_TWO_FACTORS = Object.freeze(['coop-two-r7-opening', 'coop-two-three-window', 'coop-two-fatal-facing', 'coop-two-r7-core-pair']);
export const siracusaTwoScope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 2 && !!m.wave
  && m.round >= 1 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip';
const record = (ps, row) => (ps._botSiracusaCoopHistory ||= []).push(row);
/** Owned native coverage and real same-base ordinary pairs; elite+ordinary is not a merge pair. */
export function siracusaOpeningCorePair(ps) {
  const native = ps.allChess().filter(p => pieceBonds(ps.gd, p).includes('siracusaShip'));
  const nativeKinds = [...new Set(native.map(p => ps.gd.baseIdOf(p.id)))], counts = new Map();
  for (const p of native) if (!ps.gd.isGolden(p.id)) {
    const base = ps.gd.baseIdOf(p.id); counts.set(base, (counts.get(base) || 0) + 1);
  }
  return { nativeKinds, pairs: [...counts].filter(([, n]) => n >= 2).map(([id]) => id) };
}
const cache = new WeakMap();
export function withSiracusaTwoTrial(parent, factor, { snapshot, probe }) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const corePair = factor === 'coop-two-r7-core-pair', r7 = factor === 'coop-two-r7-opening' || corePair;
  const openingKey = corePair ? '_botSiracusaTwoR7CorePairOpening' : r7 ? '_botSiracusaTwoR7Opening' : '_botSiracusaTwoR8Opening';
  const staged = (m, ps) => siracusaTwoScope(m, ps) && m.round === 7 && ps.shop.level <= 3
    && ps[openingKey]?.eligible === true && ps.allChess().length >= 6;
  const missing = ps => [parent.ids.honeysuckle, parent.ids.vigil].filter(id => !ps.allChess().some(p => ps.gd.baseIdOf(p.id) === id));
  const held = (m, ps) => siracusaTwoScope(m, ps) && m.round === 8 && ps.shop.level === 3
    && ps[openingKey]?.level === 2 && missing(ps).length > 0;
  const overrides = factor === 'coop-two-fatal-facing' ? {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!siracusaTwoScope(m, ps)) return;
      const plans = siracusaFirePlans(m, ps, h, { directionsOnly: true, singleOnly: true, limit: 7 });
      if (plans.length < 2) return;
      const risk = yield* probe(m, ps, h, [snapshot(ps, h)], () => ({ index: 0 }), { input: siracusaContactInput });
      if (!risk || risk.stale || !allCoopForecastsFatal(risk.job.outcomes, ps.lp)) return;
      // The shared normal forecaster caps each job at three plans. Keep the real incumbent in
      // each batch; evaluate at most six distinct single turns, all on the same paired samples.
      const outcomes = [], batches = []; let stale = false, complete = true;
      for (let offset = 1; offset < plans.length; offset += 2) {
        const result = yield* probe(m, ps, h, [plans[0], ...plans.slice(offset, offset + 2)], undefined, { input: siracusaContactInput });
        if (!result) { complete = false; break; }
        batches.push({ offset, stale: result.stale, outcomes: result.job.outcomes });
        if (result.stale) { stale = true; break; }
        for (const row of result.job.outcomes) if (row.index || offset === 1)
          outcomes.push({ ...row, index: row.index ? offset + row.index - 1 : 0 });
      }
      const index = stale || !complete ? 0 : selectStealthRepair(plans, outcomes).index;
      if (index) applySiracusaContact(ps, plans[index]);
      record(ps, { factor, round: m.round, index, stale, complete, risk: risk.job.outcomes,
        outcomes, batches, plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    },
  } : {
    prepStart(m, ps) {
      const round = r7 ? 7 : 8;
      if (siracusaTwoScope(m, ps) && m.round === round && !ps[openingKey]) {
        const eliteKinds = [...siracusaNativeEliteKinds(ps)];
        ps[openingKey] = { round, level: ps.shop.level, eliteKinds, eligible: ps.shop.level === 2 && eliteKinds.length >= 2 };
        if (corePair) {
          const opening = siracusaOpeningCorePair(ps), coverageEligible = opening.nativeKinds.length >= 4 || opening.pairs.length > 0;
          Object.assign(ps[openingKey], opening, { coverageEligible, eligible: ps[openingKey].eligible && coverageEligible });
        }
        record(ps, { factor, kind: 'opening', ...ps[openingKey] });
      }
      parent.prepStart?.(m, ps);
    },
    ...(r7 ? {
      levelTarget(m, ps, options) { return staged(m, ps) ? 3 : parent.levelTarget(m, ps, options); },
      priorityLevel(m, ps) { return staged(m, ps) && ps.shop.level === 2 ? true : parent.priorityLevel(m, ps); },
      spendReserve(m, ps) { return staged(m, ps) ? ps.shop.level === 2 && ps.funds >= ps.shop.upgradePrice
        ? Math.max(0, ps.shop.upgradePrice) : 0 : parent.spendReserve(m, ps); },
      beforeUpgrade(m, ps, plan) { return staged(m, ps) && ps.shop.level === 3 ? false : parent.beforeUpgrade(m, ps, plan); },
    } : {
      levelTarget(m, ps, options) {
        if (!held(m, ps)) return parent.levelTarget(m, ps, options);
        if (!ps[openingKey].recordedHold) {
          ps[openingKey].recordedHold = true;
          record(ps, { factor, kind: 'search-window', round: m.round, funds: ps.funds, missing: missing(ps) });
        }
        return 3;
      },
      priorityLevel(m, ps) { return held(m, ps) ? false : parent.priorityLevel(m, ps); },
      spendReserve(m, ps) { return held(m, ps) ? 0 : parent.spendReserve(m, ps); },
      beforeUpgrade(m, ps, plan) { return held(m, ps) ? false : parent.beforeUpgrade(m, ps, plan); },
    }),
  };
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
