// [ASSUMED] Independent co-op adaptation of the retained solo Lucien R14 firezone.
// Use own-board coordinates; the actual boss field mirrors the right seat, including RIGHT -> LEFT.
// No roster, economy, layer, teammate-board, actual-battle-seed or forecast changes.
import { canPlace, placeClass, legalTiles, pieceDir } from '../../../../../board.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { LUCIEN_RIGHT_ANCHORS } from './siracusaLucienRight.js';

export const coopLucienRightScope = (m, ps) => m.mode === 'coop' && !m.isSolo && !m.wave
  && m.round === m.gd.bossRound && m.bossId === 'boss_5' && ps.bandId === 'band_chiave'
  && ps._botFocusId === 'siracusaShip' && m.botCoreStrategies !== false
  && m.opts?.botSiracusaEngines?.includes('boss') && (m.opts.botSiracusaCoopExperiment === 'coop-lucien-right'
    || m.opts.botSiracusaCoopExperiment === 'coop-opening-lucien-right' && m.order.length === 4);

/** Complete legal fixed-roster plan. Any failure keeps the entering layout in full. */
export function coopLucienRightPlan(m, ps, { rangeRec, rangeTiles }) {
  if (!coopLucienRightScope(m, ps)) return null;
  const group = m.bossGroupOf(ps); if (!group) return null;
  const gd = ps.gd || m.gd, map = ps.deployMap(), units = [...ps.board.values()].filter(p => p.kind === 'chess');
  if (!units.length) return null;
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const taken = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  const plan = new Map(); plan.dirs = new Map(); plan.reserved = new Set(taken); plan.side = group.side;
  plan.paired = group.players.length === 2; plan.fieldZone = group.side === 'R' ? [10, 12] : [8, 10]; plan.changes = [];
  const put = (p, key, dir) => { plan.set(p.uid, key); plan.dirs.set(p.uid, dir); taken.add(key); };
  // Keep quiet Raid homes/directions and every summon owner; never withdraw or re-place a summon.
  for (const [key, p] of ps.board) if (p.kind === 'chess' && (owners.has(p.uid) || pieceBonds(gd, p).includes('raidShip'))) put(p, key, pieceDir(p));
  const byValue = (a, b) => Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid;
  // The same local anchor faces inward on both seats. Terrain uses the real bossL/bossR deployment map.
  for (const [suffix, row, col, dir] of LUCIEN_RIGHT_ANCHORS) {
    const p = units.filter(p => !plan.has(p.uid) && gd.baseIdOf(p.id) === `chess_char_${suffix}_a`).sort(byValue)[0];
    const r = 21 - row, key = `${r},${col}`;
    if (p && !taken.has(key) && canPlace(map, placeClass(ps, gd.chess(p.id)), r, col)) put(p, key, dir);
  }
  const rest = units.filter(p => !plan.has(p.uid)).sort((a, b) =>
    Number(placeClass(ps, gd.chess(b.id)) === 'melee') - Number(placeClass(ps, gd.chess(a.id)) === 'melee')
    || gd.chess(b.id).tier - gd.chess(a.id).tier || byValue(a, b));
  for (const p of rest) {
    const rec = gd.chess(p.id), range = rangeRec(ps, rec); let best = null;
    for (const [r, c] of legalTiles(map, placeClass(ps, rec))) {
      const key = `${r},${c}`; if (taken.has(key)) continue;
      for (const dir of ['RIGHT', 'UP', 'DOWN', 'LEFT']) {
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
    if (!best) return null;
    put(p, best.key, best.dir);
  }
  for (const [key, p] of ps.board) if (p.kind === 'chess' && (plan.get(p.uid) !== key || plan.dirs.get(p.uid) !== pieceDir(p))) {
    plan.changes.push({ uid: p.uid, id: p.id, from: key, fromDir: pieceDir(p), to: plan.get(p.uid), dir: plan.dirs.get(p.uid) });
  }
  return plan;
}
