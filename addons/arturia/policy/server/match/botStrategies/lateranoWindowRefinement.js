// [ASSUMED] Bounded fixed-roster contact repair. Public geometry proposes; two independent forecasts select.
// Runs after shopping and the retained placement. Never reads actual battle results or changes owned assets.
import { createForecastSteps } from '../botForecast.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { applyControlPositions } from './lateranoControlBoss.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const PRIORITY = { chess_char_6_13_a: 9, chess_char_6_01_a: 9, chess_char_5_01_a: 5,
  chess_char_3_21_a: 5, chess_char_2_01_a: 3, chess_char_1_01_a: 3 };
const distance = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
const signature = locs => locs.map(p => `${p.key}:${p.dir}`).join('|');

/** Preserve summon positions and all non-position combat inputs verbatim. */
export function windowBattleInput(original, plan, { readingOrder = false } = {}) {
  const input = structuredClone(original);
  for (const u of input.units) if (u.kind === 'chess' && plan.has(u.uid)) {
    [u.row, u.col] = plan.get(u.uid).split(',').map(Number); u.dir = plan.dirs.get(u.uid);
  }
  // PlayerState serializes the deployed field in row/column reading order. Retain that exact order
  // for co-op forecasts after moving chess, including the interleaved pinned summons.
  if (readingOrder) input.units.sort((a,b) => b.row-a.row || a.col-b.col);
  return input;
}

/** Incoming path tiles precede a blocker's foot; reaching only its foot is insufficient contact. */
export function windowLayoutValue(layout, ctx) {
  const { info, routes, bodies, normal, bossId, skillActive, diagonal } = ctx;
  const dealers = info.map((u, i) => ({ ...u, i })).filter(u => u.dealer);
  const weight = dealers.reduce((s, u) => s + u.weight, 0) || 1;
  let score = 0, total = 0;
  const exposure = layout.map(() => 0);
  for (const route of routes) {
    let end = route.tiles.length - 1;
    if (normal && !route.fly) {
      const fronts = info.flatMap((u, i) => u.front ? [route.tiles.indexOf(layout[i].key)] : []).filter(i => i >= 0);
      if (fronts.length) end = Math.min(...fronts);
    }
    const tiles = route.tiles.slice(0, end + 1), n = route.n || 1;
    total += n;
    for (const u of dealers) {
      if (route.fly && !u.air) continue;
      const hits = tiles.filter(k => layout[u.i].cover.has(k)).length;
      exposure[u.i] += n * Math.min(1, hits / 3);
    }
    // Focus the squad on the incoming contact window rather than equally rewarding every route tile.
    const window = normal ? tiles.slice(-3) : tiles;
    for (const key of window) {
      const share = dealers.reduce((s, u) => s + ((!route.fly || u.air) && layout[u.i].cover.has(key) ? u.weight : 0), 0) / weight;
      score += n * share * share * 30 / Math.max(1, window.length);
    }
    if (normal && !route.fly && end < route.tiles.length - 1) for (let i = 0; i < layout.length; i++) {
      const index = route.tiles.indexOf(layout[i].key);
      if (!info[i].front && index >= 0 && index < end) score -= n * info[i].weight * 4;
    }
  }
  const fixed = new Set(bodies);
  for (let i = 0; i < layout.length; i++) {
    const u = info[i], p = layout[i];
    if (u.dealer) {
      if (fixed.size) score += u.weight * ([...fixed].some(k => p.cover.has(k)) ? 30 : -80);
      else score += u.weight * exposure[i] / Math.max(1, total) * 20;
    }
    if (u.healable && info.some(v => v.healer)) {
      const healed = layout.some((q, j) => info[j].healer && q.heal.has(p.key));
      score += u.weight * (healed ? 6 : u.primary || u.front ? -10 : -2);
    }
    if (skillActive && u.dealer && layout.some((q, j) => info[j].skill && (diagonal
      ? distance(p, q) <= 1 : Math.abs(p.r - q.r) + Math.abs(p.c - q.c) <= 1))) score += u.weight * 4;
    if (normal && u.mostima) for (let j = 0; j < layout.length; j++) {
      if (info[j].ammo && Math.abs(p.r - layout[j].r) + Math.abs(p.c - layout[j].c) === 1)
        score += (u.elite ? 8 : 4) * exposure[j] / Math.max(1, total);
    }
    // Helm's flying parts stun the surrounding 3x3. Do not place the whole firing line in one blast.
    if (!normal && bossId === 'boss_1') for (let j = i + 1; j < layout.length; j++) {
      if (distance(p, layout[j]) <= 1) score -= Math.min(u.weight, info[j].weight) * 5;
    }
  }
  return score;
}

/** Legal direction / move / swap proposals, retaining the incumbent and the complete roster. */
export function windowProposals(layout, options, ctx, stage) {
  const out = new Map(), current = signature(layout);
  const offer = (trial, focus) => {
    const key = signature(trial);
    if (key === current || out.has(key) || new Set(trial.map(p => p.key)).size !== trial.length) return;
    out.set(key, { layout: trial, focus, score: windowLayoutValue(trial, ctx) });
  };
  for (let i = 0; i < layout.length; i++) for (const next of options[i]) {
    const old = layout[i];
    if (stage === 'facing' ? old.key !== next.key : stage === 'near' && distance(old, next) > 2) continue;
    const trial = layout.slice(), j = layout.findIndex((p, n) => n !== i && p.key === next.key);
    trial[i] = next;
    if (j >= 0) {
      const other = options[j].find(p => p.key === old.key && p.dir === layout[j].dir);
      if (!other) continue;
      trial[j] = other;
    }
    offer(trial, i);
  }
  const ranked = [...out.values()].sort((a, b) => b.score - a.score || a.focus - b.focus);
  const selected = [], groups = new Set();
  for (const p of ranked) {
    if (groups.has(p.focus)) continue;
    selected.push(p); groups.add(p.focus); if (selected.length === 2) break;
  }
  // A useful permutation can require two coordinated changes. Greedy geometry may propose that permutation,
  // but only the independent combat samples may accept it. Keep a single-step alternative alongside it.
  let joint = layout.slice();
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < joint.length; i++) {
    let preferred = joint, value = windowLayoutValue(joint, ctx);
    for (const next of options[i]) {
      const old = joint[i];
      if (stage === 'facing' ? old.key !== next.key : stage === 'near' && distance(old, next) > 2) continue;
      const trial = joint.slice(), j = joint.findIndex((p, n) => n !== i && p.key === next.key);
      trial[i] = next;
      if (j >= 0) {
        const other = options[j].find(p => p.key === old.key && p.dir === joint[j].dir);
        if (!other) continue;
        trial[j] = other;
      }
      const score = windowLayoutValue(trial, ctx);
      if (score > value + 1e-6) { preferred = trial; value = score; }
    }
    joint = preferred;
  }
  if (signature(joint) !== current && !selected.some(p => signature(p.layout) === signature(joint)))
    return [{ layout: joint, focus: -1, score: windowLayoutValue(joint, ctx) }, ...selected.slice(0, 1)];
  return selected;
}

export function* lateranoWindowSteps(m, ps, h, recipe, { cooperative = false, bossOnly = false } = {}) {
  const normal = !!m.wave;
  if ((!m.isSolo && !(cooperative && m.mode === 'coop')) || m.botRehearsal < 2 || m.round < 4 || m.round > m.gd.bossRound
    || cooperative && (m.isSolo || bossOnly && normal)) return;
  const chosen = [...ps.board.values()].filter(p => p.kind === 'chess');
  if (chosen.length < 3) return;
  const start = performance.now(), model = h.fieldModel(m, ps), records = chosen.map(p => h.rangeRec(ps, ps.gd.chess(p.id)));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  // An owner's move withdraws its summons. Keep such owners fixed, and forecast the exact existing summons
  // instead of letting the generic shadow-input helper silently propose a different summon deployment.
  const tokenOwners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const info = records.map(rec => {
    const id = m.gd.baseIdOf(rec.chessId), healer = rec.attackKind === 'heal' || rec.subProfessionId === 'incantationmedic';
    const dealer = !['heal', 'none'].includes(rec.attackKind) && rec.subProfessionId !== 'bard';
    const bb = rec.skill?.bb || {};
    return { healer, dealer, primary: ['chess_char_6_13_a', 'chess_char_6_01_a'].includes(id),
      weight: healer ? 4 : (PRIORITY[id] ?? Math.max(1, rec.tier / 2)) * (rec.isGolden ? 1.25 : 1),
      healable: acceptsHealing(rec), skill: rec.bonds?.includes('skillfulShip'), mostima: id === recipe.ids.mostima,
      elite: !!rec.isGolden, ammo: bb.ammo > 0 || bb['attack@trigger_time'] > 0,
      front: rec.position === 'MELEE' && (rec.stats?.blockCnt || 0) > 0 && rec.subProfessionId !== 'reaper',
      air: !!rec.canHitFly };
  });
  const ctx = { info, routes: model.routes.filter(r => !r.fallback && r.n > 0), bodies: model.bossBodies.flatMap(b => b.tiles),
    normal, bossId: m.bossId, skillActive: !!ps.bonds.skillfulShip?.active, diagonal: (ps.bonds.skillfulShip?.layers || 0) >= 40 };
  const options = chosen.map((piece, i) => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      const key = `${r},${c}`;
      if (reserved.has(key) || !ps._legal(piece, r, c)) continue;
      for (const dir of DIRS) {
        if (tokenOwners.has(piece.uid) && (key !== ps.find(piece.uid)?.key || dir !== piece.dir)) continue;
        out.push({ key, r, c, dir, cover: new Set(h.rangeTiles(records[i], r, c, dir)),
          heal: info[i].healer ? healingTiles(records[i], r, c, dir) : new Set() });
      }
    }
    return out;
  });
  let current = chosen.map((p, i) => options[i].find(o => o.key === ps.find(p.uid)?.key && o.dir === p.dir));
  if (current.some(p => !p)) return;
  const planOf = layout => { const plan = new h.LayoutPlan(); layout.forEach((p, i) => {
    plan.set(chosen[i].uid, p.key); plan.dirs.set(chosen[i].uid, p.dir);
  }); if (cooperative) plan.lineup = chosen; return plan; };
  const batches = [];
  const originalInput = ps.battleInput();
  function* inputSteps(plan) {
    yield;
    return windowBattleInput(originalInput, plan, { readingOrder: cooperative });
  }
  for (const stage of ['facing', 'near', 'reposition']) {
    const proposals = windowProposals(current, options, ctx, stage);
    if (!proposals.length) continue;
    const candidates = [current, ...proposals.map(p => p.layout)], plans = candidates.map(planOf);
    const job = cooperative ? yield* h.windowForecast(m, ps, chosen, plans, inputSteps, recipe)
      : yield* createForecastSteps(m, ps, chosen, plans, inputSteps, { rehearsalValue: recipe.rehearsalValue });
    if (!job) continue;
    while (!job.run(4)) yield;
    if (cooperative && job.stale) {
      (ps._botCoopWindowHistory ||= []).push({ round: m.round, boss: !normal, stale: true,
        batches, abortedStage: stage, ms: performance.now() - start });
      return; // Every stage was read-only; keep the inherited actual board after a teammate change.
    }
    let index = job.bestIndex;
    if (normal && index > 0) {
      const old = job.outcomes.filter(o => o.index === 0), next = job.outcomes.filter(o => o.index === index);
      // Do not disturb an already-safe farming formation for a speculative geometric/layer tie-break.
      const maxLoss = rows => Math.max(...rows.map(r => r.lost));
      const sumLoss = rows => rows.reduce((s, r) => s + r.lost, 0);
      if (!(maxLoss(next) < maxLoss(old) || maxLoss(next) === maxLoss(old) && sumLoss(next) < sumLoss(old))) index = 0;
    }
    current = candidates[index];
    batches.push({ stage, index, forecastIndex: job.bestIndex, outcomes: job.outcomes });
  }
  const plan = planOf(current);
  // Only operators move; summons remain reserved. All final swaps pass normal PlayerState legality.
  applyControlPositions(ps, plan);
  const audit = { round: m.round, batches, ms: performance.now() - start,
    positions: [...plan].map(([uid, key]) => ({ uid, key, dir: plan.dirs.get(uid) })) };
  if (cooperative) {
    if (JSON.stringify(ps.battleInput()) !== JSON.stringify(windowBattleInput(originalInput, plan, { readingOrder: true }))) throw Error('Co-op window differs from forecast input');
    (ps._botCoopWindowHistory ||= []).push({ ...audit, boss: !normal, stale: false });
  } else {
    ps._botLateranoWindow = audit;
    (ps._botWindowHistory ||= []).push(audit);
  }
}

export function withLateranoWindowRefinement(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* lateranoWindowSteps(m, ps, helpers, recipe);
  } });
}
