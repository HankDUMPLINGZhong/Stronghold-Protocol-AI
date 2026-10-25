// [ASSUMED] Three independent, opt-in normal-wave co-op experiments over late-key-value.
// No actual battle seeds, future shops, teammates' private assets or gameplay-rule changes.
import { createForecastSteps } from '../botForecast.js';
import { prepLayerForecast } from '../botLateranoDevelopment.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { enemyPositionPlans, enemyTypeInfo, enemyRoleValue } from './lateranoEnemyTypes.js';
import { stealthBattleInput, selectStealthRepair } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { allCoopForecastsFatal } from './lateranoCoopRescue.js';
import { siracusaKeyValuePlan } from './siracusaKeyValue.js';
import { withSiracusaEarlyCore } from './siracusaEarlyCore.js';
import { withSiracusaEarlyMarket } from './siracusaEarlyMarket.js';
import { siracusaFirePlans } from './siracusaNormalFire.js';
import { botSell } from '../botSiracusaSales.js';
import { withSiracusaCoopEquipment } from './siracusaCoopEquipment.js';
import { withSiracusaTactic, SIRACUSA_TACTIC_FACTORS } from './siracusaCoopTactics.js';
import { withSiracusaFourFactor, SIRACUSA_FOUR_FACTORS } from './siracusaCoopFour.js';
import { withSiracusaOpeningTrial, SIRACUSA_OPENING_FACTORS, SIRACUSA_AROMA_CASH_BASELINE } from './siracusaCoopOpeningTrials.js';
import { withSiracusaTwoTrial, SIRACUSA_TWO_FACTORS } from './siracusaCoopTwoTrials.js';
import { withSiracusaFourCorePair } from './siracusaCoopFourCorePair.js';
export { SIRACUSA_TWO_FACTORS } from './siracusaCoopTwoTrials.js';
export { SIRACUSA_FOUR_FACTORS } from './siracusaCoopFour.js';
export { SIRACUSA_OPENING_FACTORS } from './siracusaCoopOpeningTrials.js';

export const SIRACUSA_EARLY_FACTORS = Object.freeze(['coop-early-sale-protection', 'coop-early-fireline', 'coop-early-aroma', 'coop-early-visible-upgrade']);
export const SIRACUSA_COOP_EXPERIMENTS = Object.freeze(['coop-retained', 'coop-inputs', 'coop-defense', 'coop-fatal-resources', 'coop-defense-inputs', 'coop-defense-early-core', ...SIRACUSA_EARLY_FACTORS, 'coop-large-body-coverage', 'coop-lucien-right', 'coop-equipment', ...SIRACUSA_TACTIC_FACTORS, ...SIRACUSA_FOUR_FACTORS, ...SIRACUSA_OPENING_FACTORS, SIRACUSA_AROMA_CASH_BASELINE, ...SIRACUSA_TWO_FACTORS]);
const CORE = 'siracusaShip', MIMIC = 'chess_item_5_05_e_a';
export const siracusaCoopScope = (m, ps) => m.mode === 'coop' && !m.isSolo && !!m.wave
  && m.round >= 1 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const history = (ps, row) => (ps._botSiracusaCoopHistory ||= []).push(row);
const stamp = ps => JSON.stringify([ps.m.round, ps.lp, ps.funds, ps.battleInput(), ps.hand, ps.temp, ps.shop.slots]);

/** Current PREP_FIN only. Virtual withdrawals count as bench chess; items and temp never do. */
export function prepareSiracusaCoopInput(m, ps, chosen, plan, input) {
  const units = chosen.filter(p => plan.has(p.uid)).map(p => {
    const [r, c] = plan.get(p.uid).split(',').map(Number);
    return { uid: p.uid, rec: ps.gd.chess(p.id), bonds: pieceBonds(ps.gd, p), r, c,
      key: plan.get(p.uid), dir: plan.dirs.get(p.uid) };
  });
  const selected = new Set(chosen.map(p => p.uid));
  const handCount = ps.hand.filter(p => p?.kind === 'chess' && !selected.has(p.uid)).length
    + field(ps).filter(p => !selected.has(p.uid)).length;
  const fin = prepLayerForecast(ps.gd, units, input.bonds, 'SERVER_PREP_FIN', ps.round.spent, ps.round.refreshes,
    { nativeAll: true, handCount, gainedChess: ps.round.gainedChess || 0, shopLevel: ps.shop.level });
  for (const [id, n] of Object.entries(fin)) input.bonds[id].layers += n;
  return input;
}

export function siracusaCoopSnapshot(ps, h) {
  const p = new h.LayoutPlan(); p.lineup = field(ps);
  for (const u of p.lineup) { p.set(u.uid, ps.find(u.uid).key); p.dirs.set(u.uid, u.dir); }
  return p;
}

/** For the other two factors retain old chess-only/no-PREP_FIN rehearsal inputs, keeping factors independent. */
export function siracusaLegacyProbeInput(ps, plan) {
  const input = stealthBattleInput(ps, plan);
  input.units = input.units.filter(u => u.kind === 'chess');
  return input;
}

export function siracusaCoopRosterPlans(m, ps, h, original, protectedUids) {
  const threat = enemyTypeInfo(m, ps.gd), chosen = original.lineup, proposals = [];
  const score = p => enemyRoleValue(h.rangeRec(ps, ps.gd.chess(p.id)), threat) + Number(ps.gd.isGolden(p.id)) * 7;
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const healer = p => { const r = ps.gd.chess(p.id); return r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId); };
  const front = p => { const r = ps.gd.chess(p.id); return r.position === 'MELEE' && r.stats?.blockCnt > 0; };
  for (const added of ps.allChess().filter(p => !chosen.includes(p))) for (const removed of chosen) {
    if (protectedUids.has(removed.uid) || owners.has(removed.uid) || removed.items?.length
      || pieceBonds(ps.gd, added).includes('raidShip')) continue;
    if (healer(removed) && !healer(added) && !chosen.some(p => p !== removed && healer(p))) continue;
    if (front(removed) && !front(added) && !chosen.some(p => p !== removed && front(p))) continue;
    const key = original.get(removed.uid), [r, c] = key.split(',').map(Number);
    if (!ps._legal(added, r, c)) continue;
    const gain = score(added) - score(removed); if (gain <= 0) continue;
    const plan = new h.LayoutPlan(); plan.lineup = chosen.map(p => p === removed ? added : p);
    for (const p of plan.lineup) { plan.set(p.uid, p === added ? key : original.get(p.uid)); plan.dirs.set(p.uid, p === added ? removed.dir : p.dir); }
    const bonds = stealthBattleInput(ps, plan).bonds;
    if ([CORE, 'swiftShip', 'arcaneShip', 'raidShip'].some(id => (bonds[id]?.count || 0) < (ps.bonds[id]?.count || 0))) continue;
    proposals.push({ plan, gain, added: added.uid, removed: removed.uid });
  }
  proposals.sort((a, b) => b.gain - a.gain || a.added - b.added || a.removed - b.removed);
  return proposals.slice(0, 2).map(x => x.plan);
}

function* probe(m, ps, h, plans, select = selectStealthRepair, options = {}) {
  const before = stamp(ps);
  function* inputs(plan) { yield; return options.input ? options.input(ps, plan) : siracusaLegacyProbeInput(ps, plan); }
  const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputs, {
    forecastReadinessOnly: true, forecastLayerGainsEnabled: false,
    forecastContext: () => ({}), observeForecast: () => () => ({}), selectForecast: select,
  });
  if (!job) return null;
  while (!job.run(4)) yield;
  return { job, stale: stamp(ps) !== before };
}

function* defense(m, ps, h, parent) {
  const original = siracusaCoopSnapshot(ps, h);
  const fixedUids = new Set(original.lineup.filter(p => base(ps, p) === parent.ids.aroma
    || pieceBonds(ps.gd, p).includes('raidShip')).map(p => p.uid));
  // Active Raid's quiet homes and empty landings are preserved: only turn other units in this case.
  const positions = enemyPositionPlans(m, ps, { ...h, fixedUids, positionDirectionsOnly: !!ps.bonds.raidShip?.active }, enemyTypeInfo(m, ps.gd));
  const roster = siracusaCoopRosterPlans(m, ps, h, original, fixedUids);
  const plans = [original, ...(positions.length > 1 ? [positions[1]] : []), ...roster].slice(0, 3);
  if (plans.length < 2) return;
  const result = yield* probe(m, ps, h, plans); if (!result) return;
  const { job, stale } = result;
  if (!stale && job.bestIndex) {
    const added = job.best.lineup.filter(p => !original.lineup.includes(p));
    const removed = original.lineup.filter(p => !job.best.lineup.includes(p));
    for (let i = 0; i < added.length; i++) {
      const [row, col] = original.get(removed[i].uid).split(',').map(Number);
      if (!ps.move(added[i].uid, { area: 'board', row, col }, job.best.dirs.get(added[i].uid))?.ok) throw Error('Siracusa co-op roster move rejected');
    }
    applyControlPositions(ps, job.best);
    if ([...job.best].some(([uid, key]) => ps.find(uid)?.key !== key || ps.find(uid)?.piece.dir !== job.best.dirs.get(uid))) throw Error('Siracusa co-op defense differs from forecast');
  }
  history(ps, { factor: 'coop-defense', round: m.round, index: stale ? 0 : job.bestIndex, stale,
    outcomes: job.outcomes, candidates: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
}

export function siracusaRescueMimicTarget(ps) {
  if (!ps.hand.some(p => !p)) return null;
  const own = ps.allChess();
  return own.filter(p => !ps.gd.isGolden(p.id) && (p.items?.length || 0) < ps.gd.equipPerChess
    && own.filter(q => base(ps, p) === base(ps, q) && !ps.gd.isGolden(q.id)).length >= 2
    && !own.some(q => base(ps, p) === base(ps, q) && ps.gd.isGolden(q.id)))
    .sort((a, b) => Number(pieceBonds(ps.gd, b).includes(CORE)) - Number(pieceBonds(ps.gd, a).includes(CORE))
      || ps.gd.chess(b.id).tier - ps.gd.chess(a.id).tier || a.uid - b.uid)[0] || null;
}
const mimic = ps => [...ps.hand, ...ps.temp].find(p => p?.kind === 'item' && ps.gd.baseIdOf(p.id) === MIMIC);

function* rescue(m, ps, h, parent) {
  const canAct = () => mimic(ps) && siracusaRescueMimicTarget(ps)
    || siracusaKeyValuePlan(m, ps, parent, {}, { emergency: true });
  if (m.round < 3 || !h.recoverEconomySteps || !canAct()) return;
  let result = yield* probe(m, ps, h, [siracusaCoopSnapshot(ps, h)], () => ({ index: 0 }));
  if (!result || result.stale || !allCoopForecastsFatal(result.job.outcomes, ps.lp)) return;
  const log = { factor: 'coop-fatal-resources', round: m.round, lp: ps.lp, before: result.job.outcomes, repairs: [] }; history(ps, log);
  for (let pass = 0; pass < 2 && canAct(); pass++) {
    const before = stamp(ps), item = mimic(ps), target = item && siracusaRescueMimicTarget(ps);
    const action = { pass, fundsBefore: ps.funds, item: target ? item.id : null, target: target?.id }; log.repairs.push(action);
    if (target) action.used = !!ps.equip(item.uid, target.uid)?.ok;
    ps._botSiracusaRescueActive = true;
    try { yield* h.recoverEconomySteps(); } finally { ps._botSiracusaRescueActive = false; }
    action.fundsAfter = ps.funds;
    if (stamp(ps) === before) break;
    if (parent.holdShop) { const held = parent.holdShop(m, ps); if (!!ps.shop.frozen !== !!held) ps.freeze(); }
    result = yield* probe(m, ps, h, [siracusaCoopSnapshot(ps, h)], () => ({ index: 0 }));
    action.after = result?.job.outcomes;
    if (!result || result.stale || !allCoopForecastsFatal(result.job.outcomes, ps.lp)) break;
  }
}

const cache = new WeakMap();
export function withSiracusaCoopExperiment(parent, factor) {
  if (factor === 'coop-four-r7-core-pair') return withSiracusaFourCorePair(withSiracusaCoopExperiment(parent, 'coop-two-r7-core-pair'));
  if (SIRACUSA_TWO_FACTORS.includes(factor)) return withSiracusaTwoTrial(withSiracusaCoopExperiment(parent, SIRACUSA_AROMA_CASH_BASELINE), factor,
    { snapshot: siracusaCoopSnapshot, probe });
  if (factor === SIRACUSA_AROMA_CASH_BASELINE || SIRACUSA_OPENING_FACTORS.includes(factor)) return withSiracusaOpeningTrial(withSiracusaCoopExperiment(parent, 'coop-staged-three-opening'), factor,
    { snapshot: siracusaCoopSnapshot, probe });
  if (SIRACUSA_FOUR_FACTORS.includes(factor)) return withSiracusaFourFactor(withSiracusaCoopExperiment(parent, 'coop-stealth-contact'), factor,
    { snapshot: siracusaCoopSnapshot, probe, prepareInput: prepareSiracusaCoopInput });
  if (SIRACUSA_TACTIC_FACTORS.includes(factor)) return withSiracusaTactic(withSiracusaCoopExperiment(parent, 'coop-large-body-coverage'), factor,
    { snapshot: siracusaCoopSnapshot, probe });
  if (factor === 'coop-equipment') return withSiracusaCoopEquipment(withSiracusaCoopExperiment(parent, 'coop-large-body-coverage'),
    { snapshot: siracusaCoopSnapshot, probe });
  if (factor === 'coop-lucien-right') return withSiracusaCoopExperiment(parent, 'coop-large-body-coverage');
  // Position-only trial inherits the selected sale protection and ordinary-wave policy literally.
  if (factor === 'coop-large-body-coverage') return withSiracusaCoopExperiment(parent, 'coop-early-sale-protection');
  if (factor === 'coop-retained') return parent;
  if (factor === 'coop-defense-early-core') return withSiracusaEarlyCore(withSiracusaCoopExperiment(parent, 'coop-defense'));
  if (SIRACUSA_EARLY_FACTORS.includes(factor)) {
    const baseline = withSiracusaCoopExperiment(parent, 'coop-defense-early-core');
    if (factor === 'coop-early-sale-protection') return baseline;
    if (factor !== 'coop-early-fireline') return withSiracusaEarlyMarket(baseline, factor);
    let variants = cache.get(baseline); if (!variants) { variants = new Map(); cache.set(baseline, variants); }
    if (!variants.has(factor)) variants.set(factor, Object.freeze({ ...baseline,
      *finalBoardSteps(m, ps, h) {
        if (baseline.finalBoardSteps) yield* baseline.finalBoardSteps(m, ps, h);
        if (!siracusaCoopScope(m, ps)) return;
        const plans = siracusaFirePlans(m, ps, h); if (plans.length < 2) return;
        const result = yield* probe(m, ps, h, plans); if (!result) return;
        const { job, stale } = result;
        if (!stale && job.bestIndex) applyControlPositions(ps, job.best);
        history(ps, { factor, round: m.round, index: stale ? 0 : job.bestIndex, stale, outcomes: job.outcomes,
          candidates: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
      },
    }));
    return variants.get(factor);
  }
  // Literal composition: input correction still scopes to ordinary rehearsal. The adopted defense probe is inherited.
  if (factor === 'coop-defense-inputs') return withSiracusaCoopExperiment(withSiracusaCoopExperiment(parent, 'coop-defense'), 'coop-inputs');
  if (!SIRACUSA_COOP_EXPERIMENTS.includes(factor)) return parent;
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const overrides = factor === 'coop-inputs' ? {
    *rehearsalInputSteps(m, ps, chosen, plan, h) {
      const input = prepareSiracusaCoopInput(m, ps, chosen, plan, yield* h.bossInputSteps(m, ps, chosen, plan,
        { keepWithdrawn: true, independentPlanning: true }));
      history(ps, { factor, round: m.round, units: input.units.length, chess: chosen.length,
        layers: Object.fromEntries(Object.entries(input.bonds).map(([id, b]) => [id, b.layers])) });
      return input;
    },
  } : {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!siracusaCoopScope(m, ps)) return;
      if (factor === 'coop-defense') yield* defense(m, ps, h, parent);
      else yield* rescue(m, ps, h, parent);
    },
    ...(factor === 'coop-fatal-resources' ? {
      trade(m, ps, ctx) {
        if (parent.trade(m, ps, ctx)) return true;
        if (!ps._botSiracusaRescueActive || !siracusaCoopScope(m, ps)) return false;
        const plan = siracusaKeyValuePlan(m, ps, parent, ctx, { emergency: true }); if (!plan) return false;
        const audit = { factor, round: m.round, target: plan.slot.id, sales: plan.sales, fundsBefore: ps.funds }; history(ps, audit);
        for (const sale of plan.sales) if (!botSell(m, ps, sale.uid)?.ok) return false;
        const before = new Set(ps.allChess().map(p => p.uid)), result = ps.buy(plan.index);
        audit.bought = !!result.ok; audit.fundsAfter = ps.funds;
        if (!result.ok) return false;
        parent.afterPurchase?.(m, ps, plan.slot, before); parent.useEconomy?.(m, ps); return true;
      },
    } : {}),
  };
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
