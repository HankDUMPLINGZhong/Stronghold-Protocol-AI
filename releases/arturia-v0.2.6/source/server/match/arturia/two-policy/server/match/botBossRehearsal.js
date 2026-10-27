// Bounded solo R14 rehearsal. No Match actions or onBattleStart meta hooks are executed by proposals.
// [ASSUMED] A public-wave forecast with an independent seed; not a prediction of the actual combat RNG.
import { GEO } from '../../../../../../shared/constants.js';
import { deriveSeed } from '../../../../../sim/rng.js';
import { bossPoolHp, SharedBossPool } from '../../../../finalAssault.js';
import { withBounties } from '../../../../waves.js';

export function* createBossRehearsalSteps(m, ps, chosen, plans, inputSteps) {
  const group = m.bossGroupOf(ps);
  // Paired fights need a joint team plan; do not model a missing teammate as an empty board.
  if (!m.isSolo || !group || m.round !== m.gd.bossRound || m.botRehearsal < 2) return null;
  const seen = new Set();
  const candidates = plans.filter((p) => {
    const sig = [...p].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}:${k}:${p.dirs.get(u)}`).join('|');
    if (seen.has(sig)) return false; seen.add(sig); return true;
  }).slice(0, m.botRehearsal);
  if (candidates.length < 2) return null;
  const hp = bossPoolHp(m.gd, m.bossId, 1), wave = group.wave, trials = [];
  for (const plan of candidates) {
    const input = yield* inputSteps(plan);
    input.lpForBoss = ps.lp;
    const pool = new SharedBossPool(hp);
    const battle = m.newBattle({ seed: deriveSeed(m.seed, `boss-rehearse:${m.round}:${ps.seat}`), kind: 'boss',
      modeId: m.modeId, round: m.round, stageId: m.stageId, rect: { ...GEO.BOSS_RECT }, timeLimit: Infinity,
      players: [input], spawns: m._sanitizeSpawns(withBounties(m.gd, m.round, wave, ps.bounties, ps.playerId), ps.playerId),
      routes: wave.routes, sharedBoss: pool, flags: { layerGainsEnabled: false, ...m.gd.dp, enemyScale: m.gd.enemyScale(m.round) },
      fieldId: `br:${ps.playerId}`, enemyOverrides: wave.overrides, waveId: wave.templateId, bossId: m.bossId });
    const trial = { battle, pool, lost: 0 };
    battle.on('enemyLeak', ({ enemy }) => { trial.lost += Number.isFinite(enemy?.lpr) && enemy.lpr >= 0 ? enemy.lpr : 1; });
    battle.on('lpLoss', ({ amount }) => { trial.lost += Math.max(0, Number(amount) || 0); });
    trials.push(trial); yield;
  }
  const after = m.gd.bossLevelTime(m.round) || m.gd.bossOvertimeAfterReal;
  const minMissing = Math.min(...candidates.map((p) => p.bossMissing || 0));
  // Computational guard only. Exceeding it retains the measured baseline; it is not a game time limit.
  const cap = Math.ceil((after + ps.lp / Math.max(0.01, m.gd.bossOvertimeDrainReal) + 5) * m.gd.combatTimeScale * 30);
  let i = 0, ticks = 0, bestScore = -Infinity;
  const job = { chosen, plans: candidates, best: candidates[0], done: false, outcomes: [], run(budgetMs = Infinity) {
    const start = performance.now(); let steps = 0;
    while (i < trials.length) {
      const t = trials[i];
      while (!t.battle.finished && ticks < cap) {
        t.battle.step(); ticks++; steps++;
        const remaining = ps.lp - t.lost - m.gd.bossOvertimeDue(t.battle.time, after);
        if (t.pool.hp <= 0 || remaining <= 0) { if (!t.battle.finished) t.battle.forceEnd('forced'); break; }
        if (steps % 4 === 0 && performance.now() - start >= budgetMs) return false;
      }
      const lp = ps.lp - t.lost - m.gd.bossOvertimeDue(t.battle.time, after), won = t.pool.hp <= 0;
      const score = ticks >= cap && !t.battle.finished ? -Infinity
        : won ? 2 + Math.max(0, lp) / Math.max(1, ps.lp) : 1 - t.pool.hp / hp;
      job.outcomes.push({ index: i, won, damage: hp - t.pool.hp, lp, duration: t.battle.time, missing: candidates[i].bossMissing || 0 });
      if ((candidates[i].bossMissing || 0) <= minMissing && score > bestScore + 1e-6) {
        bestScore = score; job.best = candidates[i]; job.bestIndex = i;
      }
      trials[i] = null; i++; ticks = 0;
      if (Number.isFinite(budgetMs) && performance.now() - start >= budgetMs) return false;
    }
    job.done = true; return true;
  } };
  return job;
}
