// [ASSUMED] Isolated owner experiment: repair zero firing coverage of real huge bodies at R14/R15.
// Preserve the selected roster, economy, rehearsal budget and already covered dealers.
import { canPlace, legalTiles, placeClass, pieceDir, parseKey } from '../../../../../board.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

export function largeBodyCoveragePlan(m, ps, h) {
  if (!m.isSolo || m.wave || ![m.gd.bossRound, m.gd.hiddenRound].includes(m.round)
    || m.botCoreStrategies === false || ps._botFocusId !== 'siracusaShip'
    || !m.opts?.botSiracusaEngines?.includes('boss')) return null;
  const model = h.fieldModel(m, ps);
  if (!model.bossBodies?.length) return null;
  const gd = ps.gd || m.gd, map = ps.deployMap(), plan = new Map(), byUid = new Map();
  plan.dirs = new Map(); plan.reserved = new Set(); plan.repairs = [];
  const units = [...ps.board].filter(([, p]) => p.kind === 'chess').map(([key, p]) => {
    const rec = h.rangeRec(ps, gd.chess(p.id));
    const raid = pieceBonds(gd, p).includes('raidShip');
    const u = { p, uid: p.uid, rec, raid, protectedLaunch: raid && !!ps.bonds.raidShip?.active,
      dps: h.isHealer(rec) ? 0 : h.effDps(model, rec), cls: placeClass(ps, gd.chess(p.id)) };
    plan.set(p.uid, key); plan.dirs.set(p.uid, pieceDir(p)); byUid.set(p.uid, u); return u;
  });
  const covers = (u, key = plan.get(u.uid), dir = plan.dirs.get(u.uid)) => {
    const [r, c] = parseKey(key), cover = new Set(h.rangeTiles(u.rec, r, c, dir));
    return model.bossBodies.some((b) => b.tiles.some((k) => cover.has(k)));
  };
  const required = (u) => u.dps > 0 && !u.protectedLaunch;
  const order = units.filter(required).sort((a, b) => {
    const rank = (u) => gd.baseIdOf(u.p.id) === 'chess_char_4_16_a' ? 2 : gd.baseIdOf(u.p.id) === 'chess_char_3_18_a' ? 1 : 0;
    return rank(b) - rank(a) || b.dps - a.dps || a.uid - b.uid;
  });
  for (const u of order) {
    if (covers(u)) continue;
    const oldKey = plan.get(u.uid), oldDir = plan.dirs.get(u.uid), [or, oc] = parseKey(oldKey);
    let best = null;
    for (const [r, c] of legalTiles(map, u.cls)) {
      const key = `${r},${c}`, other = units.find((v) => v.uid !== u.uid && plan.get(v.uid) === key);
      if (other?.protectedLaunch || other && !canPlace(map, other.cls, or, oc)) continue;
      // A swap must not turn another valid damage dealer into an idle slot.
      if (other && required(other) && covers(other) && !covers(other, oldKey, plan.dirs.get(other.uid))) continue;
      const dirs = u.raid ? ['RIGHT'] : [oldDir, ...['RIGHT', 'UP', 'DOWN', 'LEFT'].filter((d) => d !== oldDir)];
      for (const dir of dirs) {
        if (!covers(u, key, dir)) continue;
        // The factor only repairs missing coverage: prefer a turn, then a nearby empty tile, then a legal swap.
        const cost = (key === oldKey ? 0 : other ? 2 : 1) + (dir === oldDir ? 0 : 0.1)
          + (Math.abs(r - or) + Math.abs(c - oc)) * 0.01;
        if (!best || cost < best.cost - 1e-9) best = { key, dir, other, cost };
      }
    }
    if (!best) continue;
    if (best.other) plan.set(best.other.uid, oldKey);
    plan.set(u.uid, best.key); plan.dirs.set(u.uid, best.dir);
    plan.repairs.push({ uid: u.uid, id: u.p.id, from: oldKey, to: best.key, fromDir: oldDir, dir: best.dir, swap: best.other?.uid ?? null });
  }
  return plan.repairs.length ? plan : null;
}
