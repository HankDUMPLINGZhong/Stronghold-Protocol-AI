// Bounded current-wave planning, separate from the retained one-sample rehearsal.
// [ASSUMED] Three formations, two common independent seeds; worst-case loss precedes average loss.
// Forecast results are disposable: no meta dispatch, shared boss pool, RNG draw or settlement.
import { GEO } from '../../../../../../shared/constants.js';
import { deriveSeed } from '../../../../../sim/rng.js';
import { withBounties } from '../../../../waves.js';
import { bossPoolHp, SharedBossPool } from '../../../../finalAssault.js';
import { unitePathEnabled, unitePathContext, unitePathValue, protectUnitePath } from './botStrategies/lateranoCoopUnitePath.js';

export const FORECAST_SAMPLES = 2;
export const FORECAST_PLANS = 3;

const signature = plan => [...plan].sort((a,b) => a[0]-b[0])
  .map(([uid,key]) => `${uid}@${key}:${plan.dirs?.get(uid) || 'RIGHT'}`).join('|');
const sum = (rows, key) => rows.reduce((s,r) => s+r[key],0);
const max = (rows, key) => Math.max(...rows.map(r => r[key]));
const min = (rows, key) => Math.min(...rows.map(r => r[key]));
const better = (a,b) => {
  for (let i=0;i<a.length;i++) if (Math.abs(a[i]-b[i]) > 1e-6) return a[i]>b[i];
  return false;
};

/** Complete paired samples only. A farming proposal must preserve safety in EACH common sample. */
export function selectForecast(plans, outcomes, boss = false) {
  const rows = plans.map((_,i) => outcomes.filter(r => r.index===i).sort((a,b) => a.sample-b.sample));
  const valid = rs => rs.length===FORECAST_SAMPLES && rs.every((r,i) => r.valid && r.sample===i);
  if (!valid(rows[0])) return 0;
  const rank = rs => boss
    ? [min(rs,'won'),sum(rs,'won'),min(rs,'damageShare'),sum(rs,'damageShare'),min(rs,'lp'),sum(rs,'lp')]
    : [-max(rs,'lost'),-sum(rs,'lost'),sum(rs,'killed'),-max(rs,'deaths'),-sum(rs,'deaths'),sum(rs,'layers')];
  let best=0, score=rank(rows[0]);
  for (let i=1;i<plans.length;i++) {
    if (!valid(rows[i])) continue;
    if (plans[i].farming && (boss || rows[i].some((r,s) => r.lost>rows[0][s].lost || r.leaks>rows[0][s].leaks
      || r.killed<rows[0][s].killed || r.deaths>rows[0][s].deaths))) continue;
    const next=rank(rows[i]);
    if (better(next,score)) { best=i; score=next; }
  }
  return best;
}

/** inputSteps snapshots a shadow board and its summons; the real player is never temporarily rearranged. */
export function* createForecastSteps(m, ps, chosen, plans, inputSteps, recipe) {
  if (!(m.botRehearsal>0)) return null;
  const boss = !m.wave;
  const group = boss && m.isSolo && m.round===m.gd.bossRound ? m.bossGroupOf(ps) : null;
  if (boss && !group) return null; // Co-op needs joint planning, not an imaginary empty teammate.
  const wave = boss ? group.wave : m.wave;
  if (!wave) return null;
  // [ASSUMED] Explicit boss-only sampling experiment; every retained policy still uses two samples.
  const samples = boss && recipe?.forecastContext && recipe?.selectForecast
    && [4, 6, 8, 10, 12].includes(recipe.forecastSamples) ? recipe.forecastSamples
    : !boss && m.mode === 'coop' && !m.isSolo && recipe?.forecastContext && recipe?.selectForecast
      && recipe.forecastNormalSamples === 6 ? 6 : FORECAST_SAMPLES;
  const seen=new Set();
  const planLimit = boss && recipe?.finalProtectionPlans && recipe.forecastPlanLimit === 6 ? 6 : FORECAST_PLANS;
  const candidates=plans.filter(p => {
    const key=signature(p); if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0,planLimit > FORECAST_PLANS && m.botRehearsal >= FORECAST_PLANS ? planLimit : Math.min(FORECAST_PLANS,m.botRehearsal));
  if (candidates.length<2 && !(candidates.length === 1 && !boss && recipe?.forecastReadinessOnly === true)) return null;
  const inputs=[];
  for (const plan of candidates) {
    const input = yield* inputSteps(plan);
    inputs.push(recipe?.prepareForecastInput?.(m, ps, chosen, plan, input) || input); yield;
  }
  const context = recipe?.forecastContext?.(m, ps, chosen, candidates, recipe);
  const pathContexts = !boss && unitePathEnabled(m, ps, candidates) ? inputs.map(input => unitePathContext(m, ps, input)) : null;
  const pathOptions = pathContexts && candidates.every(p => p.coopUnitePathBalance)
    ? { balanced: true, urgent: m.alivePlayers().some(p => p.playerId !== ps.playerId && p.lp <= m.gd.lpCapPerRound) } : undefined;
  const hp = boss ? bossPoolHp(m.gd,m.bossId,1) : 0;
  const after = m.gd.bossLevelTime(m.round) || m.gd.bossOvertimeAfterReal;
  const cap = boss
    ? Math.ceil((after+ps.lp/Math.max(.01,m.gd.bossOvertimeDrainReal)+5)*m.gd.combatTimeScale*30)
    : Math.ceil(((wave.timeLimit || 60)+5)*30);
  const trials=[];
  for (let index=0;index<candidates.length;index++) for (let sample=0;sample<samples;sample++) {
    // The sample seed is deliberately independent of candidate index, scheduling and all mutable match RNGs.
    const pool=boss ? new SharedBossPool(hp) : null;
    const input=structuredClone(inputs[index]); if (boss) input.lpForBoss=ps.lp;
    const trial={ index,sample,pool,battle:null,lost:0,failed:false,metrics:null };
    try {
      trial.battle=m.newBattle({ seed:deriveSeed(m.seed,`forecast:${m.round}:${ps.seat}:${sample}`),
        kind:boss ? 'boss' : 'normal', modeId:m.modeId, round:m.round, stageId:m.stageId,
        rect:{ ...(boss ? GEO.BOSS_RECT : GEO.NORMAL_RECT) }, timeLimit:boss ? Infinity : wave.timeLimit,
        players:[input], spawns:m._sanitizeSpawns(withBounties(m.gd,m.round,wave,ps.bounties,ps.playerId)
          .map(s => ({ ...s,ownerPlayerId:ps.playerId })),ps.playerId), routes:wave.routes, sharedBoss:pool,
        flags:{ ...m.gd.dp,layerGainsEnabled:!boss && recipe?.forecastLayerGainsEnabled !== false,
          ...(boss ? { enemyScale:m.gd.enemyScale(m.round) } : {}) },
        fieldId:`r:${ps.playerId}`, enemyOverrides:wave.overrides,waveId:wave.templateId,
        ...(boss ? { bossId:m.bossId } : {}) });
      if (context) trial.metrics = recipe.observeForecast(trial.battle, context, candidates[index]);
      if (boss) {
        trial.battle.on('enemyLeak',({enemy}) => { trial.lost+=Number.isFinite(enemy?.lpr) && enemy.lpr>=0 ? enemy.lpr : 1; });
        trial.battle.on('lpLoss',({amount}) => { trial.lost+=Math.max(0,Number(amount)||0); });
      }
    } catch (e) { trial.failed=true; m.log.warn?.(`bot forecast construction failed: ${e.message}`); }
    trials.push(trial); yield;
  }
  let i=0,ticks=0;
  const job={ chosen,plans:candidates,best:candidates[0],bestIndex:0,done:false,outcomes:[],
    run(budgetMs=Infinity) {
      const start=performance.now(); let steps=0;
      while (i<trials.length) {
        const trial=trials[i], b=trial.battle;
        try {
          while (!trial.failed && !b.finished && ticks<cap) {
            b.step(); ticks++; steps++;
            if (boss && (trial.pool.hp<=0 || ps.lp-trial.lost-m.gd.bossOvertimeDue(b.time,after)<=0)) {
              if (!b.finished) b.forceEnd('forced'); break;
            }
            if (steps%4===0 && performance.now()-start>=budgetMs) return false;
          }
          if (!trial.failed && !boss && !b.finished) b.forceEnd('timeout');
          const result=trial.failed ? null : b.result(), pp=result?.perPlayer?.[ps.playerId];
          const valid=!!pp && !result.synthetic && !(result.errors>0) && !(b.errorCount>0)
            && b.finished;
          if (!valid) job.outcomes.push({ index:trial.index,sample:trial.sample,valid:false });
          else if (boss) job.outcomes.push({ index:trial.index,sample:trial.sample,valid:true,
            won:trial.pool.hp<=0 ? 1 : 0, damageShare:1-Math.max(0,trial.pool.hp)/hp,
            lp:ps.lp-trial.lost-m.gd.bossOvertimeDue(b.time,after), layers:0,
            ...(recipe?.forecastBossMetrics && trial.metrics ? trial.metrics(pp) : {}) });
          else {
            const leaks=(pp.leaked || []).filter(l => l && l.counted!==false);
            job.outcomes.push({ index:trial.index,sample:trial.sample,valid:true,
              // Normal settlement counts enemies with a round cap; lpr belongs to leader LP handling only.
              lost:Math.min(m.gd.lpCapPerRound,leaks.length),
              leaks:leaks.length,killed:pp.killed || 0,deaths:pp.deaths || 0,
              layers:recipe?.rehearsalValue?.(m,ps,pp) || 0,
              ...(pathContexts ? { unitePath: unitePathValue(pathContexts[trial.index], pp) } : {}),
              ...(trial.metrics ? trial.metrics(pp) : {}) });
          }
        } catch (e) {
          job.outcomes.push({ index:trial.index,sample:trial.sample,valid:false });
          m.log.warn?.(`bot forecast failed: ${e.message}`);
        }
        trial.battle=null; i++; ticks=0;
        if (Number.isFinite(budgetMs) && performance.now()-start>=budgetMs) return false;
      }
      if (context) {
        job.development = recipe.selectForecast(candidates, pathContexts ? protectUnitePath(job.outcomes, pathOptions) : job.outcomes, context);
        job.bestIndex = job.development.index;
      } else job.bestIndex=selectForecast(candidates,pathContexts ? protectUnitePath(job.outcomes, pathOptions) : job.outcomes,boss);
      job.best=candidates[job.bestIndex]; job.chosen=job.best.lineup || chosen;
      job.done=true; return true;
    },
  };
  return job;
}
