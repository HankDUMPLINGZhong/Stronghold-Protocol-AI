// [ASSUMED] Lucien fixed-roster whole-window candidates. No purchasing, saved layouts or actual combat seeds.
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { mobileBossValue } from './lateranoMobileBoss.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { withLateranoCoopBossSelf } from './lateranoCoopBossSelf.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';
import { applyCoopRolePlan } from './lateranoCoopRoles.js';

const DIRS = ['RIGHT', 'DOWN', 'UP', 'LEFT'];
const eligible = m => m.mode === 'coop' && !m.isSolo && !m.wave && m.bossId === 'boss_5'
  && m.round === m.gd.bossRound && m.botRehearsal >= 3;
const signature = p => [...p].map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');

/** Keep distinct tank/healer/carry assignments inside a window, before forecasting the complete layouts. */
export function roleAllocationBeam(rows, info, maximum = 24) {
  const key = row => row.layout.map((p, i) => info[i].tank || info[i].heal || info[i].primary
    ? `${i}:${p.key}:${info[i].heal ? p.dir : ''}` : '').filter(Boolean).join('|');
  const result = [], seen = new Set();
  for (const row of rows) if (!seen.has(key(row))) {
    seen.add(key(row)); result.push(row); if (result.length === maximum) return result;
  }
  for (const row of rows) if (!result.includes(row)) {
    result.push(row); if (result.length === maximum) break;
  }
  return result;
}

function allocationValue(layout, ctx, family) {
  let value = mobileBossValue(layout, ctx);
  for (let i = 0; i < layout.length; i++) {
    const u = ctx.info[i], p = layout[i];
    const healed = layout.some((q, j) => ctx.info[j].heal && q.heal.has(p.key));
    if (family === 'healing' && u.healable) value += u.weight * (healed ? 15 : u.primary || u.tank ? -25 : -3);
    if (family === 'contact' && u.primary) value += u.weight * p.contact * 35;
    if (family === 'safety' && (u.heal || u.primary)) value -= u.weight * p.threat * 24;
  }
  return value;
}

/** Each translated rectangle gets its own bounded simultaneous assignment beam, preserving role diversity. */
export function* coopAtomicWindowPlans(m, ps, h, recipe, { roleDiversity = false } = {}) {
  const original = bossFormationSnapshot(ps, h), offered = [];
  if (!eligible(m) || original.lineup.length < 3) return [original];
  const model = h.fieldModel(m, ps), heat = new Map();
  for (const rt of model.routes.filter(rt => !rt.fallback && rt.dwell > 0))
    for (const k of rt.tiles) heat.set(k, (heat.get(k) || 0) + rt.tileTime);
  const total = [...heat.values()].reduce((n, v) => n + v, 0);
  if (!total) return [original];
  const nodes = [...heat].map(([key, weight]) => {
    const [r, c] = key.split(',').map(Number); return { key, r, c, weight: weight / total };
  });
  const rec = u => h.rangeRec(ps, ps.gd.chess(u.id));
  const healRange = ps._botCoopHealingRange || healingTiles;
  const units = original.lineup.map(u => {
    const r = rec(u), base = ps.gd.baseIdOf(u.id);
    const heal = r.attackKind === 'heal' || r.subProfessionId === 'incantationmedic';
    return { u, rec: r, heal, tank: r.profession === 'TANK', def: r.stats?.def || 0,
      healable: acceptsHealing(r), skill: r.bonds?.includes('skillfulShip'),
      primary: [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(base),
      weight: heal ? 5 : ([recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(base) ? 9
        : base === recipe.ids.faith ? .5 : Math.max(1, r.tier / 2)) * (ps.gd.isGolden(u.id) ? 1.25 : 1) };
  }).sort((a, b) => Number(b.tank) - Number(a.tank) || (a.tank ? b.def - a.def : Number(b.heal) - Number(a.heal)
    || Number(b.primary) - Number(a.primary)) || a.u.uid - b.u.uid);
  const tokens = new Set([...ps.board].filter(([, u]) => u.kind !== 'chess').map(([k]) => k));
  const owners = new Set([...ps.board.values()].filter(u => u.kind === 'token').map(u => u.ownerUid));
  const options = units.map(({ u, rec: r, heal }) => {
    const out = [];
    for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
      const key = `${row},${col}`;
      if (tokens.has(key) || !ps._legal(u, row, col)) continue;
      for (const dir of DIRS) {
        if (owners.has(u.uid) && (original.get(u.uid) !== key || u.dir !== dir)) continue;
        const cover = new Set(h.rangeTiles(r, row, col, dir));
        out.push({ key, r: row, c: col, dir, cover, heal: heal ? healRange(r, row, col, dir) : null,
          contact: nodes.reduce((s, n) => s + (cover.has(n.key) ? n.weight : 0), 0),
          threat: nodes.reduce((s, n) => s + ((row - n.r) ** 2 + (col - n.c) ** 2 <= 4 ? n.weight : 0), 0) });
      }
    }
    return out;
  });
  const contexts = units.map((_, i) => ({ info: units.slice(0, i + 1), nodes, anchor: 0, kind: m.bossId,
    skillActive: !!ps.bonds.skillfulShip?.active, diagonal: (ps.bonds.skillfulShip?.layers || 0) >= 40 }));
  const families = roleDiversity ? ['balanced', 'healing', 'contact', 'safety'] : ['balanced'];
  for (const family of families) for (const [height, width] of [[4, 2], [2, 4]]) for (let row = 9; row <= 13 - height; row++)
    for (let col = 2; col <= 11 - width; col++) {
      let beam = [{ layout: [], score: 0 }];
      for (let i = 0; i < units.length && beam.length; i++) {
        const opts = options[i].filter(p => p.r >= row && p.r < row + height && p.c >= col && p.c < col + width);
        const next = [];
        for (const partial of beam) for (const p of opts) {
          if (partial.layout.some(q => q.key === p.key)) continue;
          const layout = [...partial.layout, p]; next.push({ layout, score: roleDiversity
            ? allocationValue(layout, contexts[i], family) : mobileBossValue(layout, contexts[i]) });
        }
        next.sort((a, b) => b.score - a.score);
        beam = roleDiversity ? roleAllocationBeam(next, contexts[i].info) : next.slice(0, 24);
        yield;
      }
      if (beam.length) {
        const best = beam[0], plan = new h.LayoutPlan(); plan.lineup = original.lineup;
        best.layout.forEach((p, i) => { plan.set(units[i].u.uid, p.key); plan.dirs.set(units[i].u.uid, p.dir); });
        plan.coopAtomicWindow = { row, col, height, width, score: best.score, ...(roleDiversity ? { family } : {}) }; offered.push(plan);
      }
      yield;
    }
  offered.sort((a, b) => b.coopAtomicWindow.score - a.coopAtomicWindow.score);
  const result = [original];
  if (roleDiversity) {
    const seen = new Set([signature(original)]);
    // One proposal per objective; the same rectangle may offer different role allocations.
    for (const family of families) for (const p of offered.filter(p => p.coopAtomicWindow.family === family)) {
      if (seen.has(signature(p))) continue;
      seen.add(signature(p)); result.push(p); break;
    }
    return result;
  }
  // Keep different complete windows, rather than four near-identical top-scoring local moves.
  for (const p of offered) {
    if (result.slice(1).some(q => [...p].filter(([u, k]) => q.get(u) !== k).length < 3)) continue;
    result.push(p); if (result.length === 5) break;
  }
  return result;
}

export function withCoopAtomicWindow(parent, { roleDiversity = false } = {}) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    const start = performance.now();
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!eligible(m)) return;
    const remaining = m.sched.virtual ? 30_000 : 30_000 - (performance.now() - start);
    if (remaining <= 0) return;
    // The inherited search finishes unchanged. Only this factor adds at most 300k steps, within the same 30s wall cap.
    const extra = withLateranoCoopBossSelf({ *finalBoardSteps(m, ps, h) {
      const plans = yield* coopAtomicWindowPlans(m, ps, h, parent, { roleDiversity }), batches = [];
      let best = plans[0];
      for (let i = 1; i < plans.length; i += 2) {
        const job = yield* createCoopBossForecast(m, ps, [best, ...plans.slice(i, i + 2)], 10);
        if (!job) break; while (!job.run(4)) yield;
        batches.push({ selected: job.bestIndex, stale: job.stale, outcomes: job.outcomes });
        if (job.stale) break; best = job.best;
      }
      const changed = signature(best) !== signature(plans[0]);
      if (changed) applyCoopRolePlan(ps, best);
      (ps._botCoopFactorHistory ||= []).push({ factor: roleDiversity ? 'role-allocation' : 'atomic-window', round: m.round, changed,
        proposals: plans.map(p => ({ positions: [...p], dirs: [...p.dirs], window: p.coopAtomicWindow })), batches });
    } }, { fieldSteps: 300_000, wallMs: remaining });
    yield* extra.finalBoardSteps(m, ps, h);
  } });
}
