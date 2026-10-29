// [ASSUMED] Four-seat contact guards; the measured safe guard is adopted, others remain explicit trials.
// Fixed before the 56-seed comparison; no actual wave outcome or seed-specific condition.
import { FORECAST_SAMPLES } from '../botForecast.js';
import { selectStealthRepair } from './lateranoStealthWave.js';
import { refinedContactContext } from './siracusaContactRefined.js';

export const CONTACT_GUARDS = Object.freeze([
  'contact-guard-safe', 'contact-guard-growth', 'contact-guard-repeat',
]);
export const CONTACT_SAFE_GROWTH = 'contact-guard-safe-growth';
export const CONTACT_SAFE_NO_MICRO = 'contact-guard-safe-no-micro';
export const isContactGuard = factor => CONTACT_GUARDS.includes(factor)
  || factor === CONTACT_SAFE_GROWTH || factor === CONTACT_SAFE_NO_MICRO;
export const hasContactGrowth = factor => factor === CONTACT_GUARDS[1] || factor === CONTACT_SAFE_GROWTH;
const mean = (rs, key) => rs.reduce((n, r) => n + r[key], 0) / FORECAST_SAMPLES;
const max = (rs, key) => Math.max(...rs.map(r => r[key]));
const complete = rs => rs.length === FORECAST_SAMPLES && rs.every((r, s) => r.valid && r.sample === s);
const grouped = (plans, outcomes) => plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));

export function contactGuardContext(m, ps, h, plans, factor) {
  const original = plans[0];
  const context = { factor, lp: ps.lp, round: m.round, stageId: m.stageId,
    previous: ps._botSiracusaContactRepair,
    changed: plans.map(p => original.lineup.filter(u => p.get(u.uid) !== original.get(u.uid)
      || p.dirs.get(u.uid) !== original.dirs.get(u.uid)).length) };
  if (hasContactGrowth(factor)) {
    // Own current expected auto-attack DPS incl. active six-core extra damage, not past actual damage.
    context.critical = refinedContactContext(m, ps, h, plans).critical;
    context.vigil = new Set(original.lineup.filter(p => ps.gd.baseIdOf(p.id) === 'chess_char_3_19_a').map(p => p.uid));
  }
  return context;
}

/** Observe the same detached two forecast battles; wolves include later summons with null UIDs. */
export function observeContactGuard(battle, ctx, playerId) {
  let vigilCoreGain = 0, vigilKills = 0;
  const ownVigil = u => u?.ownerId === playerId && (ctx.vigil.has(u.uid) || ctx.vigil.has(u.ownerUnit?.uid));
  battle.on('kill', ({ killer, victim }) => { if (victim?.side === 'enemy' && ownVigil(killer)) vigilKills++; });
  battle.on('layerGain', ({ source, bondId, n }) => {
    if (bondId === 'siracusaShip' && source?.ownerId === playerId && ctx.vigil.has(source.uid)) vigilCoreGain += n;
  });
  return pp => ({ carryDamage: (pp.unitStats || []).filter(u => ctx.critical.has(u.uid)).reduce((n, u) => n + u.dmg, 0),
    vigilDamage: Math.round(battle.allyUnits.filter(ownVigil).reduce((n, u) => n + u.stats.dmg, 0)), vigilCoreGain, vigilKills });
}

/** Retain the paired LP/leak ranking. Combined trials filter once against the same untouched incumbent. */
export function selectGuardedContact(plans, outcomes, ctx) {
  const rows = grouped(plans, outcomes), reference = rows[0], rejected = [];
  if (!complete(reference)) return { index: 0, rejected, reason: 'incomplete-reference' };
  const margin = ctx.lp - max(reference, 'lost'), urgent = margin <= 2;
  for (let i = 1; i < plans.length; i++) {
    const rs = rows[i];
    if (!complete(rs) || rs.some((r, s) => r.lost > reference[s].lost || r.leaks > reference[s].leaks)) continue;
    const lpGain = mean(reference, 'lost') - mean(rs, 'lost');
    const leakGain = mean(reference, 'leaks') - mean(rs, 'leaks');
    const smallGain = lpGain < 2 && leakGain < 3;
    let reason = null;
    if ((ctx.factor === CONTACT_GUARDS[0] || ctx.factor === CONTACT_SAFE_GROWTH || ctx.factor === CONTACT_SAFE_NO_MICRO) && !urgent && smallGain
      && (max(reference, 'leaks') <= 2 || ctx.changed[i] > 2)) reason = 'safe-small-gain';
    // Explicit four-seat trial over adopted safe: paired mean uncapped leaks, same urgency and samples.
    if (ctx.factor === CONTACT_SAFE_NO_MICRO && !urgent && leakGain <= 1) reason = 'nonurgent-one-leak';
    if (hasContactGrowth(ctx.factor)) {
      const keys = ['carryDamage', 'vigilDamage', 'vigilCoreGain', 'vigilKills'];
      let growthReason = null;
      if ([...reference, ...rs].some(r => keys.some(k => !Number.isFinite(r[k])))) growthReason = 'incomplete-metrics';
      // Near-fatal strictly paired rescue may sacrifice future growth; otherwise protect current output.
      else if (!(urgent && rs.every((r, s) => r.lost < reference[s].lost)) && rs.some((r, s) =>
        r.carryDamage < reference[s].carryDamage * .85 || r.vigilDamage < reference[s].vigilDamage * .8
        || r.vigilCoreGain < reference[s].vigilCoreGain || r.vigilKills < reference[s].vigilKills)) growthReason = 'carry-or-vigil-growth';
      if (growthReason) reason = reason ? `${reason}+${growthReason}` : growthReason;
    }
    const prev = ctx.previous;
    if (ctx.factor === CONTACT_GUARDS[2] && !urgent && smallGain && prev?.round === ctx.round - 1
      && prev.stageId === ctx.stageId && (prev.meanLostGain >= 2 || prev.meanLeakGain >= 3)) reason = 'repeat-small-gain';
    if (reason) rejected.push({ index: i, reason });
  }
  const vetoes = new Set(rejected.map(r => r.index));
  const { index } = selectStealthRepair(plans, outcomes.filter(r => !vetoes.has(r.index)));
  return { index, rejected, margin, changed: ctx.changed };
}

/** Consecutive-round factor remembers predicted benefit only, never real combat or settlement. */
export function rememberContactRepair(ctx, plans, outcomes, index) {
  const rows = grouped(plans, outcomes);
  return { round: ctx.round, stageId: ctx.stageId, index,
    meanLostGain: index && complete(rows[0]) && complete(rows[index]) ? mean(rows[0], 'lost') - mean(rows[index], 'lost') : 0,
    meanLeakGain: index && complete(rows[0]) && complete(rows[index]) ? mean(rows[0], 'leaks') - mean(rows[index], 'leaks') : 0 };
}
