// [ASSUMED] Bounded co-op final preparation. Cache and pruning retain the ten-sample ordering exactly.
// A shared deterministic field-step ceiling applies in every scheduler; real rooms also have a wall-clock fuse.
import { bossPoolHp, SharedBossPool } from '../../../../../finalAssault.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { selectFinalSwap } from './lateranoFinalSwap.js';

export const COOP_PLANNING_LIMITS = Object.freeze({ fieldSteps: 1_200_000, wallMs: 15_000 });
const sessions = new WeakMap();
export const coopPlanningSession = ps => sessions.get(ps);
const context = (m, ps) => JSON.stringify({ seed:m.seed,round:m.round,boss:m.bossId,stage:m.stageId,
  groups:m.bossWaves, players:m.alivePlayers().map(p=>({id:p.playerId,lp:p.lp,
    input:p===ps?null:p.battleInput(),bounties:p.bounties})) });
const score = rows => [Math.min(...rows.map(r=>r.won)),rows.reduce((n,r)=>n+r.won,0),
  Math.min(...rows.map(r=>r.damageShare)),rows.reduce((n,r)=>n+r.damageShare,0),
  Math.min(...rows.map(r=>r.lp)),rows.reduce((n,r)=>n+r.lp,0)];

/** Even perfect remaining samples cannot beat the completed incumbent. Never reject a possible winner. */
export function coopPrefixCannotWin(rows, incumbent, samples, lp) {
  if(rows.some(r=>!r.valid))return true;
  if(!rows.length||incumbent.length!==samples||incumbent.some(r=>!r.valid))return false;
  const remaining=samples-rows.length;
  const upper=[rows.every(r=>r.won)?1:0,rows.reduce((n,r)=>n+r.won,0)+remaining,
    Math.min(...rows.map(r=>r.damageShare)),rows.reduce((n,r)=>n+r.damageShare,0)+remaining,
    Math.min(...rows.map(r=>r.lp)),rows.reduce((n,r)=>n+r.lp,0)+remaining*lp];
  const best=score(incumbent);
  for(let i=0;i<best.length;i++)if(Math.abs(upper[i]-best[i])>1e-6)return upper[i]<best[i];
  return true; // exact ties retain the earlier incumbent
}

function expired(s) {
  if(s.steps>=s.limits.fieldSteps){s.reason ||= 'field-step-budget';return true;}
  if(!s.m.sched.virtual&&performance.now()-s.started>=s.limits.wallMs){s.reason ||= 'wall-budget';return true;}
  return !!s.reason;
}

export function withLateranoCoopPlanning(parent, limits=COOP_PLANNING_LIMITS) {
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(m.mode!=='coop'||m.isSolo||m.wave||m.round!==m.gd.bossRound){
      if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);return;
    }
    const s={m,started:performance.now(),steps:0,limits,cache:new Map(),stamp:context(m,ps),
      hits:0,simulated:0,pruned:0,reason:null};
    sessions.set(ps,s);
    const gen=parent.finalBoardSteps?.(m,ps,h);
    try{
      if(gen)for(;;){
        // Let an in-flight comparison finish bookkeeping and apply its completed incumbent.
        // run() observes the expired budget before constructing/stepping another battle.
        if(expired(s)&&(!s.activeJob||s.activeJob.done)){gen.return();break;}
        const r=gen.next();if(r.done)break;yield;
      }
    }finally{
      gen?.return();sessions.delete(ps);
      (ps._botCoopPlanningHistory ||= []).push({round:m.round,ms:performance.now()-s.started,
        fieldSteps:s.steps,cacheHits:s.hits,simulatedSamples:s.simulated,prunedCandidates:s.pruned,
        reason:s.reason,limits:{...limits}});
    }
  }});
}

/** Lazy trials, exact incumbent reuse, staged prefixes, early public-state invalidation and bounded total work. */
export function* efficientCoopBossForecast(m,ps,plans,samples,fieldsOf) {
  const s=sessions.get(ps);if(!s)return null;
  if(context(m,ps)!==s.stamp){s.reason='stale';return null;}
  const hp=bossPoolHp(m.gd,m.bossId,m.alivePlayers().length);
  const lp=m.alivePlayers().reduce((n,p)=>n+Math.max(0,p.lp),0);
  const after=m.gd.bossLevelTime(m.round)||m.gd.bossOvertimeAfterReal;
  const cap=Math.ceil((after+lp/Math.max(.01,m.gd.bossOvertimeDrainReal)+5)*m.gd.combatTimeScale*30);
  const inputs=[],entries=[];
  for(const plan of plans){
    const input=stealthBattleInput(ps,plan),key=JSON.stringify(input);inputs.push(input);
    if(!s.cache.has(key))s.cache.set(key,new Map());entries.push(s.cache.get(key));yield;
  }
  let index=0,sample=0,trial=null;
  const job={done:false,best:plans[0],bestIndex:0,plans,outcomes:[],stale:false,pruned:[],budget:false,
    run(budgetMs=Infinity){
      if(job.done)return true;
      const start=performance.now();
      const finish=()=>{
        job.stale=context(m,ps)!==s.stamp;
        if(job.stale)s.reason='stale';
        if(!job.stale)job.bestIndex=selectFinalSwap(plans,job.outcomes,{samples,aggregate:true}).index;
        job.best=plans[job.bestIndex];job.done=true;
        if(trial)trial.fields=null;
        return true;
      };
      if(context(m,ps)!==s.stamp){s.reason='stale';return finish();}
      if(expired(s)){job.budget=true;return finish();}
      while(index<plans.length){
        if(entries[index].has(sample)){
          job.outcomes.push({...entries[index].get(sample),index,sample});s.hits++;sample++;
        }else{
          if(expired(s)){job.budget=true;return finish();}
          if(!trial){
            const pool=new SharedBossPool(hp);trial={pool,ticks:0,lost:0,failed:false,fields:null};
            try{
              trial.fields=fieldsOf(m,ps,inputs[index],pool,sample);
              const current=trial;
              for(const b of trial.fields){
                b.on('enemyLeak',({enemy})=>{current.lost+=Number.isFinite(enemy?.lpr)&&enemy.lpr>=0?enemy.lpr:1;});
                b.on('lpLoss',({amount})=>{current.lost+=Math.max(0,Number(amount)||0);});
              }
            }catch(e){trial.failed=true;m.log.warn?.(`co-op boss forecast construction failed: ${e.message}`);}
          }
          try{
            while(!trial.failed&&trial.ticks<cap&&trial.fields.some(b=>!b.finished)){
              for(const b of trial.fields)if(!b.finished){b.step();s.steps++;}trial.ticks++;
              if(trial.pool.hp<=0||lp-trial.lost-m.gd.bossOvertimeDue(trial.ticks/30,after)<=0)break;
              if(expired(s)){job.budget=true;return finish();}
              if(trial.ticks%4===0&&performance.now()-start>=budgetMs)return false;
            }
            for(const b of trial.fields||[])if(!b.finished)b.forceEnd('forced');
            const valid=!trial.failed&&trial.ticks<cap&&trial.fields.every(b=>!b.errorCount&&!b.result().synthetic&&!b.result().errors);
            const row={index,sample,valid,won:trial.pool.hp<=0?1:0,damageShare:1-Math.max(0,trial.pool.hp)/hp,
              lp:lp-trial.lost-m.gd.bossOvertimeDue(trial.ticks/30,after)};
            job.outcomes.push(row);if(valid)entries[index].set(sample,{...row});
          }catch(e){job.outcomes.push({index,sample,valid:false});m.log.warn?.(`co-op boss forecast failed: ${e.message}`);}
          trial.fields=null;trial=null;sample++;s.simulated++;
        }
        const rows=job.outcomes.filter(r=>r.index===index);
        if(index===0&&(rows.some(r=>!r.valid)||sample===samples&&rows.every(r=>r.won)))return finish();
        const incumbent=job.outcomes.filter(r=>r.index===job.bestIndex);
        if(index>0&&[2,4,samples].includes(sample)&&coopPrefixCannotWin(rows,incumbent,samples,lp)){
          if(sample<samples){job.pruned.push(index);s.pruned++;}index++;sample=0;
        }else if(sample===samples){
          job.bestIndex=selectFinalSwap(plans,job.outcomes,{samples,aggregate:true}).index;index++;sample=0;
        }
        if(performance.now()-start>=budgetMs)return false;
      }
      return finish();
    }};
  s.activeJob=job;return job;
}
