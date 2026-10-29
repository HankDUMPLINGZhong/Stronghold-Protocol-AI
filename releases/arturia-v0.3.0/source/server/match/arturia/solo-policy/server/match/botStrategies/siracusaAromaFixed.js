// [ASSUMED] Player-selected Aroma anchors for R1-13 only. Experimental fixture, not a selected profile.
// Coordinates are board coordinates; the review diagram uses row = 21 - board row.
// Preserve acquisition, roster, economy, rehearsal count and the R14 policy exactly.
import { canPlace } from '../../../../../board.js';

export const AROMA_ANCHORS = Object.freeze(Object.fromEntries(Object.entries({
  act1autochess_m02: { r: 11, c: 4, dir: 'RIGHT' },
  act1autochess_m03: { r: 9, c: 4, dir: 'RIGHT' },
  act1autochess_m04: { r: 10, c: 3, dir: 'RIGHT' },
  act2autochess_m01: { r: 9, c: 4, dir: 'RIGHT' },
  act2autochess_m02: { r: 9, c: 4, dir: 'RIGHT' },
  act2autochess_m03: { r: 10, c: 5, dir: 'RIGHT' },
  act2autochess_m04: { r: 11, c: 3, dir: 'RIGHT' },
}).map(([id, p]) => [id, Object.freeze(p)])));

const cached = new WeakMap();
export function withSiracusaAromaFixed(baseline, m) {
  if (cached.has(m)) return cached.get(m);
  const candidate = Object.freeze({ ...baseline,
    placementPlan(gd, pieces, plan, ctx) {
      const anchor = AROMA_ANCHORS[m.stageId];
      if (m.round < 1 || m.round > 13 || !anchor) return baseline.placementPlan?.(gd, pieces, plan, ctx);
      // Only one copy can occupy the player-selected tile. Prefer an elite, then the lowest existing UID.
      const aroma = pieces.filter(p => p.kind === 'chess' && gd.baseIdOf(p.id) === baseline.ids.aroma)
        .sort((a, b) => Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid)[0];
      const key = `${anchor.r},${anchor.c}`;
      if (!aroma || ctx.occupied.has(key) || !canPlace(ctx.map, 'ranged', anchor.r, anchor.c)) {
        return baseline.placementPlan?.(gd, pieces, plan, ctx);
      }
      // Let the existing Raid matcher find its usual distinct homes/landings around this occupied anchor.
      const previous = baseline.placementPlan?.(gd, pieces, plan, {
        ...ctx, occupied: new Set([...ctx.occupied, key]),
      });
      const starts = new Map(previous?.starts || []), fixed = new Set(previous?.fixed || []);
      starts.set(aroma.uid, { key, ...anchor }); fixed.add(aroma.uid);
      return { ...previous, starts, fixed, reserved: new Set(previous?.reserved || []) };
    },
  });
  cached.set(m, candidate);
  return candidate;
}
