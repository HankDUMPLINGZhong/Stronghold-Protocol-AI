// [ASSUMED] Three independent follow-ups over the selected multiplayer21/17 recipe.
// Owned/public information only. No saved formations, teammate units, economic or battle-rule overrides.
import { healingTiles } from '../botPositioning.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { coopRoleEntryPlan } from './lateranoCoopRoles.js';
import { controlBonds } from './lateranoControlBoss.js';
import { repairCoopWithdrawal } from './lateranoCoopWithdrawalPackage.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';
import { coopBossExchangePlans } from './lateranoCoopBossExchange.js';
import { withLateranoCoopBossSelf } from './lateranoCoopBossSelf.js';
import { applyCoopRolePlan } from './lateranoCoopRoles.js';

const cooperative = m => m.mode === 'coop' && !m.isSolo;
const late = m => cooperative(m) && m.round >= m.gd.bossRound - 1 && m.round <= m.gd.bossRound;
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tank = r => r.profession === 'TANK' && r.stats?.blockCnt > 0;
const base = (ps, p) => ps.gd.baseIdOf(p.id || p.chessId);
const mains = recipe => new Set([recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto]);

/** Potential incantation healing uses the attack window; actual independent battles must deliver the damage/heals. */
export function coopIncantationHealing(h, rec, r, c, dir, enemies) {
  if (rec.subProfessionId !== 'incantationmedic') return healingTiles(rec, r, c, dir);
  const cover = new Set(h.rangeTiles(rec, r, c, dir));
  return enemies && ![...enemies].some(k => cover.has(k)) ? new Set() : cover;
}

/** One legal held-medic addition per distinct base, including when the board already has a healer. */
export function ownedCoopIncantationPlans(m, ps, h, recipe) {
  const original = bossFormationSnapshot(ps, h), rec = p => h.rangeRec(ps, ps.gd.chess(p.id));
  const before = controlBonds(ps, original.lineup), main = mains(recipe), proposals = [];
  const pinned = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  for (const incoming of ps.allChess().filter(p => !original.lineup.some(q => base(ps, q) === base(ps, p))
    && rec(p).subProfessionId === 'incantationmedic')) {
    for (const outgoing of original.lineup) {
      if (main.has(base(ps, outgoing)) || pinned.has(outgoing.uid)) continue;
      const lineup = original.lineup.map(p => p === outgoing ? incoming : p), bonds = controlBonds(ps, lineup);
      if (m.bossId === 'boss_4' && rec(outgoing).subProfessionId === 'wandermedic'
        && !lineup.some(p => rec(p).subProfessionId === 'wandermedic')) continue;
      if ((bonds.lateranoShip?.count || 0) < Math.min(6, before.lateranoShip?.count || 0)
        || ['preciShip', 'skillfulShip'].some(id => before[id]?.active
          && (bonds[id]?.count || 0) < Math.min(id === 'preciShip' ? 3 : 2, before[id].count))
        || original.lineup.some(p => tank(rec(p))) && !lineup.some(p => tank(rec(p)))) continue;
      const plan = coopRoleEntryPlan(ps, h, original, lineup); if (!plan) continue;
      const score = ((bonds.preciShip?.count || 0) >= 3 && (before.preciShip?.count || 0) < 3 ? 100 : 0)
        + (healer(rec(outgoing)) ? 20 : 0) + rec(incoming).tier - rec(outgoing).tier;
      plan.coopIncantation = { incoming: incoming.uid, outgoing: outgoing.uid, score };
      proposals.push(plan);
    }
  }
  proposals.sort((a, b) => b.coopIncantation.score - a.coopIncantation.score
    || a.coopIncantation.incoming - b.coopIncantation.incoming || a.coopIncantation.outgoing - b.coopIncantation.outgoing);
  const chosen = [], seen = new Set();
  for (const plan of proposals) {
    const id = base(ps, plan.lineup.find(p => p.uid === plan.coopIncantation.incoming));
    if (seen.has(id)) continue; seen.add(id); chosen.push(plan); if (chosen.length === 2) break;
  }
  return chosen;
}

export function withCoopIncantationRecovery(parent, { retainBranches = false } = {}) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!cooperative(m) || m.wave || m.round !== m.gd.bossRound) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return;
    }
    const started = performance.now(), historyStart = ps._botCoopSelfBossHistory?.length || 0;
    const oldRetain = ps._botCoopRetainBossBranches, retained = [];
    if (retainBranches) ps._botCoopRetainBossBranches = () => {
      oldRetain?.();
      retained.push(...coopBossExchangePlans(m, ps, h, parent));
    };
    const oldRange = ps._botCoopHealingRange, oldPlans = ps._botCoopHeldHealingPlans;
    const model = h.fieldModel(m, ps), enemies = new Set(model.bossBodies.flatMap(b => b.tiles));
    if (!enemies.size) for (const route of model.routes.filter(r => !r.fallback && r.dwell > 0))
      for (const key of route.tiles) enemies.add(key);
    ps._botCoopHealingRange = (rec, r, c, dir) => coopIncantationHealing(h, rec, r, c, dir, enemies);
    ps._botCoopHeldHealingPlans = () => {
      const plans = ownedCoopIncantationPlans(m, ps, h, parent);
      (ps._botCoopRegressionHistory ||= []).push({ factor: 'incantation-candidates', round: m.round,
        plans: plans.map(p => ({ ...p.coopIncantation, roster: p.lineup.map(u => u.id) })) });
      return plans;
    };
    try {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (retainBranches && retained.length) {
        const used = (ps._botCoopSelfBossHistory || []).slice(historyStart).reduce((n, r) => n + r.fieldSteps, 0);
        const remaining = m.sched.virtual ? 30_000 : 30_000 - (performance.now() - started);
        if (used >= 1_500_000 || remaining <= 0) return;
        const extra = withLateranoCoopBossSelf({ *finalBoardSteps() {
          const original = bossFormationSnapshot(ps, h);
          const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
          const roster = p => p.lineup.map(u => `${u.uid}:${u.id}`).sort().join('|');
          const seen = new Set([signature(original)]), plans = [original];
          for (const plan of retained) {
            if (roster(plan) !== roster(original) || seen.has(signature(plan))) continue;
            seen.add(signature(plan)); plans.push(plan);
          }
          {
            let best = plans[0]; const batches = [];
            for (let i = 1; i < plans.length; i += 2) {
              const job = yield* createCoopBossForecast(m, ps, [best, ...plans.slice(i, i + 2)], 10);
              if (!job) break; while (!job.run(4)) yield;
              batches.push({ index: job.bestIndex, stale: job.stale, outcomes: job.outcomes });
              if (job.stale) break; best = job.best;
            }
            if (best !== plans[0]) applyCoopRolePlan(ps, best);
            (ps._botCoopRegressionHistory ||= []).push({ factor: 'incantation-retain-branches', round: m.round,
              plans: plans.map(p => ({ positions: [...p], dirs: [...p.dirs] })), batches });
          }
        } }, { fieldSteps: 1_500_000 - used, wallMs: remaining });
        yield* extra.finalBoardSteps(m, ps, h);
      }
    }
    finally {
      if (oldRange === undefined) delete ps._botCoopHealingRange; else ps._botCoopHealingRange = oldRange;
      if (oldPlans === undefined) delete ps._botCoopHeldHealingPlans; else ps._botCoopHeldHealingPlans = oldPlans;
      if (retainBranches) {
        if (oldRetain === undefined) delete ps._botCoopRetainBossBranches; else ps._botCoopRetainBossBranches = oldRetain;
      }
    }
  } });
}

/** Distinct-base minimum-slot feasibility, retaining acquired carries and the native frontliner. */
export function coopPrecisionFeasible(ps, recipe, pieces, skillful = 0) {
  const gd = ps.gd, main = mains(recipe); main.add(recipe.ids.faith);
  const groups = new Map(), ids = ['lateranoShip', 'preciShip', 'skillfulShip'], caps = [6, 3, skillful];
  for (const p of pieces) {
    const id = base(ps, p), flags = ids.map(k => Number(!gd.modeInactiveBonds.has(k) && pieceBonds(gd, p).includes(k)));
    if (!groups.has(id)) groups.set(id, []);
    if (!groups.get(id).some(row => row.join() === flags.join())) groups.get(id).push(flags);
  }
  const bonus = ids.map((id, i) => Math.min(caps[i], ps.bondCountBonus?.[id] || 0));
  let states = new Map([[bonus.join(), 0]]);
  for (const [id, options] of groups) {
    const next = main.has(id) ? new Map() : new Map(states);
    for (const [key, slots] of states) {
      if (slots >= ps.deployCap) continue;
      const row = key.split(',').map(Number);
      for (const flags of options) {
        const k = flags.map((v, i) => Math.min(caps[i], row[i] + v)).join();
        next.set(k, Math.min(next.get(k) ?? Infinity, slots + 1));
      }
    }
    states = next;
  }
  return (states.get(caps.join()) ?? Infinity) <= ps.deployCap;
}

/** Protect only an indispensable last base of an achievable mature Precision package, at R13-14. */
export function coopLatePrecisionEssential(m, ps, recipe, rec, pieces = ps.allChess()) {
  if (!late(m) || (ps.layers.preciShip || 0) < 40 || ps.gd.modeInactiveBonds.has('preciShip')) return false;
  const id = base(ps, rec), same = pieces.filter(p => base(ps, p) === id);
  if (same.length !== 1 || !pieceBonds(ps.gd, same[0]).includes('preciShip')) return false;
  const signature = JSON.stringify([pieces.map(p => [p.uid, p.id, p.items?.map(i => i.id)]).sort((a, b) => a[0] - b[0]),
    ps.deployCap, ps.bondCountBonus, ps.layers.skillfulShip || 0]);
  let cache = ps._botCoopLatePrecisionCache;
  if (cache?.signature !== signature) {
    const skill = (ps.layers.skillfulShip || 0) >= 40 && coopPrecisionFeasible(ps, recipe, pieces, 2) ? 2 : 0;
    cache = { signature, skill, feasible: coopPrecisionFeasible(ps, recipe, pieces, skill), essential: new Map() };
    ps._botCoopLatePrecisionCache = cache;
  }
  if (!cache.feasible) return false;
  if (!cache.essential.has(id)) cache.essential.set(id, !coopPrecisionFeasible(ps, recipe, pieces.filter(p => base(ps, p) !== id), cache.skill));
  return cache.essential.get(id);
}

export function withCoopLatePrecisionPackage(parent) {
  const essential = (m, ps, rec, pieces) => {
    const result = coopLatePrecisionEssential(m, ps, parent, rec, pieces);
    if (result) {
      const key = `${m.round}:${base(ps, rec)}`, metrics = ps._botCoopRegressionMetrics ||= {};
      metrics[key] = (metrics[key] || 0) + 1;
    }
    return result;
  };
  return Object.freeze({ ...parent,
    keep(m, ps, rec, ...xs) { return essential(m, ps, rec) || parent.keep(m, ps, rec, ...xs); },
    preserve(m, ps, rec, ...xs) { return essential(m, ps, rec) || parent.preserve(m, ps, rec, ...xs); },
    beforeWithdrawal(m, ps, p, h) {
      if (parent.beforeWithdrawal?.(m, ps, p, h)) return true;
      if (!essential(m, ps, ps.gd.chess(p.id))) return false;
      const repaired = repairCoopWithdrawal(m, ps, p, h, parent);
      if (repaired) (ps._botCoopRegressionHistory ||= []).push({ factor: 'late-precision-entry', round: m.round, kept: p.id });
      return repaired;
    },
    trade(m, ps, ...xs) {
      if (!late(m)) return parent.trade(m, ps, ...xs);
      const old = ps._botCoopPrecisionSaleGuard;
      ps._botCoopPrecisionSaleGuard = (p, remaining) => essential(m, ps, ps.gd.chess(p.id), remaining);
      try { return parent.trade(m, ps, ...xs); }
      finally { if (old === undefined) delete ps._botCoopPrecisionSaleGuard; else ps._botCoopPrecisionSaleGuard = old; }
    },
  });
}

/** Reuse the supply proposals/common samples; only unused safer candidates enter the normal defense selector. */
export function withCoopSupplyDefenseFallback(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!cooperative(m) || !m.wave || m.round >= m.gd.bossRound) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return;
    }
    const old = ps._botCoopSupplyDefenseFallback; ps._botCoopSupplyDefenseFallback = true;
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { if (old === undefined) delete ps._botCoopSupplyDefenseFallback; else ps._botCoopSupplyDefenseFallback = old; }
  } });
}
