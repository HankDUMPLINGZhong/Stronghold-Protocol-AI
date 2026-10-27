// [ASSUMED] Independent R14 geometry factor: retain the entering formation, propose carry/medic/blocker moves.
// Public boss bodies/routes and owned pieces only. No purchases, layer targets or saved winning coordinates.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { selectFinalSwap } from './lateranoFinalSwap.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const dealer = r => !['heal', 'none'].includes(r.attackKind) && r.subProfessionId !== 'bard' && (r.stats?.atk || 0) > 0;
const distance = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
const eligible = m => m.isSolo && !m.wave && m.round === m.gd.bossRound && m.botRehearsal >= 3;

export function bossFormationSnapshot(ps, h) {
  const p = new h.LayoutPlan(); p.lineup = field(ps).sort((a, b) => a.uid - b.uid);
  for (const u of p.lineup) { p.set(u.uid, ps.find(u.uid).key); p.dirs.set(u.uid, u.dir || 'RIGHT'); }
  return p;
}

/** Simultaneous role assignment; displaced allies receive legal freed tiles rather than being withdrawn. */
export function linkedFormationPlan(ps, h, original, targets) {
  const targetUids = new Set(targets.map(t => t.uid)), targetKeys = new Set(targets.map(t => t.key));
  if (targetKeys.size !== targets.length) return null;
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([k]) => k));
  for (const t of targets) {
    const u = original.lineup.find(p => p.uid === t.uid);
    if (!u || reserved.has(t.key) || !ps._legal(u, ...t.key.split(',').map(Number))
      || owners.has(u.uid) && (original.get(u.uid) !== t.key || u.dir !== t.dir)) return null;
  }
  const displaced = original.lineup.filter(p => !targetUids.has(p.uid) && targetKeys.has(original.get(p.uid)));
  if (displaced.some(p => owners.has(p.uid))) return null;
  const free = targets.map(t => original.get(t.uid)).filter(k => !targetKeys.has(k));
  const p = new h.LayoutPlan(); p.lineup = original.lineup;
  for (const u of p.lineup) { p.set(u.uid, original.get(u.uid)); p.dirs.set(u.uid, original.dirs.get(u.uid)); }
  for (const t of targets) { p.set(t.uid, t.key); p.dirs.set(t.uid, t.dir); }
  const assign = (i, available) => {
    if (i === displaced.length) return true;
    for (const key of available) if (ps._legal(displaced[i], ...key.split(',').map(Number))) {
      p.set(displaced[i].uid, key);
      if (assign(i + 1, available.filter(k => k !== key))) return true;
    }
    return false;
  };
  if (!assign(0, free) || new Set(p.values()).size !== p.lineup.length) return null;
  return p;
}

/** Candidate diversity follows role positions, never a stage ID, seed, previous match or cached victory. */
export function bossLinkedPlans(m, ps, h, recipe, original = bossFormationSnapshot(ps, h), { healingRange = ps._botCoopHealingRange || healingTiles } = {}) {
  const units = original.lineup.slice().sort((a, b) => a.uid - b.uid), rec = p => h.rangeRec(ps, ps.gd.chess(p.id));
  const mains = new Set([recipe.ids.exusiaiAlter, recipe.ids.lemuen]);
  const carryValue = p => {
    const r = rec(p), s = r.stats || {};
    return (s.atk || 0) * (s.aspd || 100) / (100 * Math.max(.3, s.bat || 1))
      * (ps.gd.isGolden(p.id) ? 1.6 : 1) * (mains.has(ps.gd.baseIdOf(p.id)) ? 2 : 1);
  };
  const carries = units.filter(p => dealer(rec(p)) && rec(p).profession !== 'TANK')
    .sort((a, b) => Number(mains.has(ps.gd.baseIdOf(b.id))) - Number(mains.has(ps.gd.baseIdOf(a.id)))
      || carryValue(b) - carryValue(a) || a.uid - b.uid).slice(0, 2);
  const medics = units.filter(p => healer(rec(p)) && rec(p).profession !== 'TANK')
    .sort((a, b) => Number(rec(b).subProfessionId === 'wandermedic') - Number(rec(a).subProfessionId === 'wandermedic')
      || carryValue(b) - carryValue(a) || a.uid - b.uid).slice(0, 2);
  const tanks = units.filter(p => (rec(p).stats?.blockCnt || 0) >= 2)
    .sort((a, b) => Number(rec(b).profession === 'TANK') - Number(rec(a).profession === 'TANK')
      || (rec(b).stats.maxHp || 0) * (1 + (rec(b).stats.def || 0) / 500) - (rec(a).stats.maxHp || 0) * (1 + (rec(a).stats.def || 0) / 500)
      || a.uid - b.uid).slice(0, 2);
  if (!carries.length || !medics.length || !tanks.length) return [];
  const model = h.fieldModel(m, ps), bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  const guards = model.routes.filter(r => !r.fallback && !r.dwell && !r.fly && r.n > 0);
  const bossRoutes = model.routes.filter(r => !r.fallback && r.dwell > 0), guardTotal = guards.reduce((n, r) => n + r.n, 0) || 1;
  if (!bodies.size && !bossRoutes.length) return [];
  const options = new Map();
  for (const u of units) {
    const r = rec(u), out = [];
    for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
      if (!ps._legal(u, row, col) || [...ps.board].some(([k, p]) => k === `${row},${col}` && p.kind !== 'chess')) continue;
      for (const dir of DIRS) {
        const cover = new Set(h.rangeTiles(r, row, col, dir)), key = `${row},${col}`;
        const contact = bodies.size ? Number([...bodies].some(k => cover.has(k)))
          : bossRoutes.reduce((s, rt) => s + rt.tiles.filter(k => cover.has(k)).length / Math.max(1, rt.tiles.length), 0) / bossRoutes.length;
        out.push({ uid: u.uid, key, r: row, c: col, dir, cover, heal: healingRange(r, row, col, dir), contact });
      }
    }
    options.set(u.uid, out);
  }
  const at = (p, u) => options.get(u.uid).find(o => o.key === p.get(u.uid) && o.dir === p.dirs.get(u.uid));
  const score = p => {
    const layout = units.map(u => at(p, u)); if (layout.some(l => !l)) return -Infinity;
    let value = 0;
    for (let i = 0; i < units.length; i++) {
      const r = rec(units[i]), loc = layout[i], w = dealer(r) ? Math.max(1, carryValue(units[i]) / 400) : 1;
      if (dealer(r)) value += w * (loc.contact > 0 ? 10 + loc.contact * 5 : -30);
      if (acceptsHealing(r) && carries.includes(units[i])) value += w * (layout.some((l, j) => healer(rec(units[j])) && l.heal.has(loc.key)) ? 12 : -24);
      if (m.bossId === 'boss_7' && (carries.includes(units[i]) || medics.includes(units[i])))
        for (let j = i + 1; j < units.length; j++) if ((carries.includes(units[j]) || medics.includes(units[j])) && layout[j].c === loc.c) value -= w * 10;
    }
    for (const rt of guards) {
      const block = layout.reduce((v, l, i) => (rec(units[i]).stats?.blockCnt || 0) >= 2 && rt.tiles.includes(l.key)
        ? Math.min(v, rt.tiles.indexOf(l.key)) : v, Infinity);
      if (!Number.isFinite(block)) continue;
      for (let i = 0; i < units.length; i++) if (carries.includes(units[i]) || medics.includes(units[i])) {
        const loc = layout[i], index = rt.tiles.indexOf(loc.key), w = carries.includes(units[i]) ? 12 : 8;
        value += rt.n / guardTotal * (index >= 0 && index < block ? -w * 3 : w);
        if (carries.includes(units[i]) && loc.cover.has(rt.tiles[Math.max(0, block - 1)])) value += rt.n / guardTotal * w;
      }
    }
    return value - units.filter(u => p.get(u.uid) !== original.get(u.uid)).length * 2;
  };
  const distinct = (list, n) => {
    const result = [], seen = new Set();
    for (const x of list) { const k = x.key; if (seen.has(k)) continue; seen.add(k); result.push(x); if (result.length === n) break; }
    return result;
  };
  const proposals = [];
  for (const carry of carries) for (const medic of medics) for (const tank of tanks) {
    if (carry === medic || carry === tank || medic === tank) continue;
    const start = at(original, carry), oldMedic = at(original, medic), oldTank = at(original, tank);
    if (!start || !oldMedic || !oldTank) continue;
    for (const c of options.get(carry.uid).filter(l => l.contact > 0 && distance(l, start) <= 1)) {
      if (!oldMedic.heal.has(c.key) || !oldMedic.heal.has(oldTank.key)) continue;
      const p = linkedFormationPlan(ps, h, original, [c, oldMedic, oldTank]); if (!p) continue;
      const value = score(p); if (!Number.isFinite(value)) continue;
      p.linked = { carry: carry.uid, medic: medic.uid, tank: tank.uid, family: 'local', score: value }; proposals.push(p);
    }
    const carryLocs = distinct(options.get(carry.uid).filter(l => l.contact > 0).sort((a, b) => b.contact - a.contact
      || distance(a, start) - distance(b, start)), 12);
    for (const c of carryLocs) {
      const ts = distinct(options.get(tank.uid).map(t => {
        let value = t.contact * 4;
        for (const rt of guards) {
          const n = rt.tiles.indexOf(t.key); if (n < 0) continue;
          value += rt.n / guardTotal * (8 + (c.cover.has(rt.tiles[Math.max(0, n - 1)]) ? 8 : -8));
          const at = rt.tiles.indexOf(c.key); if (at >= 0 && at < n) value -= 30;
        }
        return { ...t, value: value - distance(t, c) * .3 };
      }).sort((a, b) => b.value - a.value), 6);
      for (const t of ts) {
        const ms = distinct(options.get(medic.uid).filter(l => l.heal.has(c.key) && l.heal.has(t.key))
          .map(l => ({ ...l, value: carries.reduce((n, u) => n + Number(l.heal.has(original.get(u.uid))) * carryValue(u) / 400, 0)
            - guards.reduce((n, rt) => n + Number(rt.tiles.includes(l.key)) * rt.n / guardTotal * 4, 0) - distance(l, t) * .1 }))
          .sort((a, b) => b.value - a.value), 4);
        for (const med of ms) {
          const p = linkedFormationPlan(ps, h, original, [c, med, t]); if (!p) continue;
          const value = score(p); if (!Number.isFinite(value)) continue;
          p.linked = { carry: carry.uid, medic: medic.uid, tank: tank.uid, family: 'joint', score: value };
          proposals.push(p);
        }
      }
    }
  }
  proposals.sort((a, b) => b.linked.score - a.linked.score || (signature(a) < signature(b) ? -1 : signature(a) > signature(b) ? 1 : 0));
  const selected = [], seen = new Set([signature(original)]), families = new Set();
  for (const carry of carries) for (const familyName of ['local', 'joint']) for (const p of proposals.filter(p => p.linked.carry === carry.uid && p.linked.family === familyName)) {
    if (selected.filter(p => p.linked.carry === carry.uid && p.linked.family === familyName).length >= (familyName === 'local' ? 2 : 1)) break;
    const s = signature(p), family = `${p.linked.carry}:${p.get(p.linked.carry)}:${p.get(p.linked.medic)}:${p.get(p.linked.tank)}`;
    if (seen.has(s) || families.has(family)) continue;
    seen.add(s); families.add(family); selected.push(p);
  }
  return selected;
}

export function* bossFormationSteps(m, ps, h, recipe, entering, samples = FORECAST_SAMPLES, aggregate = false) {
  if (!eligible(m)) return;
  if (![2, 4, 6, 8, 10, 12].includes(samples)) throw Error('Unsupported linked boss forecast sample count');
  const started = performance.now(), incumbent = bossFormationSnapshot(ps, h), candidates = [];
  const ids = p => p.lineup.map(u => u.uid).sort((a, b) => a - b).join();
  if (entering && ids(entering) === ids(incumbent) && signature(entering) !== signature(incumbent)) {
    const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
    const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([k]) => k));
    if (entering.lineup.every(p => !reserved.has(entering.get(p.uid)) && ps._legal(p, ...entering.get(p.uid).split(',').map(Number))
      && (!owners.has(p.uid) || entering.get(p.uid) === incumbent.get(p.uid) && entering.dirs.get(p.uid) === incumbent.dirs.get(p.uid)))) candidates.push(entering);
  }
  candidates.push(...bossLinkedPlans(m, ps, h, recipe, incumbent));
  if (!candidates.length) return;
  let best = incumbent; const batches = [];
  for (let i = 0; i < candidates.length; i += 2) {
    const plans = [best, ...candidates.slice(i, i + 2)];
    function* inputSteps(p) { yield; return stealthBattleInput(ps, p); }
    const policy = { forecastSamples: samples, forecastContext: () => ({ samples, aggregate }),
      observeForecast: () => () => ({}), selectForecast: selectFinalSwap };
    const job = yield* createForecastSteps(m, ps, best.lineup, plans, inputSteps, policy);
    if (!job) continue; while (!job.run(4)) yield;
    best = job.best;
    batches.push({ index: job.bestIndex, outcomes: job.outcomes, candidates: job.plans.map(p => ({ linked: p.linked,
      positions: [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) })) })) });
    const selected = job.outcomes.filter(r => r.index === job.bestIndex);
    if (selected.length === samples && selected.every(r => r.valid && r.won)) break;
  }
  const expected = stealthBattleInput(ps, best); applyControlPositions(ps, best);
  if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Linked boss formation differs from its forecast');
  (ps._botBossFormationHistory ||= []).push({ round: m.round, retainedEntering: candidates.includes(entering),
    samples, aggregate, generated: candidates.filter(p => p.linked).length, changed: signature(best) !== signature(incumbent), batches, ms: performance.now() - started });
}

export function withLateranoBossFormation(recipe, { samples = FORECAST_SAMPLES, aggregate = false } = {}) {
  if (![2, 4, 6, 8, 10, 12].includes(samples)) throw Error('Unsupported linked boss forecast sample count');
  if (aggregate && ![4, 6, 8, 10, 12].includes(samples)) throw Error('Aggregate boss selection requires expanded samples');
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    const entering = eligible(m) ? bossFormationSnapshot(ps, h) : null;
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h);
    yield* bossFormationSteps(m, ps, h, recipe, entering, samples, aggregate);
  } });
}
