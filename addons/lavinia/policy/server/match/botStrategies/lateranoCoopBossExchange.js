// [ASSUMED] Own-only final occupied-tile exchanges. No saved layouts/results, economy or teammate-unit inputs.
import { bossFormationSnapshot, linkedFormationPlan } from './lateranoBossFormation.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { coopSelfBossSession } from './lateranoCoopBossSelf.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';
import { applyCoopRolePlan } from './lateranoCoopRoles.js';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const eligible = m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound
  && m.botRehearsal >= 3 && m.bossId !== 'boss_4';
const signature = p => [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');

/** Swap a carry and an occupied support tile, then aim the carry. Preserve every roster member and loadout. */
export function coopBossExchangePlans(m, ps, h, recipe, maximum = 8) {
  const original = bossFormationSnapshot(ps, h); if (!eligible(m)) return [original];
  const rec = p => h.rangeRec(ps, ps.gd.chess(p.id)), base = p => ps.gd.baseIdOf(p.id);
  const priorities = new Map([[recipe.ids.exusiaiAlter, 12], [recipe.ids.lemuen, 11],
    [recipe.ids.archetto, 8], [recipe.ids.executorAlter, 6]]);
  const carries = original.lineup.filter(p => priorities.has(base(p))).sort((a, b) => priorities.get(base(b)) - priorities.get(base(a)) || a.uid - b.uid);
  if (!carries.length) return [original];
  const pinned = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const heal = p => rec(p).attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(rec(p).subProfessionId);
  const skill = original.lineup.filter(p => pieceBonds(ps.gd, p).includes('skillfulShip'));
  const medics = original.lineup.filter(heal), model = h.fieldModel(m, ps), bodies = new Set(model.bossBodies.flatMap(b => b.tiles));
  const routes = model.routes.filter(r => !r.fallback && r.dwell > 0);
  const weight = p => (priorities.get(base(p)) || (rec(p).subProfessionId === 'slower' ? 6 : 1)) * (ps.gd.isGolden(p.id) ? 1.3 : 1);
  const at = (plan, p) => { const [r, c] = plan.get(p.uid).split(',').map(Number); return { r, c, dir: plan.dirs.get(p.uid) }; };
  const cover = (plan, p) => { const l = at(plan, p); return new Set(h.rangeTiles(rec(p), l.r, l.c, l.dir)); };
  const contact = (plan, p) => {
    const hit = cover(plan, p);
    if (bodies.size) return [...bodies].filter(k => hit.has(k)).length / bodies.size;
    const total = routes.reduce((n, r) => n + r.tiles.length * r.tileTime, 0) || 1;
    return routes.reduce((n, r) => n + r.tiles.filter(k => hit.has(k)).length * r.tileTime, 0) / total;
  };
  const healed = (plan, p) => medics.some(med => {
    const l = at(plan, med), tiles = rec(med).subProfessionId === 'incantationmedic' ? cover(plan, med) : healingTiles(rec(med), l.r, l.c, l.dir);
    return tiles.has(plan.get(p.uid));
  });
  const aura = (plan, p) => !!ps.bonds.skillfulShip?.active && skill.some(source => {
    const a = at(plan, source), b = at(plan, p), dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
    return ps.bonds.skillfulShip.layers >= 40 ? Math.max(dr, dc) <= 1 : dr + dc <= 1;
  });
  const safe = plan => carries.every(p => contact(plan, p) > 0
    && (!acceptsHealing(rec(p)) || !healed(original, p) || healed(plan, p))
    && (!aura(original, p) || aura(plan, p)));
  const score = plan => original.lineup.reduce((n, p) => n + weight(p) * contact(plan, p) * 30
    + (carries.includes(p) && healed(plan, p) ? weight(p) * 2 : 0), 0);
  const lists = [], seen = new Set([signature(original)]);
  for (const carry of carries) {
    if (pinned.has(carry.uid)) continue;
    const proposals = [];
    for (const other of original.lineup) {
      if (other === carry || carries.includes(other) || pinned.has(other.uid)) continue;
      if (rec(other).profession === 'TANK') continue; // Keep the inherited blocking anchor intact in this narrow trial.
      for (const dir of DIRS) {
        const plan = linkedFormationPlan(ps, h, original, [
          { uid: carry.uid, key: original.get(other.uid), dir },
          { uid: other.uid, key: original.get(carry.uid), dir: original.dirs.get(other.uid) },
        ]);
        if (!plan || !safe(plan)) continue;
        const sig = signature(plan); if (seen.has(sig)) continue; seen.add(sig);
        plan.coopExchange = { carry: carry.uid, support: other.uid, score: score(plan) };
        proposals.push(plan);
      }
    }
    proposals.sort((a, b) => b.coopExchange.score - a.coopExchange.score || signature(a).localeCompare(signature(b)));
    lists.push(proposals);
  }
  const result = [original];
  // Give each carry a comparison before spending a second slot on that carry's alternative.
  for (let i = 0; i < 2; i++) for (const list of lists) if (list[i]) {
    result.push(list[i]); if (result.length > maximum) return result;
  }
  return result;
}

export function withCoopBossExchange(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!eligible(m)) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const old = ps._botCoopAfterLocalBoss;
    ps._botCoopAfterLocalBoss = function*(m, ps, h) {
      if (old) yield* old(m, ps, h);
      const session = coopSelfBossSession(ps); if (!session || session.reason) return;
      const plans = coopBossExchangePlans(m, ps, h, parent); if (plans.length < 2) return;
      const job = yield* createCoopBossForecast(m, ps, plans, 10); if (!job) return;
      while (!job.run(4)) yield;
      if (!job.stale && job.bestIndex) applyCoopRolePlan(ps, job.best);
      (ps._botCoopBossExchangeHistory ||= []).push({ round: m.round, index: job.bestIndex, stale: job.stale,
        reason: session.reason, plans: plans.map(p => ({ lineup: p.lineup.map(u => ({ uid: u.uid, id: u.id })),
          positions: [...p], dirs: [...p.dirs], proposal: p.coopExchange })), outcomes: job.outcomes });
      if (ps._botCoopAfterExchangeBoss) yield* ps._botCoopAfterExchangeBoss(m, ps, h);
    };
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { if (old === undefined) delete ps._botCoopAfterLocalBoss; else ps._botCoopAfterLocalBoss = old; }
  } });
}
