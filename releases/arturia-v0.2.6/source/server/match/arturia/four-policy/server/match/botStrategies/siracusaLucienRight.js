// [ASSUMED] Owner's experiment: use the 30/32 firezone for Lucien's R14 only.
// Apply after the existing shopping, roster choice and rehearsals; draw no RNG.
import { canPlace, placeClass, legalTiles, pieceDir } from '../../../../../board.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

// Coordinates are the owner's display rows; the board stores row = 21 - displayRow.
const ANCHORS = [
  ['4_10', 11, 4, 'RIGHT'], // Aroma keeps the original long horizontal firing lane.
  ['5_22', 10, 7, 'RIGHT'], // Nymph fears toward the shared right-hand firing zone.
  ['2_16', 11, 8, 'RIGHT'],
  ['1_08', 11, 7, 'RIGHT'], // Ordinary Texas stays in the fence, as in 30/32.
  ['3_18', 12, 9, 'UP'],
  ['5_20', 12, 7, 'RIGHT'],
  ['5_10', 12, 8, 'LEFT'],
  ['6_18', 10, 8, 'RIGHT'], // Lappland Alter can use the advanced ranged slot.
  ['5_12', 10, 8, 'DOWN'],
];
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];

export function lucienRightPlan(m, ps, { rangeRec, rangeTiles }) {
  if (!m.isSolo || m.wave || m.round !== m.gd.bossRound || m.bossId !== 'boss_5'
    || m.botCoreStrategies === false || ps._botFocusId !== 'siracusaShip'
    || !m.opts?.botSiracusaEngines?.includes('boss')) return null;
  const gd = ps.gd || m.gd, map = ps.deployMap();
  const units = [...ps.board.values()].filter((p) => p.kind === 'chess');
  if (!units.length) return null;
  const plan = new Map(), taken = new Set();
  plan.dirs = new Map(); plan.reserved = new Set();
  const put = (p, key, dir) => { plan.set(p.uid, key); plan.dirs.set(p.uid, dir); taken.add(key); };
  // Retain the original Raid launch tile, so this experiment does not introduce initial contact before landing.
  for (const [key, p] of ps.board) {
    if (p.kind === 'chess' && pieceBonds(gd, p).includes('raidShip')) put(p, key, 'RIGHT');
  }
  const byValue = (a, b) => Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid;
  for (const [suffix, row, col, dir] of ANCHORS) {
    const p = units.filter((p) => !plan.has(p.uid) && gd.baseIdOf(p.id) === `chess_char_${suffix}_a`).sort(byValue)[0];
    const r = 21 - row, key = `${r},${col}`;
    if (p && !taken.has(key) && canPlace(map, placeClass(ps, gd.chess(p.id)), r, col)) put(p, key, dir);
  }
  // A different map/roster fills the legal tiles with coverage of columns 8--10.
  // Place melee-only units first, so ranged units cannot consume their last legal tile.
  const rest = units.filter((p) => !plan.has(p.uid)).sort((a, b) =>
    Number(placeClass(ps, gd.chess(b.id)) === 'melee') - Number(placeClass(ps, gd.chess(a.id)) === 'melee')
    || (gd.chess(b.id)?.tier || 0) - (gd.chess(a.id)?.tier || 0) || byValue(a, b));
  for (const p of rest) {
    const rec = gd.chess(p.id), range = rangeRec(ps, rec);
    let best = null;
    for (const [r, c] of legalTiles(map, placeClass(ps, rec))) {
      const key = `${r},${c}`;
      if (taken.has(key)) continue;
      for (const dir of DIRS) {
        let score = 0;
        for (const covered of rangeTiles(range, r, c, dir)) {
          const [rr, cc] = covered.split(',').map(Number);
          if (rr >= 9 && rr <= 12 && cc >= 8 && cc <= 10) score += cc >= 9 ? 5 : 2;
        }
        score -= Math.abs(c - 8) * 0.3 + Math.abs(r - 10.5) * 0.1;
        if (dir === 'RIGHT') score += 0.05;
        if (!best || score > best.score) best = { key, dir, score };
      }
    }
    if (!best) return null; // A full legal placement is required; keep the original formation otherwise.
    put(p, best.key, best.dir || pieceDir(p));
  }
  return plan;
}
