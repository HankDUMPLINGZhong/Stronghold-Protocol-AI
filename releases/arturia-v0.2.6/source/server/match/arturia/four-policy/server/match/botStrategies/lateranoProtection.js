// [ASSUMED] R14 alternatives for the medic/four-tier development candidate only.
// Geometry proposes moves; independent forecast seeds compare them. No observed battle result or seed is queried.
import { legalTiles, canPlace, placeClass, parseKey, tileKey } from '../../../../../board.js';
import { acceptsHealing, isFormationAnchor } from '../botPositioning.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const distance = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
const base = (gd, u) => gd.baseIdOf(u.rec.chessId);

/** Relative firing time along the public route; bodies count once even when several occupied tiles overlap. */
export function protectionContact(u, model) {
  if (u.heal || !u.ground || !(u.dps > 0)) return 0;
  if (model.bossBodies.length) return model.bossBodies.filter(b => b.tiles.some(k => u.cover.has(k))).length / model.bossBodies.length;
  const routes = model.routes.filter(r => r.dwell > 0);
  if (!routes.length) return 0;
  return routes.reduce((sum, rt) => {
    let longest = 0, run = 0, hits = 0;
    for (const key of rt.tiles) {
      if (u.cover.has(key)) { hits++; run++; longest = Math.max(longest, run); } else run = 0;
    }
    return sum + (hits * 0.6 + longest * 0.4) / Math.max(1, rt.tiles.length);
  }, 0) / routes.length;
}

/** Combat-only score: continuous contact, actual healing grids, and protection from public approach/area geometry. */
export function protectionScore(gd, units, model, ids, bossId, safety = 1, cache = null) {
  const dealers = units.filter(u => !u.heal && u.ground && u.dps > 0);
  const main = u => cache?.main.has(u.uid) ?? [ids.exusiaiAlter, ids.lemuen].includes(base(gd, u));
  const weight = u => u.dps * (main(u) ? 3 : 1);
  const total = dealers.reduce((n, u) => n + weight(u), 0) || 1;
  const share = u => cache?.share.get(u.uid) ?? weight(u) / total;
  const medics = units.filter(u => u.healCover.size > 0);
  let score = 0;
  for (const u of dealers) {
    let contact = cache?.contact.get(u);
    if (contact == null) { contact = protectionContact(u, model); cache?.contact.set(u, contact); }
    score += share(u) * contact * 30;
    if (main(u) && contact === 0) score -= 20;
    if (acceptsHealing(u.rec) && medics.length) {
      const covered = medics.some(h => h !== u && h.healCover.has(u.key));
      score += share(u) * (covered ? 9 : -7) * safety;
    }
  }
  for (const healer of medics) {
    if (healer.heal && medics.some(h => h !== healer && h.healCover.has(healer.key))) score += safety;
  }
  const routes = cache?.routes || model.routes.filter(r => !r.fly && !r.fallback && r.n > 0);
  const flow = routes.reduce((n, r) => n + r.n, 0) || 1;
  const anchorKeys = new Set(units.filter(u => isFormationAnchor(u.rec)).map(u => u.key));
  const fronts = routes.map(rt => rt.tiles.findIndex(k => anchorKeys.has(k)));
  for (const u of units) {
    if (isFormationAnchor(u.rec)) continue;
    const importance = u.heal ? 0.5 : share(u);
    if (!importance) continue;
    for (let i = 0; i < routes.length; i++) {
      const rt = routes[i];
      const at = rt.tiles.indexOf(u.key);
      const front = fronts[i];
      if (at >= 0 && (front < 0 || at <= front)) score -= importance * rt.n / flow * 9 * safety;
    }
  }
  // Public boss mechanics: Sami strikes entire columns; the shield's projectile affects a 3x3 area.
  if (bossId === 'boss_7' || bossId === 'boss_1') for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j];
    const hitTogether = bossId === 'boss_7' ? a.c === b.c : distance(a, b) <= 1;
    if (hitTogether) score -= ((a.heal ? 0.3 : share(a)) + (b.heal ? 0.3 : share(b))) * safety * 2;
  }
  return score;
}

/** Three bounded complete alternatives; legal empty tiles and pair swaps, original roster/items/directions retained unless searched. */
export function* lateranoProtectionPlans(m, ps, chosen, plans, { model, unitOf, recOf, makePlan, ids }) {
  if (m.round !== m.gd.bossRound || m.wave || !m.isSolo) return [];
  const gd = ps.gd || m.gd, map = ps.deployMap(), byUid = new Map(chosen.map(p => [p.uid, p]));
  const starts = plans.map(plan => [...plan].map(([uid, key]) => {
    const p = byUid.get(uid), [r, c] = parseKey(key), u = unitOf(recOf(p), key, r, c, plan.dirOf(uid), model);
    u.uid = uid; return u;
  }));
  const out = [];
  const dealers = starts[0].filter(u => !u.heal && u.ground && u.dps > 0);
  const main = new Set(dealers.filter(u => [ids.exusiaiAlter, ids.lemuen].includes(base(gd, u))).map(u => u.uid));
  const weight = u => u.dps * (main.has(u.uid) ? 3 : 1);
  const total = dealers.reduce((n, u) => n + weight(u), 0) || 1;
  const cache = { main, share: new Map(starts[0].map(u => [u.uid, weight(u) / total])), contact: new WeakMap(),
    routes: model.routes.filter(r => !r.fly && !r.fallback && r.n > 0) };
  for (const safety of [0.5, 1.5, 3]) {
    const rank = us => protectionScore(gd, us, model, ids, m.bossId, safety, cache);
    let units = starts.toSorted((a, b) => rank(b) - rank(a))[0].slice();
    const options = new Map(units.filter(u => byUid.get(u.uid)?.kind === 'chess').map(u => [u.uid,
      [...legalTiles(map, placeClass(ps, gd.chess(byUid.get(u.uid).id)))].flatMap(([r, c]) => DIRS.map(dir => {
        const v = unitOf(u.rec, tileKey(r, c), r, c, dir, model); v.uid = u.uid; return v;
      }))]));
    for (let pass = 0; pass < 1; pass++) for (let i = 0; i < units.length; i++) {
      const initial = units[i];
      if (!options.has(initial.uid)) continue;
      let best = units.slice(), score = rank(units);
      for (const next of options.get(initial.uid)) {
        const j = units.findIndex((u, n) => n !== i && u.key === next.key), other = j >= 0 ? units[j] : null;
        if (other && (byUid.get(other.uid)?.kind !== 'chess'
          || !canPlace(map, placeClass(ps, gd.chess(byUid.get(other.uid).id)), initial.r, initial.c))) continue;
        const trial = units.slice(); trial[i] = next;
        if (other) { const v = unitOf(other.rec, initial.key, initial.r, initial.c, other.dir, model); v.uid = other.uid; trial[j] = v; }
        const value = rank(trial);
        if (value > score + 1e-6) { best = trial; score = value; }
      }
      units = best;
      yield;
    }
    const plan = makePlan();
    for (const u of units) { plan.set(u.uid, u.key); plan.dirs.set(u.uid, u.dir); }
    plan.protection = true; out.push(plan);
  }
  return out;
}

export function withLateranoProtection(recipe) {
  return Object.freeze({ ...recipe, finalProtectionPlans: lateranoProtectionPlans, forecastPlanLimit: 6 });
}
