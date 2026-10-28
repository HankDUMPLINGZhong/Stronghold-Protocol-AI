// [ASSUMED] Optional, fixed-roster R14 contact candidates for Gun and Lucien.
// Only public routes, operator ranges and boss selectors generate candidates. Independent forecasts choose them.
import { createBossRehearsalSteps } from '../botBossRehearsal.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { createRng, deriveSeed } from '../../../../../../sim/rng.js';

const PRIORITY = { chess_char_6_13_a: 9, chess_char_6_01_a: 9, chess_char_5_01_a: 5,
  chess_char_3_21_a: 4, chess_char_1_01_a: 3, chess_char_2_01_a: 3,
  chess_char_4_02_a: 1.5, chess_char_4_01_a: 0.5, chess_char_6_09_a: 1 };
const DIRS = ['RIGHT', 'UP', 'LEFT', 'DOWN'];
const distance2 = (a, b) => (a.r - b.r) ** 2 + (a.c - b.c) ** 2;

/** Prefer the worst common sample; a lucky victory cannot hide failure in the other forecast. */
export function pairedBossChoice(primary, secondary) {
  const scores = primary.map((a, i) => {
    const b = secondary[i], bothWon = a.won && b.won;
    return [bothWon ? 1 : 0, bothWon ? Math.min(a.lp, b.lp) : Math.min(a.damage, b.damage), (a.damage + b.damage) / 2];
  });
  let selectedIndex = 0;
  for (let i = 1; i < scores.length; i++) for (let k = 0; k < scores[i].length; k++) {
    if (Math.abs(scores[i][k] - scores[selectedIndex][k]) < 1e-6) continue;
    if (scores[i][k] > scores[selectedIndex][k]) selectedIndex = i;
    break;
  }
  return selectedIndex;
}

/** Includes a target's real incoming neighbours, not just the blocker's foot. */
export function mobileContactAt(cover, point) {
  let n = cover.has(point.key) ? 2 : 0;
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cover.has(`${point.r + dr},${point.c + dc}`)) n++;
  return n / 6;
}

/** Pure geometry: joint boss contact, healing, real Skillful footprint and boss-specific threat. */
export function mobileBossValue(layout, ctx) {
  const { info, nodes, anchor, kind, skillActive, diagonal } = ctx;
  const healed = layout.map((p, i) => info[i].healable && layout.some((q, j) => info[j].heal && q.heal.has(p.key)));
  const hasHealer = info.some(u => u.heal), total = info.reduce((n, u) => n + (u.heal ? 0 : u.weight), 0) || 1;
  let score = 0;
  for (const node of nodes) {
    let covered = 0;
    for (let i = 0; i < layout.length; i++) if (!info[i].heal && layout[i].cover.has(node.key)) covered += info[i].weight;
    score += node.weight * (covered / total) ** 2 * 30;
  }
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i], u = info[i], weight = u.weight;
    if (!u.heal) score += weight * p.contact * 25;
    if (hasHealer && u.healable) score += weight * (healed[i] ? 8 : u.primary ? -16 : -3);
    if (skillActive && layout.some((q, j) => info[j].skill && (diagonal
      ? Math.max(Math.abs(p.r - q.r), Math.abs(p.c - q.c)) <= 1
      : Math.abs(p.r - q.r) + Math.abs(p.c - q.c) <= 1))) score += weight * 6;
    if (i !== anchor) {
      score -= weight * p.threat * (kind === 'boss_5' ? 12 : 7) * (u.heal ? 2 : 1);
      if (kind === 'boss_2') {
        score += weight * mobileContactAt(p.cover, layout[anchor]) * 10;
        score -= weight * (ctx.chargeRisk.get(`${p.key}|${layout[anchor].key}`) || 0) * (u.heal ? 14 : 6);
      }
    }
  }
  const tank = layout[anchor];
  if (hasHealer) score += healed[anchor] ? 14 : -14;
  if (kind === 'boss_5') {
    score += nodes.some(n => n.key === tank.key) ? 8 : -8;
    // A block/flash must stay in the main squad's firing window rather than exposing an isolated blocker.
    for (let i = 0; i < layout.length; i++) if (info[i].primary) score += info[i].weight * mobileContactAt(layout[i].cover, tank) * 5;
  }
  return score;
}

export function* mobileBossSteps(m, ps, helpers, enabled, { collect = false } = {}) {
  if ((!m.isSolo && !(collect && m.mode === 'coop')) || m.round !== m.gd.bossRound || !enabled.includes(m.bossId) || m.botRehearsal < 2) return;
  const { LayoutPlan, rangeRec, rangeTiles, fieldModel, bossInputSteps } = helpers;
  const chosen = [...ps.board.values()].filter(p => p.kind === 'chess');
  if (chosen.length < 2) return;
  const start = performance.now(), model = fieldModel(m, ps), routes = model.routes.filter(r => r.dwell > 0 && !r.fallback);
  if (!routes.length) return;
  const heat = new Map();
  for (const route of routes) for (const key of route.tiles) heat.set(key, (heat.get(key) || 0) + route.tileTime);
  const sum = [...heat.values()].reduce((n, v) => n + v, 0) || 1;
  const nodes = [...heat].map(([key, weight]) => { const [r, c] = key.split(',').map(Number); return { key, r, c, weight: weight / sum }; });
  const records = chosen.map(p => rangeRec(ps, ps.gd.chess(p.id)));
  const info = records.map(rec => {
    const base = m.gd.baseIdOf(rec.chessId), heal = rec.attackKind === 'heal';
    return { heal, primary: ['chess_char_6_13_a', 'chess_char_6_01_a'].includes(base),
      healable: acceptsHealing(rec), skill: rec.bonds?.includes('skillfulShip'),
      weight: heal ? 5 : (PRIORITY[base] ?? Math.max(1, rec.tier / 2)) * (rec.isGolden ? 1.25 : 1),
      tank: rec.profession === 'TANK', def: rec.stats?.def || 0 };
  });
  const anchor = info.map((u, i) => ({ ...u, i })).sort((a, b) => Number(b.tank) - Number(a.tank) || b.def - a.def || a.i - b.i)[0].i;
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  const owners = collect ? new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid)) : new Set();
  const options = chosen.map((p, i) => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      const key = `${r},${c}`;
      if (reserved.has(key) || !ps._legal(p, r, c)) continue;
      for (const dir of DIRS) {
        if (owners.has(p.uid) && (ps.find(p.uid).key !== key || p.dir !== dir)) continue;
        const cover = new Set(rangeTiles(records[i], r, c, dir));
        const contact = nodes.reduce((n, p) => n + (cover.has(p.key) ? p.weight : 0), 0);
        if (!info[i].heal && contact === 0) continue;
        const point = { r, c };
        out.push({ key, r, c, dir, cover, contact, heal: info[i].heal ? healingTiles(records[i], r, c, dir) : null,
          threat: nodes.reduce((n, p) => n + (distance2(point, p) <= 4 ? p.weight : 0), 0) });
      }
    }
    return out;
  });
  if (options.some(list => !list.length)) return;
  const chargeRisk = new Map(), keys = new Map(options.flat().map(p => [p.key, p]));
  if (m.bossId === 'boss_2') for (const point of keys.values()) for (const tank of keys.values()) {
    let risk = 0;
    for (const node of nodes) {
      const dr = tank.r - node.r, dc = tank.c - node.c, len = dr * dr + dc * dc;
      const t = len ? Math.max(0, Math.min(1, ((point.r - node.r) * dr + (point.c - node.c) * dc) / len)) : 0;
      if ((point.r - node.r - t * dr) ** 2 + (point.c - node.c - t * dc) ** 2 < 0.35 ** 2) risk += node.weight;
    }
    chargeRisk.set(`${point.key}|${tank.key}`, risk);
  }
  const ctx = { info, nodes, anchor, kind: m.bossId, chargeRisk,
    skillActive: !!ps.bonds.skillfulShip?.active, diagonal: (ps.bonds.skillfulShip?.layers || 0) >= 40 };
  const rng = createRng(deriveSeed(m.seed, `mobile-boss-geometry:${m.bossId}:v1`));
  const sig = layout => layout.map(p => `${p.key}:${p.dir}`).join('|'), bests = new Map();
  const keep = (layout, score) => {
    const key = sig(layout); if (!bests.has(key)) bests.set(key, { layout: layout.slice(), score });
    if (bests.size > 60) bests.delete([...bests].sort((a, b) => a[1].score - b[1].score)[0][0]);
  };
  restarts: for (let restart = 0; restart < 12; restart++) {
    const used = new Set(), layout = [];
    for (const list of options) { const free = list.filter(p => !used.has(p.key)); if (!free.length) continue restarts;
      const p = free[Math.floor(rng() * free.length)]; used.add(p.key); layout.push(p); }
    let value = mobileBossValue(layout, ctx);
    for (let step = 0; step < 4000; step++) {
      const i = Math.floor(rng() * layout.length), next = options[i][Math.floor(rng() * options[i].length)], old = layout[i];
      if (layout.some((p, j) => j !== i && p.key === next.key)) continue;
      layout[i] = next; const score = mobileBossValue(layout, ctx), temp = step < 1000 ? 5 : step < 2500 ? 1 : 0.12;
      if (score >= value || rng() < Math.exp((score - value) / temp)) value = score; else layout[i] = old;
      if (step > 2500) keep(layout, value);
      if (step % 120 === 0) yield;
    }
  }
  const sorted = [...bests.values()].sort((a, b) => b.score - a.score), selected = [];
  for (const p of sorted) { if (selected.some(q => p.layout.filter((u, i) => u.key !== q.layout[i].key).length < 3)) continue;
    selected.push(p); if (selected.length === 2) break; }
  if (selected.length < 2) for (const p of sorted) { if (selected.some(q => sig(p.layout) === sig(q.layout))) continue;
    selected.push(p); if (selected.length === 2) break; }
  if (selected.length < 2) return;
  const original = new LayoutPlan();
  for (const [key, p] of ps.board) if (p.kind === 'chess') { original.set(p.uid, key); original.dirs.set(p.uid, p.dir); }
  const plans = [original, ...selected.map(p => { const plan = new LayoutPlan();
    p.layout.forEach((loc, i) => { plan.set(chosen[i].uid, loc.key); plan.dirs.set(chosen[i].uid, loc.dir); }); return plan; })];
  if (collect) { for (const plan of plans) plan.lineup = chosen; return plans; }
  function* comparePlans(candidates) {
    const first = yield* createBossRehearsalSteps(m, ps, chosen, candidates, p => bossInputSteps(m, ps, chosen, p));
    if (!first) return null;
    while (!first.run(4)) yield;
    // A read-only owner for the second public forecast; do not change the match seed or its random streams.
    const secondOwner = Object.assign(Object.create(m), { seed: deriveSeed(m.seed, 'mobile-boss-forecast:1') });
    const second = yield* createBossRehearsalSteps(secondOwner, ps, chosen, candidates, p => bossInputSteps(m, ps, chosen, p));
    if (!second) return first;
    while (!second.run(4)) yield;
    const selectedIndex = pairedBossChoice(first.outcomes, second.outcomes);
    first.best = first.plans[selectedIndex]; first.bestIndex = selectedIndex;
    first.secondaryOutcomes = second.outcomes;
    return first;
  }
  const job = yield* comparePlans(plans);
  if (!job) return;
  while (!job.run(4)) yield;
  let best = job.best;
  const refinements = [], seen = new Set(plans.map(p => chosen.map(u => `${p.get(u.uid)}:${p.dirs.get(u.uid)}`).join('|')));
  const planOf = layout => { const plan = new LayoutPlan(); layout.forEach((p, i) => { plan.set(chosen[i].uid, p.key); plan.dirs.set(chosen[i].uid, p.dir); }); return plan; };
  // Three bounded local batches. Every batch compares the incumbent and two new legal candidates on the same
  // independent forecast stream; neither real combat results nor the benchmark record are available here.
  for (const stage of ['facing', 'support', 'frontline']) {
    const layout = chosen.map((u, i) => options[i].find(p => p.key === best.get(u.uid) && p.dir === best.dirs.get(u.uid)));
    if (layout.some(p => !p)) break;
    const targets = info.map((u, i) => ({ ...u, i })).filter(u => stage === 'frontline' ? u.i === anchor
      : stage === 'facing' ? u.primary || u.heal : u.primary || u.heal || u.weight >= 4);
    const pool = new Map();
    const offer = trial => {
      const signature = sig(trial);
      if (seen.has(signature) || new Set(trial.map(p => p.key)).size !== chosen.length) return;
      pool.set(signature, { layout: trial, score: mobileBossValue(trial, ctx) });
    };
    for (const { i } of targets) for (const next of options[i]) {
      const old = layout[i];
      if (stage === 'facing' ? next.key !== old.key : Math.max(Math.abs(next.r - old.r), Math.abs(next.c - old.c)) > (stage === 'frontline' ? 2 : 1)) continue;
      const trial = layout.slice(), j = trial.findIndex((p, n) => n !== i && p.key === next.key);
      trial[i] = next;
      if (j >= 0) {
        const swapped = options[j].find(p => p.key === old.key && p.dir === layout[j].dir);
        if (!swapped) continue;
        trial[j] = swapped;
      }
      offer(trial);
    }
    if (stage === 'support') for (const { i } of targets.filter(t => t.primary)) for (const { i: hi } of targets.filter(t => t.heal)) {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const trial = layout.slice();
        const a = options[i].find(p => p.r === layout[i].r + dr && p.c === layout[i].c + dc && p.dir === layout[i].dir);
        const h = options[hi].find(p => p.r === layout[hi].r + dr && p.c === layout[hi].c + dc && p.dir === layout[hi].dir);
        if (!a || !h) continue;
        trial[i] = a; trial[hi] = h; offer(trial);
      }
    }
    const proposals = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 2);
    if (!proposals.length) continue;
    for (const p of proposals) seen.add(sig(p.layout));
    const localPlans = [best, ...proposals.map(p => planOf(p.layout))];
    const local = yield* comparePlans(localPlans);
    if (!local) continue;
    while (!local.run(4)) yield;
    best = local.best;
    refinements.push({ stage, outcomes: local.outcomes, secondaryOutcomes: local.secondaryOutcomes, selectedIndex: local.bestIndex ?? 0,
      candidates: proposals.map(p => ({ score: p.score, positions: p.layout.map((loc, i) => ({ uid: chosen[i].uid, key: loc.key, dir: loc.dir })) })) });
  }
  const snapshot = () => [...ps.board].filter(([, p]) => p.kind === 'chess').map(([key, p]) => ({ uid: p.uid, id: p.id, key, dir: p.dir,
    items: (p.items || []).map(it => ({ ...it })) }));
  const before = snapshot();
  for (let pass = 0; pass < 3; pass++) for (const [uid, key] of best) {
    const [row, col] = key.split(',').map(Number), result = ps.move(uid, { area: 'board', row, col }, best.dirs.get(uid));
    if (result?.error) throw Error(`Mobile boss placement rejected: ${result.error}`);
  }
  const after = snapshot();
  const identity = xs => JSON.stringify(xs.map(({ uid, id, items }) => ({ uid, id, items })).sort((a, b) => a.uid - b.uid));
  if (identity(before) !== identity(after)) throw Error('Mobile boss roster/equipment changed');
  ps._botLateranoMobileBoss = { kind: m.bossId, before, after, outcomes: job.outcomes, selectedIndex: job.bestIndex ?? 0,
    secondaryOutcomes: job.secondaryOutcomes, refinements,
    trialCount: job.outcomes.length + (job.secondaryOutcomes?.length || 0)
      + refinements.reduce((n, r) => n + r.outcomes.length + (r.secondaryOutcomes?.length || 0), 0),
    candidates: selected.map(p => ({ score: p.score, positions: p.layout.map((loc, i) => ({ uid: chosen[i].uid, key: loc.key, dir: loc.dir })) })),
    independentSeed: `boss-rehearse:${m.round}:${ps.seat}`, ms: performance.now() - start };
}

export function withLateranoMobileBoss(recipe, enabled) {
  const kinds = Object.freeze([...enabled]);
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* mobileBossSteps(m, ps, helpers, kinds);
  } });
}
