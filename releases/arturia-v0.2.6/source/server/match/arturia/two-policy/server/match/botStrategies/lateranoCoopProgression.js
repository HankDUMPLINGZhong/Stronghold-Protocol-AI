// [ASSUMED] Continuous co-op tier progression: use real deployed strength and bounded engine windows.
// Same shopping/gear/combat callbacks as14/56; only economic gates and a public-wave readiness probe change.
import { createForecastSteps } from '../botForecast.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';
import { lateranoFocused } from './lateranoFocused.js';
import { coopEntryState } from './lateranoCoopSafety.js';
import { coopTempoSafe } from './lateranoCoopFactors.js';
import { withLateranoCoopEarlyInvestment } from './lateranoCoopUpgrade.js';
import { ownedLateranoCount } from './lateranoSixReady.js';

const CORE = 'lateranoShip', { ids } = lateranoFocused;
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const healing = rec => rec.attackKind === 'heal' || rec.dmgType === 'heal'
  || ['guardian', 'incantationmedic'].includes(rec.subProfessionId);
const ordinaryPair = (ps, id) => {
  const own = ps.allChess().filter(p => base(ps, p) === id);
  return !own.some(p => ps.gd.isGolden(p.id)) && own.filter(p => !ps.gd.isGolden(p.id)).length >= 2;
};
const ownsSixCarry = ps => ps.allChess().some(p => [ids.lemuen, ids.exusiaiAlter].includes(base(ps, p)));
const age = (m, ps, tier) => m.round - (ps._botCoopTierAt?.[tier] ?? m.round);

/** Same650-defense criterion as the solo maturity trial, evaluated only for a deployed tank's real loadout. */
function strongTank(ps, p, rec) {
  if (rec.profession !== 'TANK' || (rec.stats.blockCnt || 0) < 2) return false;
  if (ps.gd.isGolden(p.id) && rec.tier >= 3) return true;
  if (base(ps, p) !== ids.faith) return false;
  let defence = rec.stats.def;
  for (const id of rec.garrisonIds || []) {
    const g = ps.gd.garrison(id);
    if (g?.effectKey !== 'act1autochess_gar_eff_attrByBond' || !(g.bb.def > 0)) continue;
    const layers = (g.bbStr.bond_id || '').split(',').reduce((n, b) => n + (ps.bonds[b]?.active ? ps.layers[b] || 0 : 0), 0);
    defence *= 1 + Math.floor(layers / Math.max(1, g.bb.divide_num || 1)) * g.bb.def;
  }
  return defence >= 650;
}

/** No bench-only carry, defender or healer can satisfy the mature-board roles. */
export function coopProgressBoard(ps) {
  const pieces = field(ps), gd = ps.gd;
  const entries = pieces.map(p => { const r = gd.chess(p.id); return { p, rec: loadoutRecord(r, resolveRecordLoadout(r, ps.loadoutFor(r))) }; });
  const native = pieces.filter(p => pieceBonds(gd, p).includes(CORE));
  const carry = entries.find(({ p, rec }) => gd.isGolden(p.id) && (rec.profession === 'SNIPER' && rec.tier >= 2
    || base(ps, p) === ids.executorAlter)
    && pieceBonds(gd, p).includes(CORE) && !['heal', 'none'].includes(rec.attackKind));
  return { distinct: new Set(pieces.map(p => base(ps, p))).size,
    natives: new Set(native.map(p => base(ps, p))).size,
    carry: carry?.p.uid ?? null,
    tank: entries.find(({ p, rec }) => strongTank(ps, p, rec))?.p.uid ?? null,
    healer: entries.find(({ rec }) => healing(rec))?.p.uid ?? null,
    mostima: pieces.find(p => base(ps, p) === ids.mostima)?.uid ?? null,
    mostimaElite: pieces.some(p => base(ps, p) === ids.mostima && gd.isGolden(p.id)),
    ranged: entries.some(({ rec }) => rec.position === 'RANGED' && !['heal', 'none'].includes(rec.attackKind)),
    front: entries.some(({ rec }) => rec.position !== 'RANGED' && (rec.stats.blockCnt || 0) >= 1),
    tierThreeCarry: pieces.some(p => [ids.archetto, ids.exusiai].includes(base(ps, p))) };
}

function ready(m, ps, maxLoss = 1) {
  const s = ps._botCoopProgress;
  return scope(m, ps) && s?.round === m.round && s.level === ps.shop.level
    && s.signature === JSON.stringify(ps.battleInput()) && coopTempoSafe(s.outcomes, { maxLoss });
}

export function coopContinuousFiveReady(m, ps) {
  if (!scope(m, ps) || ps.shop.level !== 4 || m.round < 9 || m.round > 11 || ps.lp < 12
    || age(m, ps, 4) < 2 || !ready(m, ps)) return false;
  const b = coopProgressBoard(ps);
  return ownedLateranoCount(m, ps) >= 5 && b.distinct >= 6 && b.natives >= 4 && b.mostima != null
    && b.carry != null && b.tank != null && b.healer != null;
}

export function coopProgressDecision(m, ps) {
  if (!scope(m, ps) || m.round >= m.gd.bossRound) return { target: null, hold: false, reason: null };
  if (ps.shop.level === 3 && m.round >= 5 && m.round <= 6 && ps.lp >= 18 && age(m, ps, 3) >= 2 && ready(m, ps)) {
    const b = coopProgressBoard(ps);
    if (b.distinct >= 4 && b.natives >= 3 && b.front && b.ranged && b.tierThreeCarry)
      return { target: 4, hold: false, reason: 'three-window-complete' };
  }
  if (ps.shop.level === 4 && m.round >= 9 && m.round <= 10 && ps.lp >= 12 && age(m, ps, 4) === 2
    && ordinaryPair(ps, ids.mostima) && ready(m, ps))
    return { target: 4, hold: true, reason: 'bounded-mostima-pair' };
  if (ps.shop.level === 5 && ownedLateranoCount(m, ps) >= 6) {
    if (m.round === 11 && ps.lp >= 12 && ready(m, ps, 0)) {
      const b = coopProgressBoard(ps);
      if (b.mostimaElite && (ps.bonds[CORE]?.count || 0) >= 6 && b.carry != null && b.tank != null && b.healer != null)
        return { target: 6, hold: false, reason: 'mature-six-access' };
    }
    // A real Saint pair gets at most R12 only on a safe board without an acquired tier-six native carry.
    if (m.round === 12) {
      if (ordinaryPair(ps, ids.executorAlter) && !ownsSixCarry(ps) && ps.lp >= 12 && ready(m, ps))
        return { target: 5, hold: true, reason: 'bounded-saint-pair' };
      return { target: 6, hold: false, reason: 'six-access-before-finale' };
    }
  }
  return { target: null, hold: false, reason: null };
}

function* probeSteps(m, ps, h) {
  if (!scope(m, ps) || !m.wave || m.botRehearsal < 3 || ps.lp < 12
    || !(ps.shop.level === 3 && m.round >= 5 && m.round <= 6
      || ps.shop.level === 4 && m.round >= 9 && m.round <= 11 || ps.shop.level === 5 && (m.round === 11
        || m.round === 12 && ordinaryPair(ps, ids.executorAlter) && !ownsSixCarry(ps)))) return;
  const plan = new h.LayoutPlan(); plan.lineup = field(ps);
  if (plan.lineup.length < 4) return;
  for (const p of plan.lineup) { plan.set(p.uid, ps.find(p.uid).key); plan.dirs.set(p.uid, p.dir); }
  const signature = JSON.stringify(ps.battleInput()), round = m.round, level = ps.shop.level;
  function* inputSteps() { yield; return ps.battleInput(); }
  const job = yield* createForecastSteps(m, ps, plan.lineup, [plan], inputSteps, {
    forecastReadinessOnly: true, forecastContext: () => ({}),
    observeForecast: (_battle, _ctx, plan) => pp => coopEntryState(ps, plan, pp), selectForecast: () => ({ index: 0 }),
  });
  if (!job) return; while (!job.run(4)) yield;
  if (m.round !== round || ps.shop.level !== level || JSON.stringify(ps.battleInput()) !== signature) return;
  ps._botCoopProgress = { round: m.round, level: ps.shop.level, signature, outcomes: job.outcomes };
  (ps._botCoopProgressHistory ||= []).push({ ...ps._botCoopProgress, board: coopProgressBoard(ps),
    age: age(m, ps, ps.shop.level), decision: coopProgressDecision(m, ps), matureFive: coopContinuousFiveReady(m, ps) });
}

/** Replace only the four economic closures needed to give the existing five-member gate a deployed-board predicate. */
export function withLateranoCoopProgression(recipe, matureEconomy) {
  const gates = Object.freeze({ ...recipe, ...Object.fromEntries(['levelTarget', 'beforeUpgrade', 'priorityLevel', 'spendReserve']
    .map(key => [key, (m, ps, ...args) => (scope(m, ps) ? matureEconomy : recipe)[key](m, ps, ...args)])) });
  const low = withLateranoCoopEarlyInvestment(gates);
  return Object.freeze({ ...low,
    observeSpend(m, ps) {
      const settle = recipe.observeSpend?.(m, ps), level = ps.shop.level;
      return () => { settle?.(); if (scope(m, ps) && ps.shop.level !== level) (ps._botCoopTierAt ||= {})[ps.shop.level] = m.round; };
    },
    *beforeEconomySteps(m, ps, h) {
      if (scope(m, ps)) (ps._botCoopTierAt ||= {})[ps.shop.level] ??= m.round;
      if (low.beforeEconomySteps) yield* low.beforeEconomySteps(m, ps, h);
      yield* probeSteps(m, ps, h);
    },
    levelTarget(m, ps, options) { return coopProgressDecision(m, ps).target ?? low.levelTarget(m, ps, options); },
    beforeUpgrade(m, ps, plan) { return !coopProgressDecision(m, ps).hold && low.beforeUpgrade(m, ps, plan); },
    priorityLevel(m, ps) {
      const d = coopProgressDecision(m, ps);
      return !d.hold && (d.target != null && d.target > ps.shop.level || low.priorityLevel(m, ps));
    },
    spendReserve(m, ps) {
      const d = coopProgressDecision(m, ps);
      if (d.hold) return 0;
      if (d.target != null && d.target > ps.shop.level)
        return ps.funds >= ps.shop.upgradePrice + low.upgradeReserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
      return low.spendReserve(m, ps);
    },
  });
}
