// [ASSUMED] Opt-in refinement of ordinary-wave contact repair; never a selected recipe.
// Six common samples, current PREP_FIN projection, own carry/growth protection and bounded small changes.
import { createForecastSteps } from '../botForecast.js';
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { prepareSiracusaCoopInput } from './siracusaCoopExperiments.js';
import { siracusaContactInput, applySiracusaContact } from './siracusaCoopTactics.js';

export const SIRACUSA_CONTACT_REFINED = 'contact-fire-robust';
export const SIRACUSA_CONTACT_LIFELINE = 'contact-fire-lifeline';
export const CONTACT_SAMPLES = 6;
const CORE = 'siracusaShip', BONDS = [CORE, 'swiftShip', 'arcaneShip', 'raidShip'];
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.difficulty === 'ABYSS' && m.order.length === 2
  && !!m.wave && m.round >= 5 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const max = (rows, key) => Math.max(...rows.map(r => r[key]));
const rank = rows => [-max(rows, 'lost'), -sum(rows, 'lost'), -max(rows, 'leaks'), -sum(rows, 'leaks')];
const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

export function refinedContactContext(m, ps, h, plans) {
  const candidates = plans[0].lineup.map(p => ({ p, rec: h.rangeRec(ps, ps.gd.chess(p.id)), bonds: pieceBonds(ps.gd, p) }))
    .filter(x => !x.bonds.includes('raidShip') && !['none', 'heal'].includes(x.rec.attackKind));
  const bb = ps.gd.bond(CORE)?.bb || {}, six = (ps.bonds[CORE]?.count || 0) >= 6;
  const dps = x => ((x.rec.stats?.atk || 0) + (six && x.bonds.includes(CORE)
    ? ((bb.base_damage || 0) + (bb.damage_per_stack || 0) * (ps.layers[CORE] || 0)) * (bb.prob || 0) : 0))
    * (x.rec.stats?.aspd || 100) / (100 * Math.max(.3, x.rec.stats?.bat || 1.5));
  candidates.sort((a, b) => dps(b) - dps(a) || a.p.uid - b.p.uid);
  const critical = new Set(candidates.slice(0, 2).map(x => x.p.uid));
  for (const x of candidates) if (ps.gd.baseIdOf(x.p.id) === 'chess_char_4_10_a') critical.add(x.p.uid);
  const original = plans[0];
  return { lp: ps.lp, critical, bodies: new Set(candidates.map(x => x.p.uid)), bondIds: BONDS.filter(id => ps.bonds[id]?.active),
    changed: plans.map(p => original.lineup.filter(u => p.get(u.uid) !== original.get(u.uid) || p.dirs.get(u.uid) !== original.dirs.get(u.uid)).length) };
}

/** Projection writes only a detached current-wave input; no real dispatch, economy or next-prep rewards. */
export function refinedContactInput(m, ps, plan) {
  const input = siracusaContactInput(ps, plan), before = Object.fromEntries(Object.entries(input.bonds).map(([id, b]) => [id, b.layers]));
  prepareSiracusaCoopInput(m, ps, plan.lineup, plan, input);
  plan.contactFin = Object.fromEntries(BONDS.map(id => [id, Math.max(0, (input.bonds[id]?.layers || 0) - (before[id] || 0))]));
  return input;
}

export function observeRefinedContact(battle, ctx, plan, playerId) {
  const deaths = {}, first = {}; let bodyKilled = 0;
  battle.on('death', ({ unit: u, reason }) => {
    if (reason !== 'killed' || u?.ownerId !== playerId) return;
    if (ctx.bodies.has(u.uid)) bodyKilled++;
    if (ctx.critical.has(u.uid)) { deaths[u.uid] = (deaths[u.uid] || 0) + 1; first[u.uid] ??= battle.time; }
  });
  return pp => ({ bodyKilled, protectedDeaths: { ...deaths }, protectedFirstDeaths: { ...first },
    silent: [...ctx.critical].filter(uid => !(pp.unitStats?.find(u => u.uid === uid)?.dmg > 0)).length,
    gains: Object.fromEntries(BONDS.map(id => [id, (plan.contactFin?.[id] || 0) + (pp.layerGains?.[id] || 0)])), damage: pp.damageDealt || 0 });
}

/** Refuse a one-leak micro gain that reshuffles most of the team; own lethal rescue keeps priority. */
export function selectRefinedContact(plans, outcomes, ctx) {
  const rows = plans.map((_, index) => outcomes.filter(r => r.index === index).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === CONTACT_SAMPLES && rs.every((r, i) => r.sample === i && r.valid && Number.isFinite(r.bodyKilled) && Number.isFinite(r.silent));
  if (!valid(rows[0]) || rows[0].every(r => r.leaks === 0)) return { index: 0, reason: 'reference-clear-or-incomplete' };
  const reference = rows[0], rejected = []; let index = 0, score = rank(reference);
  for (let i = 1; i < rows.length; i++) {
    const rs = rows[i]; let reason = null;
    if (!valid(rs)) reason = 'incomplete';
    else if (rs.some((r, s) => r.lost > reference[s].lost || r.leaks > reference[s].leaks)) reason = 'paired-leaks';
    const clearRescue = !reason && ctx.lifeline && max(reference, 'lost') >= ctx.lp && rs.every(r => r.lost === 0 && r.leaks === 0);
    const rescue = clearRescue || !reason && reference.every(r => r.lost >= ctx.lp) && rs.every(r => r.lost < ctx.lp);
    if (!reason && rs.some((r, s) => r.bodyKilled > reference[s].bodyKilled || !clearRescue && (r.silent > reference[s].silent
      || [...ctx.critical].some(uid => (r.protectedDeaths?.[uid] || 0) > (reference[s].protectedDeaths?.[uid] || 0)
        || (r.protectedFirstDeaths?.[uid] ?? Infinity) + 1 < (reference[s].protectedFirstDeaths?.[uid] ?? Infinity))))) reason = 'carry-window';
    if (!reason && !rescue && rs.some((r, s) => ctx.bondIds.some(id => (r.gains?.[id] || 0) < (reference[s].gains?.[id] || 0)))) reason = 'growth';
    const gain = !reason ? (sum(reference, 'leaks') - sum(rs, 'leaks')) / CONTACT_SAMPLES : 0;
    const safeMostlyClear = ctx.lifeline && reference.every(r => r.lost < ctx.lp) && reference.filter(r => r.leaks === 0).length >= CONTACT_SAMPLES / 2;
    if (!reason && !rescue && gain <= 1 && (ctx.changed[i] > 2 || safeMostlyClear)) reason = 'small-gain-large-change';
    if (reason) { rejected.push({ index: i, reason }); continue; }
    const next = rank(rs);
    if (better(next, score) || i !== 0 && index !== 0 && !better(score, next) && ctx.changed[i] < ctx.changed[index]) { index = i; score = next; }
  }
  return { index, rejected };
}

const cache = new WeakMap();
export function withRefinedContact(parent, makePlans, { lifeline = false } = {}) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(lifeline)) return variants.get(lifeline);
  const recipe = Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!scope(m, ps)) return;
    const before = JSON.stringify([ps.lp, ps.funds, ps.battleInput(), ps.hand, ps.temp, ps.shop.slots]);
    const plans = makePlans(m, ps, h); if (plans.length < 2) return;
    const ctx = refinedContactContext(m, ps, h, plans);
    ctx.lifeline = lifeline;
    function* inputs(plan) { yield; return refinedContactInput(m, ps, plan); }
    const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputs, {
      forecastReadinessOnly: true, forecastNormalSamples: CONTACT_SAMPLES,
      forecastContext: () => ctx, observeForecast: (battle, context, plan) => observeRefinedContact(battle, context, plan, ps.playerId),
      selectForecast: selectRefinedContact,
    });
    if (!job) return;
    ctx.changed = job.plans.map(p => plans[0].lineup.filter(u => p.get(u.uid) !== plans[0].get(u.uid) || p.dirs.get(u.uid) !== plans[0].dirs.get(u.uid)).length);
    while (!job.run(4)) yield;
    const stale = before !== JSON.stringify([ps.lp, ps.funds, ps.battleInput(), ps.hand, ps.temp, ps.shop.slots]);
    const index = stale ? 0 : job.bestIndex;
    if (index) applySiracusaContact(ps, job.best);
    (ps._botSiracusaCoopHistory ||= []).push({ factor: lifeline ? SIRACUSA_CONTACT_LIFELINE : SIRACUSA_CONTACT_REFINED, round: m.round, index, stale,
      samples: CONTACT_SAMPLES, decision: job.development, changed: ctx.changed, outcomes: job.outcomes,
      plans: job.plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
  } });
  variants.set(lifeline, recipe); return recipe;
}
