// [ASSUMED] Three independent trials over selected co-op3/56. No shopping or gameplay changes.
import { pieceBonds, computeBonds } from '../../../../../bondsMeta.js';
import { applyControlPositions, controlBonds } from './lateranoControlBoss.js';
import { stealthBattleInput, selectStealthRepair } from './lateranoStealthWave.js';
import { enemyTypeInfo, enemyRoleValue, enemyPositionPlans } from './lateranoEnemyTypes.js';
import { coopRoleEntryPlan, applyCoopRolePlan } from './lateranoCoopRoles.js';
import { withLateranoCoopBossSelf, createCoopSelfBossForecast } from './lateranoCoopBossSelf.js';

export const SIRACUSA_TACTIC_FACTORS = Object.freeze(['coop-stealth-contact', 'coop-pre-six-roles', 'coop-gun-contact']);
const CORE = 'siracusaShip', VIGIL = 'chess_char_3_19_a', AROMA = 'chess_char_4_10_a';
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const recOf = (ps, p) => p.kind === 'token' ? ps.gd.token(p.id) : ps.gd.chess(p.id);
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tank = r => r.profession === 'TANK' && r.stats?.blockCnt > 0;
const melee = r => r.position === 'MELEE' && r.stats?.blockCnt > 0 && !healer(r);
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const native = (ps, p) => pieceBonds(ps.gd, p).includes(CORE);
const wolves = (ps, p) => p.kind === 'token' && field(ps).some(o => o.uid === p.ownerUid && base(ps, o) === VIGIL);
const record = (ps, row) => (ps._botSiracusaCoopHistory ||= []).push(row);
const signature = p => [...p].map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
function copy(p, h) {
  const q = new h.LayoutPlan(p); q.lineup = p.lineup; q.dirs = new Map(p.dirs); q.reserved = new Set(p.reserved || []); return q;
}
function pins(ps, normal) {
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  return new Set(field(ps).filter(p => owners.has(p.uid) || pieceBonds(ps.gd, p).includes('raidShip')
    || normal && base(ps, p) === AROMA).map(p => p.uid));
}

/** Retain actual summons, replacing only positions explicitly present in the candidate. No projection/replanning. */
export function siracusaContactInput(ps, plan) {
  const input = stealthBattleInput(ps, plan);
  for (const u of input.units) if (plan.has(u.uid)) {
    [u.row, u.col] = plan.get(u.uid).split(',').map(Number); u.dir = plan.dirs.get(u.uid);
  }
  return input;
}
export function applySiracusaContact(ps, plan) {
  // A chess target may be a wolf's vacated cell. Move wolves to their reserved empty
  // destinations first; swapping them into the chess source can violate owner range.
  for (const [uid, key] of plan) if (ps.find(uid)?.piece.kind === 'token' && ps.find(uid).key !== key) {
    const [row, col] = key.split(',').map(Number);
    if (!ps.move(uid, { area: 'board', row, col }, plan.dirs.get(uid))?.ok) throw Error('Siracusa wolf interception rejected');
  }
  const chess = new Map([...plan].filter(([uid]) => ps.find(uid)?.piece.kind === 'chess')); chess.dirs = plan.dirs;
  applyControlPositions(ps, chess);
  for (const [uid, key] of plan) if (ps.find(uid)?.key !== key || ps.find(uid).piece.dir !== plan.dirs.get(uid)) throw Error('Siracusa contact plan differs');
}

/** Greedy joint candidates use current own routes and legal cells, never actual enemies/results. */
export function siracusaContactPlans(m, ps, h, snapshot, { gun = false, fixedUids = null, endurance = false, radius = 2, limit = 3 } = {}) {
  const original = snapshot(ps, h), onBoard = [...ps.board.values()].filter(p => ['chess', 'token'].includes(p.kind));
  for (const [key, p] of ps.board) if (p.kind === 'token') { original.set(p.uid, key); original.dirs.set(p.uid, p.dir || 'RIGHT'); }
  const model = h.fieldModel(m, ps), routes = model.routes.filter(r => !r.fallback && r.n > 0 && (!gun || r.dwell > 0));
  if (!routes.length) return [original];
  const fixed = fixedUids || pins(ps, !gun), units = new Map(onBoard.map(p => [p.uid, p])), cache = new Map();
  const six = (ps.bonds[CORE]?.count || 0) >= 6;
  const state = (p, key, dir) => {
    const ck = `${p.uid}:${key}:${dir}`; if (cache.has(ck)) return cache.get(ck);
    const rec = h.rangeRec(ps, recOf(ps, p)), [r, c] = key.split(',').map(Number), s = rec.stats || {};
    const rate = (s.aspd || 100) / 100 / Math.max(.3, s.bat || 1.5), hidden = six && p.kind === 'chess' && native(ps, p);
    const bb = ps.gd.bond(CORE)?.bb || {}, L = ps.layers[CORE] || 0;
    const proc = hidden ? ((bb.base_damage || 0) + (bb.damage_per_stack || 0) * L) * (bb.prob || 0) * rate : 0;
    const dps = healer(rec) || rec.attackKind === 'none' ? 0 : (s.atk || 0) * rate + proc;
    // Wolf's generated base block is zero; its combat kit supplies blocking from live wolf shadows.
    const isWolf = wolves(ps, p);
    const u = { p, key, r, c, dir, rec, hidden, wolf: isWolf, melee: melee(rec),
      block: isWolf ? 1 : s.blockCnt || 0, cover: new Set(h.rangeTiles(rec, r, c, dir)), weight: Math.sqrt(Math.max(0, dps)) };
    cache.set(ck, u); return u;
  };
  const descriptors = plan => [...plan].map(([uid, key]) => state(units.get(uid), key, plan.dirs.get(uid)));
  const score = plan => {
    const all = descriptors(plan), dealers = all.filter(u => u.weight > 0), total = dealers.reduce((n, u) => n + u.weight, 0) || 1;
    let value = 0;
    for (const rt of routes) {
      if (rt.fly) continue;
      const stops = all.filter(u => u.block > 0 && rt.tiles.includes(u.key)).sort((a, b) => rt.tiles.indexOf(a.key) - rt.tiles.indexOf(b.key));
      const first = stops[0];
      if (first) {
        const at = rt.tiles.indexOf(first.key), point = rt.tiles[Math.max(0, at - 1)];
        const share = dealers.filter(u => u.cover.has(point) || u.cover.has(first.key)).reduce((n, u) => n + u.weight, 0) / total;
        value += rt.n * (share * share * 70 + (first.wolf ? 55 : first.melee ? 18 : -55));
        if (!first.wolf && all.some(u => u.wolf && rt.tiles.includes(u.key))) value -= rt.n * 20;
        // Blocked enemies can attack a hidden blocker. Prefer melee/wolves over ranged support contact.
        if (!first.melee && !first.wolf && ['support', 'supporter'].includes(first.rec.profession?.toLowerCase())) value -= rt.n * 20;
        if (endurance) {
          const durability = u => Math.sqrt(Math.max(0, u.rec.stats?.maxHp || 0)) + (u.rec.stats?.def || 0) / 25;
          const backup = stops.slice(1).find(u => u.wolf || u.melee);
          value += rt.n * (Math.min(35, durability(first) / 3) - first.weight / total * 35
            + (backup ? 12 + Math.min(15, durability(backup) / 6) : -20));
        }
        if (gun) for (const u of dealers.filter(u => u !== first)) {
          const dr = first.r - u.r, dc = first.c - u.c;
          value += rt.n * (u.cover.has(first.key) ? 12 : 0) * u.weight / total;
          if (dr * dr + dc * dc <= 4) value -= rt.n * (u.hidden ? .5 : 3) * u.weight / total;
          for (const node of rt.tiles) {
            const [r, c] = node.split(',').map(Number), vr = first.r - r, vc = first.c - c, len = vr * vr + vc * vc;
            const t = len ? Math.max(0, Math.min(1, ((u.r - r) * vr + (u.c - c) * vc) / len)) : 0;
            if ((u.r - r - t * vr) ** 2 + (u.c - c - t * vc) ** 2 < .35 ** 2)
              value -= rt.n / rt.tiles.length * (u.hidden ? 2 : 12) * u.weight / total;
          }
        }
      }
      if (gun) for (const point of rt.tiles) {
        const share = dealers.filter(u => u.cover.has(point)).reduce((n, u) => n + u.weight, 0) / total;
        value += rt.n / rt.tiles.length * share * share * 100;
      }
    }
    return value - [...plan].filter(([uid, key]) => key !== original.get(uid)).length * .1;
  };
  const change = (plan, uid, key, dir) => {
    const p = units.get(uid), q = copy(plan, h), other = [...plan].find(([id, k]) => id !== uid && k === key);
    if (!ps._legal(p, ...key.split(',').map(Number))) return null;
    if (other) {
      const v = units.get(other[0]);
      if (v.kind !== 'chess' || fixed.has(v.uid) || !ps._legal(v, ...plan.get(uid).split(',').map(Number))) return null;
      q.set(v.uid, plan.get(uid));
    }
    q.set(uid, key); q.dirs.set(uid, dir); return q;
  };
  const options = new Map();
  for (const p of original.lineup.filter(p => !fixed.has(p.uid))) {
    const [r, c] = original.get(p.uid).split(',').map(Number), list = [];
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      if (Math.abs(dr) + Math.abs(dc) > radius) continue;
      const key = `${r + dr},${c + dc}`;
      if (original.reserved?.has(key) || !ps._legal(p, r + dr, c + dc)) continue;
      for (const dir of DIRS) list.push({ key, dir });
    }
    options.set(p.uid, list);
  }
  const starts = [original];
  if (!gun) for (const p of onBoard.filter(p => wolves(ps, p))) {
    let best = original, bestValue = score(original);
    for (const key of new Set(routes.filter(r => !r.fly).flatMap(r => r.tiles))) {
      if (ps.board.has(key) || !ps._legal(p, ...key.split(',').map(Number))) continue;
      const q = copy(original, h); q.set(p.uid, key); const v = score(q);
      if (v > bestValue) { best = q; bestValue = v; }
    }
    if (best !== original) starts.push(best);
  }
  const offered = [];
  for (const start of starts) {
    let joint = start, value = score(start);
    for (let pass = 0; pass < 2; pass++) for (const [uid, list] of options) {
      let next = joint, nextValue = value;
      for (const { key, dir } of list) { const q = change(joint, uid, key, dir); if (!q) continue;
        const v = score(q); if (v > nextValue + 1e-6) { next = q; nextValue = v; }
      }
      joint = next; value = nextValue;
    }
    if (signature(joint) !== signature(original)) { joint.contactScore = value; offered.push(joint); }
    if (start !== original) { start.contactScore = score(start); offered.push(start); }
  }
  offered.sort((a, b) => b.contactScore - a.contactScore || signature(a).localeCompare(signature(b)));
  const result = [original], seen = new Set([signature(original)]);
  // Preserve a wolf-first candidate before the generic second slot.
  if (!gun) {
    const wolf = offered.find(p => onBoard.some(u => wolves(ps, u) && p.get(u.uid) !== original.get(u.uid)));
    if (wolf) { result.push(wolf); seen.add(signature(wolf)); }
  }
  for (const p of offered) if (!seen.has(signature(p)) && result.length < limit) { result.push(p); seen.add(signature(p)); }
  return result;
}

/** Only real existing unplaced wolves: the authoritative move supplies any split UID. */
export function placeHeldWolf(m, ps, h) {
  if ([...ps.board.values()].some(p => wolves(ps, p))) return null;
  const item = [...ps.hand, ...ps.temp].find(p => p && wolves(ps, p)); if (!item) return null;
  const routes = h.fieldModel(m, ps).routes.filter(r => !r.fly && !r.fallback && r.n > 0), candidates = [];
  for (const rt of routes) for (const [i, key] of rt.tiles.entries()) if (!ps.board.has(key) && ps._legal(item, ...key.split(',').map(Number))) candidates.push({ key, score: rt.n / (i + 1) });
  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)); const pick = candidates[0]; if (!pick) return null;
  const [row, col] = pick.key.split(',').map(Number);
  if (!ps.move(item.uid, { area: 'board', row, col }, 'RIGHT')?.ok) throw Error('Held wolf legal deployment failed');
  return { uid: ps.board.get(pick.key).uid, key: pick.key };
}

export function siracusaPreSixPlans(m, ps, h, snapshot) {
  const original = snapshot(ps, h), chosen = original.lineup, threat = enemyTypeInfo(m, ps.gd), fixed = pins(ps, true);
  const rec = p => h.rangeRec(ps, ps.gd.chess(p.id)), hasTank = chosen.some(p => tank(rec(p))), hasHeal = chosen.some(p => healer(rec(p)));
  const before = controlBonds(ps, chosen), proposals = [], bench = ps.allChess().filter(p => !chosen.includes(p));
  for (const a of bench) {
    const ra = rec(a); if (pieceBonds(ps.gd, a).includes('raidShip')) continue;
    if (!(threat.pureAir ? ra.canHitFly && !healer(ra) : !hasTank && tank(ra) || !hasHeal && healer(ra))) continue;
    for (const d of chosen) {
      if (fixed.has(d.uid) || d.items?.length || healer(rec(d)) && !healer(ra) && !chosen.some(p => p !== d && healer(rec(p)))) continue;
      const lineup = chosen.map(p => p === d ? a : p), after = controlBonds(ps, lineup);
      if ((after[CORE]?.count || 0) < Math.min(6, before[CORE]?.count || 0)) continue;
      const plan = coopRoleEntryPlan(ps, h, original, lineup); if (!plan) continue;
      if (chosen.some(p => fixed.has(p.uid) && (plan.get(p.uid) !== original.get(p.uid) || plan.dirs.get(p.uid) !== original.dirs.get(p.uid)))) continue;
      const selected = new Set(lineup.map(p => p.uid)), view = Object.assign(Object.create(ps), {
        board: new Map([...ps.board].filter(([, p]) => p.kind !== 'chess')), hand: ps.hand.map(p => selected.has(p?.uid) ? null : p),
        temp: ps.temp.filter(p => !selected.has(p?.uid)), _legalityStale: false,
      });
      view.hand.push(...chosen.filter(p => !selected.has(p.uid)));
      for (const p of lineup) view.board.set(plan.get(p.uid), { ...p, dir: plan.dirs.get(p.uid) });
      view.bonds = computeBonds(ps.gd, view);
      const geo = enemyPositionPlans(m, view, { ...h, fixedUids: fixed }, threat)[1] || plan;
      geo.lineup = lineup; geo.entry = { incoming: a.uid, outgoing: d.uid,
        score: Number(!hasTank && tank(ra)) * 100 + Number(!hasHeal && healer(ra)) * 80 + enemyRoleValue(ra, threat) - enemyRoleValue(rec(d), threat) };
      proposals.push(geo);
    }
  }
  proposals.sort((a, b) => b.entry.score - a.entry.score || a.entry.incoming - b.entry.incoming || a.entry.outgoing - b.entry.outgoing);
  const plans = [original], seen = new Set();
  for (const p of proposals) if (!seen.has(p.entry.incoming) && plans.length < 3) { plans.push(p); seen.add(p.entry.incoming); }
  return plans;
}

const cache = new WeakMap();
export function withSiracusaTactic(parent, factor, { snapshot, probe }) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const gun = withLateranoCoopBossSelf({ *finalBoardSteps(m, ps, h) {
    const plans = siracusaContactPlans(m, ps, h, snapshot, { gun: true }); if (plans.length < 2) return;
    const job = yield* createCoopSelfBossForecast(m, ps, plans, 10); if (!job) return;
    while (!job.run(4)) yield;
    if (!job.stale && job.bestIndex) applySiracusaContact(ps, job.best);
    record(ps, { factor: 'coop-gun-contact', round: m.round, index: job.bestIndex, stale: job.stale, outcomes: job.outcomes,
      plans: plans.map(p => [...p]) });
  } });
  const recipe = Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!scope(m, ps)) return;
    if (factor === 'coop-gun-contact') {
      if (m.wave || m.round !== m.gd.bossRound || m.bossId !== 'boss_2') return;
      const old = ps._botCoopOwnBossModel; ps._botCoopOwnBossModel = 'template';
      try { yield* gun.finalBoardSteps(m, ps, h); }
      finally { if (old === undefined) delete ps._botCoopOwnBossModel; else ps._botCoopOwnBossModel = old; }
      return;
    }
    if (!m.wave || m.round < 1 || m.round > 13) return;
    if (factor === 'coop-stealth-contact') {
      if ((ps.bonds[CORE]?.count || 0) < 6) return;
      const deployedWolf = placeHeldWolf(m, ps, h), plans = siracusaContactPlans(m, ps, h, snapshot);
      if (deployedWolf) record(ps, { factor, round: m.round, kind: 'held-wolf', deployedWolf });
      if (plans.length < 2) return;
      const result = yield* probe(m, ps, h, plans, selectStealthRepair, { input: siracusaContactInput }); if (!result) return;
      if (!result.stale && result.job.bestIndex) applySiracusaContact(ps, result.job.best);
      record(ps, { factor, round: m.round, index: result.job.bestIndex, stale: result.stale, deployedWolf,
        outcomes: result.job.outcomes, plans: plans.map(p => [...p]) }); return;
    }
    if (m.round < 7 || m.round > 9 || (ps.bonds[CORE]?.count || 0) >= 6) return;
    const plans = siracusaPreSixPlans(m, ps, h, snapshot); if (plans.length < 2) return;
    const risk = yield* probe(m, ps, h, [plans[0]], () => ({ index: 0 }));
    const rows = risk?.job.outcomes || [];
    if (risk?.stale || rows.length !== 2 || rows.some(r => !r.valid || r.leaks < 3)) return;
    const result = yield* probe(m, ps, h, plans); if (!result) return;
    if (!result.stale && result.job.bestIndex) applyCoopRolePlan(ps, result.job.best);
    record(ps, { factor, round: m.round, index: result.job.bestIndex, stale: result.stale, outcomes: result.job.outcomes,
      entries: plans.slice(1).map(p => p.entry), plans: plans.map(p => [...p]) });
  } });
  variants.set(factor, recipe); return recipe;
}
