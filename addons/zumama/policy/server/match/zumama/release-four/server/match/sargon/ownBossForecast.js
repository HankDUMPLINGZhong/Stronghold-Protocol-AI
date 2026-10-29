import { createForecastBattle, stepForecastBattle } from '../../../../../../../../../../aiCompute/forecast.js';
import {allowBossChallenger} from './bossRepairSelection.js';
// [ASSUMED] Independent own-side damage objective against the actual public team boss HP pool.
// Only this seat's input and a once-per-prep public LP snapshot enter the forecast.
import {GEO} from '../../../../../../../../../../../../shared/constants.js';
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {bossPoolHp,SharedBossPool} from '../../../../../../../../../../finalAssault.js';
import {buildBossWave,bountySpawns} from '../../../../../../../../../../waves.js';

export const OWN_BOSS_LIMITS=Object.freeze({samples:4,fieldSteps:1_800_000,wallMs:30_000});
export const sargonPlanning=(m,ps)=>m.isSolo||m.opts.botSargonCoopSeat===ps.playerId;
const sessions=new WeakMap();
const observers=new WeakMap();let observerId=0;
const observerKey=fn=>{if(!fn)return 0;if(!observers.has(fn))observers.set(fn,++observerId);return observers.get(fn);};
export function publicLPTailHorizon(gd,round,lp){
  const base=(gd.bossLevelTime(round)||120)*gd.combatTimeScale;
  return !Number.isFinite(lp)||lp<=0||!Number.isFinite(gd.bossOvertimeAfter)||gd.bossOvertimeAfter<0
    ||!Number.isFinite(gd.bossOvertimeDrain)||gd.bossOvertimeDrain<=0?base
    :Math.max(base,Math.min(420,gd.bossOvertimeAfter+Math.ceil(lp/gd.bossOvertimeDrain)));
}
export function captureOwnBossOpening(m,ps){
  if(m.isSolo||!sargonPlanning(m,ps)||m.wave||m.round!==m.gd.bossRound)return null;
  const old=sessions.get(ps);if(old?.m===m&&old.round===m.round)return old;
  const openingTeamLP=m.order.reduce((n,p)=>n+(p.alive===true&&Number.isFinite(p.lp)&&p.lp>0?p.lp:0),0);
  const openingAliveCount=m.order.reduce((n,p)=>n+Number(p.alive===true&&Number.isFinite(p.lp)&&p.lp>0),0);
  const s={m,round:m.round,openingTeamLP,openingAliveCount,ownLP:ps.lp,started:performance.now(),steps:0,samples:0,comparisons:0,
    reason:null,hits:0,cache:new Map(),horizon:publicLPTailHorizon(m.gd,m.round,openingTeamLP),
    wave:buildBossWave(m.gd,createRng(deriveSeed(m.seed,`coop-self-wave:${m.round}`)),m.factions,m.round,{bossId:m.bossId,solo:openingAliveCount<=1})};
  sessions.set(ps,s);return s;
}
export function finishOwnBossOpening(m,ps){
  const s=sessions.get(ps);if(!s||s.m!==m)return;
  (ps._sargonFactorHistory||=[]).push({factor:'coop-own-boss-budget',round:s.round,
    objective:'own-boss-damage',openingTeamLP:s.openingTeamLP,openingAliveCount:s.openingAliveCount,
    bossHp:bossPoolHp(m.gd,m.bossId,s.openingAliveCount),horizon:s.horizon,
    fieldSteps:s.steps,simulatedSamples:s.samples,cachedSamples:s.hits,comparisons:s.comparisons,
    reason:s.reason,limits:OWN_BOSS_LIMITS,ms:performance.now()-s.started});
  sessions.delete(ps);
}
const expired=s=>{
  if(s.steps>=OWN_BOSS_LIMITS.fieldSteps)s.reason||='field-step-budget';
  if(!s.m.sched.virtual&&performance.now()-s.started>=OWN_BOSS_LIMITS.wallMs)s.reason||='wall-budget';
  return !!s.reason;
};
export const completeForecastRows=rows=>rows.length===(rows[0]?.objective==='own-boss-damage'?OWN_BOSS_LIMITS.samples:2)
  &&rows.every((r,i)=>r.valid&&r.sample===i);
const mean=(rs,k)=>rs.reduce((n,r)=>n+r[k],0)/rs.length;
// Only final formation search changes. Economic probes before finalBoardSteps retain the tested paired model.
export function beginBossRepair(m,ps){
  const s=captureOwnBossOpening(m,ps);if(!s)return ()=>{};
  s.repair=true;
  s.soloWave=buildBossWave(m.gd,createRng(deriveSeed(m.seed,`coop-self-wave:${m.round}`)),m.factions,m.round,{bossId:m.bossId,solo:true});
  return ()=>{(ps._sargonFactorHistory||=[]).push({factor:'boss-repair',round:m.round,
    phase:'end',fieldSteps:s.steps,paired:s.openingAliveCount>1,
    scenarios:m.bossId==='boss_1'&&s.openingAliveCount>1?['paired-empty-side','single-side']:['public-wave'],
    smallGainThreshold:.02});s.repair=false;};
}
export function selectOwnBossDamage(plans,rows){
  let index=0,best=null;
  const reference=rows.filter(r=>r.index===0).sort((a,b)=>a.sample-b.sample);
  for(let i=0;i<plans.length;i++){
    const rs=rows.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
    if(!completeForecastRows(rs)||rs.some(r=>r.objective!=='own-boss-damage'
      ||!Number.isFinite(r.bossDamage)||!Number.isFinite(r.elapsed)))continue;
    if(i&&rs.every(r=>r.bossRepair)&&completeForecastRows(reference)&&!allowBossChallenger(reference,rs))continue;
    const score=[mean(rs,'bossDamage'),Math.min(...rs.map(r=>r.bossDamage)),-mean(rs,'elapsed')];
    if(!best){index=i;best=score;continue;}
    const k=score.findIndex((n,j)=>Math.abs(n-best[j])>1e-6);
    if(k>=0&&score[k]>best[k]){index=i;best=score;}
  }
  return index;
}
export function ownBossSpec(m,ps,input,pool,sample,s){
  const wave=s.scenario===1?s.soloWave:s.wave,spawns=structuredClone(wave.spawns);
  spawns.push(...bountySpawns(m.gd,m.round,wave,ps.bounties,ps.playerId,{solo:false,side:'L'}));
  return {seed:deriveSeed(m.seed,`coop-self-boss:${m.round}:${sample}`),kind:'boss',modeId:m.modeId,
    round:m.round,stageId:m.stageId,rect:{...GEO.BOSS_RECT},timeLimit:s.horizon,
    players:[{...structuredClone(input),side:'L',colOffset:0,lpForBoss:Math.max(1,s.ownLP)},
      ...(s.openingAliveCount>1&&s.scenario!==1?[{playerId:'public-empty-R',seat:1,side:'R',colOffset:8,units:[],bonds:{},
        playerEffects:[],deviceOverrides:{},lpForBoss:s.openingTeamLP}]:[])],
    spawns:m._sanitizeSpawns(spawns),routes:wave.routes,sharedBoss:pool,
    flags:{layerGainsEnabled:false,...m.gd.dp,enemyScale:m.gd.enemyScale(m.round)},
    fieldId:'cs:0',enemyOverrides:wave.overrides,waveId:wave.templateId,bossId:m.bossId};
}
const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs?.get(u)||'RIGHT'}`).join('|');

export function* createCoopBossForecastSteps(m,ps,chosen,plans,inputSteps,recipe){
  if(m.isSolo||!sargonPlanning(m,ps)||m.round!==m.gd.bossRound||m.wave||m.botRehearsal<1)return null;
  const s=captureOwnBossOpening(m,ps);if(!s||expired(s))return null;
  const seen=new Set(),limit=recipe?.finalProtectionPlans&&recipe.forecastPlanLimit===6&&m.botRehearsal>=3?6:Math.min(3,m.botRehearsal);
  const candidates=plans.filter(p=>{
    const sig=signature(p)+(recipe?.equipmentAlternatives?'|'+JSON.stringify(p.assignments?.map(a=>[a.item.uid,a.target.uid])):'');
    if(seen.has(sig))return false;seen.add(sig);return true;
  }).slice(0,limit);
  if(candidates.length<2&&!(recipe?.singlePlanProbe&&candidates.length===1))return null;
  const inputs=[];
  for(const plan of candidates){const input=yield* inputSteps(plan);
    inputs.push(recipe?.prepareForecastInput?.(m,ps,chosen,plan,input)||input);yield;}
  const context=recipe?.forecastContext?.(m,ps,chosen,candidates,recipe),hp=bossPoolHp(m.gd,m.bossId,s.openingAliveCount);
  const scenarios=s.repair&&m.bossId==='boss_1'&&s.openingAliveCount>1?2:1;
  let index=0,sample=0,scenario=0,scenarioRows=[],trial=null;
  s.comparisons++;
  const job={chosen,plans:candidates,best:candidates[0],bestIndex:0,done:false,outcomes:[],
    run(budgetMs=Infinity){
      if(job.done)return true;const started=performance.now();
      const finish=()=>{
        trial?.battle.dispose?.();trial=null;
        job.bestIndex=selectOwnBossDamage(candidates,job.outcomes);
        job.best=candidates[job.bestIndex];job.chosen=job.best.lineup||chosen;job.done=true;
        job.development={index:job.bestIndex};
        (ps._sargonFactorHistory||=[]).push({factor:'coop-own-forecast',round:m.round,samples:OWN_BOSS_LIMITS.samples,
          plans:candidates.length,index:job.bestIndex,outcomes:job.outcomes,fieldSteps:s.steps,horizon:s.horizon});return true;
      };
      while(index<candidates.length){
        const reused=recipe?.reuseForecastRows?.(candidates[index])?.find(r=>r.sample===sample&&r.valid&&r.objective==='own-boss-damage');
        if(reused){job.outcomes.push({...reused,index});s.hits++;sample++;}
        else{
          if(expired(s))return finish();
          // Observer identity is part of the cache key: medical/contact diagnostics cannot reuse scalar-only rows.
          const key=JSON.stringify([inputs[index],observerKey(recipe?.observeForecast),context,recipe?.includeBossMetrics===true,s.repair===true,scenarios],
            (_,value)=>value instanceof Set?[...value].sort():value instanceof Map?[...value]:value);
          let cache=s.cache.get(key);if(!cache)s.cache.set(key,cache=new Map());
          const saved=cache.get(sample);
          if(saved){job.outcomes.push({...structuredClone(saved),index});s.hits++;sample++;}
          else{
            if(!trial){
              s.scenario=scenario;
              const pool=new SharedBossPool(hp),battle=createForecastBattle(m, ownBossSpec(m,ps,inputs[index],pool,sample,s));s.scenario=0;
              trial={pool,battle,ticks:0,metrics:context&&recipe?.observeForecast?.(battle,context,candidates[index])};
            }
            while(!trial.battle.finished&&trial.ticks<Math.ceil(s.horizon*30)){
              stepForecastBattle(trial.battle);trial.ticks++;s.steps++;
              if(expired(s))return finish();
              if(trial.ticks%4===0&&performance.now()-started>=budgetMs)return false;
            }
            if(!trial.battle.finished)trial.battle.forceEnd('timeout');
            const result=trial.battle.result(),pp=result.perPlayer?.[ps.playerId];
            const row={index,sample,valid:!!pp&&!trial.battle.errorCount&&!result.synthetic&&!result.errors,
              objective:'own-boss-damage',bossDamage:trial.pool.byPlayer.get(ps.playerId)||0,elapsed:trial.battle.time,
              won:trial.pool.hp<=0?1:0,damageShare:1-Math.max(0,trial.pool.hp)/hp,lp:s.ownLP,layers:0,
              ...(pp&&recipe?.includeBossMetrics&&trial.metrics?trial.metrics(pp):{})};
            trial.battle.dispose?.();trial=null;s.samples++;scenarioRows.push(row);scenario++;
            if(scenario<scenarios)continue;
            const combined={...scenarioRows[0],valid:scenarioRows.every(r=>r.valid),
              bossDamage:mean(scenarioRows,'bossDamage'),elapsed:mean(scenarioRows,'elapsed'),
              damageShare:mean(scenarioRows,'damageShare'),won:Math.min(...scenarioRows.map(r=>r.won)),
              ...(s.repair?{bossRepair:true}:{}),
              ...(scenarios>1?{scenarioRows:scenarioRows.map((r,i)=>({model:i?'single-side':'paired-empty-side',
                bossDamage:r.bossDamage,elapsed:r.elapsed,won:r.won}))}:{})};
            job.outcomes.push(combined);if(combined.valid)cache.set(sample,structuredClone(combined));
            scenario=0;scenarioRows=[];sample++;
          }
        }
        if(sample===OWN_BOSS_LIMITS.samples){index++;sample=0;}
        if(performance.now()-started>=budgetMs)return false;
      }
      return finish();
    }};
  return job;
}
