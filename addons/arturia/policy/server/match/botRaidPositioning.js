// [ASSUMED] Siracusa Raid opening: a quiet home plus a distinct empty, reachable landing per member.
// Geometry follows addon/battle.js raidTile (range, terrain, radius two); reservations use public route geometry.
import { rotateOffset } from '../../../../../sim/dir.js';
import { extendedGrid } from '../../../../../sim/targeting.js';
import { pieceBonds } from '../../../../bondsMeta.js';
import { legalTiles, canPlace, placeClass, basePositionClass, tileKey } from '../../../../board.js';

const DIRS = ['RIGHT']; // Owner's independent 25/3 trial: every Raid jump keeps RIGHT facing.
const range = (rec, r, c, dir) => new Set((rec.rangeGrid || [[0, 0]]).map(([dr, dc]) => {
  const [a, b] = rotateOffset(dr, dc, dir); return tileKey(r + a, c + b);
}));
const quietRange = (rec, r, c, dir) => new Set([
  ...extendedGrid(rec.rangeGrid || [[0, 0]], rec.skill?.bb?.ability_range_forward_extend || 0),
  ...(rec.skill?.rangeGrid || []), ...(rec.skill?.trigger?.customRangeGrid || []),
].map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return tileKey(r + a, c + b); }));

export function reserveRaidPositions(gd, pieces, plan, { model, map, occupied, recOf }) {
  if (gd.modeInactiveBonds.has('raidShip')) return null;
  const raiders = pieces.filter((p) => p.kind === 'chess' && pieceBonds(gd, p).includes('raidShip'));
  if (new Set(raiders.map((p) => gd.baseIdOf(p.id))).size < 2) return null;
  const visible = model.bossBodies?.length ? model.bossBodies : model.routes.filter((rt) => !rt.fly)
    .slice().sort((a, b) => b.n - a.n).flatMap((rt) => rt.tiles.map((key) => ({ center: key.split(',').map(Number), tiles: [key] })));
  const targets = [...new Map(visible.map((t) => [t.center.join(','), t])).values()];
  if (!targets.length) return null;
  // A quiet opening concerns the visible approach, not every tile the enemy may reach later.
  const contact = new Set([...model.routes.flatMap((rt) => rt.tiles.slice(0, 3)), ...(model.bossBodies || []).flatMap((t) => t.tiles)]);
  const choices = [];
  for (const p of raiders) {
    const rec = recOf(p), options = [];
    if (!rec || rec.attackKind === 'heal' || rec.attackKind === 'none') return null;
    const cells = [...legalTiles(map, placeClass(plan.ps, rec))].filter(([r, c]) => !occupied.has(tileKey(r, c)));
    for (const dir of DIRS) {
      const homes = cells.filter(([r, c]) => ![...quietRange(rec, r, c, dir)].some((key) => contact.has(key))).slice(0, Math.max(4, raiders.length));
      if (!homes.length) continue;
      for (const target of targets) for (const [r, c] of cells) {
        if (!canPlace(map, basePositionClass(rec), r, c) || Math.max(Math.abs(r - target.center[0]), Math.abs(c - target.center[1])) > 2) continue;
        const cover = range(rec, r, c, dir);
        if (!target.tiles.some((key) => cover.has(key))) continue;
        for (const [hr, hc] of homes) {
          const homeKey = tileKey(hr, hc), key = tileKey(r, c);
          if (homeKey === key) continue;
          options.push({ home: { key: homeKey, r: hr, c: hc, dir }, landing: { key, r, c, dir, cover } });
        }
      }
    }
    if (!options.length) return null;
    choices.push({ uid: p.uid, options });
  }
  // Match distinct homes/landings. Most constrained member first; bound work when a packed field is infeasible.
  choices.sort((a, b) => a.options.length - b.options.length || a.uid - b.uid);
  let budget = 4000;
  const starts = new Map(), landings = new Map(), used = new Set(occupied);
  const pick = (i) => {
    if (i === choices.length) return true;
    const { uid, options } = choices[i];
    for (const option of options) {
      if (--budget < 0) return false;
      const { home, landing } = option;
      if (used.has(home.key) || used.has(landing.key)) continue;
      used.add(home.key); used.add(landing.key); starts.set(uid, home); landings.set(uid, landing);
      if (pick(i + 1)) return true;
      used.delete(home.key); used.delete(landing.key); starts.delete(uid); landings.delete(uid);
    }
    return false;
  };
  if (!pick(0)) return null; // Never park a member out of combat when its landing is not also available.
  return { starts, landings, fixed: new Set(starts.keys()), reserved: new Set([...landings.values()].map((p) => p.key)) };
}
