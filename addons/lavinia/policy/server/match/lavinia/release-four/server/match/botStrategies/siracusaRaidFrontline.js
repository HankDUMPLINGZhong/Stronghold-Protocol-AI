// [ASSUMED] Public-route joint candidates: non-Raid blockers retain the firing window while Raid waits behind.
// Fixed own roster only; no actual battle seed/result, private teammate roster or future shop information.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { raidDeploymentPlans } from './siracusaRaidDeployment.js';

const signature = p => [...p].map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).sort().join('|');
const dirs = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
function copy(p, h) {
  const q = new h.LayoutPlan(p); q.lineup = p.lineup; q.dirs = new Map(p.dirs); q.reserved = new Set(p.reserved || []); return q;
}

/** Add bounded simultaneous blocker moves before seeking quiet Raid homes. Tokens and their owners stay fixed;
 * existing wolf-first contact proposals remain in the inherited pool. Actual landing availability is simulated.
 */
export function raidFrontlinePlans(m, ps, h, inherited, sources) {
  const original = inherited[0];
  if (!ps.bonds.raidShip?.active || !sources.length) return inherited;
  const units = new Map([...ps.board.values()].map(p => [p.uid, p]));
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const raid = p => pieceBonds(ps.gd, p).includes('raidShip');
  const fixed = new Set([...units.values()].filter(p => p.kind !== 'chess' || owners.has(p.uid)
    || raid(p) || ps.gd.baseIdOf(p.id) === 'chess_char_4_10_a').map(p => p.uid));
  const routes = h.fieldModel(m, ps).routes.filter(r => !r.fly && !r.fallback && r.n > 0);
  if (!routes.length) return inherited;
  const recs = new Map([...units.values()].map(p => [p.uid, h.rangeRec(ps,
    p.kind === 'token' ? ps.gd.token(p.id) : ps.gd.chess(p.id))]));
  const melee = p => {
    const r = recs.get(p.uid); return r.position === 'MELEE' && r.stats?.blockCnt > 0
      && r.attackKind !== 'heal' && !['guardian', 'incantationmedic'].includes(r.subProfessionId);
  };
  const blockers = original.lineup.filter(p => !fixed.has(p.uid) && melee(p));
  const cache = new Map();
  const descriptor = (uid, key, dir) => {
    const sig = `${uid}:${key}:${dir}`; if (cache.has(sig)) return cache.get(sig);
    const p = units.get(uid), rec = recs.get(uid), s = rec.stats || {}, [r, c] = key.split(',').map(Number);
    const wolf = p.kind === 'token' && ps.gd.baseIdOf(units.get(p.ownerUid)?.id) === 'chess_char_3_19_a';
    const dps = rec.attackKind === 'heal' || rec.attackKind === 'none' ? 0 : (s.atk || 0) * (s.aspd || 100) / 100 / Math.max(.3, s.bat || 1.5);
    const value = { key, raid: raid(p), wolf, block: wolf ? 1 : s.blockCnt || 0,
      melee: melee(p), weight: Math.sqrt(Math.max(0, dps)), cover: new Set(h.rangeTiles(rec, r, c, dir)) };
    cache.set(sig, value); return value;
  };
  const score = plan => {
    const all = [...plan].map(([uid, key]) => descriptor(uid, key, plan.dirs.get(uid)));
    // Jumpers leave this window; do not count their starting range as sustained anchored fire.
    const fire = all.filter(u => !u.raid && u.weight > 0), total = fire.reduce((n, u) => n + u.weight, 0) || 1;
    let value = 0;
    for (const rt of routes) {
      const stops = all.filter(u => u.block && rt.tiles.includes(u.key)).sort((a, b) => rt.tiles.indexOf(a.key) - rt.tiles.indexOf(b.key));
      const first = stops[0]; if (!first) continue;
      const at = rt.tiles.indexOf(first.key), point = rt.tiles[Math.max(0, at - 1)];
      const share = fire.filter(u => u.cover.has(point) || u.cover.has(first.key)).reduce((n, u) => n + u.weight, 0) / total;
      const backup = stops.slice(1).some(u => !u.raid && (u.melee || u.wolf));
      value += rt.n * (share * share * 100 + (first.raid ? -90 : first.wolf ? 55 : first.melee ? 25 : -55) + (backup ? 15 : 0));
    }
    return value - [...plan].filter(([uid, key]) => original.get(uid) !== key).length * .2;
  };
  const change = (plan, uid, key, dir) => {
    const unit = units.get(uid), old = plan.get(uid), occupant = [...plan].find(([id, k]) => id !== uid && k === key);
    if (!ps._legal(unit, ...key.split(',').map(Number)) || original.reserved?.has(key)) return null;
    if (occupant && (fixed.has(occupant[0]) || !ps._legal(units.get(occupant[0]), ...old.split(',').map(Number)))) return null;
    const q = copy(plan, h); if (occupant) q.set(occupant[0], old);
    q.set(uid, key); q.dirs.set(uid, dir); return q;
  };
  const routeCells = [...new Set(routes.flatMap(r => r.tiles))], options = new Map();
  for (const p of blockers) {
    const [r, c] = original.get(p.uid).split(',').map(Number), offered = [];
    for (const key of routeCells) {
      const [a, b] = key.split(',').map(Number); if (Math.abs(a - r) + Math.abs(b - c) > 6) continue;
      for (const dir of dirs) { const q = change(original, p.uid, key, dir); if (q) offered.push({ key, dir, score: score(q) }); }
    }
    offered.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key) || dirs.indexOf(a.dir) - dirs.indexOf(b.dir));
    // Keep several different interception squares, rather than filling the beam with four facings of one square.
    const cells = new Set(), shortlist = [];
    for (const o of offered) if (!cells.has(o.key) && shortlist.length < 6) { cells.add(o.key); shortlist.push(o); }
    options.set(p.uid, shortlist);
  }
  const joint = [];
  for (let a = 0; a < blockers.length; a++) for (let b = a + 1; b < blockers.length; b++) {
    const u = blockers[a], v = blockers[b];
    for (const x of options.get(u.uid)) for (const y of options.get(v.uid)) {
      if (x.key === y.key) continue;
      const p = change(original, u.uid, x.key, x.dir), q = p && change(p, v.uid, y.key, y.dir);
      if (q && q.get(u.uid) === x.key && q.get(u.uid) !== original.get(u.uid)
        && q.get(v.uid) !== original.get(v.uid)) joint.push({ plan: q, score: score(q) });
    }
  }
  joint.sort((a, b) => b.score - a.score || signature(a.plan).localeCompare(signature(b.plan)));
  const fronts = [], frontSeen = new Set();
  for (const { plan } of joint) {
    const sig = blockers.map(p => plan.get(p.uid)).join('|');
    if (!frontSeen.has(sig) && fronts.length < 3) { fronts.push(plan); frontSeen.add(sig); }
  }
  const plans = [], seen = new Set();
  const add = p => {
    // raidDeploymentPlans intentionally returns chess entries; restore every unchanged token explicitly.
    for (const [uid, key] of original) if (!p.has(uid)) { p.set(uid, key); p.dirs.set(uid, original.dirs.get(uid)); }
    const sig = signature(p); if (seen.has(sig) || plans.length >= 18) return;
    const cells = new Set();
    for (const [uid, key] of p) {
      if (cells.has(key) || !ps._legal(units.get(uid), ...key.split(',').map(Number))) return;
      cells.add(key);
    }
    seen.add(sig); plans.push(p);
  };
  for (const p of inherited) add(p);
  for (const p of fronts) add(p);
  const missing = sources.map(s => s.uid);
  for (const start of [original, ...fronts.slice(0, 2)]) {
    const view = Object.assign(Object.create(ps), { board: new Map([...ps.board].map(([key, p]) =>
      [start.get(p.uid) || key, { ...p, dir: start.dirs.get(p.uid) || p.dir }])) });
    const proposals = raidDeploymentPlans(m, view, h, start, sources, missing);
    for (const p of proposals.slice(1, 5)) add(p);
  }
  return plans;
}
