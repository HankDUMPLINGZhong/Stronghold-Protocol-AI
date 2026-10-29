// [ASSUMED] Owned Quintus counter entry plus local carry facings, within the inherited own-only forecast budget.
// No purchases, saved layouts, live battle seeds/results, teammate units, normal-round or default changes.
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { quintusMedicRosters, controlBonds } from './lateranoControlBoss.js';
import { healingTiles } from '../botPositioning.js';
import { coopSelfBossSession } from './lateranoCoopBossSelf.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';
import { applyCoopRolePlan } from './lateranoCoopRoles.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const scoped = m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound && m.bossId === 'boss_4';
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).join('|');

/** Keep all existing occupied tiles; introduce one owned medic and coordinate primary carry directions. */
export function quintusLocalPlans(m, ps, h, recipe) {
  const original = bossFormationSnapshot(ps, h), plans = [original];
  if (!scoped(m) || (ps.bonds.lateranoShip?.count || 0) < 6) return plans;
  const rec = p => h.rangeRec(ps, ps.gd.chess(p.id)), base = p => ps.gd.baseIdOf(p.id);
  if (original.lineup.some(p => rec(p).subProfessionId === 'wandermedic')) return plans;
  const mains = original.lineup.filter(p => [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(base(p)));
  if (!mains.length) return plans;
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const bodies = new Set(h.fieldModel(m, ps).bossBodies.flatMap(b => b.tiles));
  if (!bodies.size) return plans;
  const seen = new Set([signature(original)]), proposals = [];
  const rosters = quintusMedicRosters(ps).filter(lineup => [...owners].every(uid => lineup.some(p => p.uid === uid)));
  // An elemental medic may replace the third Precision member; retain mature Skillful providers when possible.
  rosters.sort((a, b) => Number(controlBonds(ps, b).skillfulShip?.active) - Number(controlBonds(ps, a).skillfulShip?.active));
  for (const lineup of rosters.slice(0, 2)) {
    const medic = lineup.find(p => !original.lineup.includes(p)), removed = original.lineup.find(p => !lineup.includes(p));
    if (!medic || !removed || owners.has(removed.uid)) continue;
    const key = original.get(removed.uid), [r, c] = key.split(',').map(Number);
    if (!ps._legal(medic, r, c)) continue;
    const options = DIRS.map(dir => {
      const heal = healingTiles(rec(medic), r, c, dir);
      const covered = mains.filter(p => heal.has(original.get(p.uid))).length;
      const others = lineup.filter(p => p !== medic && !mains.includes(p) && heal.has(original.get(p.uid))).length;
      return { dir, covered, others };
    }).sort((a, b) => b.covered - a.covered || a.others - b.others || DIRS.indexOf(a.dir) - DIRS.indexOf(b.dir));
    if (!options[0].covered) continue;
    const combinations = mains.reduce((rows, _p) => rows.flatMap(row => DIRS.map(dir => [...row, dir])), [[]]);
    for (const facings of combinations) {
      if (mains.some((p, i) => owners.has(p.uid) && facings[i] !== original.dirs.get(p.uid))) continue;
      const contact = mains.map((p, i) => {
        const [row, col] = original.get(p.uid).split(',').map(Number);
        return h.rangeTiles(rec(p), row, col, facings[i]).filter(k => bodies.has(k)).length;
      });
      if (contact.some(n => !n)) continue;
      const plan = new h.LayoutPlan(); plan.lineup = lineup;
      for (const p of lineup) {
        plan.set(p.uid, p === medic ? key : original.get(p.uid));
        plan.dirs.set(p.uid, p === medic ? options[0].dir : mains.includes(p) ? facings[mains.indexOf(p)] : original.dirs.get(p.uid));
      }
      const sig = signature(plan); if (seen.has(sig)) continue; seen.add(sig);
      plan.quintusLocal = { medic: medic.uid, removed: removed.uid, focusedCoverage: options[0].covered,
        skillfulRetained: !!controlBonds(ps, lineup).skillfulShip?.active, bodyCoverage: contact.reduce((s, n) => s + n, 0) };
      proposals.push(plan);
    }
  }
  proposals.sort((a, b) => Number(b.quintusLocal.skillfulRetained) - Number(a.quintusLocal.skillfulRetained)
    || b.quintusLocal.bodyCoverage - a.quintusLocal.bodyCoverage || signature(a).localeCompare(signature(b)));
  return [...plans, ...proposals.slice(0, 12)];
}

export function withCoopQuintusLocal(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!scoped(m)) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const old = ps._botCoopAfterOwnBoss;
    ps._botCoopAfterOwnBoss = function*(m, ps, h) {
      if (old) yield* old(m, ps, h);
      const session = coopSelfBossSession(ps); if (!session || session.reason) return;
      const plans = quintusLocalPlans(m, ps, h, parent); if (plans.length < 2) return;
      const job = yield* createCoopBossForecast(m, ps, plans, 10); if (!job) return;
      while (!job.run(4)) yield;
      if (!job.stale && job.bestIndex) applyCoopRolePlan(ps, job.best);
      (ps._botCoopQuintusLocalHistory ||= []).push({ round: m.round, index: job.bestIndex, stale: job.stale,
        reason: session.reason, plans: plans.map(p => ({ lineup: p.lineup.map(u => ({ uid: u.uid, id: u.id })),
          positions: [...p], dirs: [...p.dirs], counter: p.quintusLocal })), outcomes: job.outcomes });
    };
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { if (old === undefined) delete ps._botCoopAfterOwnBoss; else ps._botCoopAfterOwnBoss = old; }
  } });
}
