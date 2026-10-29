// [ASSUMED] R14 fixed-roster carry/medic/frontline follow-up. Public geometry, owned assets and common samples only.
import { bossFormationSnapshot, bossLinkedPlans, linkedFormationPlan } from './lateranoBossFormation.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { coopSelfBossSession } from './lateranoCoopBossSelf.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';
import { applyCoopRolePlan } from './lateranoCoopRoles.js';

const eligible = m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound
  && m.botRehearsal >= 3 && m.bossId !== 'boss_4';
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
const dirs = ['RIGHT', 'UP', 'DOWN', 'LEFT'];

export function coopTeamWindowPlans(m, ps, h, recipe, entering) {
  const original = bossFormationSnapshot(ps, h), result = [original], seen = new Set([signature(original)]);
  if (!eligible(m)) return result;
  const rec = u => h.rangeRec(ps, ps.gd.chess(u.id));
  const healRange = ps._botCoopHealingRange || healingTiles;
  const medic = u => rec(u).attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(rec(u).subProfessionId);
  const model = h.fieldModel(m, ps), bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  const routes = model.routes.filter(r => !r.fallback && r.dwell > 0);
  const guards = model.routes.filter(r => !r.fallback && !r.dwell && !r.fly && r.n > 0);
  const at = (p, u) => { const [r, c] = p.get(u.uid).split(',').map(Number); return { r, c, dir: p.dirs.get(u.uid) }; };
  const cover = (p, u) => { const l = at(p, u); return new Set(h.rangeTiles(rec(u), l.r, l.c, l.dir)); };
  const tank = u => rec(u).profession === 'TANK'; // Saint is an output unit, never the protected tank role.
  const weight = u => [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(ps.gd.baseIdOf(u.id)) ? 4
    : rec(u).profession === 'TANK' ? .5 : 1;
  const score = p => {
    const meds = p.lineup.filter(medic).map(u => { const l = at(p, u); return healRange(rec(u), l.r, l.c, l.dir); });
    let value = 0;
    for (const u of p.lineup) {
      const r = rec(u), hit = cover(p, u), key = p.get(u.uid), w = weight(u);
      if (!['heal', 'none'].includes(r.attackKind) && r.subProfessionId !== 'bard') {
        const contact = bodies.size ? [...bodies].filter(k => hit.has(k)).length / bodies.size
          : routes.reduce((n, rt) => n + rt.tiles.filter(k => hit.has(k)).length / Math.max(1, rt.tiles.length), 0);
        value += w * (contact > 0 ? 15 + contact * 10 : -40);
      }
      if (acceptsHealing(r)) value += w * (meds.some(c => c.has(key)) ? 12 : -8);
      for (const rt of guards) {
        const index = rt.tiles.indexOf(key); if (index < 0 || tank(u)) continue;
        const front = p.lineup.filter(tank).some(t => { const i = rt.tiles.indexOf(p.get(t.uid)); return i >= 0 && i < index; });
        if (!front) value -= (medic(u) ? 25 : 12) * w;
      }
    }
    return value;
  };
  const offer = (p, family) => {
    if (!p || seen.has(signature(p))) return;
    seen.add(signature(p)); p.coopTeamWindow = { family, score: score(p) }; result.push(p);
  };
  if (entering && entering.lineup.map(u => u.uid).sort().join() === original.lineup.map(u => u.uid).sort().join()) {
    offer(linkedFormationPlan(ps, h, original, entering.lineup.map(u => ({ uid: u.uid, key: entering.get(u.uid), dir: entering.dirs.get(u.uid) }))), 'entering');
  }
  // Recompute joint plans after the inherited exchanges, not from their earlier formation.
  for (const p of bossLinkedPlans(m, ps, h, recipe, original))
    if (rec(p.lineup.find(u => u.uid === p.linked.tank)).profession === 'TANK') offer(p, `linked-${p.linked.family}`);
  // Give the healer a whole-team coverage alternative; moving the primary carry alone misses this family.
  for (const med of original.lineup.filter(medic).filter(u => !tank(u)).slice(0, 2)) {
    const proposals = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) for (const dir of dirs) {
      const p = linkedFormationPlan(ps, h, original, [{ uid: med.uid, key: `${r},${c}`, dir }]);
      if (p) proposals.push(p);
    }
    proposals.sort((a, b) => score(b) - score(a) || signature(a).localeCompare(signature(b)));
    const slots = new Set();
    for (const p of proposals) if (!slots.has(p.get(med.uid))) {
      slots.add(p.get(med.uid)); offer(p, 'team-healer'); if (slots.size === 2) break;
    }
  }
  return result;
}

export function withCoopTeamWindow(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!eligible(m)) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const entering = bossFormationSnapshot(ps, h), old = ps._botCoopAfterExchangeBoss;
    ps._botCoopAfterExchangeBoss = function*(m, ps, h) {
      if (old) yield* old(m, ps, h);
      const session = coopSelfBossSession(ps); if (!session || session.reason) return;
      const plans = coopTeamWindowPlans(m, ps, h, parent, entering), batches = [];
      let best = plans[0], stale = false;
      for (let i = 1; i < plans.length && !session.reason; i += 2) {
        const job = yield* createCoopBossForecast(m, ps, [best, ...plans.slice(i, i + 2)], 10);
        if (!job) break; while (!job.run(4)) yield;
        batches.push({ index: job.bestIndex, stale: job.stale, outcomes: job.outcomes });
        if (job.stale) { stale = true; break; } best = job.best;
      }
      if (!stale && signature(best) !== signature(plans[0])) applyCoopRolePlan(ps, best);
      (ps._botCoopTeamWindowHistory ||= []).push({ round: m.round, changed: signature(best) !== signature(plans[0]),
        stale, reason: session.reason, plans: plans.map(p => ({ positions: [...p], dirs: [...p.dirs], proposal: p.coopTeamWindow })), batches });
    };
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { if (old === undefined) delete ps._botCoopAfterExchangeBoss; else ps._botCoopAfterExchangeBoss = old; }
  } });
}
