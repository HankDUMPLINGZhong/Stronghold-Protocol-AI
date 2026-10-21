// [ASSUMED] Independent R14 experiments: owned elemental medic for Quintus; fixed-roster columns for Sami.
// Shopping, equipment and pre-boss development are inherited verbatim. No actual combat outcome is consulted.
import { computeBonds } from '../../../../../bondsMeta.js';
import { createBossRehearsalSteps } from '../botBossRehearsal.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { pairedBossChoice } from './lateranoMobileBoss.js';
import { createRng, deriveSeed } from '../../../../../../sim/rng.js';

const CORE = 'lateranoShip', DIRS = ['RIGHT', 'UP', 'LEFT', 'DOWN'];
const CARRIES = new Set(['chess_char_6_13_a', 'chess_char_6_01_a']);
const PRIORITY = { chess_char_6_13_a: 9, chess_char_6_01_a: 9, chess_char_5_01_a: 5,
  chess_char_3_21_a: 5, chess_char_1_01_a: 3, chess_char_2_01_a: 3,
  chess_char_4_02_a: 1.5, chess_char_4_01_a: 0.5, chess_char_6_09_a: 1 };
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);

/** A legal final permutation can contain an illegal intermediate swap across floor/high-ground tiles.
 * Keep the old three-pass action order when moves succeed; defer BAD_TILE until other units have moved.
 * Never bypass PlayerState legality, choose another layout or silently accept an unfinished permutation.
 */
export function applyControlPositions(ps, plan) {
  let deferred = false;
  for (let pass = 0; pass < 3; pass++) for (const [uid, key] of plan) {
    const [row, col] = key.split(',').map(Number), result = ps.move(uid, { area: 'board', row, col }, plan.dirs.get(uid));
    if (result?.error === 'BAD_TILE') deferred = true;
    else if (result?.error) throw Error(`Control boss placement rejected: ${result.error}`);
  }
  if (deferred && [...plan].some(([uid, key]) => {
    const loc = ps.find(uid);
    return loc?.area !== 'board' || loc.key !== key || loc.piece.dir !== plan.dirs.get(uid);
  })) throw Error('Control boss placement rejected: unresolved BAD_TILE');
}

export function controlBonds(ps, chosen) {
  const selected = new Set(chosen.map(p => p.uid));
  return computeBonds(ps.gd, { ...ps, board: new Map(chosen.map(p => [p.uid, p])),
    hand: [...ps.hand.filter(p => !selected.has(p?.uid)), ...field(ps).filter(p => !selected.has(p.uid))] });
}

/** Each permitted swap keeps six, the two named carries, and all existing equipment on its owner. */
export function quintusMedicRosters(ps) {
  const gd = ps.gd, current = field(ps);
  const medics = ps.allChess().filter(p => gd.chess(p.id).subProfessionId === 'wandermedic')
    .sort((a, b) => gd.chess(b.id).tier - gd.chess(a.id).tier || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid);
  if (!medics.length || (controlBonds(ps, current)[CORE]?.count || 0) < 6) return [];
  if (current.some(p => gd.chess(p.id).subProfessionId === 'wandermedic')) return [current];
  const medic = medics[0], rosters = [];
  for (const removed of current) {
    if (CARRIES.has(base(gd, removed))) continue;
    const loc = ps.find(removed.uid), [r, c] = loc.key.split(',').map(Number);
    if (!ps._legal(medic, r, c)) continue; // A real hand→board swap works even with a full bench.
    const chosen = current.map(p => p === removed ? medic : p);
    if ((controlBonds(ps, chosen)[CORE]?.count || 0) < 6) continue;
    rosters.push(chosen);
  }
  return rosters;
}

const adjacent = (a, b, diagonal) => diagonal ? Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) <= 1
  : Math.abs(a.r - b.r) + Math.abs(a.c - b.c) <= 1;

/** Geometry proposes; two common independent forecast streams check real targeting, damage and healing. */
export function controlBossValue(layout, ctx) {
  const { info, kind, critical, skillActive, diagonal } = ctx;
  let score = 0;
  const med = layout.findIndex((p, i) => info[i].elemental);
  const covered = i => info[i].healable && layout.some((p, j) => info[j].healer && p.heal.has(layout[i].key));
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i], u = info[i], w = u.weight;
    if (u.dealer) score += p.contact ? w * 15 : -w * 80;
    if (u.healable && info.some(u => u.healer)) score += covered(i) ? w * 12 : -w * (u.primary ? 24 : 5);
    if (skillActive && layout.some((q, j) => info[j].skill && adjacent(p, q, diagonal))) score += w * 5;
    // Wandermedic elemental mitigation (including Eyja's HP/EP aura) also protects unhealable Reapers.
    if (kind === 'boss_4' && critical.has(i)) score += med >= 0 && layout[med].heal.has(p.key) ? 35 : -180;
  }
  if (kind === 'boss_7') {
    for (let c = 2; c <= 10; c++) {
      const column = info.map((u, i) => ({ ...u, i })).filter(u => layout[u.i].c === c);
      const sum = column.reduce((n, u) => n + u.weight, 0), squares = column.reduce((n, u) => n + u.weight ** 2, 0);
      score -= (sum * sum - squares) * 1.4;
      const fragile = column.filter(u => u.primary || u.healer);
      score -= fragile.length > 1 ? 90 * (fragile.length - 1) : 0;
    }
    // A physician near the travelling guards needs an actual blocker, not just another ranged ally.
    for (let i = 0; i < layout.length; i++) if (info[i].healer) {
      const p = layout[i];
      score -= ctx.guardHeat.get(p.key) || 0;
      if (layout.some((q, j) => info[j].tank && Math.abs(q.r - p.r) + Math.abs(q.c - p.c) <= 2)) score += 10;
    }
  }
  return score;
}

export function controlBossCoverage(layout, ctx) {
  if (new Set(layout.map(p => p.key)).size !== layout.length) return false;
  if (ctx.kind !== 'boss_4') return true;
  const i = ctx.info.findIndex(u => u.elemental);
  return i >= 0 && [...ctx.critical].every(j => layout[i].heal.has(layout[j].key));
}

export function* controlBossSteps(m, ps, helpers, enabled, { collect = false } = {}) {
  if ((!m.isSolo && !(collect && m.mode === 'coop')) || m.round !== m.gd.bossRound || !enabled.includes(m.bossId) || m.botRehearsal < 2) return;
  const { LayoutPlan, rangeRec, rangeTiles, fieldModel, bossInputSteps } = helpers;
  const original = field(ps);
  const owners = collect ? new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid)) : new Set();
  const rosters = (m.bossId === 'boss_4' ? quintusMedicRosters(ps) : [original])
    .filter(chosen => [...owners].every(uid => chosen.some(p => p.uid === uid)));
  if (!rosters.length) return;
  const start = performance.now(), model = fieldModel(m, ps), bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  if (!bodies.size) return;
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  const guardHeat = new Map();
  for (const r of model.routes.filter(r => !r.dwell && !r.fallback)) for (const key of r.tiles) guardHeat.set(key, (guardHeat.get(key) || 0) + 12);
  const rng = createRng(deriveSeed(m.seed, `control-boss-geometry:${m.bossId}:1`)), proposals = [];
  const sig = (chosen, locs) => locs.map((p, i) => `${chosen[i].uid}:${p.key}:${p.dir}`).join('|');
  const planOf = (chosen, layout) => {
    const p = new LayoutPlan(); p.lineup = chosen;
    layout.forEach((loc, i) => { p.set(chosen[i].uid, loc.key); p.dirs.set(chosen[i].uid, loc.dir); }); return p;
  };
  for (const chosen of rosters) {
    const records = chosen.map(p => rangeRec(ps, ps.gd.chess(p.id)));
    const bonds = controlBonds(ps, chosen);
    const info = records.map((rec, i) => {
      const id = base(ps.gd, chosen[i]), healer = rec.attackKind === 'heal' || rec.subProfessionId === 'incantationmedic';
      return { elemental: rec.subProfessionId === 'wandermedic', healer, healable: acceptsHealing(rec),
        primary: CARRIES.has(id), dealer: rec.attackKind !== 'heal' && rec.attackKind !== 'none' && rec.subProfessionId !== 'bard',
        skill: rec.bonds?.includes('skillfulShip'), tank: rec.profession === 'TANK', def: rec.stats.def,
        weight: healer ? 5 : (PRIORITY[id] ?? Math.max(1, rec.tier / 2)) * (rec.isGolden ? 1.25 : 1) };
    });
    const critical = new Set(info.map((u, i) => ({ ...u, i })).sort((a, b) => b.def - a.def).slice(0, 2).map(u => u.i));
    info.forEach((u, i) => { if (u.primary || u.weight >= 5 && u.dealer) critical.add(i); });
    const ctx = { info, kind: m.bossId, critical, guardHeat, skillActive: !!bonds.skillfulShip?.active, diagonal: (bonds.skillfulShip?.layers || 0) >= 40 };
    const options = chosen.map((p, i) => {
      const list = [], rec = records[i];
      for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
        const key = `${r},${c}`;
        if (reserved.has(key) || !ps._legal(p, r, c)) continue;
        for (const dir of DIRS) {
          if (owners.has(p.uid) && (ps.find(p.uid).key !== key || p.dir !== dir)) continue;
          const cover = new Set(rangeTiles(rec, r, c, dir));
          const contact = [...bodies].some(key => cover.has(key));
          // Keep non-contact options so local repairs can start from an imperfect retained board.
          // Otherwise one inactive guard/scattergun makes the entire incumbent impossible to refine.
          const heal = info[i].healer ? (rec.subProfessionId === 'incantationmedic' ? cover : healingTiles(rec, r, c, dir)) : null;
          list.push({ key, r, c, dir, contact, heal });
        }
      }
      return list;
    });
    if (options.some(a => !a.length)) continue;
    const bests = new Map();
    const keep = (layout, value) => {
      if (!controlBossCoverage(layout, ctx)) return;
      const signature = sig(chosen, layout);
      if (!bests.has(signature)) bests.set(signature, { chosen, layout: layout.slice(), value, ctx, options });
      if (bests.size > 30) bests.delete([...bests].sort((a, b) => a[1].value - b[1].value)[0][0]);
    };
    restarts: for (let restart = 0; restart < 10; restart++) {
      const layout = [], used = new Set();
      for (let i = 0; i < options.length; i++) {
        const list = options[i], loc = ps.find(chosen[i].uid);
        const retained = restart === 0 && loc?.area === 'board' ? list.find(p => p.key === loc.key && p.dir === chosen[i].dir) : null;
        const free = list.filter(p => !used.has(p.key)); if (!free.length) continue restarts;
        const p = retained && !used.has(retained.key) ? retained : free[Math.floor(rng() * free.length)];
        layout.push(p); used.add(p.key);
      }
      let value = controlBossValue(layout, ctx);
      for (let step = 0; step < 4000; step++) {
        const i = Math.floor(rng() * layout.length), next = options[i][Math.floor(rng() * options[i].length)], old = layout[i];
        if (layout.some((p, j) => j !== i && p.key === next.key)) continue;
        layout[i] = next; const v = controlBossValue(layout, ctx), temp = step < 1000 ? 5 : step < 2500 ? 1 : 0.15;
        if (v >= value || rng() < Math.exp((v - value) / temp)) value = v; else layout[i] = old;
        if (step > 2000) keep(layout, value);
        if (step % 150 === 0) yield;
      }
    }
    const best = [...bests.values()].sort((a, b) => b.value - a.value);
    for (const p of best) {
      if (proposals.some(q => q.chosen === chosen && p.layout.filter((u, i) => q.layout[i].key !== u.key).length < 2)) continue;
      proposals.push(p); if (proposals.filter(q => q.chosen === chosen).length === 3) break;
    }
  }
  if (!proposals.length) return;
  proposals.sort((a, b) => b.value - a.value);
  const originalPlan = new LayoutPlan();
  for (const [key, p] of ps.board) if (p.kind === 'chess') { originalPlan.set(p.uid, key); originalPlan.dirs.set(p.uid, p.dir); }
  originalPlan.lineup = original;
  // Scores from different rosters have different total weights. Give each legal swap a real forecast
  // before spending the remaining slot on another layout of the same roster.
  const diverse = rosters.map(chosen => proposals.find(p => p.chosen === chosen)).filter(Boolean);
  for (const p of proposals) if (!diverse.includes(p)) diverse.push(p);
  const plans = m.bossId === 'boss_7' ? [originalPlan, ...proposals.slice(0, 2).map(p => planOf(p.chosen, p.layout))]
    : diverse.slice(0, 3).map(p => planOf(p.chosen, p.layout));
  if (collect) return [originalPlan, ...plans.filter(p => p !== originalPlan)];
  function* compare(candidates) {
    const input = p => bossInputSteps(m, ps, p.lineup, p, { keepWithdrawn: true });
    const first = yield* createBossRehearsalSteps(m, ps, original, candidates, input);
    if (!first) return null; while (!first.run(4)) yield;
    const owner = Object.assign(Object.create(m), { seed: deriveSeed(m.seed, 'control-boss-forecast:1') });
    const second = yield* createBossRehearsalSteps(owner, ps, original, candidates, input);
    if (!second) return null; while (!second.run(4)) yield;
    const index = pairedBossChoice(first.outcomes, second.outcomes);
    return { best: first.plans[index], index, outcomes: first.outcomes, secondary: second.outcomes };
  }
  const job = yield* compare(plans); if (!job) return;
  let best = job.best;
  const refinements = [];
  for (const stage of ['facing', 'support', 'contact']) {
    const chosen = best.lineup, prototype = proposals.find(p => p.chosen === chosen);
    if (!prototype) continue;
    const { options, ctx } = prototype;
    const layout = chosen.map((u, i) => options[i].find(p => p.key === best.get(u.uid) && p.dir === best.dirs.get(u.uid)));
    if (layout.some(p => !p)) continue;
    const pool = new Map();
    for (let i = 0; i < chosen.length; i++) for (const next of options[i]) {
      const old = layout[i];
      const repairInactive = stage === 'contact' && ctx.info[i].dealer && !old.contact;
      if (stage === 'facing' ? next.key !== old.key : !repairInactive && Math.max(Math.abs(next.r - old.r), Math.abs(next.c - old.c)) > (stage === 'contact' ? 2 : 1)) continue;
      const trial = layout.slice(), j = trial.findIndex((p, n) => n !== i && p.key === next.key);
      trial[i] = next;
      if (j >= 0) { const other = options[j].find(p => p.key === old.key && p.dir === layout[j].dir); if (!other) continue; trial[j] = other; }
      if (!controlBossCoverage(trial, ctx) || sig(chosen, trial) === sig(chosen, layout)) continue;
      pool.set(sig(chosen, trial), { layout: trial, value: controlBossValue(trial, ctx) });
    }
    const ranked = [...pool.values()].sort((a, b) => b.value - a.value), local = [], groups = new Set();
    for (const p of ranked) {
      const group = p.layout.map((u, i) => u.key !== layout[i].key ? i : null).filter(i => i != null).join(',');
      if (stage === 'contact' && groups.has(group)) continue;
      local.push(p); groups.add(group); if (local.length === 2) break;
    }
    if (!local.length) continue;
    const next = yield* compare([best, ...local.map(p => planOf(chosen, p.layout))]);
    if (next) { best = next.best; refinements.push({ stage, index: next.index, outcomes: next.outcomes, secondary: next.secondary }); }
  }
  const snapshot = () => field(ps).map(p => ({ uid: p.uid, id: p.id, key: ps.find(p.uid).key, dir: p.dir, items: p.items?.map(i => i.id) || [] }));
  const before = snapshot(), equipment = ps.allChess().map(p => [p.uid, p.id, p.items?.map(i => i.id) || []]).sort((a, b) => a[0] - b[0]);
  const added = best.lineup.filter(p => !original.some(u => u.uid === p.uid));
  const removed = original.filter(p => !best.lineup.some(u => u.uid === p.uid));
  for (let i = 0; i < added.length; i++) {
    const [row, col] = ps.find(removed[i].uid).key.split(',').map(Number);
    const result = ps.move(added[i].uid, { area: 'board', row, col }, best.dirs.get(added[i].uid));
    if (result?.error) throw Error(`Elemental medic swap rejected: ${result.error}`);
  }
  applyControlPositions(ps, best);
  const after = snapshot();
  if (JSON.stringify(equipment) !== JSON.stringify(ps.allChess().map(p => [p.uid, p.id, p.items?.map(i => i.id) || []]).sort((a, b) => a[0] - b[0]))) throw Error('Control boss changed owned cards/equipment');
  if ((ps.bonds[CORE]?.count || 0) < 6 && (controlBonds(ps, original)[CORE]?.count || 0) >= 6) throw Error('Control boss lost six Laterano');
  if (m.bossId === 'boss_7' && before.map(p => p.uid).sort().join() !== after.map(p => p.uid).sort().join()) throw Error('Sami changed roster');
  ps._botLateranoControlBoss = { kind: m.bossId, before, after, index: job.index, outcomes: job.outcomes, secondary: job.secondary,
    initialCandidates: plans.map(p => ({ lineup: p.lineup.map(u => u.uid), positions: [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) })) })),
    refinements, rosters: rosters.length, candidates: proposals.length, ms: performance.now() - start };
}

export function withLateranoControlBoss(recipe, enabled) {
  const bosses = Object.freeze([...enabled]);
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* controlBossSteps(m, ps, helpers, bosses);
  } });
}
