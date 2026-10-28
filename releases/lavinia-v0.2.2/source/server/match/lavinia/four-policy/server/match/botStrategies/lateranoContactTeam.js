// [ASSUMED] Team contact refinement over the retained 25/8 experiment, using public routes and current assets only.
// Preserves its forecast budget. Static skill coverage is an opportunity estimate, never a promised active skill.
import { lateranoApproachPlans, approachValue, approachFronts } from './lateranoApproach.js';
import { canPlace, placeClass, legalTiles, parseKey } from '../../../../../board.js';
import { loadoutRecord, resolveRecordLoadout, extendedGrid } from '../../../../../../../shared/loadoutRecord.js';
import { rotateOffset } from '../../../../../../sim/dir.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const base = u => u.rec.baseId || u.rec.chessId;
const front = u => u.block > 0 && u.rec.position === 'MELEE';

/** Only a selected Archetto S3 grants this temporary extension; do not manufacture it for another skill/operator. */
export function contactSkillGrid(rec, ids) {
  if ((rec.baseId || rec.chessId) !== ids.archetto || rec.skill?.skillId !== 'skchr_archet_3') return rec.rangeGrid;
  const n = Math.floor(Number(rec.skill.bb?.ability_range_forward_extend) || 0);
  return n > 0 ? extendedGrid(rec.rangeGrid, n) : rec.rangeGrid;
}

/** Formation safety and ammo adjacency are evaluated together, before any battle is run. */
export function contactTeamValue(model, units, ids, road) {
  const expanded = units.map(u => u.skillCover ? { ...u, cover: u.skillCover } : u);
  let value = approachValue(model, units, ids, road) * 0.65 + approachValue(model, expanded, ids, road) * 0.35;
  const fronts = approachFronts(model, units, road), total = fronts.reduce((s, f) => s + f.route.n, 0) || 1;
  const opportunity = u => {
    let share = 0;
    for (const rt of model.routes) {
      if (rt.fallback || !(rt.n > 0) || (rt.fly ? !u.air : !u.ground)) continue;
      const f = fronts.find(f => f.route === rt), end = f?.index >= 0 ? f.index : rt.tiles.length - 1;
      const hits = rt.tiles.slice(0, end + 1).filter(k => u.cover.has(k) || u.skillCover?.has(k)).length;
      share += rt.n * Math.min(1, hits / 3);
    }
    return Math.min(1, share / Math.max(1, model.routes.reduce((s, rt) => s + (rt.fallback ? 0 : rt.n), 0)));
  };
  for (const f of fronts) {
    if (!f.unit) continue;
    // A frontline behind the operator it should protect is ineffective, regardless of the path's column number.
    for (const u of units) {
      const i = f.route.tiles.indexOf(u.key);
      if (!front(u) && i >= 0 && i < f.index) value -= 24 * f.route.n / total;
    }
  }
  for (const u of units) {
    if (base(u) === ids.mostima) for (const donor of units) {
      const bb = donor.rec.skill?.bb || {};
      if (Math.abs(u.r - donor.r) + Math.abs(u.c - donor.c) !== 1 || !(bb.ammo > 0 || bb['attack@trigger_time'] > 0)) continue;
      value += (u.rec.isGolden ? 12 : 6) * opportunity(donor);
    }
    if (base(u) === ids.executorAlter) value += opportunity(u) * 8;
  }
  return value;
}

function template(m, ps, chosen, source, h, lower) {
  const gd = ps.gd || m.gd, map = ps.deployMap(), rows = chosen.map(p => ({ p, rec: h.recOf(p) }));
  const pick = id => rows.filter(x => gd.baseIdOf(x.p.id) === id).toSorted((a, b) => Number(b.rec.isGolden) - Number(a.rec.isGolden) || a.p.uid - b.p.uid)[0];
  const saint = pick(h.ids.executorAlter), mostima = pick(h.ids.mostima), archetto = pick(h.ids.archetto);
  const blower = m.stageId === 'act2autochess_m01', infection = m.stageId === 'act1autochess_m04';
  if (!saint || !mostima || !blower && !infection) return null;
  const tanks = rows.filter(x => x.p !== saint.p && x.rec.position === 'MELEE' && (x.rec.stats?.blockCnt || 0) > 0)
    .toSorted((a, b) => Number(gd.baseIdOf(b.p.id) === h.ids.faith) - Number(gd.baseIdOf(a.p.id) === h.ids.faith)
      || (b.rec.stats.maxHp * (1 + b.rec.stats.def / 500)) - (a.rec.stats.maxHp * (1 + a.rec.stats.def / 500)) || a.p.uid - b.p.uid);
  if (!tanks.length) return null;
  const plan = h.makePlan(), used = new Set(), pins = new Set();
  const put = (x, r, c, dir) => {
    if (!x || plan.has(x.p.uid) || used.has(`${r},${c}`) || !canPlace(map, placeClass(ps, x.rec), r, c)) return false;
    plan.set(x.p.uid, `${r},${c}`); plan.dirs.set(x.p.uid, dir); used.add(`${r},${c}`); pins.add(x.p.uid); return true;
  };
  for (const p of chosen.filter(p => p.kind !== 'chess')) {
    const key = source.get(p.uid); if (!key) return null;
    plan.set(p.uid, key); plan.dirs.set(p.uid, source.dirOf(p.uid)); used.add(key); pins.add(p.uid);
  }
  if (blower) {
    if (lower) {
      if (!put(tanks[0], 9, 7, 'RIGHT') || !put(saint, 10, 7, 'DOWN')) return null;
      const newExusiai = pick(h.ids.exusiaiAlter);
      put(newExusiai, 12, 7, 'DOWN');
      const donors = rows.filter(x => pieceBonds(gd, x.p).includes('skillfulShip'));
      const active = !gd.modeInactiveBonds.has('skillfulShip') && new Set(donors.map(x => gd.baseIdOf(x.p.id))).size >= 2;
      const alreadyCovered = active && [...plan].some(([uid, key]) => {
        if (!donors.some(x => x.p.uid === uid)) return false;
        const [r, c] = parseKey(key), dr = Math.abs(r - 10), dc = Math.abs(c - 7);
        return (ps.layers.skillfulShip || 0) >= 40 ? Math.max(dr, dc) <= 1 : dr + dc <= 1;
      });
      // [ASSUMED] Start testing the mature-aura alternative at the real forty-layer diagonal breakpoint.
      const donor = active && !alreadyCovered && (ps.layers.skillfulShip || 0) >= 40 && newExusiai && donors.toSorted((a, b) =>
        Number(b.rec.attackKind === 'heal') - Number(a.rec.attackKind === 'heal') || b.rec.tier - a.rec.tier || a.p.uid - b.p.uid)[0];
      if (donor && put(donor, 11, 7, donor.rec.attackKind === 'heal' ? 'DOWN' : 'RIGHT')) put(mostima, 12, 6, 'RIGHT'); // Still adjacent to New Exusiai's real ammo.
      else if (!put(mostima, 11, 7, 'DOWN')) return null;
      put(pick(h.ids.executor), 10, 5, 'RIGHT');
      put(archetto, 9, 5, 'RIGHT'); // (9,6) in the proposed sketch is forbidden on this actual map.
    } else {
      if (!put(tanks[0], 12, 7, 'DOWN') || !put(saint, 12, 6, 'RIGHT') || !put(mostima, 12, 5, 'RIGHT')) return null;
      put(pick(h.ids.exusiaiAlter), 12, 4, 'RIGHT');
      put(pick(h.ids.executor), 11, 5, 'RIGHT'); put(archetto, 11, 4, 'RIGHT');
    }
  } else {
    // Existing tank line remains intact; only the user-taught shooter positions/directions change on this map.
    for (const { p } of rows) { const key = source.get(p.uid); plan.set(p.uid, key); plan.dirs.set(p.uid, source.dirOf(p.uid)); }
    const requested = [[saint, 11, 8], [mostima, 11, 7], [archetto, 10, 5]].filter(x => x[0]);
    const changed = new Set(requested.map(([x]) => x.p.uid));
    for (const [x, r, c] of requested) {
      if (!canPlace(map, placeClass(ps, x.rec), r, c) || [...plan].some(([uid, key]) => !changed.has(uid) && key === `${r},${c}`)) return null;
      plan.set(x.p.uid, `${r},${c}`); plan.dirs.set(x.p.uid, 'RIGHT');
    }
    return new Set(plan.values()).size === plan.size ? plan : null;
  }
  // Rear shooters are not required to stand in an airflow buff. Fill below the anchored ammo pair, facing the routes.
  for (const x of rows.filter(x => !pins.has(x.p.uid))) {
    const groundFront = x.rec.position === 'MELEE' && (x.rec.stats?.blockCnt || 0) > 0;
    let cells = [...legalTiles(map, placeClass(ps, x.rec))].filter(([r, c]) => !used.has(`${r},${c}`)
      && (groundFront ? c === 7 && m.stage.tiles[m.stage.rows[r]?.[c]]?.groundPassable : r <= 11 && c <= 5));
    if (!cells.length) cells = [...legalTiles(map, placeClass(ps, x.rec))].filter(([r, c]) => !used.has(`${r},${c}`));
    const units = [...plan].map(([uid, key]) => { const [r, c] = parseKey(key), u = h.unitOf(h.recOf(chosen.find(p => p.uid === uid)), key, r, c, plan.dirOf(uid), h.model); u.uid = uid; return u; });
    const options = cells.flatMap(([r, c]) => (groundFront || x.rec.attackKind === 'heal' ? DIRS : ['RIGHT']).map(dir => {
      const u = h.unitOf(x.rec, `${r},${c}`, r, c, dir, h.model); u.uid = x.p.uid;
      return { r, c, dir, value: h.contactValue(h.model, [...units, u], h.ids, h.road) };
    })).toSorted((a, b) => b.value - a.value || b.r - a.r || a.c - b.c);
    if (!options.length || !put(x, options[0].r, options[0].c, options[0].dir)) return null;
  }
  return plan.size === chosen.length ? plan : null;
}

export function withLateranoContactTeam(recipe, { lower = false } = {}) {
  return Object.freeze({ ...recipe,
    *normalContactPlans(m, ps, chosen, plans, helpers) {
      if (!m.wave || m.round < 4 || m.round >= m.gd.bossRound || chosen.length < 4) return [];
      const { ids } = recipe, gd = ps.gd || m.gd, map = ps.deployMap();
      const road = new Set([...map.keys()].filter(key => { const [r, c] = parseKey(key); return m.stage.tiles[m.stage.rows[r]?.[c]]?.groundPassable; }));
      const hasFront = chosen.some(p => gd.baseIdOf(p.id) !== ids.executorAlter && gd.chess(p.id)?.position === 'MELEE' && gd.chess(p.id)?.stats.blockCnt > 0);
      const h = { ...helpers, ids, road, contactValue: contactTeamValue,
        recOf(p) { const rec = helpers.recOf(p); return p.kind === 'chess' ? loadoutRecord(rec, resolveRecordLoadout(rec, ps.loadoutFor(rec))) : rec; },
        unitOf(rec, key, r, c, dir, model) {
          const u = helpers.unitOf(rec, key, r, c, dir, model), grid = contactSkillGrid(rec, ids);
          if (grid !== rec.rangeGrid) u.skillCover = new Set(grid.map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return `${r + a},${c + b}`; }));
          if (hasFront && (rec.baseId || rec.chessId) === ids.executorAlter) u.block = 0; // Output role; actual combat block is untouched.
          else if (u.block > 0 && rec.position === 'MELEE') u.block = Math.max(2, u.block); // Vina / other block-one interim fronts also establish a line.
          return u;
        } };
      const out = yield* lateranoApproachPlans(m, ps, chosen, plans, h);
      const fixed = template(m, ps, chosen, plans[0], h, lower); yield;
      if (fixed) out[0] = fixed;
      return out;
    },
    // An owned pair of Steadfast bodies can support a fragile interim front; never creates an acquisition project.
    lineupBonus(gd, pieces, bonds, plan) {
      const value = recipe.lineupBonus(gd, pieces, bonds, plan);
      if (plan.ps?.m.round >= gd.bossRound || pieces.some(p => gd.baseIdOf(p.id) === recipe.ids.faith)) return value;
      return value + (bonds.steadShip?.count >= 2 && bonds.lateranoShip?.count >= 6 ? 8 : 0);
    }
  });
}
