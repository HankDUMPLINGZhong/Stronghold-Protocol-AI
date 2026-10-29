// [ASSUMED] Independent, unselected four-seat R14 trials. Own assets and public seat headers only.
import { computeBonds, pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { windowLayoutValue } from './lateranoWindowRefinement.js';

export const SIRACUSA_BOSS_POOL_FACTORS = Object.freeze([
  'boss-support-survival', 'boss-owned-bench', 'boss-pool-phase-samples',
]);
export const SIRACUSA_BOSS_POOL_COMBINED = 'boss-owned-bench-phase';
export const SIRACUSA_BOSS_POOL_TWO_COMBINED = 'boss-owned-bench-phase-two';
export const SIRACUSA_BOSS_POOL_TWO_BONDS = 'boss-owned-bench-phase-two-bonds';
const CORE = 'siracusaShip';
const signature = layout => layout.map(p => `${p.key}:${p.dir}`).join('|');
const touches = (p, bodies) => bodies.some(k => p.cover.has(k));

/** Geometry is only a proposer; real common combat samples decide whether the squad improves. */
export function bossSupportProposals(ps, h, geometry, current) {
  const { chosen, options, ctx } = geometry, bodies = ctx.bodies;
  const records = chosen.map(p => h.rangeRec(ps, ps.gd.chess(p.id)));
  const native = chosen.map(p => pieceBonds(ps.gd, p).includes(CORE));
  const support = records.map(rec => ['slower', 'guardian', 'medic', 'wandermedic', 'incantationmedic'].includes(rec.subProfessionId));
  const covers = (i, p) => records[i].skill?.rangeGrid?.length
    ? new Set(h.rangeTiles({ ...records[i], rangeGrid: records[i].skill.rangeGrid }, p.r, p.c, p.dir)) : p.cover;
  const legal = trial => new Set(trial.map(p => p.key)).size === trial.length
    && trial.every((p, i) => !ctx.info[i].dealer || !touches(current[i], bodies) || touches(p, bodies));
  const value = trial => {
    let score = windowLayoutValue(trial, ctx);
    for (let i = 0; i < trial.length; i++) {
      if (support[i]) {
        const keys = covers(i, trial[i]);
        for (let j = 0; j < trial.length; j++) if (i !== j && keys.has(trial[j].key))
          score += ctx.info[j].weight * (native[j] ? 3 : 5);
        if (bodies.some(k => keys.has(k))) score += ctx.info[i].weight * 8;
      }
      for (let j = i + 1; j < trial.length; j++) {
        const a = trial[i], b = trial[j], dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
        const hitTogether = ctx.bossId === 'boss_7' ? dc === 0
          : ctx.bossId === 'boss_6' ? (dr === 0 || dc === 0) && dr + dc <= 2
            : ['boss_1', 'boss_8'].includes(ctx.bossId) && Math.max(dr, dc) <= 1;
        // Native concealment reduces early selection, but expires during a long fight; never treat it as immunity.
        if (hitTogether) score -= Math.min(ctx.info[i].weight, ctx.info[j].weight) * (native[i] && native[j] ? 4 : 10);
      }
    }
    return score;
  };
  const alternatives = new Map(), initial = signature(current);
  const offer = layout => {
    const key = signature(layout);
    if (key !== initial && legal(layout) && !alternatives.has(key)) alternatives.set(key, { layout, score: value(layout) });
  };
  // Include every legal support facing, even when generic geometry's two focus slots omit that supporter.
  for (let i = 0; i < current.length; i++) if (support[i]) for (const p of options[i]) {
    if (p.key === current[i].key) { const trial = current.slice(); trial[i] = p; offer(trial); }
  }
  let joint = current.slice();
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < joint.length; i++) {
    let best = joint, score = value(joint);
    for (const p of options[i]) {
      const trial = joint.slice(), j = joint.findIndex((q, k) => k !== i && q.key === p.key);
      trial[i] = p;
      if (j >= 0) {
        const other = options[j].find(q => q.key === joint[i].key && q.dir === joint[j].dir);
        if (!other) continue;
        trial[j] = other;
      }
      if (!legal(trial)) continue;
      const next = value(trial); if (next > score + 1e-6) { best = trial; score = next; }
    }
    joint = best;
  }
  offer(joint);
  return [...alternatives.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Only a hand→occupied-board single swap: legal even with a full bench, no intermediate empty slot needed.
 * All summon owners stay fixed, including owners of off-board stacks, so token identities cannot be lost. */
export function bossBenchPlans(ps, h, basePlan, { preserveActive = false } = {}) {
  const required = preserveActive ? Object.keys(ps.bonds).filter(id => ps.bonds[id]?.active) : [];
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const selected = new Set(basePlan.lineup.map(p => p.uid)), alternatives = [];
  const rank = (chosen, bonds) => {
    let score = 0;
    for (const p of chosen) {
      const rec = h.rangeRec(ps, ps.gd.chess(p.id)), s = rec.stats || {};
      const native = pieceBonds(ps.gd, p).includes(CORE), bb = ps.gd.bond(CORE)?.bb || {};
      const proc = native && bonds[CORE]?.count >= 6 ? ((bb.base_damage || 0) + (bb.damage_per_stack || 0) * (ps.layers[CORE] || 0)) * (bb.prob || 0) : 0;
      score += ((s.atk || 0) + proc) * (s.aspd || 100) / (100 * Math.max(.3, s.bat || 1.5));
    }
    // Propose full bond packages, not merely the next highest-tier body. Combat measures their actual value.
    for (const id of ['swiftShip', 'arcaneShip', 'raidShip']) if (bonds[id]?.active) score += 10 * (bonds[id].layers || 0);
    return score;
  };
  for (let idx = 0; idx < ps.hand.length; idx++) {
    const incoming = ps.hand[idx];
    if (incoming?.kind !== 'chess' || selected.has(incoming.uid) || owners.has(incoming.uid)) continue;
    // A first deployment can grant fresh token stacks even when none exist yet. Their hand-count/UID effects
    // are outside this single-swap projection; do not forecast the body without those placement side effects.
    const incomingRec = ps.gd.chess(incoming.id);
    if (ps.gd.placeableTokens(incoming.id, ps.loadoutFor(incomingRec)).length) continue;
    for (const removed of basePlan.lineup) {
      if (owners.has(removed.uid)) continue;
      const key = basePlan.get(removed.uid), [r, c] = key.split(',').map(Number);
      if (!ps._legal(incoming, r, c)) continue;
      const chosen = basePlan.lineup.map(p => p === removed ? incoming : p), plan = new h.LayoutPlan(); plan.lineup = chosen;
      for (const p of chosen) {
        plan.set(p.uid, p === incoming ? key : basePlan.get(p.uid));
        plan.dirs.set(p.uid, p === incoming ? (pieceBonds(ps.gd, p).includes('raidShip') ? 'RIGHT' : basePlan.dirs.get(removed.uid)) : basePlan.dirs.get(p.uid));
      }
      const board = new Map([...ps.board].filter(([, p]) => p.kind !== 'chess'));
      for (const p of chosen) board.set(plan.get(p.uid), { ...p, dir: plan.dirs.get(p.uid) });
      const hand = ps.hand.slice(); hand[idx] = removed;
      const view = Object.assign(Object.create(Object.getPrototypeOf(ps)), ps, { board, hand, _legalityStale: false });
      view.bonds = computeBonds(ps.gd, view);
      if ((view.bonds[CORE]?.count || 0) < 6) continue;
      if (required.some(id => !view.bonds[id]?.active)) continue;
      plan.bossOriginalInput = view.battleInput();
      plan.bossSwap = { incoming: incoming.uid, removed: removed.uid, basePlan };
      alternatives.push({ plan, score: rank(chosen, view.bonds), incoming: incoming.uid,
        identity: JSON.stringify([incoming.id, incoming.items?.map(p => p.id) || []]) });
    }
  }
  const out = [], used = new Set();
  for (const p of alternatives.sort((a, b) => b.score - a.score || a.incoming - b.incoming)) {
    if (used.has(p.identity)) continue;
    out.push(p.plan); used.add(p.identity); if (out.length === 3) break;
  }
  return out;
}

/** A bounded scenario, not a prediction of any particular teammate. Never reads teammate private state. */
export function bossExternalDps(model, sample) {
  const share = [0, .25, .5, .75][sample % 4];
  return share * (model.hp / Math.max(1, model.alive.length)) * Math.max(0, model.alive.length - 1) / model.horizon;
}

export function attachBossExternalDamage(battle, pool, model, sample) {
  const dps = bossExternalDps(model, sample);
  if (dps > 0) battle.on('tick', ({ dt }) => pool.damage('sb:model-support', dps * dt), { priority: 10000, owner: 'forecast-support' });
  return battle;
}

/** All four common scenarios must complete. Total progress/clearance outranks own damage share. */
export function selectBossPhaseSamples(plans, outcomes, samples) {
  let index = 0, best = null;
  for (let i = 0; i < plans.length; i++) {
    const rows = outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample);
    if (rows.length !== samples || rows.some((r, j) => !r.valid || r.sample !== j || ![r.poolLeft, r.elapsed, r.bossDamage].every(Number.isFinite))) continue;
    const mean = k => rows.reduce((n, r) => n + r[k], 0) / samples;
    const score = [rows.filter(r => r.poolLeft <= 0).length, -mean('poolLeft'), -Math.max(...rows.map(r => r.poolLeft)), mean('bossDamage'), -mean('elapsed')];
    if (!best) { best = score; index = i; continue; }
    for (let k = 0; k < score.length; k++) if (Math.abs(score[k] - best[k]) > 1e-6) {
      if (score[k] > best[k]) { best = score; index = i; } break;
    }
  }
  return index;
}
