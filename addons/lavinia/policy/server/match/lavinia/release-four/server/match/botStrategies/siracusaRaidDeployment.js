// [ASSUMED] Independent ordinary-wave trial: validate actual first Raid jumps for deployment layerers.
// Own fixed assets and public routes only. Common independent samples retain per-sample defense and prior growth.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { pieceDir } from '../../../../../../../../../board.js';
import { extendedGrid } from '../../../../../../../../../../sim/targeting.js';
import { rotateOffset } from '../../../../../../../../../../sim/dir.js';
import { siracusaCoopSnapshot } from './siracusaCoopExperiments.js';
import { siracusaContactPlans, applySiracusaContact } from './siracusaCoopTactics.js';
import { probeCorrectedContact } from './siracusaContactInputs.js';
import { probeContactRollback } from './siracusaContactRollback.js';

export const SIRACUSA_RAID_DEPLOYMENT = 'raid-deployment-first-jump';
const RAID = 'raidShip', KEY = 'bond:raidShip';
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 2 && m.difficulty === 'ABYSS'
  && !!m.wave && m.round >= 5 && m.round <= 13 && ps.bandId === 'band_chiave'
  && ps._botFocusId === 'siracusaShip' && !!ps.bonds[RAID]?.active;
const signature = p => [...p].map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).sort().join('|');

/** Membership/kill/prep triggers alone are not deployment growth. Generated data is authoritative. */
export function raidDeploymentGain(gd, piece) {
  if (!pieceBonds(gd, piece).includes(RAID)) return 0;
  return (gd.chess(piece.id)?.garrisonIds || []).reduce((n, id) => {
    const g = gd.garrison(id), targets = (g?.bbStr?.bond_id || '').split(',');
    return n + (g?.effectKey === 'act2autochess_gar_event_onstart'
      && (g.bbStr?.bond_type === 'bond_self' || targets.includes(RAID)) ? Math.max(0, g.bb?.bond_add_count || 0) : 0);
  }, 0);
}

/** Observe real redeployments and the actual post-jump buff, never an estimated jump or granted live layers. */
export function observeRaidDeployment(battle, ctx) {
  const units = new Map(), progress = Object.fromEntries(ctx.sources.map(s => [s.uid,
    { deploys: 0, jumps: 0, raidGain: 0, firstJump: null }])), seen = new Map();
  const own = u => u?.ownerId === ctx.playerId && Object.hasOwn(progress, u.uid);
  for (const u of battle.allyUnits || []) if (own(u)) {
    units.set(u.uid, u); if (u.deployed) progress[u.uid].deploys++;
  }
  battle.on('deploy', ({ unit }) => { if (own(unit)) { units.set(unit.uid, unit); progress[unit.uid].deploys++; } });
  battle.on('layerGain', ({ source, bondId, n }) => { if (bondId === RAID && own(source)) progress[source.uid].raidGain += n; });
  battle.on('tick', () => {
    for (const [uid, u] of units) if (u.alive && u.deployed && u.findBuff(KEY) && seen.get(uid) !== u.deploySeq) {
      seen.set(uid, u.deploySeq); progress[uid].jumps++; progress[uid].firstJump ??= battle.time;
    }
  });
  return pp => ({ raidProgress: structuredClone(progress), damage: pp.damageDealt || 0 });
}

const complete = rows => rows.length === 2 && rows.every((r, i) => r.valid && r.sample === i && r.raidProgress);
const hit = p => Number(p.deploys >= 2 && p.jumps >= 1);
const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
export function selectRaidDeployment(plans, outcomes, ctx) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  if (!complete(rows[0])) return { index: 0 };
  const rank = rs => {
    const coverage = rs.map(r => ctx.sources.reduce((n, s) => n + hit(r.raidProgress[s.uid]), 0));
    const gain = rs.map(r => ctx.sources.reduce((n, s) => n + r.raidProgress[s.uid].raidGain, 0));
    const delay = rs.map(r => ctx.sources.reduce((n, s) => n + (r.raidProgress[s.uid].firstJump ?? 1e4), 0));
    return [-Math.max(...rs.map(r => r.lost)), -rs.reduce((n, r) => n + r.lost, 0),
      -Math.max(...rs.map(r => r.leaks)), -rs.reduce((n, r) => n + r.leaks, 0),
      Math.min(...coverage), coverage[0] + coverage[1], Math.min(...gain), gain[0] + gain[1],
      -Math.max(...delay), -delay[0] - delay[1], rs.reduce((n, r) => n + r.damage, 0)];
  };
  let index = 0, score = rank(rows[0]);
  for (let i = 1; i < rows.length; i++) {
    const rs = rows[i]; if (!complete(rs)) continue;
    if (rs.some((r, j) => r.lost > rows[0][j].lost || r.leaks > rows[0][j].leaks || r.deaths > rows[0][j].deaths
      || ctx.sources.some(s => {
        const p = r.raidProgress[s.uid], b = rows[0][j].raidProgress[s.uid];
        return !p || hit(p) < hit(b) || Math.min(2, p.deploys) < Math.min(2, b.deploys) || p.raidGain < b.raidGain;
      }))) continue;
    // Extra overkill damage alone cannot churn an unchanged first-jump/deployment result.
    if (!rs.some((r, j) => ctx.sources.some(s => {
      const p = r.raidProgress[s.uid], b = rows[0][j].raidProgress[s.uid];
      return hit(p) > hit(b) || p.raidGain > b.raidGain;
    }))) continue;
    const next = rank(rs); if (better(next, score)) { index = i; score = next; }
  }
  return { index };
}

function copy(plan, h) {
  const p = new h.LayoutPlan(plan); p.lineup = plan.lineup; p.dirs = new Map(plan.dirs); p.reserved = new Set(plan.reserved || []); return p;
}

/** Multiple full-route quiet-home proposals, followed by small joint melee-window alternatives.
 * Landings are validated dynamically by the real Raid implementation in both forecasts, not statically promised.
 */
export function raidDeploymentPlans(m, ps, h, original, sources, missing) {
  const all = new Map([...ps.board].map(([key, p]) => [p.uid, { p, key }]));
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const raiders = original.lineup.filter(p => pieceBonds(ps.gd, p).includes(RAID) && !owners.has(p.uid));
  const targets = missing.map(uid => original.lineup.find(p => p.uid === uid)).filter(p => p && !owners.has(p.uid))
    .sort((a, b) => raidDeploymentGain(ps.gd, b) - raidDeploymentGain(ps.gd, a) || a.uid - b.uid);
  if (!targets.length) return [original];
  const model = h.fieldModel(m, ps), routes = model.routes.filter(r => !r.fly && !r.fallback && r.n > 0), homes = new Map();
  for (const p of raiders) {
    const rec = h.rangeRec(ps, ps.gd.chess(p.id)), range = [...extendedGrid(rec.rangeGrid || [[0, 0]], rec.skill?.bb?.ability_range_forward_extend || 0),
      ...(rec.skill?.rangeGrid || []), ...(rec.skill?.trigger?.customRangeGrid || [])];
    const choices = [];
    for (const key of ps.deployMap().keys()) {
      const [r, c] = key.split(',').map(Number); if (!ps._legal(p, r, c)) continue;
      const cover = new Set(range.map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, 'RIGHT'); return `${r + a},${c + b}`; }));
      // The whole published route is considered; early cells weigh most, later contact is still penalized.
      const exposure = routes.reduce((v, rt) => v + rt.n * rt.tiles.reduce((n, t, i) => n + (cover.has(t) ? 1 / (i + 1) : 0), 0), 0);
      choices.push({ key, exposure, r, c });
    }
    choices.sort((a, b) => a.exposure - b.exposure || a.r - b.r || a.c - b.c); homes.set(p.uid, choices);
  }
  const plans = [original], seen = new Set([signature(original)]);
  const add = p => {
    if (plans.length >= 9) return;
    const cells = new Set();
    for (const [uid, { p: unit, key }] of all) {
      const at = p.get(uid) || key; if (cells.has(at) || !ps._legal(unit, ...at.split(',').map(Number))) return; cells.add(at);
      if ((unit.kind === 'token' || owners.has(uid) || ps.gd.baseIdOf(unit.id) === 'chess_char_4_10_a')
        && (at !== key || (p.dirs.get(uid) || pieceDir(unit)) !== pieceDir(unit))) return;
    }
    const sig = signature(p); if (seen.has(sig)) return; seen.add(sig); plans.push(p);
  };
  const propose = (moving, offset) => {
    const movable = new Set(moving.map(p => p.uid)), occupied = new Set([...all].filter(([uid]) => !movable.has(uid)).map(([, u]) => u.key));
    const p = copy(original, h);
    for (const unit of moving) {
      const options = (homes.get(unit.uid) || []).filter(x => !occupied.has(x.key) && x.key !== original.get(unit.uid));
      const home = options[Math.min(offset, options.length - 1)]; if (!home) return;
      p.set(unit.uid, home.key); p.dirs.set(unit.uid, 'RIGHT'); occupied.add(home.key);
    }
    add(p);
  };
  for (const p of targets) for (const offset of [0, 1]) { propose([p], offset); if (plans.length >= 5) break; }
  propose(targets, 2); propose(raiders.slice().sort((a, b) => Number(missing.includes(b.uid)) - Number(missing.includes(a.uid)) || a.uid - b.uid), 0);
  // Preserve ranged fire anchors, summons/owners and the proposed Raid homes. Only nearby blockers can adjust.
  const fixed = new Set([...all].filter(([, { p }]) => {
    const rec = p.kind === 'chess' ? ps.gd.chess(p.id) : null;
    return p.kind === 'token' || owners.has(p.uid) || pieceBonds(ps.gd, p).includes(RAID)
      || ps.gd.baseIdOf(p.id) === 'chess_char_4_10_a' || rec?.position !== 'MELEE' || !(rec.stats?.blockCnt > 0) || rec.attackKind === 'heal';
  }).map(([uid]) => uid));
  for (const p of plans.slice(1, 3)) {
    const candidates = siracusaContactPlans(m, ps, h, () => copy(p, h), { fixedUids: fixed, radius: 1, limit: 2, endurance: true });
    for (const q of candidates.slice(1)) add(q);
  }
  void sources;
  return plans.map(p => {
    const q = new h.LayoutPlan(); q.lineup = original.lineup; q.dirs = new Map(); q.reserved = new Set();
    for (const u of q.lineup) { q.set(u.uid, p.get(u.uid)); q.dirs.set(u.uid, p.dirs.get(u.uid)); } return q;
  });
}

const cache = new WeakMap();
export function withSiracusaRaidDeployment(parent, enabled) {
  if (!enabled) return parent;
  if (!cache.has(parent)) cache.set(parent, Object.freeze({ ...parent,
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!scope(m, ps)) return;
      const original = siracusaCoopSnapshot(ps, h), sources = original.lineup.filter(p => raidDeploymentGain(ps.gd, p) > 0)
        .map(p => ({ uid: p.uid, id: p.id, gain: raidDeploymentGain(ps.gd, p) }));
      if (!sources.length) return;
      const context = { playerId: ps.playerId, sources }, options = { context, observe: observeRaidDeployment };
      const before = yield* probeCorrectedContact(m, ps, h, [original], options);
      if (!before || before.stale || !complete(before.job.outcomes)) return;
      const missing = sources.filter(s => before.job.outcomes.some(r => !hit(r.raidProgress[s.uid]))).map(s => s.uid);
      const log = { factor: SIRACUSA_RAID_DEPLOYMENT, round: m.round, sources, missing, index: 0, before: before.job.outcomes };
      (ps._botSiracusaRaidDeploymentHistory ||= []).push(log);
      if (!missing.length) return;
      const plans = raidDeploymentPlans(m, ps, h, original, sources, missing); if (plans.length < 2) return;
      const result = yield* probeContactRollback(m, ps, h, plans, { corrected: true, ...options, select: selectRaidDeployment });
      if (!result || result.stale) return;
      log.index = result.job.bestIndex; log.outcomes = result.job.outcomes;
      log.plans = plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) })));
      if (log.index) applySiracusaContact(ps, plans[log.index]);
    },
  }));
  return cache.get(parent);
}
