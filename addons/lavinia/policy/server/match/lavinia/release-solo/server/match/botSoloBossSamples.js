// [ASSUMED] Opt-in solo R14: retain candidates/roster, compare four common independent battle samples.
import { createForecastBattle, stepForecastBattle } from '../../../../../../../../aiCompute/forecast.js';
import { GEO } from '../../../../../../../../../../shared/constants.js';
import { deriveSeed } from '../../../../../../../../../sim/rng.js';
import { bossPoolHp, SharedBossPool } from '../../../../../../../../finalAssault.js';
import { withBounties } from '../../../../../../../../waves.js';
export const SOLO_BOSS_SAMPLE_LIMITS = Object.freeze({ samples: 4, fieldSteps: 1_800_000, wallMs: 30_000 });
export function soloBossSampleRank(rows, hp, lp) {
  if (rows.length !== 4 || rows.some((r, i) => !r.valid || r.sample !== i)) return null;
  const scores = rows.map(r => r.won ? 2 + Math.max(0, r.lp) / Math.max(1, lp) : r.damage / hp);
  return [rows.filter(r => r.won).length, scores.reduce((n, v) => n + v, 0) / 4, Math.min(...scores)];
}
export function* createSoloBossSamples(m, ps, chosen, candidates, inputSteps, wave) {
  const limits = SOLO_BOSS_SAMPLE_LIMITS, hp = bossPoolHp(m.gd, m.bossId, 1), started = performance.now();
  const after = m.gd.bossLevelTime(m.round) || m.gd.bossOvertimeAfterReal;
  const cap = Math.ceil((after + ps.lp / Math.max(.01, m.gd.bossOvertimeDrainReal) + 5) * m.gd.combatTimeScale * 30);
  const inputs = [];
  for (const plan of candidates) { const input = yield* inputSteps(plan); input.lpForBoss = ps.lp; inputs.push(input); yield; }
  let index = 0, sample = 0, t = null, ticks = 0, totalSteps = 0, bestRank = null;
  const minMissing = Math.min(...candidates.map(p => p.bossMissing || 0));
  const job = { chosen, plans: candidates, best: candidates[0], bestIndex: 0, done: false, outcomes: [], samples: 4,
    run(budgetMs = Infinity) {
      const start = performance.now(); let steps = 0;
      while (index < candidates.length) {
        if (totalSteps >= limits.fieldSteps || !m.sched.virtual && performance.now() - started >= limits.wallMs) {
          job.stopped = totalSteps >= limits.fieldSteps ? 'field-step-budget' : 'wall-budget';
          job.best = candidates[0]; job.bestIndex = 0; job.done = true; return true;
        }
        if (!t) {
          const input = structuredClone(inputs[index]), pool = new SharedBossPool(hp);
          const seed = deriveSeed(m.seed, sample === 0 ? `boss-rehearse:${m.round}:${ps.seat}` : `boss-rehearse:${m.round}:${ps.seat}:sample:${sample}`);
          const battle = createForecastBattle(m, { seed, kind: 'boss', modeId: m.modeId, round: m.round,
            stageId: m.stageId, rect: { ...GEO.BOSS_RECT }, timeLimit: Infinity, players: [input],
            spawns: m._sanitizeSpawns(withBounties(m.gd, m.round, wave, ps.bounties, ps.playerId), ps.playerId),
            routes: wave.routes, sharedBoss: pool, flags: { layerGainsEnabled: false, ...m.gd.dp, enemyScale: m.gd.enemyScale(m.round) },
            fieldId: `br4:${ps.playerId}`, enemyOverrides: wave.overrides, waveId: wave.templateId, bossId: m.bossId });
          t = { battle, pool, lost: 0 };
          battle.on('enemyLeak', ({ enemy }) => { t.lost += Number.isFinite(enemy?.lpr) && enemy.lpr >= 0 ? enemy.lpr : 1; });
          battle.on('lpLoss', ({ amount }) => { t.lost += Math.max(0, Number(amount) || 0); });
        }
        while (!t.battle.finished && ticks < cap) {
          stepForecastBattle(t.battle); ticks++; steps++; totalSteps++;
          if (t.pool.hp <= 0 || ps.lp - t.lost - m.gd.bossOvertimeDue(t.battle.time, after) <= 0) {
            if (!t.battle.finished) t.battle.forceEnd('forced'); break;
          }
          if (totalSteps >= limits.fieldSteps || steps % 4 === 0 && performance.now() - start >= budgetMs) return false;
        }
        job.outcomes.push({ index, sample, valid: ticks < cap || t.battle.finished, won: t.pool.hp <= 0,
          damage: hp - t.pool.hp, lp: ps.lp - t.lost - m.gd.bossOvertimeDue(t.battle.time, after), duration: t.battle.time,
          missing: candidates[index].bossMissing || 0 });
        t = null; ticks = 0; sample++;
        if (sample === limits.samples) {
          const rank = soloBossSampleRank(job.outcomes.filter(r => r.index === index), hp, ps.lp);
          if ((candidates[index].bossMissing || 0) <= minMissing && rank) {
            const at = bestRank ? rank.findIndex((v, k) => Math.abs(v - bestRank[k]) > 1e-6) : -1;
            if (!bestRank || at >= 0 && rank[at] > bestRank[at]) { bestRank = rank; job.best = candidates[index]; job.bestIndex = index; }
          }
          sample = 0; index++;
        }
        if (Number.isFinite(budgetMs) && performance.now() - start >= budgetMs) return false;
      }
      job.fieldSteps = totalSteps; job.done = true; return true;
    } };
  return job;
}
