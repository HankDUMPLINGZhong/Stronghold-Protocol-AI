// [ASSUMED] Opt-in two/four-seat R14 fixed-roster search. Common independent samples rank own Boss damage.
// Public alive/LP/band headers only; no teammate roster, actual wave or real battle seed is consulted.
import { createOrderedForecastJob } from '../../../../../../../../../aiCompute/ordered.js';
import { createForecastBattle } from '../../../../../../../../../aiCompute/forecast.js';
import { SharedBossPool, bossPoolHp } from '../../../../../../../../../finalAssault.js';
import { createRng, deriveSeed } from '../../../../../../../../../../sim/rng.js';
import { buildBossWave, bountySpawns } from '../../../../../../../../../waves.js';
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { legalTiles, placeClass, pieceDir } from '../../../../../../../../../board.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { GEO } from '../../../../../../../../../../../shared/constants.js';
import { projectBossPrepFinish } from './lateranoCoopBossPrepFinish.js';
import { selectCoopSelfDamage, ownDamagePrefixCannotBeat } from './lateranoCoopBossSelf.js';
import { windowProposals, windowBattleInput } from './lateranoWindowRefinement.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { SIRACUSA_BOSS_POOL_FACTORS, SIRACUSA_BOSS_POOL_COMBINED, SIRACUSA_BOSS_POOL_TWO_COMBINED, SIRACUSA_BOSS_POOL_TWO_BONDS, bossSupportProposals, bossBenchPlans, attachBossExternalDamage, selectBossPhaseSamples } from './siracusaBossPoolTrials.js';

export const SIRACUSA_BOSS_FOUR = 'boss-four-samples';
export const SIRACUSA_BOSS_LIMITS = Object.freeze({ samples: 4, fieldSteps: 1_800_000, wallMs: 30_000 });
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const eligible = (m, ps) => m.mode === 'coop' && !m.isSolo && [2, 4].includes(m.order.length) && m.difficulty === 'ABYSS'
  && !m.wave && m.round === m.gd.bossRound && m.botRehearsal >= 2
  && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip';

export function siracusaPublicBoss(m, ps) {
  const alive = m.order.filter(p => p.alive).map(p => ({ playerId: p.playerId, seat: p.seat, lp: p.lp, bandId: p.bandId }))
    .sort((a, b) => a.seat - b.seat);
  const index = alive.findIndex(p => p.playerId === ps.playerId), start = index - index % 2;
  const paired = index >= 0 && alive.slice(start, start + 2).length === 2;
  const teamLP = alive.reduce((n, p) => n + p.lp, 0), gd = ps.gd || m.gd;
  const base = (gd.bossLevelTime(m.round) || 120) * gd.combatTimeScale;
  const tail = Number.isFinite(gd.bossOvertimeAfter) && gd.bossOvertimeDrain > 0
    ? gd.bossOvertimeAfter + Math.ceil(teamLP / gd.bossOvertimeDrain) : base;
  return { alive, paired, side: paired && index % 2 ? 'R' : 'L', teamLP,
    hp: bossPoolHp(gd, m.bossId, Math.max(1, alive.length)), horizon: Math.max(base, Math.min(420, tail)) };
}

const ownStamp = (m, ps) => JSON.stringify([m.round, ps.lp, ps.funds, ps.round, ps.battleInput(), ps.hand, ps.temp,
  siracusaPublicBoss(m, ps)]);

export function siracusaBossInput(m, ps, plan, original = ps.battleInput(), model = siracusaPublicBoss(m, ps)) {
  const input = windowBattleInput(original, plan, { readingOrder: true });
  const projected = projectBossPrepFinish(ps.gd || m.gd, ps, plan, input);
  const mates = model.alive.filter(p => p.playerId !== ps.playerId).map(({ playerId, bandId }) => ({ playerId, bandId }));
  projected.input.contentInfo = { round: m.round, kind: 'boss', shopLevel: ps.shop.level, funds: ps.funds,
    handUnits: ps.hand.filter(Boolean).length, handChess: ps.hand.filter(p => p?.kind === 'chess').length,
    roundStats: { ...ps.round }, matchBands: [ps.bandId, ...mates.map(p => p.bandId)].filter(Boolean), teammates: mates };
  return projected;
}

/** Same three proposal stages as the shared window search; Siracusa proc weights, Raid launches and wolves retained. */
export function siracusaBossGeometry(m, ps, h) {
  const chosen = [...ps.board.values()].filter(p => p.kind === 'chess'), model = h.fieldModel(m, ps);
  const recs = chosen.map(p => h.rangeRec(ps, ps.gd.chess(p.id)));
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  const bb = ps.gd.bond('siracusaShip')?.bb || {}, active = ps.bonds.siracusaShip?.count >= 6;
  const info = recs.map((rec, i) => {
    const dealer = !['heal', 'none'].includes(rec.attackKind) && rec.subProfessionId !== 'bard';
    const native = pieceBonds(ps.gd, chosen[i]).includes('siracusaShip');
    const stat = rec.stats || {}, rate = (stat.aspd || 100) / (100 * Math.max(.3, stat.bat || 1.5));
    const proc = active && native ? ((bb.base_damage || 0) + (bb.damage_per_stack || 0) * (ps.layers.siracusaShip || 0)) * (bb.prob || 0) : 0;
    const healer = healingTiles(rec, 10, 5, 'RIGHT').size > 0;
    return { dealer, healer, primary: native || rec.tier >= 5, weight: dealer ? Math.max(1, ((stat.atk || 0) + proc) * rate / 400) : 4,
      healable: acceptsHealing(rec), skill: rec.bonds?.includes('skillfulShip'), mostima: false, ammo: false,
      front: rec.position === 'MELEE' && (stat.blockCnt || 0) > 0, air: !!rec.canHitFly };
  });
  const ctx = { info, routes: model.routes.filter(r => !r.fallback && r.n > 0), bodies: model.bossBodies.flatMap(b => b.tiles),
    normal: false, bossId: m.bossId, skillActive: !!ps.bonds.skillfulShip?.active, diagonal: (ps.layers.skillfulShip || 0) >= 40 };
  const options = chosen.map((piece, i) => {
    const current = ps.find(piece.uid), raid = pieceBonds(ps.gd, piece).includes('raidShip');
    const pinned = owners.has(piece.uid) || raid && ps.bonds.raidShip?.active;
    const out = [];
    for (const [r, c] of legalTiles(ps.deployMap(), placeClass(ps, ps.gd.chess(piece.id)))) {
      const key = `${r},${c}`; if (reserved.has(key) || !ps._legal(piece, r, c) || pinned && key !== current.key) continue;
      for (const dir of DIRS) {
        if (pinned && dir !== pieceDir(piece) || raid && dir !== 'RIGHT' && dir !== pieceDir(piece)) continue;
        out.push({ key, r, c, dir, cover: new Set(h.rangeTiles(recs[i], r, c, dir)), heal: healingTiles(recs[i], r, c, dir) });
      }
    }
    return out;
  });
  const current = chosen.map((p, i) => options[i].find(o => o.key === ps.find(p.uid).key && o.dir === pieceDir(p)));
  const planOf = layout => { const p = new h.LayoutPlan(); p.lineup = chosen;
    layout.forEach((o, i) => { p.set(chosen[i].uid, o.key); p.dirs.set(chosen[i].uid, o.dir); }); return p; };
  return { chosen, ctx, options, current, planOf };
}

export function siracusaBossSpec(m, ps, input, pool, sample, session) {
  const { model, wave } = session, side = model.side;
  const own = { ...structuredClone(input), side, colOffset: side === 'R' ? 8 : 0, lpForBoss: Math.max(1, model.teamLP) };
  const players = [own];
  if (model.paired) {
    const empty = { playerId: 'sb:empty-side', side: side === 'L' ? 'R' : 'L', colOffset: side === 'L' ? 8 : 0,
      units: [], bonds: {}, playerEffects: [] };
    if (side === 'L') players.push(empty); else players.unshift(empty);
  }
  const spawns = structuredClone(wave.spawns);
  spawns.push(...bountySpawns(m.gd, m.round, wave, ps.bounties, ps.playerId, { solo: false, side }));
  return { seed: deriveSeed(m.seed, `coop-self-boss:${m.round}:${sample}`), kind: 'boss', modeId: m.modeId,
    round: m.round, stageId: m.stageId, rect: { ...GEO.BOSS_RECT }, timeLimit: model.horizon,
    players, spawns: m._sanitizeSpawns(spawns), routes: wave.routes, sharedBoss: pool,
    flags: { layerGainsEnabled: false, ...m.gd.dp, enemyScale: m.gd.enemyScale(m.round) },
    fieldId: 'sb:0', enemyOverrides: wave.overrides, waveId: wave.templateId, bossId: m.bossId };
}

export function* siracusaBossSearch(m, ps, h, limits = SIRACUSA_BOSS_LIMITS, factor = SIRACUSA_BOSS_FOUR) {
  const preserveBonds = factor === SIRACUSA_BOSS_POOL_TWO_BONDS;
  const combined = factor === SIRACUSA_BOSS_POOL_COMBINED || factor === SIRACUSA_BOSS_POOL_TWO_COMBINED || preserveBonds;
  const bench = factor === SIRACUSA_BOSS_POOL_FACTORS[1] || combined;
  const phase = factor === SIRACUSA_BOSS_POOL_FACTORS[2] || combined;
  const requiredBonds = preserveBonds ? Object.keys(ps.bonds).filter(id => ps.bonds[id]?.active) : [];
  const started = performance.now(), stamp = ownStamp(m, ps), original = ps.battleInput(), model = siracusaPublicBoss(m, ps);
  const s = { m, started, limits, model, steps: 0, cache: new Map(), hits: 0, simulated: 0, comparisons: 0, pruned: 0, reason: null,
    wave: buildBossWave(m.gd, createRng(deriveSeed(m.seed, `coop-self-wave:${m.round}`)), m.factions, m.round, { bossId: m.bossId, solo: !model.paired }) };
  const geometry = siracusaBossGeometry(m, ps, h), { options, ctx, planOf } = geometry;
  if (geometry.current.some(p => !p) || geometry.chosen.length < 2) return;
  let current = geometry.current, rosterPlan = null, changed = false, cancelled = true;
  const audit = { round: m.round, factor, samples: limits.samples, model,
    ...(preserveBonds ? { protectedBonds: requiredBonds } : {}),
    entering: [...planOf(current)].map(([uid, key]) => ({ uid, key, dir: planOf(current).dirs.get(uid) })), batches: [] };
  const expired = () => {
    if (s.steps >= limits.fieldSteps) s.reason ||= 'field-step-budget';
    if (!m.sched.virtual && performance.now() - started >= limits.wallMs) s.reason ||= 'wall-budget';
    return !!s.reason;
  };
  try {
    const stages = ['facing', 'near', 'reposition', ...(factor === SIRACUSA_BOSS_POOL_FACTORS[0] ? ['support'] : bench ? ['bench'] : [])];
    for (const stage of stages) {
      if (expired()) break;
      const proposals = stage === 'support' ? bossSupportProposals(ps, h, geometry, current)
        : stage === 'bench' ? bossBenchPlans(ps, h, planOf(current), { preserveActive: preserveBonds }) : windowProposals(current, options, ctx, stage);
      if (!proposals.length) continue;
      const candidates = [current, ...proposals.map(p => p.layout)], plans = stage === 'bench' ? [planOf(current), ...proposals] : candidates.map(planOf);
      const inputs = [], entries = [], gains = [];
      for (const plan of plans) {
        const projected = siracusaBossInput(m, ps, plan, plan.bossOriginalInput || original, model), key = JSON.stringify(projected.input);
        if (!s.cache.has(key)) s.cache.set(key, new Map()); entries.push(s.cache.get(key)); inputs.push(projected.input); gains.push(projected.gains); yield;
      }
      const job = createOrderedForecastJob({ match: m, player: ps, session: s, plans, samples: limits.samples, inputs, entries,
        shared: plans.map(() => undefined), stamp, hp: model.hp, cap: Math.ceil(model.horizon * 30),
        key: () => ownStamp(m, ps), expired, makeSpec: (input, sample) => siracusaBossSpec(m, ps, input, null, sample, s),
        field: (input, pool, sample) => {
          const battle = createForecastBattle(m, siracusaBossSpec(m, ps, input, pool, sample, s));
          return phase ? attachBossExternalDamage(battle, pool, model, sample) : battle;
        },
        makePool: () => new SharedBossPool(model.hp), select: rows => phase
          ? selectBossPhaseSamples(plans, rows, limits.samples) : selectCoopSelfDamage(plans, rows, limits.samples),
        cannotBeat: (rows, incumbent) => phase ? rows.some(r => !r.valid)
          : ownDamagePrefixCannotBeat(rows, incumbent, limits.samples, model.hp),
        validWorkerRow: row => Number.isFinite(row.bossDamage) && Number.isFinite(row.elapsed),
        project: (battle, pool) => { const result = battle.result(), pp = result.perPlayer?.[ps.playerId];
          return { valid: !battle.errorCount && !result.synthetic && !result.errors,
            bossDamage: pool.byPlayer.get(ps.playerId) || 0, elapsed: battle.time,
            ...(phase ? { poolLeft: pool.hp } : {}),
            leaks: (pp?.leaked || []).filter(l => l.counted !== false).length, damage: pp?.damageDealt || 0, deaths: pp?.deaths || 0 };
        }, label: 'Siracusa Boss' });
      try { while (!job.run(4)) yield; } finally { job.cancel(); }
      audit.batches.push({ stage, index: job.bestIndex, stale: job.stale, outcomes: job.outcomes, pruned: job.pruned, gains,
        plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
      if (job.stale) { s.reason = 'own-state-changed'; return; }
      if (stage === 'bench') rosterPlan = job.bestIndex ? plans[job.bestIndex] : null;
      else current = candidates[job.bestIndex];
      changed ||= job.bestIndex > 0;
    }
    if (ownStamp(m, ps) !== stamp) { s.reason = 'own-state-changed'; return; }
    changed = !!rosterPlan || current.some((o, i) => o.key !== geometry.current[i].key || o.dir !== geometry.current[i].dir);
    // Applying no movement at all preserves the original board's insertion/token history exactly.
    if (changed) {
      const plan = rosterPlan || planOf(current), expected = windowBattleInput(plan.bossOriginalInput || original, plan, { readingOrder: true });
      if (plan.bossSwap) {
        applyControlPositions(ps, plan.bossSwap.basePlan);
        const [row, col] = plan.get(plan.bossSwap.incoming).split(',').map(Number);
        const result = ps.move(plan.bossSwap.incoming, { area: 'board', row, col }, plan.dirs.get(plan.bossSwap.incoming));
        if (!result?.ok) throw Error('Siracusa Boss owned-bench swap rejected');
        if ((ps.bonds.siracusaShip?.count || 0) < 6) throw Error('Siracusa Boss bench lost six natives');
      }
      applyControlPositions(ps, plan);
      if (requiredBonds.some(id => !ps.bonds[id]?.active)) throw Error('Siracusa Boss protected bond became inactive');
      if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Siracusa Boss plan differs from forecast positions');
    }
    cancelled = false;
  } finally {
    Object.assign(audit, { changed: !cancelled && changed, cancelled, reason: s.reason, steps: s.steps, simulatedSamples: s.simulated,
      cachedSamples: s.hits, comparisons: s.comparisons, prunedCandidates: s.pruned, ms: performance.now() - started,
      limits: { ...limits }, positions: [...(rosterPlan || planOf(current))].map(([uid, key]) => ({ uid, key, dir: (rosterPlan || planOf(current)).dirs.get(uid) })) });
    (ps._botSiracusaBossHistory ||= []).push(audit);
  }
}

const cache = new WeakMap();
export function withSiracusaCoopBossForecast(parent, factor) {
  if (factor == null || factor === false) return parent;
  const two = factor === SIRACUSA_BOSS_POOL_TWO_COMBINED || factor === SIRACUSA_BOSS_POOL_TWO_BONDS;
  if (factor !== SIRACUSA_BOSS_FOUR && factor !== SIRACUSA_BOSS_POOL_COMBINED && !two && !SIRACUSA_BOSS_POOL_FACTORS.includes(factor)) throw Error('Unknown Siracusa Boss trial');
  if (!cache.has(parent)) cache.set(parent, new Map());
  const recipes = cache.get(parent);
  if (!recipes.has(factor)) recipes.set(factor, Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (eligible(m, ps) && (factor === SIRACUSA_BOSS_FOUR || (two ? m.order.length === 2 : m.order.length === 4))) yield* siracusaBossSearch(m, ps, h, SIRACUSA_BOSS_LIMITS, factor);
    else if (eligible(m, ps)) yield* siracusaBossSearch(m, ps, h);
  } }));
  return recipes.get(factor);
}
