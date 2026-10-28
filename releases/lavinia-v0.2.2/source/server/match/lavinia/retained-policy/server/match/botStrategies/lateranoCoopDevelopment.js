// [ASSUMED] Fixed-roster co-op growth previews over14/56; no acquisition, upgrade, gear or R14 changes.
// Cautious/bold relative-risk caps preserve critical survival, perfect-clear helper eligibility and Unite readiness.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { developmentCarries, developmentLayoutValue, observeDevelopment, prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { pieceDir } from '../../../../../board.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { coopEntryState, coopGrowthFirstEnabled } from './lateranoCoopSafety.js';
import { windowBattleInput } from './lateranoWindowRefinement.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { coreStrategy, readsTeammateRoster } from '../botCoreStrategies.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip', VISION = 'visiShip';
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_21_a']);
const healer = rec => rec.attackKind === 'heal' || rec.dmgType === 'heal' || ['guardian', 'incantationmedic'].includes(rec.subProfessionId);
const tank = rec => rec.profession === 'TANK' && (rec.stats?.blockCnt || 0) > 0;
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess').sort((a,b) => a.uid-b.uid);
const signature = layout => layout.map(p => p.key+':'+p.dir).join('|');
const mean = (rows, key) => rows.reduce((sum,r) => sum+r[key],0)/rows.length;
const max = (rows, key) => Math.max(...rows.map(r => r[key]));
export const COOP_GROWTH_RISK = Object.freeze({
  cautious: Object.freeze({ perRound:1,total:2,minLP:18,remainingLP:14,allyLP:8,lastRound:10,referenceLeaks:2 }),
  bold: Object.freeze({ perRound:2,total:4,minLP:16,remainingLP:12,allyLP:6,lastRound:11,referenceLeaks:3 }),
});
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && m.wave && m.round < m.gd.bossRound
  && ps.bandId === 'band_paganini' && ps._botFocusId === CORE && m.botRehearsal >= 3;

/** Reuse single-player trait/aura geometry; add an exclusive incoming firing window for the Saint.
 * It proposes positions only: actual attacks, growth, survival and aura coverage are measured in previews.
 */
export function* coopDevelopmentPlans(m, ps, h, recipe) {
  const chosen=field(ps), original=new h.LayoutPlan(); original.lineup=chosen;
  for(const p of chosen){original.set(p.uid,ps.find(p.uid).key);original.dirs.set(p.uid,pieceDir(p));}
  if(chosen.length<3)return[original];
  const model=h.fieldModel(m,ps), routes=model.routes.filter(rt=>!rt.fallback&&rt.n>0);
  if(!routes.length)return[original];
  const recs=chosen.map(p=>({...h.rangeRec(ps,ps.gd.chess(p.id)),chessId:p.id}));
  const bonds=chosen.map(p=>pieceBonds(ps.gd,p));
  const owners=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  const reserved=new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([key])=>key));
  const options=chosen.map((p,i)=>{
    const out=[];
    for(let r=9;r<=12;r++)for(let c=2;c<=10;c++){
      const key=r+','+c;if(reserved.has(key)||!ps._legal(p,r,c))continue;
      for(const dir of DIRS){
        if(owners.has(p.uid)&&(key!==original.get(p.uid)||dir!==pieceDir(p)))continue;
        out.push({key,r,c,dir,cover:new Set(h.rangeTiles(recs[i],r,c,dir)),heal:healingTiles(recs[i],r,c,dir)});
      }
    }
    return out;
  });
  const current=chosen.map((p,i)=>options[i].find(o=>o.key===original.get(p.uid)&&o.dir===pieceDir(p)));
  if(current.some(p=>!p))return[original];
  const saint=chosen.findIndex(p=>ps.gd.baseIdOf(p.id)===recipe.ids.executorAlter);
  const total=routes.reduce((n,rt)=>n+rt.n,0)||1;
  const score=layout=>{
    const units=layout.map((p,i)=>({...p,uid:chosen[i].uid,rec:recs[i],bonds:bonds[i],
      dps:['heal','none'].includes(recs[i].attackKind)?0:(recs[i].stats.atk||0)*(recs[i].stats.aspd||100)/(100*Math.max(.3,recs[i].stats.bat||1)),
      block:recs[i].position==='MELEE'?recs[i].stats.blockCnt||0:0,
      heal:healer(recs[i]),air:!!recs[i].canHitFly,ground:!['heal','none'].includes(recs[i].attackKind)}));
    let value=developmentLayoutValue(ps.gd,units,{ps,developmentPhase:'farm'},ps.bonds,model,recipe);
    for(let i=0;i<units.length;i++)if(MAIN.has(ps.gd.baseIdOf(chosen[i].id))||tank(recs[i])){
      if(acceptsHealing(recs[i])&&recs.some(healer))value+=layout.some((p,j)=>healer(recs[j])&&p.heal.has(layout[i].key))?.8:-.8;
    }
    if(saint>=0&&ps.bonds[VISION]?.active){
      const u=units[saint];let exclusive=0;
      for(const rt of routes){
        if(rt.fly&&!u.air)continue;
        const fronts=units.filter(v=>v!==u&&v.block>0).map(v=>rt.tiles.indexOf(v.key)).filter(n=>n>=0);
        const stop=fronts.length?Math.min(...fronts):rt.tiles.length-1;
        for(const key of rt.tiles.slice(0,stop+1))if(u.cover.has(key)){
          const competition=units.filter(v=>v!==u&&v.ground&&(!rt.fly||v.air)&&v.cover.has(key)).reduce((n,v)=>n+v.dps,0);
          exclusive+=rt.n/total/(1+competition/Math.max(1,u.dps));
        }
      }
      value+=Math.min(4,exclusive)*2;
    }
    return value;
  };
  const change=(layout,i,next)=>{
    const trial=layout.slice(),j=layout.findIndex((p,k)=>k!==i&&p.key===next.key);trial[i]=next;
    if(j>=0){const other=options[j].find(p=>p.key===layout[i].key&&p.dir===layout[j].dir);if(!other)return null;trial[j]=other;}
    return trial;
  };
  let joint=current.slice(),single=null,singleScore=score(current);
  for(let pass=0;pass<2;pass++)for(let i=0;i<chosen.length;i++){
    let best=joint,bestScore=score(joint);
    for(const next of options[i]){
      if(pass===0){const trial=change(current,i,next);if(trial){const s=score(trial);if(s>singleScore+1e-6){single=trial;singleScore=s;}}}
      const trial=change(joint,i,next);if(!trial)continue;const s=score(trial);
      if(s>bestScore+1e-6){best=trial;bestScore=s;}
    }
    joint=best;yield;
  }
  const plans=[original],seen=new Set([signature(current)]);
  for(const layout of [joint,single]){
    if(!layout||seen.has(signature(layout)))continue;seen.add(signature(layout));
    const plan=new h.LayoutPlan();plan.lineup=chosen;
    layout.forEach((p,i)=>{plan.set(chosen[i].uid,p.key);plan.dirs.set(chosen[i].uid,p.dir);});plans.push(plan);
  }
  return plans;
}

/** Public LP and already-owned field only. Saint is a carry, never the tank or external healer. */
export function coopDevelopmentContext(m,ps,recipe,plans,{risk=true}={}) {
  const policy=coreStrategy(m,CORE),retainedLimits=COOP_GROWTH_RISK[risk==='bold'?'bold':'cautious'];
  const limits=policy?.coopDevelopmentRiskPerRound>0
    ?Object.freeze({...retainedLimits,perRound:policy.coopDevelopmentRiskPerRound}):retainedLimits;
  const chosen=plans[0].lineup, recs=chosen.map(p=>ps.gd.chess(p.id));
  const protectedUids=new Set(chosen.filter((p,i)=>MAIN.has(ps.gd.baseIdOf(p.id))||tank(recs[i])||healer(recs[i])).map(p=>p.uid));
  const carries=developmentCarries(chosen.map((p,i)=>({uid:p.uid,rec:recs[i]})));
  const saint=chosen.find(p=>ps.gd.baseIdOf(p.id)===recipe.ids.executorAlter);
  if(saint&&!carries.some(c=>c.uid===saint.uid))carries.push({uid:saint.uid,weight:Math.max(1,ps.gd.chess(saint.id).stats.atk||0)});
  const previous=ps._botCoopDevelopment,spent=previous?.spent||0;
  const unexpected=previous?.round===m.round-1&&ps.lp<previous.lp-previous.worstLoss-1;
  const others=m.alivePlayers().filter(p=>p.playerId!==ps.playerId);
  const allySafe=others.every(p=>p.lp>=limits.allyLP);
  const weight=carries.reduce((n,c)=>n+c.weight,0)||1;
  const precisionShare=!ps.bonds.preciShip?.active?0:carries.reduce((n,c)=>{
    const r=ps.gd.chess(chosen.find(p=>p.uid===c.uid).id);
    return n+(r.bonds.includes('preciShip')||ps.bonds.preciShip.count>=3&&r.position==='RANGED'?c.weight:0);
  },0)/weight;
  return {carries,protectedUids,saintUid:saint?.uid??null,layers:{...ps.layers},remaining:m.gd.bossRound-m.round,
    lemuen:chosen.some(p=>ps.gd.baseIdOf(p.id)===recipe.ids.lemuen),precisionShare,skillful:!!ps.bonds[SKILL]?.active,
    allowClearLeak:policy?.coopDevelopmentAllowClearLeak===true,growthFirst:coopGrowthFirstEnabled(m,ps),
    lp:ps.lp,spent,round:m.round,limits,hasTeammates:others.length>0,allowRisk:!!risk&&m.round<=limits.lastRound&&ps.lp>=limits.minLP
      &&spent<limits.total&&!unexpected&&allySafe};
}

export function observeCoopDevelopment(battle,ctx,plan,ps) {
  const observe=observeDevelopment(battle,ctx,plan);let saintAttacks=0,saintBuffed=0,saintTicks=0,saintCovered=0;
  battle.on('attack',({attacker:u})=>{if(u?.uid===ctx.saintUid){saintAttacks++;if(u.findBuff('bond:skillfulShip'))saintBuffed++;}});
  battle.on('tick',()=>{if(battle.tickCount%15!==0)return;
    const u=(battle.allyUnits||[]).find(u=>u.uid===ctx.saintUid&&u.alive&&u.deployed);
    if(u){saintTicks++;if(u.findBuff('bond:skillfulShip'))saintCovered++;}
  });
  return pp=>{
    const measured=observe(pp),ends=new Map((pp.unitsEnd||[]).map(u=>[u.uid,u]));
    const critical=Object.fromEntries([...ctx.protectedUids].map(uid=>{
      const u=ends.get(uid),p=plan.lineup.find(p=>p.uid===uid),r=ps.gd.chess(p.id),cost=r.skill?.spCost||0;
      return [uid,{alive:!!u?.alive,ready:u?.alive
        ? .5+.5*Math.max(0,Math.min(1,u.hpPct||0))+(cost>0?.1*Math.max(0,Math.min(1,u.sp/cost)):0):0}];
    }));
    const before=ctx.layers[VISION]||0,after=before+Math.max(0,measured.gains[VISION]||0);
    const coins=2*(Math.floor(after/10)-Math.floor(before/10));
    const economic=coins*.8+(before<80&&after>=80?Math.min(4,ctx.remaining*2):0)
      +(before<150&&after>=150?Math.min(12,ctx.remaining*4):0);
    return {...measured,...coopEntryState(ps,plan,pp),growth:measured.growth+economic,critical,
      saintCoverage:!ctx.skillful||ctx.saintUid==null?1:saintAttacks?saintBuffed/saintAttacks:saintTicks?saintCovered/saintTicks:0,
      saintAttacks,visionCoins:coins};
  };
}

/** Bound loss relative to the best safe growth proposal, not a deliberately weakened reference. */
export function selectCoopDevelopment(plans,outcomes,ctx) {
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  const valid=rs=>rs.length===FORECAST_SAMPLES&&rs.every((r,i)=>r.valid&&r.sample===i
    && ['growth','leaks','lost','coverage','auraMinimum','saintCoverage','entryReady','criticalDown'].every(k=>Number.isFinite(r[k]))
    && [...ctx.protectedUids].every(uid=>r.critical?.[uid]&&Number.isFinite(r.critical[uid].ready)));
  if(!valid(rows[0]))return{index:0,cost:0};
  const safeRole=(a,b)=>(ctx.growthFirst||a.entryReady+1e-6>=b.entryReady)&&a.criticalDown<=b.criticalDown
    && [...ctx.protectedUids].every(uid=>(a.protectedDeaths?.[uid]||0)<=(b.protectedDeaths?.[uid]||0)
      && (a.protectedFirstDeaths?.[uid]??Infinity)+1>=(b.protectedFirstDeaths?.[uid]??Infinity)
      && (!b.critical[uid].alive||a.critical[uid].alive)&&(ctx.growthFirst||a.critical[uid].ready+.05>=b.critical[uid].ready));
  const aura=(a,b)=>!ctx.skillful||a.auraMinimum+.01>=Math.min(.8,b.auraMinimum)
    && a.coverage+.01>=Math.min(.8,b.coverage)&&a.saintCoverage+.01>=Math.min(.8,b.saintCoverage);
  const permitted=i=>valid(rows[i])&&rows[i].every((r,s)=>safeRole(r,rows[0][s])&&aura(r,rows[0][s]));
  let best=0;
  for(let i=1;i<rows.length;i++)if(permitted(i)&&rows[i].every((r,s)=>r.leaks<=rows[0][s].leaks&&r.lost<=rows[0][s].lost)
    && mean(rows[i],'growth')>mean(rows[best],'growth')+(ctx.growthFirst?1e-6:1))best=i;
  const safe=best;let cost=0,utility=mean(rows[best],'growth');
  if(ctx.allowRisk&&max(rows[safe],'leaks')<=ctx.limits.referenceLeaks)for(let i=1;i<rows.length;i++){
    if(!permitted(i))continue;
    const extra=rows[i].map((r,s)=>Math.max(0,r.lost-rows[safe][s].lost)),debit=Math.max(...extra);
    if(!debit||debit>ctx.limits.perRound||ctx.spent+debit>ctx.limits.total||ctx.lp-max(rows[i],'lost')<ctx.limits.remainingLP
      ||rows[i].some((r,s)=>r.leaks>rows[safe][s].leaks+ctx.limits.perRound||!safeRole(r,rows[safe][s])
        ||ctx.hasTeammates&&!ctx.allowClearLeak&&rows[safe][s].leaks===0&&r.leaks>0
        ||r.criticalDown>0||ctx.skillful&&(r.auraMinimum<.8||r.saintCoverage<.8)
        ||r.growth<rows[safe][s].growth+3+4*debit))continue;
    const next=mean(rows[i],'growth')-extra.reduce((n,x)=>n+x,0)/extra.length*6;
    if(next>utility+1e-6){best=i;cost=debit;utility=next;}
  }
  return {index:best,safeIndex:safe,cost,worstLoss:max(rows[best],'lost'),growth:mean(rows[best],'growth')};
}

// LP-only policies invalidate on teammate LP/survival, never on their deployment changes.
export const coopDevelopmentStamp=(m,ps)=>JSON.stringify({round:m.round,stage:m.stageId,input:ps.battleInput(),
  allies:m.alivePlayers().filter(p=>p.playerId!==ps.playerId).map(p=>({id:p.playerId,lp:p.lp,
    ...(readsTeammateRoster(m,ps)?{field:[...p.board].map(([key,u])=>({key,uid:u.uid,id:u.id,dir:u.dir,items:u.items}))}:{})}))});
const stamp=coopDevelopmentStamp;

export function* coopDevelopmentSteps(m,ps,h,recipe,options) {
  if(!scoped(m,ps)||ps._botCoopDevelopment?.round===m.round)return;
  const start=performance.now(),originalInput=ps.battleInput(),snapshot=stamp(m,ps),funds=ps.funds;
  const inventory=JSON.stringify(ps.allChess().map(p=>[p.uid,p.id,p.items]).sort((a,b)=>a[0]-b[0]));
  const plans=yield* coopDevelopmentPlans(m,ps,h,recipe);
  if(plans.length<2||stamp(m,ps)!==snapshot)return;
  const ctx=coopDevelopmentContext(m,ps,recipe,plans,options);
  function* inputSteps(plan){yield;return windowBattleInput(originalInput,plan,{readingOrder:true});}
  const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,inputSteps,{
    prepareForecastInput:(m,ps,_chosen,plan,input)=>prepareDevelopmentInput(m,ps,plan.lineup,plan,input),
    forecastContext:()=>ctx,observeForecast:(battle,context,plan)=>observeCoopDevelopment(battle,context,plan,ps),
    selectForecast:selectCoopDevelopment,
  });
  if(!job)return;while(!job.run(4))yield;
  if(stamp(m,ps)!==snapshot){(ps._botCoopDevelopmentHistory||=[]).push({round:m.round,stale:true});return;}
  if(job.bestIndex)applyControlPositions(ps,job.best);
  if(JSON.stringify(ps.battleInput())!==JSON.stringify(windowBattleInput(originalInput,job.best,{readingOrder:true})))
    throw Error('Co-op development layout differs from preview');
  if(ps.funds!==funds||JSON.stringify(ps.allChess().map(p=>[p.uid,p.id,p.items]).sort((a,b)=>a[0]-b[0]))!==inventory)
    throw Error('Co-op development changed inventory or funds');
  const spent=(ps._botCoopDevelopment?.spent||0)+job.development.cost;
  ps._botCoopDevelopment={round:m.round,lp:ps.lp,spent,worstLoss:job.development.worstLoss||0};
  (ps._botCoopDevelopmentHistory||=[]).push({round:m.round,index:job.bestIndex,...job.development,spent,
    allowRisk:ctx.allowRisk,allowClearLeak:ctx.allowClearLeak,growthFirst:ctx.growthFirst,skillful:ctx.skillful,limits:ctx.limits,hasTeammates:ctx.hasTeammates,lp:ps.lp,stale:false,outcomes:job.outcomes,ms:performance.now()-start,
    candidates:job.plans.map(p=>({positions:p.lineup.map(u=>({uid:u.uid,id:u.id,key:p.get(u.uid),dir:p.dirs.get(u.uid)}))}))});
}

export function withLateranoCoopDevelopment(recipe,options={}) {
  return Object.freeze({...recipe,*finalBoardSteps(m,ps,h){
    if(recipe.finalBoardSteps)yield* recipe.finalBoardSteps(m,ps,h);
    yield* coopDevelopmentSteps(m,ps,h,recipe,options);
  }});
}

/** [ASSUMED] Independent trial: relax only the perfect-clear helper veto, retaining all risk/readiness guards. */
export function withCoopDevelopmentClearTrade(recipe,{perRound}={}) {
  return Object.freeze({...recipe,coopDevelopmentAllowClearLeak:true,
    ...(perRound>0?{coopDevelopmentRiskPerRound:perRound}:{})});
}
