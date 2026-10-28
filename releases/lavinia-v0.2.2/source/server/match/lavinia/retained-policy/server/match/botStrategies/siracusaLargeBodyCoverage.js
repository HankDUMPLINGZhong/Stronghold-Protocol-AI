// [ASSUMED] Isolated owner experiment: repair zero firing coverage of real huge bodies at R14/R15.
// Preserve the selected roster, economy, rehearsal budget and already covered dealers.
import { canPlace, legalTiles, placeClass, pieceDir, parseKey } from '../../../../../board.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { healingTiles } from '../botPositioning.js';

export function largeBodyCoveragePlan(m, ps, h) {
  const coop = m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_chiave'
    && ['coop-large-body-coverage', 'coop-lucien-right', 'coop-equipment', 'coop-stealth-contact', 'coop-pre-six-roles', 'coop-gun-contact', 'coop-staged-three', 'coop-fatal-contact', 'coop-held-boss-roster', 'coop-staged-three-mature', 'coop-staged-three-opening', 'coop-opening-fire-directions', 'coop-opening-lucien-right', 'coop-opening-first-aroma-cash', 'coop-first-aroma-cash', 'coop-two-r7-opening', 'coop-two-three-window', 'coop-two-fatal-facing', 'coop-two-r7-core-pair', 'coop-four-r7-core-pair'].includes(m.opts?.botSiracusaCoopExperiment);
  if ((!m.isSolo && !coop) || m.wave || ![m.gd.bossRound, m.gd.hiddenRound].includes(m.round)
    || m.botCoreStrategies === false || ps._botFocusId !== 'siracusaShip'
    || !m.opts?.botSiracusaEngines?.includes('boss')) return null;
  const model = h.fieldModel(m, ps);
  if (!model.bossBodies?.length) return null;
  const gd = ps.gd || m.gd, map = ps.deployMap(), plan = new Map(), byUid = new Map();
  plan.dirs = new Map(); plan.reserved = new Set(); plan.repairs = [];
  const owners = new Set(coop ? [...ps.board.values(), ...(ps.hand || []), ...(ps.temp || [])]
    .filter(p => p?.kind === 'token').map(p => p.ownerUid) : []);
  if (coop) for (const [key, p] of ps.board) if (p.kind !== 'chess') plan.reserved.add(key);
  const units = [...ps.board].filter(([, p]) => p.kind === 'chess').map(([key, p]) => {
    const rec = h.rangeRec(ps, gd.chess(p.id));
    const raid = pieceBonds(gd, p).includes('raidShip');
    const u = { p, uid: p.uid, rec, raid, protectedLaunch: raid && !!ps.bonds.raidShip?.active || owners.has(p.uid),
      dps: h.isHealer(rec) ? 0 : h.effDps(model, rec), cls: placeClass(ps, gd.chess(p.id)) };
    plan.set(p.uid, key); plan.dirs.set(p.uid, pieceDir(p)); byUid.set(p.uid, u); return u;
  });
  const covers = (u, key = plan.get(u.uid), dir = plan.dirs.get(u.uid)) => {
    const [r, c] = parseKey(key), cover = new Set(h.rangeTiles(u.rec, r, c, dir));
    return model.bossBodies.some((b) => b.tiles.some((k) => cover.has(k)));
  };
  const required = (u) => u.dps > 0 && !u.protectedLaunch;
  // Preserve every existing pure-medic/guardian healing relationship in the co-op-only trial.
  const healing = coop ? units.flatMap(u => {
    const [r, c] = parseKey(plan.get(u.uid)), cover = healingTiles(u.rec, r, c, plan.dirs.get(u.uid));
    return units.filter(v => v !== u && cover.has(plan.get(v.uid))).map(v => [u, v]);
  }) : [];
  const keepsHealing = (u, key, dir, other, oldKey) => healing.every(([medic, target]) => {
    const at = v => v === u ? key : v === other ? oldKey : plan.get(v.uid);
    const [r, c] = parseKey(at(medic));
    return healingTiles(medic.rec, r, c, medic === u ? dir : plan.dirs.get(medic.uid)).has(at(target));
  });
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
      if (plan.reserved.has(key) || other?.protectedLaunch || coop && other && h.isHealer(other.rec)
        || other && !canPlace(map, other.cls, or, oc)) continue;
      // A swap must not turn another valid damage dealer into an idle slot.
      if (other && required(other) && covers(other) && !covers(other, oldKey, plan.dirs.get(other.uid))) continue;
      const dirs = u.raid ? ['RIGHT'] : [oldDir, ...['RIGHT', 'UP', 'DOWN', 'LEFT'].filter((d) => d !== oldDir)];
      for (const dir of dirs) {
        if (!covers(u, key, dir)) continue;
        if (coop && !keepsHealing(u, key, dir, other, oldKey)) continue;
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
