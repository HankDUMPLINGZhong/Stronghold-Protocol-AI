// Growth-only shared geometry: artillery lanes and ranged support of the first melee engagement on each route.
// [ASSUMED] A sustained firing lane matters more than briefly crossing several routes; keep placements within 90%
// of the best feasible lane score, then let the existing combat model choose safety, airflow and blocker support.
import { rotateOffset } from '../../../../../sim/dir.js';
import { SUB } from '../../../../../sim/professions.js';

/** Guardians heal through their selected skill, not their single-tile basic attack. */
export function healingTiles(rec, r, c, dir) {
  const healer = rec?.dmgType === 'heal' || rec?.attackKind === 'heal';
  const grid = healer ? rec.rangeGrid : rec?.subProfessionId === 'guardian' ? rec.healingGrid ?? rec.skill?.rangeGrid : null;
  return new Set((grid || []).map(([dr, dc]) => {
    const [a, b] = rotateOffset(dr, dc, dir); return `${r + a},${c + b}`;
  }));
}

export function acceptsHealing(rec) { return !SUB[rec?.subProfessionId]?.noHeal; }

/** Defenders with an actual blocking capacity establish contact; extended range does not make them a backliner. */
export function isFormationAnchor(rec) {
  return rec?.profession === 'TANK' && (rec.stats?.blockCnt || 0) >= 2;
}

/** [ASSUMED] Shared soft objective, alongside combat and positional traits, never a mandatory facing or tile. */
export function formationValue(model, units) {
  const routes = model.routes.filter((r) => !r.fly && !r.fallback && r.n > 0);
  const total = routes.reduce((n, r) => n + r.n, 0);
  if (!total) return 0;
  let value = 0;
  for (const rt of routes) {
    const weight = rt.n / total;
    const indices = units.map((u) => rt.tiles.indexOf(u.key));
    for (let j = 0; j < units.length; j++) {
      const u = units[j], at = indices[j];
      if (u.heal || !u.ground) continue;
      // The real first other blocker, including a summon; no promise that it survives or stops unblockable enemies.
      let front = Infinity;
      for (let k = 0; k < units.length; k++) if (k !== j && units[k].block > 0 && indices[k] >= 0) front = Math.min(front, indices[k]);
      if (isFormationAnchor(u.rec)) {
        if (at >= 0 && at > 0 && u.cover.has(rt.tiles[at - 1])) value += weight * 0.35;
        continue;
      }
      const ranged = u.rec.position === 'RANGED' || u.rec.subProfessionId === 'lord';
      if (!ranged) continue; // Melee interceptors remain free to pre-damage a separate section of the route.
      let incoming = 0;
      if (at >= 0) for (let k = Math.max(0, at - 5); k < at; k++) if (u.cover.has(rt.tiles[k])) incoming++;
      if (at >= 0 && at <= front) {
        const st = u.rec.stats || {};
        const bulk = (st.maxHp || 1000) * (1 + (st.def || 0) / 500);
        const fragile = Math.max(0.2, 1 - bulk / 7000);
        value -= weight * fragile * (1.4 - Math.min(5, incoming) * 0.14);
      }
      if (front < Infinity && u.cover.has(rt.tiles[front])) {
        const protectedPosition = at < 0 || at > front;
        value += weight * (protectedPosition ? 0.55 : 0.1);
        if (front > 0 && u.cover.has(rt.tiles[front - 1])) value += weight * 0.2;
      }
    }
  }
  return value;
}

/** First road-blocking melee on each actual ground route, ordered from its entrance, not by column. */
export function engagementFronts(model, units) {
  if (model.bossBodies?.length) return []; // Fixed bosses are evaluated against their real body, not a walking route.
  const blocks = new Set(units.filter((u) => u.block > 0).map((u) => u.key));
  return model.routes.filter((rt) => !rt.fly && !rt.fallback && rt.n > 0).flatMap((route) => {
    const index = route.tiles.findIndex((k) => blocks.has(k));
    return index < 0 ? [] : [{ route, index, key: route.tiles[index], upstream: route.tiles[index - 1] ?? null }];
  });
}

/**
 * [ASSUMED] Lexicographic priorities for a ranged dealer: cover the engagement, avoid being encountered before the
 * blocker, then cover one more incoming tile. Weight separate lanes by this wave's visible enemy count. Off-road
 * safety is only a geometric proxy; it does not assert immunity to ranged enemies or area damage.
 */
export function frontlineCoverage(fronts, cover, key) {
  let covered = 0, protectedFlow = 0, upstream = 0;
  for (const f of fronts) {
    if (!cover.has(f.key)) continue;
    const n = f.route.n, at = f.route.tiles.indexOf(key);
    covered += n;
    if (at < 0 || at > f.index) protectedFlow += n;
    if (f.upstream && cover.has(f.upstream)) upstream += n;
  }
  return { covered, protectedFlow, upstream };
}

export function isLineCaster(rec) {
  const grid = rec?.rangeGrid;
  return rec?.subProfessionId === 'blastcaster' && Array.isArray(grid) && grid.length >= 3
    && (grid.every(([r]) => r === 0) || grid.every(([, c]) => c === 0));
}

export function lineCoverage(model, rec, r, c, dir) {
  const cover = new Set(rec.rangeGrid.map(([dr, dc]) => {
    const [a, b] = rotateOffset(dr, dc, dir); return `${r + a},${c + b}`;
  }));
  let total = 0, sustained = 0, touched = 0, weightedTiles = 0, longest = 0;
  const routes = [];
  for (const rt of model.routes) {
    if (rt.fly && !rec.canHitFly) continue;
    const n = Math.max(0, rt.n), hits = rt.tiles.filter((key) => cover.has(key)).length;
    let run = 0, best = 0;
    for (const key of rt.tiles) { run = cover.has(key) ? run + 1 : 0; best = Math.max(best, run); }
    total += n; weightedTiles += n * hits;
    if (hits) touched += n;
    if (best >= Math.min(3, rt.tiles.length)) sustained += n;
    longest = Math.max(longest, best);
    routes.push({ n, hits, run: best });
  }
  if (!total) return { score: 0, flow: 0, touched: 0, weightedTiles: 0, longest: 0, routes };
  const flow = sustained / total;
  weightedTiles /= total;
  return { score: flow * 16 + longest * 2 + weightedTiles * 2 + touched / total,
    flow, touched: touched / total, weightedTiles, longest, routes };
}

/** Cells are already legal and unoccupied; no stage name, fixed row, future wave or enemy position is hardcoded. */
export function linePlacementGate(model, rec, cells, dirs) {
  if (!isLineCaster(rec)) return null;
  const scores = new Map();
  let best = 0;
  for (const [r, c] of cells) for (const dir of dirs) {
    const cover = new Set(rec.rangeGrid.map(([dr, dc]) => {
      const [a, b] = rotateOffset(dr, dc, dir); return `${r + a},${c + b}`;
    }));
    const score = model.bossBodies?.length
      ? model.bossBodies.filter((body) => body.tiles.some((k) => cover.has(k))).length
      : lineCoverage(model, rec, r, c, dir).score;
    scores.set(`${r},${c}:${dir}`, score); best = Math.max(best, score);
  }
  return { best, allows: (r, c, dir) => !best || (scores.get(`${r},${c}:${dir}`) || 0) >= best * (model.bossBodies?.length ? 1 : 0.9) };
}
