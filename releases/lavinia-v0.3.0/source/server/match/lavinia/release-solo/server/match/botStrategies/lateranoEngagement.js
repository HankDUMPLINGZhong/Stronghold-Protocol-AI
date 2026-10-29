// [ASSUMED] Require a reachable firing window before the blocking line, independently of rehearsal outcomes.
// Solvent requires existing medical coverage. Faith is a tank and is never a Solvent carrier.
import { lateranoFocused } from './lateranoFocused.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { legalTiles, parseKey, placeClass, pieceDir } from '../../../../../board.js';

const solvent = rec => rec?.baseId === 'chess_item_1_05_e_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const medical = rec => rec.profession === 'MEDIC' || rec.subProfessionId === 'guardian';
const healingCache = new WeakMap();
const healingRecord = (ps, rec) => {
  let cache = healingCache.get(ps);
  if (!cache) healingCache.set(ps, (cache = new Map()));
  const loadout = resolveRecordLoadout(rec, ps.loadoutFor(rec)), key = `${rec.chessId}:${JSON.stringify(loadout)}`;
  if (!cache.has(key)) {
    const r = loadoutRecord(rec, loadout);
    cache.set(key, rec.subProfessionId === 'guardian' ? { ...r, healingGrid: r.skill?.rangeGrid || [] } : r);
  }
  return cache.get(key);
};

/** Only already deployed medical sources count; no purchases, lineup bonuses or forecasts of future healers. */
export function solventEligible(m, ps, target) {
  const gd = gdOf(m, ps), rec = gd.chess(target.id), loc = ps.find(target.uid);
  if (base(gd, target) === lateranoFocused.ids.faith || !acceptsHealing(rec) || loc?.area !== 'board'
    || target.items?.some(i => solvent(gd.item(i.id))) || (target.items?.length || 0) >= gd.equipPerChess) return false;
  const [r, c] = parseKey(loc.key);
  return [...ps.board.entries()].some(([key, p]) => {
    if (p.kind !== 'chess') return false;
    const source = healingRecord(ps, gd.chess(p.id));
    if (!medical(source)) return false;
    const [sr, sc] = parseKey(key);
    return healingTiles(source, sr, sc, pieceDir(p)).has(`${r},${c}`);
  });
}

const itemTargetAllowed = (m, ps, rec, target) => !solvent(rec) || solventEligible(m, ps, target);

/** Weighted reachable path before the first blocker, including the hold tile. Not an estimate of actual firing time. */
export function contactProfile(model, units, u) {
  let served = 0, hold = 0, window = 0, first = Infinity, exposed = 0, total = 0;
  for (const rt of model.routes) {
    if (rt.fallback || !(rt.fly ? u.air : u.ground) || !(rt.n > 0)) continue;
    total += rt.n;
    let stop = rt.tiles.length - 1;
    if (!rt.fly) for (const v of units) if (v.block > 0) {
      const at = rt.tiles.indexOf(v.key); if (at >= 0) stop = Math.min(stop, at);
    }
    const prefix = rt.tiles.slice(0, stop + 1), hits = prefix.filter(k => u.cover.has(k)).length;
    if (!hits) continue;
    served += rt.n;
    const delay = prefix.findIndex(k => u.cover.has(k)) * (rt.tileTime || 2);
    first = Math.min(first, delay);
    const held = !rt.fly && u.cover.has(rt.tiles[stop]);
    if (held) hold += rt.n;
    window += rt.n * (hits * (rt.tileTime || 2) + (held ? 8 : 0)) / (1 + delay / 20);
    const at = rt.tiles.indexOf(u.key);
    if (!rt.fly && u.rec.position === 'RANGED' && at >= 0 && at <= stop) exposed += rt.n;
  }
  const score = total ? (served * 3 + hold * 3 + window / 4 - exposed * 2) / total : 0;
  return { served, hold, window, first, score };
}

/** Keep usable farming geometry. Repair unreachable, rear-facing or much later firing windows without new RNG. */
function repairContact(m, ps, units, plan, model, { unitOf, map, occupied }) {
  const gd = gdOf(m, ps);
  const make = (u, key, dir) => {
    const [r, c] = parseKey(key), v = unitOf(u.rec, key, r, c, dir, model);
    v.uid = u.uid; return v;
  };
  const carry = u => !u.heal && u.dps > 0 && base(gd, u.rec) !== lateranoFocused.ids.faith
    && (u.rec.bonds?.includes('lateranoShip') || u.rec.bonds?.includes('preciShip'));
  for (let i = 0; i < units.length; i++) {
    const u = units[i]; if (!carry(u)) continue;
    const current = contactProfile(model, units, u);
    let best = u, rank = current;
    for (const dir of ['RIGHT', 'UP', 'DOWN', 'LEFT']) {
      const v = make(u, u.key, dir), next = contactProfile(model, units, v);
      if (next.score > rank.score + 1e-6) { best = v; rank = next; }
    }
    const poor = !current.served || !current.hold && rank.hold > 0
      || current.first > rank.first + 6 && current.window < rank.window * 0.7;
    if (poor) { units[i] = best; plan.dirs.set(best.uid, best.dir); }
  }
  const missing = units.map((u, i) => ({ u, i })).filter(({ u }) => carry(u) && !contactProfile(model, units, u).served)
    .sort((a, b) => b.u.dps - a.u.dps || a.u.uid - b.u.uid)[0];
  if (missing) {
    const { u, i } = missing, blocked = new Set([...plan.values(), ...plan.reserved, ...occupied]);
    let best = u, score = 0;
    for (const [r, c] of legalTiles(map, placeClass(ps, u.rec))) {
      const key = `${r},${c}`; if (blocked.has(key)) continue;
      for (const dir of ['RIGHT', 'UP', 'DOWN', 'LEFT']) {
        const v = make(u, key, dir), next = contactProfile(model, units, v);
        const piece = ps.find(u.uid)?.piece;
        if (piece?.items?.some(it => solvent(gd.item(it.id))) && !units.some(source => medical(source.rec)
          && healingTiles(healingRecord(ps, source.rec), source.r, source.c, source.dir).has(key))) continue;
        if (next.score > score + 1e-6) { best = v; score = next.score; }
      }
    }
    units[i] = best; plan.set(u.uid, best.key); plan.dirs.set(u.uid, best.dir);
  }
}

function layoutValue(gd, units, plan, bonds, model) {
  let value = lateranoFocused.layoutValue(gd, units, plan, bonds, model);
  const ps = plan.ps; if (!ps) return value;
  for (const u of units) {
    const p = ps.find(u.uid)?.piece; if (!p?.items?.some(i => solvent(gd.item(i.id)))) continue;
    if (!acceptsHealing(u.rec) || !units.some(v => medical(v.rec)
      && healingTiles(healingRecord(ps, v.rec), v.r, v.c, v.dir).has(u.key))) value -= 12;
  }
  return value;
}

export const lateranoContact = Object.freeze({ ...lateranoFocused, repairContact });
export const lateranoSustain = Object.freeze({ ...lateranoFocused, layoutValue, itemTargetAllowed });
export const lateranoEngagement = Object.freeze({ ...lateranoSustain, repairContact });
