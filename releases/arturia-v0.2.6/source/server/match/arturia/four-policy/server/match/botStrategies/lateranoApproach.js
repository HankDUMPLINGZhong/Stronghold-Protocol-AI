// [ASSUMED] Normal-wave contact alternatives over retained 27/10. Economy and roster are inherited.
// Geometry uses visible routes, legal cells and the owned squad only; independent forecasts choose the board.
import { canPlace, placeClass, legalTiles, parseKey } from '../../../../../board.js';
import { acceptsHealing } from '../botPositioning.js';
import { DIR_VEC } from '../../../../../../sim/dir.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const MAP02 = new Set(['12,4', '12,5', '11,6', '10,6']);
const base = u => u.rec.baseId || u.rec.chessId;
const frontRole = u => u.block > 0 && u.rec.position === 'MELEE'
  && (u.rec.profession === 'TANK' || u.rec.bonds?.includes('steadShip') || u.block >= 2);
const dealer = u => !u.heal && u.dps > 0 && (u.rec.position === 'RANGED' || u.rec.subProfessionId === 'lord');

/** The first assigned front on each real route; a fence or an off-road tank supplies no ground block. */
export function approachFronts(model, units, road) {
  let fronts = units.filter(frontRole);
  if (!fronts.length) fronts = units.filter(u => u.block > 0 && u.rec.position === 'MELEE');
  return model.routes.filter(rt => !rt.fly && !rt.fallback && rt.n > 0).map(route => {
    const candidates = fronts.filter(u => road.has(u.key) && route.tiles.includes(u.key));
    const unit = candidates.toSorted((a, b) => route.tiles.indexOf(a.key) - route.tiles.indexOf(b.key))[0];
    const index = unit ? route.tiles.indexOf(unit.key) : -1;
    return { route, unit, index, upstream: index > 0 ? route.tiles[index - 1] : null };
  });
}

/** Keep layer partners, but require incoming target coverage rather than just the blocker's own square. */
export function approachValue(model, units, ids, road) {
  const fronts = approachFronts(model, units, road), byRoute = new Map(fronts.map(f => [f.route, f]));
  const routes = model.routes.filter(rt => !rt.fallback && rt.n > 0), total = routes.reduce((n, rt) => n + rt.n, 0) || 1;
  const dealers = units.filter(dealer), weights = new Map(dealers.map(u => [u.uid, Math.max(1, u.dps)
    * ([ids.exusiaiAlter, ids.lemuen].includes(base(u)) ? 2 : 1)]));
  const sum = [...weights.values()].reduce((n, v) => n + v, 0) || 1;
  let score = 0;
  for (const rt of routes) {
    const weight = rt.n / total, f = byRoute.get(rt), end = f?.index >= 0 ? f.index : rt.tiles.length - 1;
    if (!rt.fly) {
      score += weight * (f?.unit ? 5 : -4);
      if (f?.upstream && !dealers.some(u => u.ground && u.cover.has(f.upstream))) score -= weight * 5;
    }
    for (const u of dealers) {
      if (rt.fly ? !u.air : !u.ground) continue;
      const share = weights.get(u.uid) / sum, at = rt.tiles.indexOf(u.key);
      // Count only targets before the blocking line; tiles near the exit cannot rescue its firing window.
      let hit = 0;
      for (let i = 0; i <= end; i++) if (u.cover.has(rt.tiles[i])) hit += 1 - i / Math.max(1, rt.tiles.length) * 0.4;
      score += weight * share * Math.min(12, hit * 2);
      if (f?.upstream) {
        if (u.cover.has(f.upstream)) score += weight * share * 12;
        else if (u.cover.has(f.unit.key)) score -= weight * share * 6;
      }
      if (f?.index >= 0 && at >= 0 && at <= f.index && !frontRole(u)) score -= weight * share * 7;
    }
    for (const h of units.filter(u => u.heal)) {
      const at = rt.tiles.indexOf(h.key);
      if (f?.index >= 0 && at >= 0 && at <= f.index) score -= weight * 3;
    }
  }
  const healers = units.filter(u => u.healCover.size);
  if (healers.length) for (const u of units) {
    if (!acceptsHealing(u.rec)) continue;
    const covered = healers.some(h => h !== u && h.healCover.has(u.key));
    score += (covered ? 1 : -1) * (u.heal ? 0.5 : weights.has(u.uid) ? weights.get(u.uid) / sum * 8 : frontRole(u) ? 1 : 0);
  }
  // Small prep-trait tie-breaks preserve a donor pair without letting it dominate the firing line.
  for (const u of units) {
    const [dr, dc] = DIR_VEC[u.dir], next = units.find(v => v.r === u.r + dr && v.c === u.c + dc);
    if (base(u) === ids.archetto && next) score += 0.6;
    if ([ids.ptilopsis4, ids.ptilopsis5].includes(base(u)) && next && base(next) === ids.archetto) score += 0.8;
    if (base(u) === ids.ayerscarpe && units.some(v => v.r === u.r - dr && v.c === u.c - dc)) score += 0.5;
  }
  return score;
}

export function* lateranoApproachPlans(m, ps, chosen, plans, helpers) {
  if (!m.wave || m.round < 4 || m.round >= m.gd.bossRound || chosen.length < 4) return [];
  const { model, unitOf, recOf, makePlan, ids } = helpers, gd = ps.gd || m.gd, map = ps.deployMap();
  const byUid = new Map(chosen.map(p => [p.uid, p]));
  const road = new Set([...map.keys()].filter(key => {
    const [r, c] = parseKey(key); return m.stage.tiles[m.stage.rows[r]?.[c]]?.groundPassable;
  }));
  const record = p => {
    const rec = recOf(p);
    if (rec.subProfessionId !== 'guardian') return rec;
    return { ...rec, healingGrid: loadoutRecord(rec, resolveRecordLoadout(rec, ps.loadoutFor(rec))).skill?.rangeGrid || [] };
  };
  const starts = plans.map(p => [...p].map(([uid, key]) => {
    const [r, c] = parseKey(key), u = unitOf(record(byUid.get(uid)), key, r, c, p.dirOf(uid), model); u.uid = uid; return u;
  }));
  const rank = us => (helpers.contactValue || approachValue)(model, us, ids, road), out = [];
  const first = starts.toSorted((a, b) => rank(b) - rank(a))[0];
  for (const mode of ['facing', 'joint']) {
    let units = first.slice();
    const frontCount = units.filter(frontRole).length;
    const options = new Map(units.filter(u => byUid.get(u.uid)?.kind === 'chess').map(u => {
      const cells = mode === 'facing' ? [[u.r, u.c]] : [...legalTiles(map, placeClass(ps, gd.chess(byUid.get(u.uid).id)))];
      return [u.uid, cells.filter(([r, c]) => !frontRole(u) || road.has(`${r},${c}`))
        .filter(([r, c]) => mode !== 'joint' || !frontRole(u) || m.stageId !== 'act1autochess_m02'
          || frontCount > 4 || MAP02.has(`${r},${c}`))
        .flatMap(([r, c]) => DIRS.map(dir => { const v = unitOf(u.rec, `${r},${c}`, r, c, dir, model); v.uid = u.uid; return v; }))];
    }));
    const order = units.toSorted((a, b) => Number(frontRole(b)) - Number(frontRole(a)) || Number(a.heal) - Number(b.heal)).map(u => u.uid);
    for (let pass = 0; pass < 2; pass++) for (const uid of order) {
      const i = units.findIndex(u => u.uid === uid), initial = units[i];
      if (!options.has(uid)) continue;
      let best = units, score = rank(units);
      for (const next of options.get(uid)) {
        const j = units.findIndex((u, n) => n !== i && u.key === next.key), other = j >= 0 ? units[j] : null;
        if (other && (mode === 'facing' || byUid.get(other.uid)?.kind !== 'chess'
          || !canPlace(map, placeClass(ps, gd.chess(byUid.get(other.uid).id)), initial.r, initial.c)
          || frontRole(other) && (!road.has(initial.key) || m.stageId === 'act1autochess_m02' && frontCount <= 4 && !MAP02.has(initial.key)))) continue;
        const trial = units.slice(); trial[i] = next;
        if (other) { const v = unitOf(other.rec, initial.key, initial.r, initial.c, other.dir, model); v.uid = other.uid; trial[j] = v; }
        const value = rank(trial);
        if (value > score + 1e-6) { score = value; best = trial; }
      }
      units = best; yield;
    }
    const proposal = makePlan();
    for (const u of units) { proposal.set(u.uid, u.key); proposal.dirs.set(u.uid, u.dir); }
    proposal.contact = true; out.push(proposal);
  }
  return out;
}

export const withLateranoApproach = recipe => Object.freeze({ ...recipe, normalContactPlans: lateranoApproachPlans });
