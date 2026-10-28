// [ASSUMED] Co-op R14 fixed-roster experiment. All alive fields share one isolated forecast pool/LP clock.
// Teammates keep their current public boards; a changed teammate snapshot invalidates the unfinished decision.
import { GEO } from '../../../../../../../shared/constants.js';
import { deriveSeed } from '../../../../../../sim/rng.js';
import { bossPoolHp, SharedBossPool } from '../../../../../finalAssault.js';
import { bountySpawns } from '../../../../../waves.js';
import { bossFormationSnapshot, bossLinkedPlans } from './lateranoBossFormation.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { selectFinalSwap } from './lateranoFinalSwap.js';
import { coopSelfBossSession, createCoopSelfBossForecast } from './lateranoCoopBossSelf.js';
import { coopPlanningSession, efficientCoopBossForecast } from './lateranoCoopPlanning.js';

const eligible = m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound && m.botRehearsal >= 2;
const signature = p => [...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs.get(u)}`).join('|');
const contextKey = (m, ps) => JSON.stringify({ groups:m.bossWaves?.map(g=>({players:g.players,wave:g.wave.templateId})),
  players:m.alivePlayers().map(p=>({id:p.playerId,lp:p.lp,input:p===ps?null:p.battleInput(),bounties:p.bounties})) });

export function coopBossPlans(m, ps, h, recipe) {
  const original=bossFormationSnapshot(ps,h),model=h.fieldModel(m,ps),plans=[original];
  const bodies=new Set(model.bossBodies.flatMap(b=>b.tiles)),routes=model.routes.filter(r=>r.dwell>0);
  const facing=bossFormationSnapshot(ps,h);
  const owners=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  for(const p of facing.lineup){
    const r=h.rangeRec(ps,ps.gd.chess(p.id));
    if(owners.has(p.uid)||['heal','none'].includes(r.attackKind)||r.subProfessionId==='bard')continue;
    const [row,col]=facing.get(p.uid).split(',').map(Number);
    const score=dir=>{const cover=new Set(h.rangeTiles(r,row,col,dir));return bodies.size
      ? [...bodies].filter(k=>cover.has(k)).length*100
      : routes.reduce((n,rt)=>n+rt.n*rt.tiles.filter(k=>cover.has(k)).length,0);};
    const next=[p.dir||'RIGHT','RIGHT','UP','DOWN','LEFT'].sort((a,b)=>score(b)-score(a))[0];
    facing.dirs.set(p.uid,next);
  }
  if(signature(facing)!==signature(original))plans.push(facing);
  const seen=new Set(plans.map(signature));
  for(const p of bossLinkedPlans(m,ps,h,recipe,original))if(!seen.has(signature(p))){
    seen.add(signature(p));plans.push(p);if(plans.length===5)break;
  }
  return plans;
}

/** Build the real paired geometry, all alive teammates, all other fields, and public bounties. No meta dispatch. */
export function coopBossFields(m, ps, input, pool, sample) {
  const lp=m.alivePlayers().reduce((n,p)=>n+Math.max(0,p.lp),0);
  return m.bossWaves.map((g,i)=>{
    const wave=g.wave,spawns=structuredClone(wave.spawns);
    const players=g.players.map((id,j)=>{
      const p=m.players.get(id),side=j===0?'L':'R',colOffset=j===0?0:8;
      spawns.push(...bountySpawns(m.gd,m.round,wave,p.bounties,id,{solo:false,side}));
      const own=p===ps?{...structuredClone(input),side,colOffset}:p.battleInput({side,colOffset});
      own.lpForBoss=lp;return own;
    });
    return m.newBattle({seed:deriveSeed(m.seed,`coop-boss-forecast:${m.round}:${i}:${sample}`),kind:'boss',
      modeId:m.modeId,round:m.round,stageId:m.stageId,rect:{...GEO.BOSS_RECT},timeLimit:Infinity,players,
      spawns:m._sanitizeSpawns(spawns),routes:wave.routes,sharedBoss:pool,
      flags:{layerGainsEnabled:false,...m.gd.dp,enemyScale:m.gd.enemyScale(m.round)},fieldId:`cb:${i}`,
      enemyOverrides:wave.overrides,waveId:wave.templateId,bossId:m.bossId});
  });
}

/** Independent common samples. Overtime drains team LP once, not once per boss field. */
export function* createCoopBossForecast(m, ps, plans, samples=10) {
  if(!eligible(m)||plans.length<2||!m.bossWaves?.length)return null;
  if(coopSelfBossSession(ps))return yield* createCoopSelfBossForecast(m,ps,plans,samples);
  if(coopPlanningSession(ps))return yield* efficientCoopBossForecast(m,ps,plans,samples,coopBossFields);
  const stamp=contextKey(m,ps),hp=bossPoolHp(m.gd,m.bossId,m.alivePlayers().length);
  const lp=m.alivePlayers().reduce((n,p)=>n+Math.max(0,p.lp),0);
  const after=m.gd.bossLevelTime(m.round)||m.gd.bossOvertimeAfterReal;
  const cap=Math.ceil((after+lp/Math.max(.01,m.gd.bossOvertimeDrainReal)+5)*m.gd.combatTimeScale*30);
  const trials=[];
  for(let index=0;index<plans.length;index++)for(let sample=0;sample<samples;sample++){
    const pool=new SharedBossPool(hp),trial={index,sample,pool,lost:0,ticks:0,failed:false};
    try{
      trial.fields=coopBossFields(m,ps,stealthBattleInput(ps,plans[index]),pool,sample);
      for(const b of trial.fields){
        b.on('enemyLeak',({enemy})=>{trial.lost+=Number.isFinite(enemy?.lpr)&&enemy.lpr>=0?enemy.lpr:1;});
        b.on('lpLoss',({amount})=>{trial.lost+=Math.max(0,Number(amount)||0);});
      }
    }catch(e){trial.failed=true;m.log.warn?.(`co-op boss forecast construction failed: ${e.message}`);}
    trials.push(trial);yield;
  }
  let at=0;
  const job={done:false,best:plans[0],bestIndex:0,plans,outcomes:[],stale:false,run(budgetMs=Infinity){
    const start=performance.now();
    while(at<trials.length){
      const t=trials[at];
      try{
        while(!t.failed&&t.ticks<cap&&t.fields.some(b=>!b.finished)){
          for(const b of t.fields)if(!b.finished)b.step();t.ticks++;
          const time=t.ticks/30;
          if(t.pool.hp<=0||lp-t.lost-m.gd.bossOvertimeDue(time,after)<=0)break;
          if(t.ticks%4===0&&performance.now()-start>=budgetMs)return false;
        }
        for(const b of t.fields||[])if(!b.finished)b.forceEnd('forced');
        const valid=!t.failed&&t.ticks<cap&&t.fields.every(b=>!b.errorCount&&!b.result().synthetic&&!b.result().errors);
        job.outcomes.push({index:t.index,sample:t.sample,valid,won:t.pool.hp<=0?1:0,
          damageShare:1-Math.max(0,t.pool.hp)/hp,lp:lp-t.lost-m.gd.bossOvertimeDue(t.ticks/30,after)});
      }catch(e){job.outcomes.push({index:t.index,sample:t.sample,valid:false});m.log.warn?.(`co-op boss forecast failed: ${e.message}`);}
      t.fields=null;at++;if(performance.now()-start>=budgetMs)return false;
    }
    job.stale=contextKey(m,ps)!==stamp;
    if(!job.stale)job.bestIndex=selectFinalSwap(plans,job.outcomes,{samples,aggregate:true}).index;
    job.best=plans[job.bestIndex];job.done=true;return true;
  }};
  return job;
}

export function* coopBossSteps(m, ps, h, recipe) {
  if(!eligible(m))return;
  ps._botCoopRetainBossBranches?.();
  const started=performance.now(),proposals=coopBossPlans(m,ps,h,recipe),batches=[];
  let best=proposals[0];
  for(let i=1;i<proposals.length;i+=2){
    const job=yield* createCoopBossForecast(m,ps,[best,...proposals.slice(i,i+2)]);
    if(!job)break;while(!job.run(4))yield;
    batches.push({index:job.bestIndex,stale:job.stale,outcomes:job.outcomes});
    if(job.stale){best=proposals[0];break;}
    best=job.best;
    const selected=job.outcomes.filter(o=>o.index===job.bestIndex);
    if(selected.length===10&&selected.every(o=>o.valid&&o.won))break;
  }
  const expected=stealthBattleInput(ps,best);applyControlPositions(ps,best);
  if(JSON.stringify(ps.battleInput())!==JSON.stringify(expected))throw Error('Co-op boss layout differs from forecast');
  (ps._botCoopBossHistory ||= []).push({round:m.round,changed:signature(best)!==signature(proposals[0]),batches,ms:performance.now()-started});
}

export function withLateranoCoopBoss(recipe) {
  return Object.freeze({...recipe,*finalBoardSteps(m,ps,h){
    if(recipe.finalBoardSteps)yield* recipe.finalBoardSteps(m,ps,h);
    yield* coopBossSteps(m,ps,h,recipe);
  }});
}
