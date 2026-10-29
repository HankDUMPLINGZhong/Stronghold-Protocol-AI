// [ASSUMED] Normal-wave firing/blocking geometry. Fixed roster; no seed-specific tiles or shop changes.
import { pieceBonds } from '../../../../../bondsMeta.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
export function siracusaFirePlans(m, ps, h, { directionsOnly = false, singleOnly = false, limit = 3 } = {}) {
  const chosen = [...ps.board.values()].filter(p => p.kind === 'chess'), model = h.fieldModel(m, ps);
  const routes = model.routes.filter(r => !r.fallback && r.n > 0), total = routes.reduce((s, r) => s + r.n, 0) || 1;
  const pinned = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  const recs = chosen.map(p => h.rangeRec(ps, ps.gd.chess(p.id)));
  const info = recs.map((r, i) => ({ rec: r, healer: r.attackKind === 'heal', front: r.position === 'MELEE' && r.stats?.blockCnt > 0,
    air: !!r.canHitFly, aroma: ps.gd.baseIdOf(chosen[i].id) === 'chess_char_4_10_a',
    weight: r.attackKind === 'heal' || r.attackKind === 'none' ? 0 : Math.max(1, (r.stats?.atk || 0) / (r.stats?.bat || 1.5)) }));
  if (directionsOnly && (ps.bonds.siracusaShip?.count || 0) >= 6) {
    const bb = ps.gd.bond('siracusaShip')?.bb || {}, layers = ps.layers.siracusaShip || 0;
    info.forEach((u, i) => { if (u.weight && pieceBonds(ps.gd, chosen[i]).includes('siracusaShip'))
      u.weight += ((bb.base_damage || 0) + (bb.damage_per_stack || 0) * layers) * (bb.prob || 0) / (u.rec.stats?.bat || 1.5); });
  }
  const pack = (i, r, c, dir) => ({ key: `${r},${c}`, r, c, dir, cover: new Set(h.rangeTiles(recs[i], r, c, dir)), heal: healingTiles(recs[i], r, c, dir) });
  const current = chosen.map((p, i) => { const [r, c] = ps.find(p.uid).key.split(',').map(Number); return pack(i, r, c, p.dir); });
  const options = chosen.map((p, i) => {
    const old = current[i];
    if (info[i].aroma || pinned.has(p.uid) || pieceBonds(ps.gd, p).includes('raidShip')) return [old];
    const out = [old];
    for (const [dr, dc] of directionsOnly ? [[0, 0]] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = old.r + dr, c = old.c + dc; if (reserved.has(`${r},${c}`) || !ps._legal(p, r, c)) continue;
      for (const dir of DIRS) if (dr || dc || dir !== old.dir) out.push(pack(i, r, c, dir));
    }
    return out;
  });
  const score = layout => {
    let value = 0;
    for (const rt of routes) {
      const eligible = info.map((u, i) => ({ u, i })).filter(({ u }) => u.weight && (!rt.fly || u.air));
      const sum = eligible.reduce((s, { u }) => s + u.weight, 0) || 1;
      const fronts = layout.map((p, i) => ({ p, i, at: rt.tiles.indexOf(p.key) })).filter(x => !rt.fly && info[x.i].front && x.at >= 0).sort((a, b) => a.at - b.at);
      const first = fronts[0], end = first?.at ?? rt.tiles.length - 1;
      const contact = first ? rt.tiles[Math.max(0, first.at - 1)] : null;
      let lane = first ? 2 : rt.fly ? 0 : -3;
      for (const { u, i } of eligible) {
        const p = layout[i], share = u.weight / sum;
        const hits = rt.tiles.slice(0, end + 1).filter(k => p.cover.has(k)).length;
        lane += share * Math.min(8, hits) * 1.5;
        if (contact && p.cover.has(contact)) lane += share * (u.aroma ? 30 : 16);
        const at = rt.tiles.indexOf(p.key);
        if (first && !u.front && at >= 0 && at < first.at) lane -= share * 8;
      }
      value += rt.n / total * lane;
    }
    for (let i = 0; i < layout.length; i++) if (acceptsHealing(recs[i]) && (info[i].front || info[i].aroma)) {
      const healers = layout.filter((p, j) => j !== i && p.heal.size);
      if (healers.length) value += healers.some(p => p.heal.has(layout[i].key)) ? 2 : -2;
    }
    return value;
  };
  const change = (layout, i, next) => {
    const trial = layout.slice(), j = layout.findIndex((p, k) => k !== i && p.key === next.key); trial[i] = next;
    if (j >= 0) { const swap = options[j].find(p => p.key === layout[i].key && p.dir === layout[j].dir); if (!swap) return null; trial[j] = swap; }
    return trial;
  };
  let single = null, best = score(current), joint = current.slice(); const singles = [];
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < chosen.length; i++) {
    let next = joint, value = score(joint);
    for (const option of options[i]) {
      if (!pass) { const trial = change(current, i, option); if (trial && score(trial) > score(current) + 1e-6) {
        singles.push({ trial, value: score(trial) });
        if (score(trial) > best + 1e-6) { single = trial; best = score(trial); }
      } }
      const trial = change(joint, i, option); if (trial && score(trial) > value + 1e-6) { next = trial; value = score(trial); }
    }
    joint = next;
  }
  const plans = [], seen = new Set();
  singles.sort((a, b) => b.value - a.value);
  // Fatal-only two-seat trial: try distinct units before a second facing of the same unit.
  const first = [], rest = [], units = new Set();
  if (singleOnly) for (const x of singles) {
    const i = x.trial.findIndex((p, j) => p.dir !== current[j].dir);
    if (units.has(i)) rest.push(x.trial); else { units.add(i); first.push(x.trial); }
  }
  const candidates = singleOnly ? [current, ...first, ...rest]
    : directionsOnly ? [current, joint, ...singles.map(x => x.trial)] : [current, joint, single];
  for (const layout of candidates.filter(Boolean)) {
    const signature = layout.map(p => `${p.key}:${p.dir}`).join('|'); if (seen.has(signature)) continue; seen.add(signature);
    const plan = new h.LayoutPlan(); plan.lineup = chosen;
    layout.forEach((p, i) => { plan.set(chosen[i].uid, p.key); plan.dirs.set(chosen[i].uid, p.dir); }); plans.push(plan);
    if (plans.length >= limit) break;
  }
  return plans;
}
