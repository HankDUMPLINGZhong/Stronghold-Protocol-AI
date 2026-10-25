// [ASSUMED] Fixed-roster R14 interception/medical-protection proposals over retained27/14.
// Public ground routes generate moves; two independent forecasts compare them with the retained board.
// No purchases, upgrades, equipment changes, live results, special seeds or map-specific coordinates.
import { GEO } from '../../../../../../../shared/constants.js';
import { BLOCK_RADIUS } from '../../../../../../sim/constants.js';
import { Grid } from '../../../../../../sim/grid.js';
import { deriveSeed } from '../../../../../../sim/rng.js';
import { fieldTile } from '../../../../../board.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { createBossRehearsalSteps } from '../botBossRehearsal.js';

const DIRS = ['RIGHT', 'UP', 'LEFT', 'DOWN'];
const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a']);
const signature = p => p.map(u => `${u.uid}:${u.key}:${u.dir}`).join('|');

/** First entry into the real ground blocking circle along a public route polyline. */
export function escortContact(route, point) {
  if (!point.blockable || !(point.block > 0)) return Infinity;
  const pts = route.points || route.tiles.map(k => k.split(',').map(Number));
  const radius2 = BLOCK_RADIUS.ground ** 2;
  let distance = 0;
  for (let i = 0; i < pts.length; i++) {
    const [r, c] = pts[i], dr = r - point.r, dc = c - point.c;
    if (dr * dr + dc * dc < radius2) return distance;
    if (i + 1 === pts.length) break;
    const [nr, nc] = pts[i + 1], vr = nr - r, vc = nc - c, length2 = vr * vr + vc * vc;
    if (!length2) continue;
    const projection = -(dr * vr + dc * vc) / length2;
    const gap2 = dr * dr + dc * dc - projection * projection * length2;
    if (gap2 < radius2) {
      const half = Math.sqrt(Math.max(0, (radius2 - gap2) / length2));
      const entry = Math.max(0, projection - half);
      if (entry <= 1 && projection + half >= 0) return distance + entry * Math.sqrt(length2);
    }
    distance += Math.sqrt(length2);
  }
  return Infinity;
}

/** Block before the medic, not merely close to it; keep the existing boss/healing windows. */
export function escortValue(layout, ctx) {
  let value = 0;
  for (const route of ctx.routes) {
    const at = layout.map(p => p.contacts.get(route));
    const front = Math.min(...layout.filter(p => p.anchor).map(p => at[layout.indexOf(p)]));
    for (let i = 0; i < layout.length; i++) {
      const u = layout[i]; if (u.anchor) continue;
      const weight = u.healer ? 8 : u.weight;
      value += route.n * weight * (!Number.isFinite(at[i]) || front + 0.05 < at[i] ? 5 : -7);
    }
    if (Number.isFinite(front)) value += route.n * 2;
  }
  for (const u of layout) {
    if (u.dealer) value += u.contact ? u.weight * 5 : -u.weight * 15;
    const healed = layout.some(h => h.heal.has(u.key));
    if (u.healable && !u.anchor) value += u.weight * (healed ? 6 : -3);
    if (u.anchor && ctx.hasHealer) value += healed ? (u.elite ? 8 : 45) : -(u.elite ? 4 : 35);
    // Healing uptime is a complete-team objective, not a reason to put every carry on one column.
    if (ctx.kind === 'boss_7') for (const v of layout) if (u.uid < v.uid && u.c === v.c) {
      if (!u.anchor && !v.anchor) value -= u.weight * v.weight * 2;
    }
    if (ctx.kind === 'boss_6') for (const v of layout) if (u.uid < v.uid
      && Math.abs(u.r - v.r) + Math.abs(u.c - v.c) <= 1) value -= u.weight * v.weight;
  }
  return value;
}

/** Candidate search is pure. Only legal one-card moves/swaps; the second proposal may also move a medic. */
export function* escortPlans(m, ps, helpers) {
  const chosen = [...ps.board.values()].filter(p => p.kind === 'chess');
  const model = helpers.fieldModel(m, ps);
  const routes = model.routes.filter(r => !r.fly && !r.fallback && !r.dwell && r.n > 0)
    .map(r => ({ ...r, points: r.tiles.map(k => k.split(',').map(Number)) }));
  if (!routes.length) return [];
  const gd = ps.gd || m.gd, stage = m.stage;
  const grid = new Grid({ ...stage, legend: stage?.tiles || stage?.legend }, GEO.BOSS_RECT);
  const bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([k]) => k));
  const records = new Map(chosen.map(p => [p.uid, helpers.rangeRec(ps, gd.chess(p.id))]));
  const anchors = chosen.filter(p => {
    const rec = records.get(p.uid);
    return rec.profession === 'TANK' && rec.stats.blockCnt >= 2;
  }).sort((a, b) => records.get(b.uid).stats.def - records.get(a.uid).stats.def || a.uid - b.uid).slice(0, 2);
  if (!anchors.length) return [];
  const anchorIds = new Set(anchors.map(p => p.uid));
  const locOf = (p, r, c, dir) => {
    const rec = records.get(p.uid), cover = new Set(helpers.rangeTiles(rec, r, c, dir));
    const healer = rec.attackKind === 'heal' || rec.subProfessionId === 'incantationmedic';
    const heal = rec.subProfessionId === 'incantationmedic' ? cover : healingTiles(rec, r, c, dir);
    const [sr, sc] = fieldTile('bossL', r, c);
    const anchor = anchorIds.has(p.uid), primary = MAIN.has(gd.baseIdOf(p.id));
    const loc = { uid: p.uid, key: `${r},${c}`, r, c, dir, healer, heal, elemental: rec.subProfessionId === 'wandermedic',
      anchor, primary, elite: gd.isGolden(p.id), block: rec.stats.blockCnt || 0, blockable: grid.blockable(sr, sc),
      saint: gd.baseIdOf(p.id) === 'chess_char_5_01_a',
      healable: acceptsHealing(rec), dealer: !healer && !anchor && rec.attackKind !== 'none' && rec.subProfessionId !== 'bard',
      weight: healer ? 6 : primary ? 9 : anchor ? 0.5 : Math.max(2, rec.tier),
      contact: [...bodies].some(k => cover.has(k)) };
    loc.contacts = new Map(routes.map(rt => [rt, escortContact(rt, loc)]));
    return loc;
  };
  const original = chosen.map(p => {
    const [r, c] = ps.find(p.uid).key.split(',').map(Number); return locOf(p, r, c, p.dir || 'RIGHT');
  });
  if (!original.some(u => u.healer)) return [];
  const options = new Map(chosen.map(p => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      if (reserved.has(`${r},${c}`) || !ps._legal(p, r, c)) continue;
      for (const dir of DIRS) out.push(locOf(p, r, c, dir));
    }
    return [p.uid, out];
  }));
  const safe = layout => original.every(u => {
    const next = layout.find(p => p.uid === u.uid);
    if (u.dealer && u.contact && !next.contact) return false;
    if (u.primary && u.healable && original.some(h => h.heal.has(u.key))
      && !layout.some(h => h.heal.has(next.key))) return false;
    if (m.bossId === 'boss_4' && (u.primary || u.anchor || u.saint)
      && original.some(h => h.elemental && h.heal.has(u.key))
      && !layout.some(h => h.elemental && h.heal.has(next.key))) return false;
    return true;
  });
  const ctx = { routes, kind: m.bossId, hasHealer: true }, originalValue = escortValue(original, ctx);
  function* improve(start, ids) {
    let best = start, value = escortValue(start, ctx);
    for (const uid of ids) {
      const i = start.findIndex(u => u.uid === uid), old = start[i];
      for (const loc of options.get(uid)) {
        const trial = start.slice(), j = trial.findIndex((u, n) => n !== i && u.key === loc.key);
        trial[i] = loc;
        if (j >= 0) {
          const other = options.get(trial[j].uid).find(u => u.key === old.key && u.dir === trial[j].dir);
          if (!other) continue; trial[j] = other;
        }
        if (!safe(trial)) continue;
        const score = escortValue(trial, ctx);
        if (score > value + 1e-6) { best = trial; value = score; }
      }
      yield;
    }
    return best;
  }
  const intercept = yield* improve(original, anchors.map(p => p.uid));
  const protectedLayout = yield* improve(intercept, intercept.filter(p => p.healer).map(p => p.uid));
  const candidates = [intercept, protectedLayout];
  // Tank facing affects its skills and early damage even when it can hit a blocked enemy in every direction.
  // Keep every facing of the selected interception, rather than resolving a geometry tie by DIRS order.
  for (const seed of [intercept, protectedLayout]) for (const p of anchors) {
    const i = seed.findIndex(u => u.uid === p.uid);
    for (const dir of DIRS) {
      const loc = options.get(p.uid).find(u => u.key === seed[i].key && u.dir === dir);
      if (!loc) continue; const trial = seed.slice(); trial[i] = loc;
      if (safe(trial)) candidates.push(trial);
    }
  }
  const out = [], seen = new Set([signature(original)]);
  for (const layout of candidates) {
    const sig = signature(layout); if (seen.has(sig) || escortValue(layout, ctx) <= originalValue + 1e-6) continue;
    seen.add(sig); const plan = new helpers.LayoutPlan(); plan.lineup = chosen;
    for (const u of layout) { plan.set(u.uid, u.key); plan.dirs.set(u.uid, u.dir); }
    plan.escortValue = escortValue(layout, ctx); out.push(plan); if (out.length >= 6) break;
  }
  return out;
}

/** Preserve worst-sample victory/LP/damage first; use medical survival and duration only as tie-breaks. */
export function escortChoice(first, second, deaths) {
  const wins = i => Number(first[i].won) + Number(second[i].won);
  const clearBenefit = i => wins(i) > wins(0) || wins(i) === 2 && wins(0) === 2
    && Math.min(first[i].lp, second[i].lp) > Math.min(first[0].lp, second[0].lp);
  const ranks = first.map((a, i) => {
    const b = second[i], won = a.won && b.won, ds = deaths.map(s => s[i]);
    return [Number(won), Number(a.won) + Number(b.won), won ? Math.min(a.lp, b.lp) : Math.min(a.damage, b.damage),
      (a.damage + b.damage) / 2, -Math.max(...ds.map(d => d.healer)), -Math.max(...ds.map(d => d.primary)),
      -Math.max(...ds.map(d => d.total)), -Math.max(a.duration, b.duration)];
  });
  let best = 0;
  for (let i = 1; i < ranks.length; i++) {
    // A small worst-sample damage increase alone cannot justify breaking the treatment/carry survival chain.
    if (!clearBenefit(i) && deaths.some(s => s[i].healer > s[0].healer || s[i].primary > s[0].primary)) continue;
    for (let j = 0; j < ranks[i].length; j++) {
      if (Math.abs(ranks[i][j] - ranks[best][j]) < 1e-6) continue;
      if (ranks[i][j] > ranks[best][j]) best = i; break;
    }
  }
  return best;
}

export function* bossEscortSteps(m, ps, helpers) {
  if (!m.isSolo || m.wave || m.round !== m.gd.bossRound || m.botRehearsal < 2) return;
  const start = performance.now(), alternatives = yield* escortPlans(m, ps, helpers);
  if (!alternatives.length) return;
  const chosen = [...ps.board.values()].filter(p => p.kind === 'chess'), original = new helpers.LayoutPlan();
  original.lineup = chosen;
  for (const p of chosen) { original.set(p.uid, ps.find(p.uid).key); original.dirs.set(p.uid, p.dir || 'RIGHT'); }
  const plans = [original, ...alternatives], outcomes = [], deaths = [];
  const inputs = p => helpers.bossInputSteps(m, ps, chosen, p, { keepWithdrawn: true });
  const medics = new Set(chosen.filter(p => {
    const rec = helpers.rangeRec(ps, ps.gd.chess(p.id)); return rec.attackKind === 'heal' || rec.subProfessionId === 'incantationmedic';
  }).map(p => p.uid));
  for (let sample = 0; sample < 2; sample++) {
    const counters = [], results = []; deaths.push(counters); outcomes.push(results);
    for (let offset = 0; offset < plans.length; offset += m.botRehearsal) {
      const indices = plans.slice(offset, offset + m.botRehearsal).map((_, i) => offset + i);
      if (indices.length === 1) indices.unshift(0);
      let built = 0;
      const owner = Object.assign(Object.create(m), { seed: deriveSeed(m.seed, `boss-escort:${sample}`), newBattle(options) {
        const battle = m.newBattle(options), count = { total: 0, healer: 0, primary: 0 }; counters[indices[built++]] = count;
        battle.on('death', ({ unit, reason }) => {
          if (reason !== 'killed' || unit.side === 'enemy' || unit.kind !== 'op') return;
          count.total++; if (medics.has(unit.uid)) count.healer++;
          if (MAIN.has(ps.gd.baseIdOf(unit.def.id))) count.primary++;
        });
        return battle;
      } });
      const job = yield* createBossRehearsalSteps(owner, ps, chosen, indices.map(i => plans[i]), inputs);
      if (!job) return; while (!job.run(4)) yield;
      for (const row of job.outcomes) results[indices[row.index]] = { ...row, index: indices[row.index] };
    }
  }
  const index = escortChoice(outcomes[0], outcomes[1], deaths);
  const snapshot = () => chosen.map(p => ({ uid: p.uid, id: p.id, key: ps.find(p.uid).key, dir: p.dir, items: p.items?.map(i => i.id) || [] }));
  const before = snapshot();
  if (index) yield* helpers.applyPlanSteps(m, ps, chosen, plans[index]);
  (ps._botBossEscortHistory ||= []).push({ round: m.round, kind: m.bossId, index, before, after: snapshot(),
    candidates: plans.map(p => ({ value: p.escortValue ?? null, positions: [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) })) })),
    outcomes, deaths, ms: performance.now() - start });
}

export function withLateranoBossEscort(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* bossEscortSteps(m, ps, helpers);
  } });
}
