// [ASSUMED] Public enemy-type responses after spending. Propose owned substitutes and legal layouts;
// common independent forecasts may accept real LP savings. No purchases, future schedule or actual outcomes.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { HOVER_KEYS } from '../../../../../../sim/content/enemies/archetypes.js';

const TYPES = ['FLY', 'TIMES', 'ELEMENT', 'DOT', 'REFLECTION'];
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'], CORE = 'lateranoShip';
const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_21_a']);
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tank = r => r.profession === 'TANK' && (r.stats?.blockCnt || 0) > 0;
const dealer = r => !['heal', 'none'].includes(r.attackKind) && r.subProfessionId !== 'bard';
const base = (ps, p) => ps.gd.baseIdOf(p.id);

/** Classify only units actually present in this wave. A hidden type slot or future enemy is never read. */
export function enemyTypeInfo(m, gd) {
  const counts = Object.fromEntries(TYPES.map(t => [t, 0]));
  let total = 0, air = 0, ranged = 0, splash = false;
  for (const s of m.wave?.spawns || []) {
    const e = gd.enemy(s.enemyKey); if (!e) continue;
    const n = s.count || 1; total += n;
    if (e.isFlyEnemy || e.stats?.motion === 'FLY' || HOVER_KEYS.includes(s.enemyKey)) air += n;
    if (e.applyWay === 'RANGED') ranged += n;
    for (const t of TYPES) if (e.acTypes?.includes(t)) counts[t] += n;
    if (e.applyWay === 'RANGED' && (e.talents?.bb?.['ProjectileBoomRange.attack@projectile_range'] > 0
      || /周围|燃烧区域|溅射/.test(e.desc || ''))) splash = true;
  }
  const type = TYPES.filter(t => counts[t] > 0).sort((a, b) => counts[b] - counts[a] || TYPES.indexOf(a) - TYPES.indexOf(b))[0] || null;
  return { type, counts, total, air, ranged, splash, pureAir: total > 0 && air === total };
}

const hits = r => Math.max(1, Number(r.skill?.bb?.['attack@times']) || 1);
export function enemyRoleValue(rec, threat) {
  const s = rec.stats || {}, rate = (s.aspd || 100) / (100 * Math.max(.3, s.bat || 1));
  const power = Math.max(1, s.atk || 0) * rate, hitRate = rate * (1 + (hits(rec) - 1) * .4);
  let value = dealer(rec) ? Math.min(28, power / 60) + rec.tier : healer(rec) ? 5 : 1;
  if (threat.type === 'FLY') value = dealer(rec) && rec.canHitFly ? value + 25 : healer(rec) ? 5 : 0;
  if (threat.type === 'TIMES' && dealer(rec)) value += hitRate * 10 + (['reaperrange', 'chain', 'splashcaster'].includes(rec.subProfessionId) ? 5 : 0);
  if (threat.type === 'REFLECTION' && dealer(rec)) value += rec.dmgType === 'phys' ? 18 : rec.dmgType === 'true' ? 22 : -5;
  if (['DOT', 'ELEMENT'].includes(threat.type) && healer(rec)) value += 18;
  if (threat.type === 'ELEMENT' && rec.subProfessionId === 'wandermedic') value += 18;
  if (['DOT', 'ELEMENT'].includes(threat.type) && tank(rec)) value += 8;
  return value;
}

function originalPlan(ps, h) {
  const plan = new h.LayoutPlan(); plan.lineup = field(ps);
  for (const p of plan.lineup) { plan.set(p.uid, ps.find(p.uid).key); plan.dirs.set(p.uid, p.dir); }
  return plan;
}

export function enemyRosterPlans(ps, h, recipe, threat, preserveSecondaries = false) {
  const original = originalPlan(ps, h), chosen = original.lineup, proposals = [];
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const rec = p => h.rangeRec(ps, ps.gd.chess(p.id));
  const value = p => enemyRoleValue(rec(p), threat) + (ps.gd.isGolden(p.id) ? 7 : 0);
  for (const added of ps.allChess().filter(p => !chosen.includes(p))) for (const removed of chosen) {
    const a = rec(added), r = rec(removed), id = base(ps, removed);
    if (owners.has(removed.uid) || id === recipe.ids.mostima) continue;
    if (MAIN.has(id) && !(threat.pureAir && !r.canHitFly && a.canHitFly)) continue;
    if (healer(r) && !healer(a) && !chosen.some(p => p !== removed && healer(rec(p)))) continue;
    if (!threat.pureAir && tank(r) && !tank(a) && !chosen.some(p => p !== removed && tank(rec(p)))) continue;
    const key = original.get(removed.uid), [row, col] = key.split(',').map(Number);
    if (!ps._legal(added, row, col)) continue;
    const score = value(added) - value(removed); if (score <= 0) continue;
    const plan = new h.LayoutPlan(); plan.lineup = chosen.map(p => p === removed ? added : p);
    for (const p of plan.lineup) { plan.set(p.uid, p === added ? key : original.get(p.uid)); plan.dirs.set(p.uid, p === added ? removed.dir : p.dir); }
    const bonds = stealthBattleInput(ps, plan).bonds;
    if ((bonds[CORE]?.count || 0) < Math.min(6, ps.bonds[CORE]?.count || 0)) continue;
    if (preserveSecondaries && ['preciShip', 'skillfulShip'].some(id => ps.bonds[id]?.active
      && (!bonds[id]?.active || bonds[id].count < Math.min(id === 'preciShip' ? 3 : 2, ps.bonds[id].count)))) continue;
    proposals.push({ plan, score, uid: added.uid, removed: removed.uid });
  }
  proposals.sort((a, b) => b.score - a.score || a.uid - b.uid || a.removed - b.removed);
  const selected = [], additions = new Set();
  for (const p of proposals) { if (additions.has(p.uid)) continue; selected.push(p.plan); additions.add(p.uid); if (selected.length === 2) break; }
  return [original, ...selected];
}

/** Broad anti-air/hit-count windows; physical focus against refraction; healing and separation for attrition.
 * Geometry proposes, but cannot commit a layout without paired current-wave LP improvement.
 */
export function enemyPositionPlans(m, ps, h, threat) {
  const original = originalPlan(ps, h), chosen = original.lineup, model = h.fieldModel(m, ps);
  const routes = model.routes.filter(r => !r.fallback && r.n > 0), total = routes.reduce((n, r) => n + r.n, 0) || 1;
  const recs = chosen.map(p => h.rangeRec(ps, ps.gd.chess(p.id)));
  const info = recs.map((r, i) => ({ healer: healer(r), tank: tank(r), dealer: dealer(r), air: !!r.canHitFly,
    healable: acceptsHealing(r), primary: MAIN.has(base(ps, chosen[i])), block: r.stats?.blockCnt || 0,
    weight: Math.max(1, enemyRoleValue(r, threat)) * (ps.gd.isGolden(chosen[i].id) ? 1.3 : 1) }));
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([k]) => k));
  const options = chosen.map((p, i) => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      const key = `${r},${c}`; if (reserved.has(key) || !ps._legal(p, r, c)) continue;
      for (const dir of DIRS) {
        if (owners.has(p.uid) && (key !== original.get(p.uid) || dir !== p.dir)) continue;
        const cover = new Set(h.rangeTiles(recs[i], r, c, dir));
        let exposure = 0;
        if (info[i].dealer) for (const rt of routes) {
          if (rt.fly && !info[i].air) continue;
          const at = rt.tiles.reduce((a, k, n) => { if (cover.has(k)) a.push(n); return a; }, []);
          const hits = at.length, early = hits ? (rt.tiles.length - at[0]) / rt.tiles.length : 0;
          exposure += rt.n / total * (hits + early * 2) * (threat.type === 'FLY' && !rt.fly ? .25 : 1);
        }
        out.push({ key, r, c, dir, cover, heal: healingTiles(recs[i], r, c, dir), exposure });
      }
    }
    return out;
  });
  const current = chosen.map((p, i) => options[i].find(o => o.key === original.get(p.uid) && o.dir === p.dir));
  if (current.some(p => !p)) return [original];
  const score = layout => {
    let n = 0;
    for (let i = 0; i < layout.length; i++) {
      const u = info[i], p = layout[i]; n += u.weight * p.exposure * 2;
      const healed = layout.some((q, j) => info[j].healer && q.heal.has(p.key));
      if (u.healable && (u.primary || u.tank) && info.some(v => v.healer)) n += u.weight * (healed ? 5 : -8);
      if (['DOT', 'ELEMENT'].includes(threat.type) && threat.splash && (u.primary || u.healer))
        for (let j = i + 1; j < layout.length; j++) if ((info[j].primary || info[j].healer || info[j].tank)
          && Math.max(Math.abs(p.r - layout[j].r), Math.abs(p.c - layout[j].c)) <= 1) n -= Math.min(u.weight, info[j].weight) * 3;
    }
    for (const rt of routes) {
      if (rt.fly) continue;
      const front = layout.reduce((v, p, i) => info[i].tank && rt.tiles.includes(p.key) ? Math.min(v, rt.tiles.indexOf(p.key)) : v, Infinity);
      if (!Number.isFinite(front)) continue;
      const upstream = rt.tiles[Math.max(0, front - 1)];
      for (let i = 0; i < layout.length; i++) {
        const u = info[i], p = layout[i], at = rt.tiles.indexOf(p.key);
        if (u.dealer && p.cover.has(upstream)) n += rt.n / total * u.weight * 5;
        if (!u.tank && (u.primary || u.healer) && at >= 0 && at < front) n -= rt.n / total * u.weight * 12;
      }
    }
    return n;
  };
  const signature = layout => layout.map(p => `${p.key}:${p.dir}`).join('|');
  const change = (layout, i, next) => {
    const trial = layout.slice(), j = layout.findIndex((p, k) => k !== i && p.key === next.key); trial[i] = next;
    if (j >= 0) { const reciprocal = options[j].find(p => p.key === layout[i].key && p.dir === layout[j].dir); if (!reciprocal) return null; trial[j] = reciprocal; }
    return trial;
  };
  let bestSingle = null, bestScore = score(current), joint = current.slice();
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < chosen.length; i++) {
    let nextJoint = joint, nextScore = score(joint);
    for (const p of options[i]) {
      if (pass === 0) {
        const single = change(current, i, p); if (single) { const s = score(single); if (s > bestScore + 1e-6) { bestSingle = single; bestScore = s; } }
      }
      const trial = change(joint, i, p); if (!trial) continue;
      const s = score(trial); if (s > nextScore + 1e-6) { nextJoint = trial; nextScore = s; }
    }
    joint = nextJoint;
  }
  const plans = [original], seen = new Set([signature(current)]);
  for (const layout of [joint, bestSingle].filter(Boolean)) {
    const key = signature(layout); if (seen.has(key)) continue; seen.add(key);
    const plan = new h.LayoutPlan(); plan.lineup = chosen;
    layout.forEach((p, i) => { plan.set(chosen[i].uid, p.key); plan.dirs.set(chosen[i].uid, p.dir); }); plans.push(plan);
  }
  return plans;
}

/** Unlike raw leak minimization beyond the LP cap, require real predicted LP savings in complete paired samples. */
export function selectEnemyRepair(plans, outcomes) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === FORECAST_SAMPLES && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(rows[0]) || rows[0].every(r => r.leaks === 0)) return { index: 0 };
  const rank = rs => [-Math.max(...rs.map(r => r.lost)), -rs.reduce((n, r) => n + r.lost, 0), -rs.reduce((n, r) => n + r.leaks, 0)];
  const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  let index = 0, best = rank(rows[0]);
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, j) => r.lost > rows[0][j].lost || r.leaks > rows[0][j].leaks)) continue;
    const next = rank(rows[i]), old = rank(rows[0]);
    if (next[0] === old[0] && next[1] === old[1]) continue;
    if (better(next, best)) { index = i; best = next; }
  }
  return { index };
}

export function* enemyTypeSteps(m, ps, h, recipe, preserveSecondaries = false) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 3 || field(ps).length < 3) return;
  const threat = enemyTypeInfo(m, ps.gd); if (!threat.type) return;
  const started = performance.now(), batches = [];
  for (const stage of ['roster', 'position']) {
    const plans = stage === 'roster' ? enemyRosterPlans(ps, h, recipe, threat, preserveSecondaries) : enemyPositionPlans(m, ps, h, threat);
    if (plans.length < 2) continue;
    function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
    const policy = { prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
      forecastContext: () => ({}), observeForecast: () => () => ({}), selectForecast: selectEnemyRepair };
    const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputSteps, policy);
    if (!job) continue; while (!job.run(4)) yield;
    if (job.bestIndex) {
      const best = job.best, added = best.lineup.filter(p => !plans[0].lineup.includes(p)), removed = plans[0].lineup.filter(p => !best.lineup.includes(p));
      for (let i = 0; i < added.length; i++) {
        const [row, col] = plans[0].get(removed[i].uid).split(',').map(Number);
        const result = ps.move(added[i].uid, { area: 'board', row, col }, best.dirs.get(added[i].uid));
        if (result?.error) throw Error(`Enemy-type substitution rejected: ${result.error}`);
      }
      const expected = stealthBattleInput(ps, best); applyControlPositions(ps, best);
      if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Enemy-type layout differs from its forecast');
    }
    batches.push({ stage, index: job.bestIndex, outcomes: job.outcomes, candidates: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
  }
  (ps._botEnemyTypeHistory ||= []).push({ round: m.round, threat, batches, ms: performance.now() - started });
}

export function withLateranoEnemyTypes(recipe, { preserveSecondaries = false } = {}) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* enemyTypeSteps(m, ps, helpers, recipe, preserveSecondaries);
  } });
}
