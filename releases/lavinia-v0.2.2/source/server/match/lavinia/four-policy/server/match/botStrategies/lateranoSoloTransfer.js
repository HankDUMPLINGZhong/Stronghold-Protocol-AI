// [ASSUMED] Three independent solo experiments over team28. No default, co-op or game-rule changes.
// Public geometry proposes complete role assignments; common forecasts alone select actual formations.
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput, developmentContext, observeDevelopment } from '../botLateranoDevelopment.js';
import { acceptsHealing, healingTiles } from '../botPositioning.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { roleAllocationBeam } from './lateranoCoopAtomicWindow.js';
import { coopRescueMimicTarget, allCoopForecastsFatal } from './lateranoCoopRescue.js';
import { coopRecruitTarget } from './lateranoCoopUnusedFactors.js';
import { recruitRecoveryPlans } from './lateranoCoopRecruitRecovery.js';
import { lateranoKeyLiquidityPlan, withLateranoKeyLiquidity } from './lateranoKeyLiquidity.js';
import { LATERANO_KEY_VALUATION } from './lateranoKeyValue.js';
import { selectFinalSwap } from './lateranoFinalSwap.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const CORE = 'lateranoShip', MIMIC = 'chess_item_5_05_e_a';
const RECRUIT = new Set(['chess_item_2_06_e_a', 'chess_item_4_01_e_a', 'chess_item_5_04_e_a']);
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
const scoped = (m, ps) => m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE && m.botRehearsal >= 3;
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const inventory = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');
const stamp = (m, ps) => JSON.stringify([m.round, m.phase, ps.lp, ps.funds, ps.round.spent, ps.round.refreshes,
  ps.battleInput(), ps.hand, ps.temp, ps.shop.slots]);

export const SOLO_TRANSFER_LIMITS = Object.freeze({ roleSteps: 300_000, recoverySteps: 240_000, roleMs: 30_000, recoveryMs: 10_000 });

/** Only current PREP_FIN changes; no new next-prep valuation, economic action or actual settlement. */
export function withSoloPrepFinProjection(parent) {
  return Object.freeze({ ...parent, soloNativePrepFinProjection: true });
}

/** A role-aware whole-lineup score, not an assumed damage result. Stationary bodies and moving paths differ. */
export function soloRoleValue(layout, ctx, family) {
  const { info, guards, skillActive, diagonal, bossId } = ctx;
  let score = 0;
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i], u = info[i], w = u.weight;
    const healed = layout.some((q, j) => info[j].heal && q.heal.has(p.key));
    const aura = skillActive && layout.some((q, j) => info[j].skill && (diagonal
      ? Math.max(Math.abs(q.r - p.r), Math.abs(q.c - p.c)) <= 1 : Math.abs(q.r - p.r) + Math.abs(q.c - p.c) <= 1));
    if (u.damage) score += w * (p.contact > 0 ? 12 + p.contact * (family === 'contact' ? 55 : 30) : -35);
    if (u.healable) score += w * (healed ? family === 'healing' ? 20 : 9 : u.primary || u.tank ? -18 : -2);
    if (aura && u.damage) score += w * 6;
    if ((u.heal || u.primary) && family === 'safety') score -= w * p.threat * 22;
    // Actual guards must meet a real tank before a healer/carry. Saint is not classified as a tank.
    for (const rt of guards) {
      const at = rt.tiles.indexOf(p.key); if (at < 0 || u.tank) continue;
      const covered = layout.some((q, j) => info[j].tank && rt.tiles.indexOf(q.key) >= 0 && rt.tiles.indexOf(q.key) < at);
      if (!covered) score -= rt.weight * w * (u.heal ? 25 : 12);
    }
    for (let j = i + 1; j < layout.length; j++) {
      if (!(u.primary || u.heal) || !(info[j].primary || info[j].heal)) continue;
      const q = layout[j], d = Math.max(Math.abs(q.r - p.r), Math.abs(q.c - p.c));
      if (bossId === 'boss_7' && p.c === q.c) score -= Math.min(w, info[j].weight) * 20;
      if (['boss_1', 'boss_6'].includes(bossId) && d <= 1) score -= Math.min(w, info[j].weight) * 15;
    }
  }
  return score;
}

/** Keep different whole-team role assignments, rather than spending the beam on duplicate directions. */
export function* soloRolePlans(m, ps, h, recipe) {
  const original = bossFormationSnapshot(ps, h), result = [original];
  if (!scoped(m, ps) || m.wave || m.round !== m.gd.bossRound || original.lineup.length < 3) return result;
  const model = h.fieldModel(m, ps), heat = new Map();
  const bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  if (bodies.size) for (const key of bodies) heat.set(key, 1);
  else for (const rt of model.routes.filter(r => !r.fallback && r.dwell > 0))
    for (const key of rt.tiles) heat.set(key, (heat.get(key) || 0) + rt.tileTime);
  const total = [...heat.values()].reduce((s, n) => s + n, 0); if (!total) return result;
  const nodes = [...heat].map(([key, n]) => { const [r, c] = key.split(',').map(Number); return { key, r, c, weight: n / total }; });
  const guards = model.routes.filter(r => !r.fallback && !r.fly && !r.dwell && r.n > 0);
  const guardTotal = guards.reduce((s, r) => s + r.n, 0) || 1;
  const info = original.lineup.map(u => {
    const rec = h.rangeRec(ps, ps.gd.chess(u.id)), id = ps.gd.baseIdOf(u.id), heal = healer(rec);
    const primary = [recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto, recipe.ids.executorAlter].includes(id);
    const tank = rec.profession === 'TANK' && (rec.stats?.blockCnt || 0) > 0;
    return { u, rec, heal, primary, tank, healable: acceptsHealing(rec), skill: pieceBonds(ps.gd, u).includes('skillfulShip'),
      damage: !['heal', 'none'].includes(rec.attackKind) && rec.subProfessionId !== 'bard',
      weight: (primary ? 9 : heal ? 5 : tank ? 1 : Math.max(1, rec.tier / 2)) * (ps.gd.isGolden(u.id) ? 1.25 : 1) };
  }).sort((a, b) => Number(b.tank) - Number(a.tank) || Number(b.heal) - Number(a.heal)
    || Number(b.primary) - Number(a.primary) || a.u.uid - b.u.uid);
  const owners = new Set([...ps.board.values()].filter(u => u.kind === 'token').map(u => u.ownerUid));
  const occupied = new Set([...ps.board].filter(([, u]) => u.kind !== 'chess').map(([k]) => k));
  const options = info.map(({ u, rec, heal }) => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      const key = `${r},${c}`; if (occupied.has(key) || !ps._legal(u, r, c)) continue;
      for (const dir of DIRS) {
        if (owners.has(u.uid) && (original.get(u.uid) !== key || original.dirs.get(u.uid) !== dir)) continue;
        const cover = new Set(h.rangeTiles(rec, r, c, dir));
        out.push({ key, r, c, dir, cover, heal: heal ? healingTiles(rec, r, c, dir) : null,
          contact: nodes.reduce((s, n) => s + (cover.has(n.key) ? n.weight : 0), 0),
          threat: nodes.reduce((s, n) => s + (Math.max(Math.abs(r - n.r), Math.abs(c - n.c)) <= 1 ? n.weight : 0), 0) });
      }
    }
    return out;
  });
  const ctx = { info, guards: guards.map(r => ({ ...r, weight: r.n / guardTotal })), bossId: m.bossId,
    skillActive: !!ps.bonds.skillfulShip?.active, diagonal: (ps.bonds.skillfulShip?.layers || 0) >= 40 };
  const windows = [];
  for (const [height, width] of [[4, 2], [2, 4], [4, 4]]) {
    const group = [];
    for (let r = 9; r <= 13 - height; r++) for (let c = 2; c <= 11 - width; c++) {
      const opts = options.map(rows => rows.filter(p => p.r >= r && p.r < r + height && p.c >= c && p.c < c + width));
      if (opts.some(o => !o.length)) continue;
      const contact = opts.reduce((s, rows, i) => s + info[i].weight * Math.max(...rows.map(p => p.contact)), 0);
      group.push({ r, c, height, width, opts, contact });
    }
    // A geometric shortlist only; common independent battle samples still decide the final plan.
    group.sort((a, b) => b.contact - a.contact || a.c - b.c || a.r - b.r); windows.push(...group.slice(0, 8));
  }
  const seen = new Set([signature(original)]);
  for (const family of ['balanced', 'healing', 'contact', 'safety']) {
    let best = null;
    for (const window of windows) {
      let beam = [{ layout: [], score: 0 }];
      for (let i = 0; i < info.length && beam.length; i++) {
        const next = [], partialCtx = { ...ctx, info: info.slice(0, i + 1) };
        for (const row of beam) for (const p of window.opts[i]) {
          if (row.layout.some(q => q.key === p.key)) continue;
          const layout = [...row.layout, p]; next.push({ layout, score: soloRoleValue(layout, partialCtx, family) });
        }
        next.sort((a, b) => b.score - a.score); beam = roleAllocationBeam(next, partialCtx.info); yield;
      }
      if (!beam.length) continue;
      if (!best || beam[0].score > best.score) best = { ...beam[0], window };
    }
    if (!best) continue;
    const plan = new h.LayoutPlan(); plan.lineup = original.lineup;
    best.layout.forEach((p, i) => { plan.set(info[i].u.uid, p.key); plan.dirs.set(info[i].u.uid, p.dir); });
    if (seen.has(signature(plan))) continue; seen.add(signature(plan));
    plan.soloRoles = { family, score: best.score, row: best.window.r, col: best.window.c,
      height: best.window.height, width: best.window.width }; result.push(plan);
  }
  return result;
}

function budget(m, ps, start, wallMs, maxSteps, before) {
  const audit = { steps: 0, reason: '' };
  audit.expired = () => {
    if (stamp(m, ps) !== before) audit.reason = 'own-state-changed';
    else if (audit.steps >= maxSteps) audit.reason = 'field-step-budget';
    else if (!m.sched.virtual && performance.now() - start >= wallMs) audit.reason = 'wall-budget';
    else if (!m.sched.virtual && Number.isFinite(m.deadline) && m.deadline - m.sched.now() < 1000) audit.reason = 'prep-deadline';
    return !!audit.reason;
  };
  return audit;
}

export function withSoloRoleAllocation(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    const start = performance.now();
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!scoped(m, ps) || m.wave || m.round !== m.gd.bossRound) return;
    const before = stamp(m, ps), audit = budget(m, ps, start, SOLO_TRANSFER_LIMITS.roleMs, SOLO_TRANSFER_LIMITS.roleSteps, before);
    const generator = soloRolePlans(m, ps, h, parent); let generated;
    while (true) {
      if (audit.expired()) return;
      const step = generator.next(); if (step.done) { generated = step.value; break; } yield;
    }
    let best = generated[0]; const batches = [];
    for (let i = 1; i < generated.length && !audit.expired(); i += 2) {
      const plans = [best, ...generated.slice(i, i + 2)];
      function* input(plan) { yield; return stealthBattleInput(ps, plan); }
      const job = yield* createForecastSteps(m, ps, best.lineup, plans, input, {
        forecastSamples: 10, forecastContext: () => ({ samples: 10, aggregate: true }),
        observeForecast: battle => { battle.on('tick', () => { audit.steps++; }); return () => ({}); }, selectForecast: selectFinalSwap,
      });
      if (!job) break;
      while (!job.run(4)) { if (audit.expired()) break; yield; }
      if (!job.done || audit.expired()) break;
      best = job.best; batches.push({ selected: job.bestIndex, outcomes: job.outcomes });
    }
    const changed = signature(best) !== signature(generated[0]);
    if (stamp(m, ps) === before && changed) {
      const input = stealthBattleInput(ps, best); applyControlPositions(ps, best);
      if (JSON.stringify(input) !== JSON.stringify(ps.battleInput())) throw Error('Solo role input differs from applied plan');
    }
    (ps._botSoloTransferHistory ||= []).push({ factor: 'roles', round: m.round, changed, steps: audit.steps, reason: audit.reason,
      ms: performance.now() - start, generated: generated.length, plans: generated.map(p => ({ family: p.soloRoles,
        positions: [...p], dirs: [...p.dirs] })), batches });
  } });
}

/** Normal forecasts keep defense first; an emergency tie never displaces the incumbent. */
export function selectSoloRecovery(entries) {
  const valid = rows => rows.length === 2 && rows.every((r, i) => r.valid && r.sample === i && Number.isFinite(r.lost) && Number.isFinite(r.leaks));
  const score = rows => [Math.max(...rows.map(r => r.lost)), rows.reduce((s, r) => s + r.lost, 0),
    Math.max(...rows.map(r => r.leaks)), rows.reduce((s, r) => s + r.leaks, 0), rows.reduce((s, r) => s + r.deaths, 0)];
  const better = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };
  if (!entries.length || !valid(entries[0].outcomes)) return 0;
  let index = 0;
  for (let i = 1; i < entries.length; i++) if (valid(entries[i].outcomes)
    && better(score(entries[i].outcomes), score(entries[index].outcomes))) index = i;
  return index;
}

const valuation = Object.freeze({ ...LATERANO_KEY_VALUATION, accept(m, ps, recipe, plan) {
  LATERANO_KEY_VALUATION.accept(m, ps, recipe, plan);
  return plan.valuation.value > 0 && plan.valuation.value >= plan.valuation.cost;
} });

/** One bounded rescue per normal round: all fresh alternatives must predict elimination before spending. */
export function withSoloEmergencyRecovery(parent) {
  const funded = withLateranoKeyLiquidity(parent, valuation);
  return Object.freeze({ ...parent,
    trade(m, ps, ...xs) { return ps._botSoloEmergencyActive ? funded.trade(m, ps, ...xs) : parent.trade(m, ps, ...xs); },
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!scoped(m, ps) || !m.wave || m.round >= m.gd.bossRound || ps._botSoloEmergencyRound === m.round || !h.recoverEconomySteps) return;
      const recruit = () => ps.shop.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot?.kind === 'item' && !slot.sold
        && RECRUIT.has(ps.gd.baseIdOf(slot.id)) && ps.priceOf(slot) <= ps.funds && coopRecruitTarget(m, ps, parent, slot));
      const mimic = () => inventory(ps).find(i => ps.gd.baseIdOf(i.id) === MIMIC);
      if (!(mimic() && coopRescueMimicTarget(ps)) && !recruit().length && !lateranoKeyLiquidityPlan(m, ps, parent, valuation)) return;
      const start = performance.now(), before = stamp(m, ps);
      const audit = budget(m, ps, start, SOLO_TRANSFER_LIMITS.recoveryMs, SOLO_TRANSFER_LIMITS.recoverySteps, before);
      const history = { factor: 'emergency', round: m.round, actions: [], batches: [], applied: false };
      (ps._botSoloTransferHistory ||= []).push(history);
      function* evaluate(plans) {
        function* input(plan) { yield; return stealthBattleInput(ps, plan); }
        const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, input, {
          forecastReadinessOnly: true,
          prepareForecastInput: (m, ps, _chosen, p, input) => prepareDevelopmentInput(m, ps, p.lineup, p, input),
          forecastContext: () => developmentContext(m, ps, plans[0].lineup, plans, parent),
          observeForecast: (battle, ctx, plan) => {
            battle.on('tick', () => { audit.steps++; }); return observeDevelopment(battle, ctx, plan);
          }, selectForecast: () => ({ index: 0 }),
        });
        if (!job) return null;
        while (!job.run(4)) { if (audit.expired()) return null; yield; }
        if (audit.expired()) return null;
        const entries = plans.map((plan, i) => ({ plan, outcomes: job.outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample) }));
        history.batches.push(job.outcomes); return entries;
      }
      try {
        const original = bossFormationSnapshot(ps, h); if (!original.lineup.length) return;
        let entries = yield* evaluate([original]);
        if (!entries || !allCoopForecastsFatal(entries[0].outcomes, ps.lp)) { history.reason = 'not-fatal'; return; }
        const alternatives = [];
        for (const p of recruitRecoveryPlans(m, ps, h, parent, 8)) if (signature(p) !== signature(original)) alternatives.push(p);
        if (alternatives.length) {
          const next = yield* evaluate(alternatives); if (!next) return; entries.push(...next);
        }
        if (!entries.every(e => allCoopForecastsFatal(e.outcomes, ps.lp))) { history.reason = 'surviving-alternative'; return; }
        ps._botSoloEmergencyRound = m.round;
        const item = mimic(), target = item && coopRescueMimicTarget(ps);
        if (target) history.actions.push({ kind: 'mimic', id: target.id, used: !!ps.equip(item.uid, target.uid)?.ok });
        // Only visible real recruitment items are bought, never an extra reroll or speculative resource.
        if (!target && ps.hand.some(p => !p)) for (const { slot, index } of recruit()) {
          const recipient = coopRecruitTarget(m, ps, parent, slot); if (!recipient) continue;
          const owned = new Set(inventory(ps).map(p => p.uid)), settled = parent.observeSpend?.(m, ps);
          const bought = ps.buy(index); settled?.(); if (!bought?.ok) continue;
          const acquired = inventory(ps).find(p => !owned.has(p.uid) && ps.gd.baseIdOf(p.id) === ps.gd.baseIdOf(slot.id));
          history.actions.push({ kind: 'recruit', id: slot.id, target: recipient.id,
            used: !!acquired && !!ps.equip(acquired.uid, recipient.uid)?.ok }); break;
        }
        ps._botSoloEmergencyActive = true;
        try { yield* h.recoverEconomySteps(); } finally { delete ps._botSoloEmergencyActive; }
        // Re-run inherited deployment on the real newly acquired roster, then check local swaps/roles.
        if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
        history.applied = history.actions.some(a => a.used) || stamp(m, ps) !== before;
        const after = stamp(m, ps), oldExpired = audit.expired;
        audit.expired = () => {
          if (stamp(m, ps) !== after) { audit.reason = 'own-state-changed'; return true; }
          return audit.steps >= SOLO_TRANSFER_LIMITS.recoverySteps || !m.sched.virtual && performance.now() - start >= SOLO_TRANSFER_LIMITS.recoveryMs;
        };
        const current = bossFormationSnapshot(ps, h); entries = yield* evaluate([current]);
        if (!entries) return;
        const candidates = [];
        for (const p of recruitRecoveryPlans(m, ps, h, parent, 24)) if (signature(p) !== signature(current)) candidates.push(p);
        for (let i = 0; i < candidates.length && !audit.expired(); i += 2) {
          const next = yield* evaluate(candidates.slice(i, i + 2)); if (!next) break; entries.push(...next);
        }
        const selected = selectSoloRecovery(entries); history.selected = selected;
        if (selected && stamp(m, ps) === after) {
          const expected = stealthBattleInput(ps, entries[selected].plan); applyControlPositions(ps, entries[selected].plan);
          if (JSON.stringify(expected) !== JSON.stringify(ps.battleInput())) throw Error('Solo emergency input differs from applied plan');
        }
        audit.expired = oldExpired;
      } finally {
        history.steps = audit.steps; history.reason ||= audit.reason || 'complete'; history.ms = performance.now() - start;
      }
    },
  });
}
