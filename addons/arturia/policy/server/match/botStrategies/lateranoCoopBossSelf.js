// [ASSUMED] Independent co-op R14 objective: own boss damage, never team victory or teammate composition.
// A fixed visible-countdown horizon uses the official lone-side template and a one-player boss HP share.
import {GEO} from '../../../../../../../shared/constants.js';
import {createRng,deriveSeed} from '../../../../../../sim/rng.js';
import {bossPoolHp,SharedBossPool} from '../../../../../finalAssault.js';
import {buildBossWave,bountySpawns} from '../../../../../waves.js';
import {stealthBattleInput} from './lateranoStealthWave.js';

export const COOP_SELF_BOSS_LIMITS=Object.freeze({fieldSteps:1_200_000,wallMs:10_000});
const sessions=new WeakMap();
export const coopSelfBossSession=ps=>sessions.get(ps);
const eligible=m=>m.mode==='coop'&&!m.isSolo&&!m.wave&&m.round===m.gd.bossRound&&m.botRehearsal>=2;
const ownKey=(m,ps)=>JSON.stringify({round:m.round,boss:m.bossId,stage:m.stageId,lp:ps.lp,bounties:ps.bounties,
 input:ps.battleInput(),assets:ps.allChess().map(p=>[p.uid,p.id,p.items?.map(i=>i.id)])});
const mean=(rows,k)=>rows.reduce((n,r)=>n+r[k],0)/rows.length;

/** Different bond units and team victories are not scores. Complete common samples rank mean own boss damage. */
export function selectCoopSelfDamage(plans,outcomes,samples){
  let index=0,best=null;
  for(let i=0;i<plans.length;i++){
    const rows=outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
    if(rows.length!==samples||rows.some((r,j)=>!r.valid||r.sample!==j
      ||![r.bossDamage,r.elapsed].every(Number.isFinite)))continue;
    const score=[mean(rows,'bossDamage'),Math.min(...rows.map(r=>r.bossDamage)),-mean(rows,'elapsed')];
    if(!best){best=score;index=i;continue;}
    for(let k=0;k<score.length;k++)if(Math.abs(score[k]-best[k])>1e-6){
      if(score[k]>best[k]){best=score;index=i;}break;
    }
  }
  return index;
}

/** Remaining samples can deal at most the own HP share each. Prune only a strict mean-damage impossibility. */
export function ownDamagePrefixCannotBeat(rows,incumbent,samples,hp){
  if(rows.some(r=>!r.valid))return true;
  if(!rows.length||incumbent.length!==samples||incumbent.some(r=>!r.valid))return false;
  return (rows.reduce((n,r)=>n+r.bossDamage,0)+(samples-rows.length)*hp)/samples<mean(incumbent,'bossDamage')-1e-6;
}

function expired(s){
  if(s.steps>=s.limits.fieldSteps){s.reason||='field-step-budget';return true;}
  if(!s.m.sched.virtual&&performance.now()-s.started>=s.limits.wallMs){s.reason||='wall-budget';return true;}
  return !!s.reason;
}

export function withLateranoCoopBossSelf(parent,limits=COOP_SELF_BOSS_LIMITS){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(!eligible(m)){if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);return;}
    const s={m,started:performance.now(),limits,steps:0,cache:new Map(),hits:0,simulated:0,comparisons:0,pruned:0,reason:null,
      horizon:(m.gd.bossLevelTime(m.round)||120)*m.gd.combatTimeScale,
      wave:buildBossWave(m.gd,createRng(deriveSeed(m.seed,`coop-self-wave:${m.round}`)),m.factions,m.round,{bossId:m.bossId,solo:true})};
    sessions.set(ps,s);const gen=parent.finalBoardSteps?.(m,ps,h);
    try{if(gen)for(;;){
      if(expired(s)&&(!s.activeJob||s.activeJob.done)){gen.return();break;}
      const r=gen.next();if(r.done)break;yield;
    }}finally{
      gen?.return();sessions.delete(ps);
      (ps._botCoopSelfBossHistory||=[]).push({round:m.round,objective:'own-boss-damage',horizon:s.horizon,
        ms:performance.now()-s.started,fieldSteps:s.steps,simulatedSamples:s.simulated,cachedSamples:s.hits,
        comparisons:s.comparisons,prunedCandidates:s.pruned,reason:s.reason,limits:{...limits}});
    }
  }});
}

/** One own-side battle per sample. No alivePlayers, teammate inputs, shared team LP, or live battle seed. */
export function ownBossField(m,ps,input,pool,sample,session){
  const wave=session.wave,spawns=structuredClone(wave.spawns);
  spawns.push(...bountySpawns(m.gd,m.round,wave,ps.bounties,ps.playerId,{solo:false,side:'L'}));
  return m.newBattle({seed:deriveSeed(m.seed,`coop-self-boss:${m.round}:${sample}`),kind:'boss',modeId:m.modeId,
    round:m.round,stageId:m.stageId,rect:{...GEO.BOSS_RECT},timeLimit:session.horizon,
    players:[{...structuredClone(input),side:'L',colOffset:0,lpForBoss:Math.max(1,ps.lp)}],
    spawns:m._sanitizeSpawns(spawns),routes:wave.routes,sharedBoss:pool,
    flags:{layerGainsEnabled:false,...m.gd.dp,enemyScale:m.gd.enemyScale(m.round)},
    fieldId:'cs:0',enemyOverrides:wave.overrides,waveId:wave.templateId,bossId:m.bossId});
}

export function* createCoopSelfBossForecast(m,ps,plans,samples=10){
  const s=sessions.get(ps);if(!s||!eligible(m)||plans.length<2)return null;
  const stamp=ownKey(m,ps),hp=bossPoolHp(m.gd,m.bossId,1),cap=Math.ceil(s.horizon*30),entries=[],inputs=[];
  for(const plan of plans){
    const input=stealthBattleInput(ps,plan),key=JSON.stringify(input);inputs.push(input);
    if(!s.cache.has(key))s.cache.set(key,new Map());entries.push(s.cache.get(key));yield;
  }
  let index=0,sample=0,trial=null;
  const job={done:false,best:plans[0],bestIndex:0,outcomes:[],plans,stale:false,pruned:[],
    run(budgetMs=Infinity){
      if(job.done)return true;const started=performance.now();
      const finish=()=>{
        job.stale=ownKey(m,ps)!==stamp;if(job.stale)s.reason='own-state-changed';
        if(!job.stale)job.bestIndex=selectCoopSelfDamage(plans,job.outcomes,samples);
        job.best=plans[job.bestIndex];job.done=true;
        trial?.battle?.dispose?.();trial=null;return true;
      };
      if(ownKey(m,ps)!==stamp||expired(s))return finish();
      while(index<plans.length){
        if(entries[index].has(sample)){job.outcomes.push({...entries[index].get(sample),index,sample});s.hits++;sample++;}
        else{
          if(expired(s))return finish();
          if(!trial){
            trial={pool:new SharedBossPool(hp),battle:null,ticks:0};
            try{trial.battle=ownBossField(m,ps,inputs[index],trial.pool,sample,s);}
            catch(e){m.log.warn?.(`own boss forecast construction failed: ${e.message}`);job.outcomes.push({index,sample,valid:false});
              trial=null;sample++;if(sample===samples){index++;sample=0;}continue;}
          }
          try{
            while(!trial.battle.finished&&trial.ticks<cap){
              trial.battle.step();trial.ticks++;s.steps++;
              if(expired(s))return finish();
              if(trial.ticks%4===0&&performance.now()-started>=budgetMs)return false;
            }
            if(!trial.battle.finished)trial.battle.forceEnd('timeout');
            const result=trial.battle.result(),valid=!trial.battle.errorCount&&!result.synthetic&&!result.errors;
            const row={index,sample,valid,bossDamage:trial.pool.byPlayer.get(ps.playerId)||0,elapsed:trial.battle.time};
            job.outcomes.push(row);if(valid)entries[index].set(sample,{...row});
          }catch(e){job.outcomes.push({index,sample,valid:false});m.log.warn?.(`own boss forecast failed: ${e.message}`);}
          trial.battle.dispose?.();trial=null;sample++;s.simulated++;
        }
        if(index>0&&sample<samples){
          const incumbent=selectCoopSelfDamage(plans,job.outcomes,samples);
          if(ownDamagePrefixCannotBeat(job.outcomes.filter(r=>r.index===index),job.outcomes.filter(r=>r.index===incumbent),samples,hp)){
            job.pruned.push(index);s.pruned++;index++;sample=0;
          }
        }
        if(sample===samples){index++;sample=0;}
        if(performance.now()-started>=budgetMs)return false;
      }
      return finish();
    }};
  s.comparisons++;s.activeJob=job;return job;
}
