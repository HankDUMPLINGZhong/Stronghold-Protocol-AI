import { createForecastBattle, stepForecastBattle } from '../../../../../../../../../aiCompute/forecast.js';
// [ASSUMED] Port selected solo searches to one co-op seat, keeping every other public board fixed.
// Forecasts share a disposable boss pool and LP across ALL paired fields. They never settle meta effects.
import {GEO} from '../../../../../../../../../../../shared/constants.js';
import {deriveSeed} from '../../../../../../../../../../sim/rng.js';
import {TICK} from '../../../../../../../../../../sim/constants.js';
import {bossPoolHp,SharedBossPool} from '../../../../../../../../../finalAssault.js';
import {bountySpawns} from '../../../../../../../../../waves.js';
import {swiftPrepGains} from './botStrategies/sargonSwift.js';

export const sargonPlanning=(m,ps)=>m.isSolo||m.opts.botSargonCoopSeat===ps.playerId;
const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs?.get(u)||'RIGHT'}`).join('|');

/** Snapshot current visible teammate boards, including the inherited pure Swift prep-finish layer projection. */
export function cooperativeBossInputs(m,ps,ownInput){
  const alive=m.alivePlayers(),teamLp=alive.reduce((n,p)=>n+Math.max(0,p.lp),0);
  const groups=(m.bossWaves||[]).map(g=>({...g,players:g.players.filter(id=>alive.some(p=>p.playerId===id))})).filter(g=>g.players.length);
  if(!groups.some(g=>g.players.includes(ps.playerId)))return null;
  return {teamLp,hp:bossPoolHp(m.gd,m.bossId,alive.length),groups:groups.map(g=>({wave:g.wave,
    players:g.players.map((id,index)=>{
      const p=m.players.get(id),side=index===1?'R':'L',colOffset=index===1?8:0;
      const input=id===ps.playerId?structuredClone(ownInput):structuredClone(p.battleInput({side,colOffset}));
      Object.assign(input,{side,colOffset,lpForBoss:teamLp});
      if(id!==ps.playerId){
        const lineup=[...p.board.values()].filter(q=>q.kind==='chess'),plan=new Map();plan.dirs=new Map();
        for(const [key,q]of p.board)if(q.kind==='chess'){plan.set(q.uid,key);plan.dirs.set(q.uid,q.dir||'RIGHT');}
        for(const [bond,n]of Object.entries(swiftPrepGains(p,lineup,plan,input.bonds)))input.bonds[bond].layers+=n;
      }
      return input;
    }),spawns:g.wave.spawns.map(s=>({...s,mods:s.mods?{...s.mods}:undefined})).concat(...g.players.map((id,index)=>
      bountySpawns(m.gd,m.round,g.wave,m.players.get(id).bounties,id,{solo:false,side:index===1?'R':'L'})))}))};
}

export function* createCoopBossForecastSteps(m,ps,chosen,plans,inputSteps,recipe,selectForecast){
  if(!sargonPlanning(m,ps)||m.round!==m.gd.bossRound||m.wave||m.botRehearsal<1)return null;
  const seen=new Set(),limit=recipe?.finalProtectionPlans&&recipe.forecastPlanLimit===6&&m.botRehearsal>=3?6:Math.min(3,m.botRehearsal);
  const candidates=plans.filter(p=>{
    const sig=signature(p)+(recipe?.equipmentAlternatives?'|'+JSON.stringify(p.assignments?.map(a=>[a.item.uid,a.target.uid])):'');
    if(seen.has(sig))return false;seen.add(sig);return true;
  }).slice(0,limit);
  if(candidates.length<2&&!(recipe?.singlePlanProbe&&candidates.length===1))return null;
  const inputs=[];
  for(const plan of candidates){const input=yield* inputSteps(plan);
    inputs.push(recipe?.prepareForecastInput?.(m,ps,chosen,plan,input)||input);yield;}
  const context=recipe?.forecastContext?.(m,ps,chosen,candidates,recipe),trials=[];
  for(let index=0;index<candidates.length;index++)for(let sample=0;sample<2;sample++){
    const reused=recipe?.reuseForecastRows?.(candidates[index])?.find(r=>r.sample===sample);
    if(reused?.valid){trials.push({index,sample,reused});continue;}
    const snapshot=cooperativeBossInputs(m,ps,inputs[index]);if(!snapshot)return null;
    const pool=new SharedBossPool(snapshot.hp),t={index,sample,pool,teamLp:snapshot.teamLp,lost:0,ticks:0,fields:[],metrics:null};
    for(const [g,group]of snapshot.groups.entries()){
      const w=group.wave,b=createForecastBattle(m, {seed:deriveSeed(m.seed,`forecast:${m.round}:${ps.seat}:${sample}:coop-field:${g}`),
        kind:'boss',modeId:m.modeId,round:m.round,stageId:m.stageId,rect:{...GEO.BOSS_RECT},timeLimit:Infinity,
        players:group.players,spawns:m._sanitizeSpawns(group.spawns),routes:w.routes,sharedBoss:pool,
        flags:{...m.gd.dp,layerGainsEnabled:false,enemyScale:m.gd.enemyScale(m.round)},fieldId:`r:coop:${ps.playerId}:${g}`,
        enemyOverrides:w.overrides,waveId:w.templateId,bossId:m.bossId});
      b.on('enemyLeak',({enemy})=>{t.lost+=Number.isFinite(enemy?.lpr)&&enemy.lpr>=0?enemy.lpr:1;});
      b.on('lpLoss',({amount})=>{t.lost+=Math.max(0,Number(amount)||0);});
      if(context&&group.players.some(p=>p.playerId===ps.playerId))t.metrics=recipe.observeForecast(b,context,candidates[index]);
      t.fields.push(b);yield;
    }
    trials.push(t);
  }
  // Same clock choice as real co-op teams containing AI seats. Overtime is charged ONCE per shared tick.
  const after=m.order.filter(p=>!p.left).length>1&&m.order.some(p=>!p.left&&p.isBot)
    ?m.gd.bossOvertimeAfterReal:m.gd.bossLevelTime(m.round)||m.gd.bossOvertimeAfterReal;
  let i=0;
  const job={chosen,plans:candidates,best:candidates[0],bestIndex:0,done:false,outcomes:[],run(budgetMs=Infinity){
    const start=performance.now();
    while(i<trials.length){
      const t=trials[i];
      if(t.reused){job.outcomes.push({...t.reused,index:t.index});i++;continue;}
      const cap=Math.ceil((after+t.teamLp/Math.max(.01,m.gd.bossOvertimeDrainReal)+5)*m.gd.combatTimeScale/TICK);
      const remaining=()=>t.teamLp-t.lost-m.gd.bossOvertimeDue(t.ticks*TICK,after);
      while(t.fields.some(b=>!b.finished)&&t.ticks<cap){
        t.ticks++;for(const b of t.fields)if(!b.finished)stepForecastBattle(b);
        if(t.pool.hp<=0||remaining()<=0){for(const b of t.fields)if(!b.finished)b.forceEnd('forced');break;}
        if(t.ticks%4===0&&performance.now()-start>=budgetMs)return false;
      }
      const results=t.fields.map(b=>b.result()),pp=results.find(r=>r.perPlayer?.[ps.playerId])?.perPlayer[ps.playerId];
      const valid=!!pp&&t.fields.every((b,j)=>b.finished&&!b.errorCount&&!results[j].synthetic&&!results[j].errors);
      job.outcomes.push(valid?{index:t.index,sample:t.sample,valid:true,won:t.pool.hp<=0?1:0,
        damageShare:1-Math.max(0,t.pool.hp)/t.pool.maxHp,lp:remaining(),layers:0,
        ...(recipe?.includeBossMetrics&&t.metrics?t.metrics(pp):{})}:{index:t.index,sample:t.sample,valid:false});
      t.fields=null;i++;
      if(Number.isFinite(budgetMs)&&performance.now()-start>=budgetMs)return false;
    }
    if(context){job.development=recipe.selectForecast(candidates,job.outcomes,context);job.bestIndex=job.development.index;}
    else job.bestIndex=selectForecast(candidates,job.outcomes,true);
    job.best=candidates[job.bestIndex];job.chosen=job.best.lineup||chosen;job.done=true;
    (ps._sargonFactorHistory||=[]).push({factor:'coop-joint-forecast',round:m.round,plans:candidates.length,
      samples:2,fields:m.bossWaves.length,alive:m.alivePlayers().length,index:job.bestIndex,outcomes:job.outcomes});
    return true;
  }};
  return job;
}
