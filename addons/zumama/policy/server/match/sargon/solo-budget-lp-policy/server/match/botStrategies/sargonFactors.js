import {SOLO_MULTI_TRANSFERS} from './sargonTransferConfig.js';
import {createEarlySteadPolicy} from './sargonEarlyStead.js';
import {createFirelinePolicy} from './sargonFireline.js';
import {recordSwiftLpTrade} from './sargonSwiftLpTrade.js';
// [ASSUMED] Independent ablations on tempo 19/4. No gameplay effects, future shops or actual battle seeds.
import { sargonPepe as baseline, ids } from './sargonPepe.js';
import { computeBonds, pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { canPlace, placeClass } from '../../../../../../../../../../board.js';
import { createRng, deriveSeed } from '../../../../../../../../../../../sim/rng.js';
import { createForecastSteps } from '../botForecast.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { createDynamicUpgradePolicy } from './sargonDynamicUpgrade.js';
import { createSixSearchPolicy } from './sargonSixSearch.js';
import { createSwiftPolicy, swiftForecastPolicy, isSwiftEngine } from './sargonSwift.js';
import { createFinalSwiftPolicy, createTightSwiftPolicy, swiftGrowthReady } from './sargonSwiftAblations.js';
import { createTightSwiftPolicy as createRetainedSwiftPolicy } from './sargonSwift24Baseline.js';
import { createThirdCopyPolicy, createCoreReplacementPolicy } from './sargonRound6.js';
import { createTargetShopPolicy } from './sargonTargetShops.js';
import { createMimicOnlyPolicy } from './sargonMimic.js';
import { createDeployedMimicPolicy,createMarginalRewardPolicy,createContactMimicPolicy } from './sargonMimicRefinements.js';
import { createTitiSixPolicy,createVideoSearchPolicy,frontlineAdjustment,cycleProposals,safetyPlans,safetyProposalIndex,videoForecastMetrics } from './sargonVideoFactors.js';
import { createPapyrusResidentPolicy,createMainFirstPolicy } from './sargonRound12.js';
import { createConditionalPapyrusPolicy,considerPapyrusSteps,papyrusForecastMetrics } from './sargonRound13.js';
import { createEfficientNymphPolicy,createGrowthPortfolioPolicy,createDegenPolicy } from './sargonRound14.js';
import { createTwoLimitSwiftPolicy } from './sargonRound15.js';
import { createKroosPriorityPolicy } from './sargonRound16.js';
import { createLocalFinalPolicy } from './sargonRound17.js';
import { createSwiftPriorityPolicy } from './sargonRound18.js';
import { createHealingCoveragePolicy } from './sargonRound19.js';
import { createCompanionPolicy } from './sargonRound21.js';
import { createEngineRewardPolicy } from './sargonRound22.js';
import { createBridgeLifecyclePolicy } from './sargonBridgeLifecycle.js';
import { createCarryFirstShopPolicy,createKeyThirdRefreshPolicy } from './sargonRound24.js';
import { createPairWaitPolicy,createRestrainedPairPolicy } from './sargonPairWait.js';
import { createAbyssWindowPolicy } from './sargonAbyssWindow.js';
import { createFiveBalancePolicy } from './sargonFiveBalance.js';
import { createLeanSixPolicy } from './sargonLeanSix.js';
import {createTolerantHealingPolicy,createMeleeContactPolicy,createLateSafetyPolicy} from './sargonFormation30.js';
import {createLionCoveragePolicy} from './sargonLionCoverage.js';
import {createActualGrowthPolicy,createNonTitiSixPolicy,createOrbDealerPolicy} from './sargonManual32.js';
import {createOnePrecisionCompanionPolicy} from './sargonPrecision33.js';
import {createEarlyReservePolicy,createGavialPairPolicy} from './sargonEconomy34.js';
import {createCoopOutputs99,createSoloThirdTransfer} from './sargonCTransfer.js';

const CORE='sargonShip', PRECI='preciShip';
const gdOf=(m,ps)=>ps.gd||m.gd;
const base=(gd,p)=>gd.baseIdOf(p.id??p.chessId);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const healer=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const has=(gd,p,b)=>pieceBonds(gd,p).includes(b);
const elite=(gd,p)=>gd.isGolden(p.id);
const carries=new Set([ids.passenger,ids.pepe,ids.titi]);
const pairEngines=new Set([ids.leonhardt,ids.kroos]);

export function rosterShadow(ps,lineup){
  const selected=new Set(lineup.map(p=>p.uid));
  const shadow=Object.assign(Object.create(ps),{
    board:new Map(lineup.map((p,i)=>[String(i),p])),
    hand:[...ps.hand.filter(p=>!selected.has(p?.uid)),...field(ps).filter(p=>!selected.has(p.uid))],
    temp:ps.temp.filter(p=>!selected.has(p?.uid)) });
  shadow.bonds=computeBonds(ps.gd,shadow);return shadow;
}
function power(m,ps,p){
  const gd=gdOf(m,ps),r=gd.chess(p.id);
  return r.tier*3+(elite(gd,p)?12:0)+(p.items?.length||0)*2+baseline.unitBonus(m,ps,r);
}

/** A full hand requires terrain-compatible board/hand swaps, not arbitrary pairing order. */
export function rosterTransition(ps,original,lineup){
  const added=lineup.filter(p=>!original.includes(p)),removed=original.filter(p=>!lineup.includes(p));
  if(added.length!==removed.length)return null;
  if(ps.hand.filter(p=>!p).length>=removed.length)return {withdraw:true,pairs:[]};
  const map=ps.deployMap(),pairs=[],used=new Set();
  function match(index){
    if(index===added.length)return true;
    for(const p of removed)if(!used.has(p.uid)){
      const key=ps.find(p.uid)?.key;if(!key)continue;
      const [r,c]=key.split(',').map(Number);
      if(!canPlace(map,placeClass(ps,ps.gd.chess(added[index].id)),r,c))continue;
      used.add(p.uid);pairs.push({added:added[index],removed:p,key});
      if(match(index+1))return true;
      pairs.pop();used.delete(p.uid);
    }
    return false;
  }
  return match(0)?{withdraw:false,pairs}:null;
}

/** Only real owned pieces. Simultaneous two-slot changes cross barriers missed by one-swap hill climbing. */
export function packageRosters(m,ps,{allowEquivalent=false,swiftPortfolio=false,swiftPolicy=null,requireEngine=true,refinement=null,requiredBases=[],allCandidates=false,allowSinglePrecision=false}={}){
  const gd=gdOf(m,ps),original=field(ps),before=rosterShadow(ps,original).bonds;
  const recipe=SARGON_FACTORS[m.opts.botSargonFactor],growthEngine=p=>!!(isSwiftEngine(gd,p)||recipe?.swiftExtraEngine?.(gd,p));
  swiftPortfolio=swiftPortfolio&&!gd.modeInactiveBonds.has('swiftShip')
    &&new Set(ps.allChess().filter(p=>has(gd,p,'swiftShip')).map(p=>base(gd,p))).size+(ps.bondCountBonus?.swiftShip||0)>=2;
  const originalSignature=original.map(p=>p.id+':'+(p.items||[]).map(i=>i.id).join('/')).sort().join('|');
  const bench=ps.allChess().filter(p=>!original.includes(p)).sort((a,b)=>power(m,ps,b)-power(m,ps,a)||a.uid-b.uid).slice(0,10);
  if(refinement==='cycle'){
    const engine=ps.allChess().find(p=>base(gd,p)===ids.minimalist&&!original.includes(p));
    if(engine&&!bench.includes(engine)){if(bench.length>=10)bench[bench.length-1]=engine;else bench.push(engine);}
  }
  if(swiftPortfolio){
    // A low-tier bridge must not disappear behind ten higher-scoring singles. Keep the same ten-piece search cap.
    const bridges=ps.allChess().filter(p=>!original.includes(p)&&has(gd,p,'swiftShip'))
      .sort((a,b)=>Number(growthEngine(b))-Number(growthEngine(a))||power(m,ps,b)-power(m,ps,a)||a.uid-b.uid).slice(0,2);
    for(const p of bridges)if(!bench.includes(p)){
      const index=bench.findLastIndex(p=>!has(gd,p,'swiftShip'));
      if(index>=0)bench[index]=p;
    }
  }
  if(!bench.length)return [];
  const all=ps.allChess(),wantPrecision=Math.min(3,new Set(all.filter(p=>has(gd,p,PRECI)).map(p=>base(gd,p))).size);
  const needFront=all.some(p=>front(gd.chess(p.id))),needHeal=all.some(p=>healer(gd.chess(p.id)));
  const protectedBases=new Set(original.filter(p=>carries.has(base(gd,p))).map(p=>base(gd,p)));
  for(const id of SARGON_FACTORS[m.opts.botSargonFactor]?.requiredLineupBases?.(m,ps)||[])protectedBases.add(id);
  for(const id of requiredBases)protectedBases.add(id);
  const seen=new Set(),out=[];
  const normal=!!m.wave;
  function add(lineup){
    const key=lineup.map(p=>p.uid).sort((a,b)=>a-b).join(',');if(seen.has(key))return;seen.add(key);
    const shadow=rosterShadow(ps,lineup),bonds=shadow.bonds;
    if((bonds[CORE]?.count||0)<Math.min(6,before[CORE]?.count||0))return;
    const precision=bonds[PRECI]?.count||0;
    const swift=bonds.swiftShip?.count||0;
    const minimum=allowSinglePrecision?Math.min(1,before[PRECI]?.count||0)
      :normal||swiftPortfolio?Math.min(2,before[PRECI]?.count||0):Math.min(3,before[PRECI]?.count||0);
    if(precision<minimum)return;
    if(needFront&&!lineup.some(p=>front(gd.chess(p.id)))||needHeal&&!lineup.some(p=>healer(gd.chess(p.id))))return;
    if([...protectedBases].some(id=>!lineup.some(p=>base(gd,p)===id)))return;
    const signature=lineup.map(p=>p.id+':'+(p.items||[]).map(i=>i.id).join('/')).sort().join('|');
    if(!allowEquivalent&&signature===originalSignature)return;
    if(!rosterTransition(ps,original,lineup))return;
    const policy=swiftPortfolio?(swiftPolicy||SARGON_FACTORS['roster-swift']):baseline;
    const score=lineup.reduce((s,p)=>s+power(m,ps,p),0)+policy.lineupBonus(gd,lineup,bonds,{ps})
      +(refinement==='front'?frontlineAdjustment(ps,lineup):0);
    out.push({lineup,score,signature,precision,swift});
  }
  for(let i=0;i<original.length;i++)for(const a of bench)add(original.map((p,j)=>j===i?a:p));
  for(let i=0;i<original.length;i++)for(let j=i+1;j<original.length;j++)for(let a=0;a<bench.length;a++)for(let b=a+1;b<bench.length;b++)
    add(original.map((p,k)=>k===i?bench[a]:k===j?bench[b]:p));
  out.sort((a,b)=>b.score-a.score||a.signature.localeCompare(b.signature));
  const unique=new Set(),rows=out.filter(p=>!unique.has(p.signature)&&unique.add(p.signature));
  if(allCandidates)return rows;
  const precision=rows.find(p=>p.precision>=wantPrecision),safety=rows.find(p=>p!==precision);
  const finish=chosen=>refinement==='cycle'?cycleProposals(ps,rows,chosen,original):chosen;
  if(swiftPortfolio){
    // One inherited Precision proposal plus one joint proposal; no extra trial and no raw cross-bond layer comparison.
    let portfolio=rows.filter(p=>p!==precision&&p.swift>=2&&p.precision>=2&&(!requireEngine||p.lineup.some(growthEngine)))
      .sort((a,b)=>Number(b.precision===2)-Number(a.precision===2)
        ||(b.score-(b.precision>=3?75:0))-(a.score-(a.precision>=3?75:0))||a.signature.localeCompare(b.signature))[0];
    if(recipe?.growthPortfolio)portfolio=recipe.growthPortfolio(m,ps,rows.filter(p=>p!==precision),portfolio);
    if(portfolio)return finish([precision,portfolio].filter(Boolean).slice(0,2));
  }
  // A temporary two-Precision healing/frontline package is allowed only in normal waves and must win paired LP trials.
  return finish([precision,...(safety?[safety]:[])].filter(Boolean).slice(0,2));
}
function clonePlan(plan,helpers){const next=new helpers.LayoutPlan(plan);next.dirs=new Map(plan.dirs);next.reserved=new Set(plan.reserved);next.lineup=plan.lineup;return next;}
function currentPlan(ps,helpers){const plan=new helpers.LayoutPlan();plan.lineup=field(ps);for(const p of plan.lineup){plan.set(p.uid,ps.find(p.uid).key);plan.dirs.set(p.uid,p.dir||'RIGHT');}return plan;}
function geometry(m,ps,plan,helpers){
  const gd=gdOf(m,ps),model=helpers.fieldModel(m,ps);
  const units=plan.lineup.map(p=>{const [r,c]=plan.get(p.uid).split(',').map(Number),rec=helpers.rangeRec(ps,gd.chess(p.id)),dir=plan.dirs.get(p.uid);
    return {p,rec,r,c,dir,key:plan.get(p.uid),cover:new Set(helpers.rangeTiles(rec,r,c,dir))};});
  let score=0;const routes=model.routes.filter(rt=>!rt.fallback&&rt.n>0),total=routes.reduce((n,r)=>n+r.n,0)||1;
  for(const rt of routes){
    const tanks=units.filter(u=>front(u.rec)&&!rt.fly),index=rt.tiles.findIndex(k=>tanks.some(u=>u.key===k)),contact=index<0?null:rt.tiles[index];
    const stop=index<0?rt.tiles.length-1:index,weight=rt.n/total;
    if(!rt.fly&&index<0)score-=4*weight;
    for(const u of units){
      const ranged=u.rec.position==='RANGED'&&u.rec.attackKind!=='heal',incant=u.rec.subProfessionId==='incantationmedic';
      if(ranged){
        const damage=(u.rec.stats.atk||100)/Math.max(.1,u.rec.stats.bat||1);
        const scale=Math.min(2,damage/500)+(elite(gd,u.p)?.5:0);
        const at=rt.tiles.indexOf(u.key),cover=rt.tiles.slice(0,stop+1).filter(k=>u.cover.has(k)).length;
        if(rt.fly&&!u.rec.canHitFly)continue;
        score+=weight*scale*(Math.min(6,cover)*.25+(contact&&u.cover.has(contact)?2:0));
        if(at>=0&&(index<0||at<index))score-=weight*4;
      }
      if(healer(u.rec))for(const tank of tanks){
        const covered=healingTiles(u.rec,u.r,u.c,u.dir).has(tank.key)&&acceptsHealing(tank.rec);
        const onRoute=rt.tiles.includes(tank.key);if(!onRoute)continue;
        const contactWindow=!incant||rt.tiles.slice(0,stop+1).some(k=>u.cover.has(k));
        score+=weight*(covered&&contactWindow?3:-1);
      }
    }
  }
  if(!m.wave)for(const u of units)if(u.rec.attackKind!=='heal'){
    const body=model.bossBodies?.flatMap(b=>b.tiles||[])||[];
    if(body.some(k=>u.cover.has(k)))score+=2;
  }
  // Keep Kroos's fast-skill donor reachable, rather than stacking an unused third component.
  for(const u of units)if(base(gd,u.p)===ids.kroos){
    const delta={RIGHT:[0,1],LEFT:[0,-1],UP:[1,0],DOWN:[-1,0]}[u.dir]||[0,1];
    if(units.some(v=>v.r===u.r+delta[0]&&v.c===u.c+delta[1]))score+=.5;
  }
  return score;
}
/** Two best legal local repairs. Coordinates come exclusively from the current deploy map. */
function localGeometryRows(m,ps,original,helpers){
  const gd=gdOf(m,ps),map=ps.deployMap(),occupied=new Map([...original].map(([u,k])=>[k,u]));
  const rows=[],signature=p=>[...p].map(([u,k])=>u+'@'+k+':'+p.dirs.get(u)).sort().join('|');
  const originalScore=geometry(m,ps,original,helpers);
  for(const p of original.lineup)for(const [key] of map){
    const [r,c]=key.split(',').map(Number);if(!canPlace(map,placeClass(ps,gd.chess(p.id)),r,c))continue;
    const other=occupied.get(key),start=original.get(p.uid),[sr,sc]=start.split(',').map(Number);
    if(other&&other!==p.uid){const piece=original.lineup.find(p=>p.uid===other);if(!canPlace(map,placeClass(ps,gd.chess(piece.id)),sr,sc))continue;}
    for(const dir of ['RIGHT','UP','DOWN','LEFT']){
      const plan=clonePlan(original,helpers);plan.set(p.uid,key);plan.dirs.set(p.uid,dir);if(other&&other!==p.uid)plan.set(other,start);
      const score=geometry(m,ps,plan,helpers);if(score>originalScore+.01)rows.push({plan,score,signature:signature(plan),uid:p.uid,healing:healer(gd.chess(p.id))});
    }
  }
  rows.sort((a,b)=>b.score-a.score||a.signature.localeCompare(b.signature));
  const seen=new Set();return rows.filter(r=>!seen.has(r.signature)&&seen.add(r.signature));
}
export function geometryPlans(m,ps,original,helpers){
  const rows=localGeometryRows(m,ps,original,helpers);if(!rows.length)return [];
  const first=rows.find(r=>r.healing)||rows[0];
  // A second unit may need to move with the healer; evaluate a linked repair against the unchanged control.
  const linked=localGeometryRows(m,ps,first.plan,helpers).find(r=>r.uid!==first.uid);
  const second=linked||rows.find(r=>r.uid!==first.uid)||rows.find(r=>r.signature!==first.signature);
  return [first.plan,...(second?[second.plan]:[])];
}
/** Strict normal-wave safety: retain a clear control, and require each common sample to avoid worse LP. */
export function selectFactorForecast(plans,outcomes,context){
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  const valid=a=>a.length===2&&a.every((r,i)=>r.valid&&r.sample===i);
  if(!valid(rows[0]))return {index:0};
  const boss=context.boss;if(!boss&&rows[0].some(r=>r.leaks===0))return {index:0};
  const rank=a=>boss?[Math.min(...a.map(r=>r.won)),a.reduce((s,r)=>s+r.won,0),a.reduce((s,r)=>s+r.damageShare,0)]
    :[-Math.max(...a.map(r=>r.lost)),-a.reduce((s,r)=>s+r.lost,0),-a.reduce((s,r)=>s+r.leaks,0)];
  const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]>b[i];return false;};
  let index=0,best=rank(rows[0]);
  for(let i=1;i<rows.length;i++){
    if(!valid(rows[i])||!boss&&rows[i].some((r,j)=>r.lost>rows[0][j].lost||r.killed<rows[0][j].killed))continue;
    const score=rank(rows[i]);if(better(score,best)){index=i;best=score;}
  }
  return {index};
}
function* searchSteps(m,ps,helpers,factor){
  if(!m.isSolo||m.botRehearsal<2||m.round>m.gd.bossRound)return;
  const original=currentPlan(ps,helpers),before=rosterShadow(ps,original.lineup).bonds;
  const searchRecipe=SARGON_FACTORS[m.opts.botSargonFactor],variant=searchRecipe?.searchVariant,refinement=variant?.(m,ps);
  if(variant)(ps._sargonFactorHistory||=[]).push({factor:m.opts.botSargonFactor,phase:'search-gate',round:m.round,refinement});
  const swift=factor.startsWith('swift-'),finalOnly=factor==='swift-final';
  const rosters=factor==='layout'?[]:packageRosters(m,ps,{allowEquivalent:factor==='roster-mixed',swiftPortfolio:swift,
    swiftPolicy:factor==='swift-gated'?SARGON_FACTORS['roster-swift-tight']:factor==='swift-phase-growth'?SARGON_FACTORS['roster-swift-phase-gated']
      :finalOnly?SARGON_FACTORS['roster-swift-final']:null,requireEngine:!finalOnly,refinement});
  if(finalOnly){
    const bonds=[before,...rosters.map(r=>rosterShadow(ps,r.lineup).bonds)];
    if(!bonds.some(b=>b.swiftShip?.active&&b[PRECI]?.active)||!bonds.some(b=>b[PRECI]?.count>=3)){
      yield* searchSteps(m,ps,helpers,'roster');return;
    }
  }
  const plans=[original];
  if(factor==='layout')plans.push(...geometryPlans(m,ps,original,helpers));
  else for(const [index,{lineup}]of rosters.entries()){
    const shadow=rosterShadow(ps,lineup);
    const plan=yield* helpers.planLayoutSteps(shadow,lineup,{formationRoles:true,fireControl:true,
      rng:createRng(deriveSeed(m.seed,`sargon-package:${m.round}:${ps.seat}:${index}`))});
    if(plan.size!==lineup.length||new Set(plan.values()).size!==lineup.length)continue;
    plan.lineup=lineup;plans.push(plan);
  }
  if(refinement==='safety'){
    const index=plans.length-1,target=plans[index],proposal=safetyPlans(m,ps,target,helpers)[0];
    if(proposal){
      const destination=safetyProposalIndex(plans.length,searchRecipe?.safetyPreserveSpare);
      (ps._sargonFactorHistory||=[]).push({factor:m.opts.botSargonFactor,phase:'safety-proposal',round:m.round,
        index:destination,beforeTiles:[...target],afterTiles:[...proposal],roster:target.lineup.map(p=>p.id)});
      plans[destination]=proposal;
    }
  }
  if(plans.length<2)return;
  const developing=swift&&(finalOnly||plans.some(p=>p.lineup.some(u=>isSwiftEngine(gdOf(m,ps),u)
    ||searchRecipe?.swiftExtraEngine?.(gdOf(m,ps),u))));
  let policy=developing?swiftForecastPolicy(m,ps,plans,lineup=>rosterShadow(ps,lineup).bonds)
    :{forecastContext:()=>({boss:!m.wave}),observeForecast:()=>()=>({}),selectForecast:selectFactorForecast};
  if(refinement)policy=videoForecastMetrics(policy,ps);
  if(searchRecipe?.conditionalPapyrus&&!m.wave)policy=papyrusForecastMetrics(policy,ps);
  let job=yield* createForecastSteps(m,ps,original.lineup,plans,
    plan=>helpers.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true}),policy);
  if(!job)return;while(!job.run(4))yield;
  if(searchRecipe?.conditionalPapyrus)job=yield* considerPapyrusSteps(m,ps,job,{
    original,policy,rosters:()=>packageRosters(m,ps,{swiftPortfolio:swift,
      swiftPolicy:SARGON_FACTORS['roster-swift-tight'],requiredBases:[ids.papyrus],allCandidates:true}),
    *plan(lineup,index){const shadow=rosterShadow(ps,lineup);
      const plan=yield* helpers.planLayoutSteps(shadow,lineup,{formationRoles:true,fireControl:true,
        rng:createRng(deriveSeed(m.seed,`sargon-papyrus:${m.round}:${ps.seat}:${index}`))});
      plan.lineup=lineup;return plan;},
    input:plan=>helpers.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true})});
  if(job.bestIndex){
    const transition=rosterTransition(ps,original.lineup,job.chosen);
    if(!transition)throw Error('Sargon selected an unreachable roster');
    for(const {added,key}of transition.pairs){
      const [row,col]=key.split(',').map(Number);
      const result=ps.move(added.uid,{area:'board',row,col},job.best.dirs.get(added.uid));
      if(!result?.ok)throw Error('Sargon factor roster swap rejected: '+JSON.stringify(result));
    }
    yield* helpers.applyPlanSteps(m,ps,job.chosen,job.best);
    if([...job.best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==job.best.dirs.get(uid)))throw Error('Sargon factor layout application failed');
  }
  recordSwiftLpTrade(m,ps,job,factor);
  (ps._sargonFactorHistory||=[]).push({factor,round:m.round,index:job.bestIndex,before:{core:before[CORE]?.count,precision:before[PRECI]?.count,
    ...(swift?{swift:before.swiftShip}:{})},...(swift?{developing}:{}),...(refinement?{refinement}:{}),
    candidates:job.plans.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],
      core:rosterShadow(ps,p.lineup).bonds[CORE]?.count,precision:rosterShadow(ps,p.lineup).bonds[PRECI]?.count,
      ...(swift?{swift:rosterShadow(ps,p.lineup).bonds.swiftShip,prepGains:p.swiftGains}:{} )})),outcomes:job.outcomes});
}
const reserve=Object.freeze({...baseline,name:'Sargon reserve ablation',
  upgradeReserve:(m,ps)=>[3,5].includes(ps.shop.level)?3:baseline.upgradeReserve(m,ps),
  spendReserve(m,ps){const extra=[3,5].includes(ps.shop.level)?3:baseline.upgradeReserve(m,ps);
    return baseline.priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+extra?ps.shop.upgradePrice:0;}});
const hangers=Object.freeze({...baseline,name:'Sargon precision hanger ablation',
  purchaseAllowed(m,ps,r){
    if(!baseline.purchaseAllowed(m,ps,r))return false;
    if(m.round>8||ps.shop.level>4||r.bonds.includes(CORE)||!r.bonds.includes(PRECI)||pairEngines.has(base(gdOf(m,ps),r)))return true;
    const gd=gdOf(m,ps),own=ps.allChess().filter(p=>base(gd,p)===base(gd,r));
    if(own.length===1)return false; // preserve existing pairs' third copies; don't start a new paid hanger pair.
    if(own.length>=2)return true;
    return new Set(ps.allChess().filter(p=>has(gd,p,PRECI)).map(p=>base(gd,p))).size<3;
  }});
const refreshLock=Object.freeze({...baseline,name:'Sargon one-coin refresh lock ablation',
  upgradeReserve:(m,ps)=>[1,3,5].includes(ps.shop.level)?1:0,
  spendReserve(m,ps){const extra=[1,3,5].includes(ps.shop.level)?1:0;
    return baseline.priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+extra?ps.shop.upgradePrice:0;},
  onLevelUp(m,ps){
    const special=[2,4,6].includes(ps.shop.level),beforeFunds=ps.funds;
    baseline.onLevelUp(m,ps);
    if(!special)return;
    ps._sargonSpecialLockRound=m.round;
    if(!ps.shop.frozen)ps.freeze();
    (ps._sargonFactorHistory||=[]).push({factor:'refresh-lock',round:m.round,phase:'special-lock',level:ps.shop.level,
      beforeFunds,funds:ps.funds,frozen:ps.shop.frozen,slots:ps.shop.slots.filter(s=>s&&!s.sold).map(s=>({kind:s.kind,id:s.id}))});
  },
  holdShop:(m,ps)=>ps._sargonSpecialLockRound===m.round&&ps.shop.slots.some(s=>s&&!s.sold&&s.kind==='chess'),
  beforeUpgrade:(m,ps)=>ps._sargonSpecialLockRound!==m.round&&baseline.beforeUpgrade(m,ps)});

const roster=Object.freeze({...baseline,name:'Sargon precision package ablation',*finalBoardSteps(m,ps,h){yield* searchSteps(m,ps,h,'roster');}});
const earlyHangers=Object.freeze({...roster,name:'Sargon restrained hangers with early survival exception',
  purchaseAllowed:(m,ps,r)=>m.round<=3?roster.purchaseAllowed(m,ps,r):hangers.purchaseAllowed(m,ps,r)});
const retained24=createRetainedSwiftPolicy(earlyHangers,function* (m,ps,h){yield* searchSteps(m,ps,h,'swift-gated');});
const mimic24=createMimicOnlyPolicy(retained24);
const retained25=createMarginalRewardPolicy(mimic24);
const retained257=createVideoSearchPolicy(retained25,'safety');
const retained267=Object.freeze({...retained257,name:'25/7 safety: preserve inherited layout in a vacant trial slot',safetyPreserveSpare:true});
const retained268=createConditionalPapyrusPolicy(retained267);

const retained277=createLocalFinalPolicy(createKroosPriorityPolicy(createTwoLimitSwiftPolicy(retained268)));

// [ASSUMED] Composition keeps both independently tested factors unchanged; healing checks the final Swift roster.
const swiftPriority277=createSwiftPriorityPolicy(retained277,
  {shadow:rosterShadow,transition:rosterTransition,rosters:(m,ps)=>packageRosters(m,ps,{swiftPortfolio:true,
    swiftPolicy:SARGON_FACTORS['roster-swift-tight'],allCandidates:true,allowSinglePrecision:true})});
const selected277=createHealingCoveragePolicy(swiftPriority277);
const companion277=createCompanionPolicy(selected277,'reactive'),companionReserve277=createCompanionPolicy(selected277,'reserve');
const selected287=createBridgeLifecyclePolicy(createEngineRewardPolicy(companion277),{shadow:rosterShadow,transition:rosterTransition});
const selected288=createCarryFirstShopPolicy(selected287);
const pairScoped288=createRestrainedPairPolicy(selected288);
const selected2810=createLeanSixPolicy(selected288,'resident');
const selected2813=createLionCoveragePolicy(selected2810,{balanced:true});
const selected2814=createEarlyReservePolicy(selected2813,'two');

export const SARGON_FACTORS=Object.freeze({reserve,hangers,
  ...Object.fromEntries(Object.keys(SOLO_MULTI_TRANSFERS).map(f=>[f,createFirelinePolicy(createEarlySteadPolicy(selected2814))])),
  'refresh-lock':refreshLock,
  'roster-mixed':Object.freeze({...baseline,name:'Sargon mixed-copy package ablation',*finalBoardSteps(m,ps,h){yield* searchSteps(m,ps,h,'roster-mixed');}}),
  roster,
  'roster-hangers':Object.freeze({...roster,name:'Sargon roster with restrained precision hangers',purchaseAllowed:hangers.purchaseAllowed}),
  'roster-dynamic':createDynamicUpgradePolicy(roster),
  'roster-hangers-early':earlyHangers,
  'roster-swift':createSwiftPolicy(earlyHangers,function* (m,ps,h){yield* searchSteps(m,ps,h,'swift-portfolio');}),
  'roster-swift-final':createFinalSwiftPolicy(earlyHangers,function* (m,ps,h){yield* searchSteps(m,ps,h,!m.wave&&m.round===m.gd.bossRound?'swift-final':'roster');}),
  'roster-swift-tight':retained24,
  'roster-target-shops':createTargetShopPolicy(retained24),
  'roster-mimic-always':mimic24,
  'roster-mimic-deployed':createDeployedMimicPolicy(mimic24),
  'roster-mimic-rewards':retained25,
  'roster-video-titi-six':createTitiSixPolicy(retained25),
  'roster-video-cycle':createVideoSearchPolicy(retained25,'cycle'),
  'roster-video-front':createVideoSearchPolicy(retained25,'front'),
  'roster-video-safety':retained257,
  'roster-safety-spare':retained267,
  'roster-papyrus-resident':createPapyrusResidentPolicy(retained267),
  'roster-main-first':createMainFirstPolicy(retained267),
  'roster-papyrus-conditional':retained268,
  'roster-swift-efficient':createEfficientNymphPolicy(retained268),
  'roster-swift-growth-roster':createGrowthPortfolioPolicy(retained268),
  'roster-swift-degen':createDegenPolicy(retained268),
  'roster-swift-two-limits':createTwoLimitSwiftPolicy(retained268),
  'roster-kroos-priority':createKroosPriorityPolicy(createTwoLimitSwiftPolicy(retained268)),
  'roster-swift-before-precision':swiftPriority277,
  'roster-swift-healing':selected277,
  'roster-swift-companion':companion277,
  'roster-swift-companion-reserve':companionReserve277,
  'roster-swift-companion-engine-rewards':selected287,
  'roster-shop-carries-first':selected288,
  'roster-six-defer':createLeanSixPolicy(selected288,'defer'),
  'roster-six-roll-lock':createLeanSixPolicy(selected288,'roll-lock'),
  'roster-six-formed':createLeanSixPolicy(selected288,'formed'),
  'roster-six-resident':selected2810,
  'roster-final-medical-tolerance':createTolerantHealingPolicy(selected2810),
  'roster-final-melee-contact':createMeleeContactPolicy(selected2810),
  'roster-final-late-safety':createLateSafetyPolicy(selected2810),
  'roster-lion-full-coverage':createLionCoveragePolicy(selected2810),
  'roster-lion-balanced-coverage':selected2813,
  'roster-actual-sargon-growth':createActualGrowthPolicy(selected2813,{shadow:rosterShadow,transition:rosterTransition,
    rosters:(m,ps)=>packageRosters(m,ps,{allowEquivalent:true,allCandidates:true})}),
  'roster-actual-growth-swift-first':createActualGrowthPolicy(selected2813,{shadow:rosterShadow,transition:rosterTransition,swiftFirst:true,
    rosters:(m,ps)=>packageRosters(m,ps,{allowEquivalent:true,allCandidates:true,allowSinglePrecision:true,swiftPortfolio:true,
      swiftPolicy:SARGON_FACTORS['roster-swift-tight']})}),
  'roster-non-titi-six':createNonTitiSixPolicy(selected2813),
  'roster-orb-dealers':createOrbDealerPolicy(selected2813),
  'roster-precision-one-companion':createOnePrecisionCompanionPolicy(selected2813),
  'roster-low-reserve-two':selected2814,
  'solo-c-growth':createCoopOutputs99(selected2814,{shadow:rosterShadow,transition:rosterTransition},{growth:true}),
  'solo-c-third':createSoloThirdTransfer(selected2814),
  'solo-c-combined':createCoopOutputs99(selected2814,{shadow:rosterShadow,transition:rosterTransition},{growth:true,third:true,nativeSwiftThird:true}),
  'roster-low-reserve-two-gavial':Object.freeze({...createGavialPairPolicy(selected2814),name:'28/14 plus IV Gavial pair growth'}),
  'roster-low-reserve-four':createEarlyReservePolicy(selected2813,'four'),
  'roster-low-reserve-four-risk':createEarlyReservePolicy(selected2813,'four-risk'),
  'roster-gavial-pair-growth':createGavialPairPolicy(selected2813),
  'roster-five-visible':createFiveBalancePolicy(selected288,'visible'),
  'roster-five-budget':createFiveBalancePolicy(selected288,'budget'),
  'roster-five-quality':createFiveBalancePolicy(selected288,'quality'),
  'roster-abyss-pair-window':createAbyssWindowPolicy(selected288),
  'roster-abyss-pair-window-from-five':createAbyssWindowPolicy(selected288,{secondScope:'from-five'}),
  'roster-pairs-restrained':pairScoped288,
  'roster-pairs-all':createPairWaitPolicy(pairScoped288,'all'),
  'roster-pairs-45':createPairWaitPolicy(pairScoped288,'tier45'),
  'roster-pairs-45-sargon':createPairWaitPolicy(pairScoped288,'tier45-sargon'),
  'roster-key-third-refresh':createKeyThirdRefreshPolicy(selected287),
  'roster-swift-reserve-engine-rewards':createBridgeLifecyclePolicy(createEngineRewardPolicy(companionReserve277),{shadow:rosterShadow,transition:rosterTransition}),
  'roster-final-contact-local':retained277,
  'roster-final-healing-coverage':createHealingCoveragePolicy(retained277),
  'roster-mimic-contact':createContactMimicPolicy(mimic24,function* (m,ps,h){yield* searchSteps(m,ps,h,'layout');}),
  'roster-third-before-special':createThirdCopyPolicy(retained24),
  'roster-higher-core':createCoreReplacementPolicy(retained24,{shadow:rosterShadow,transition:rosterTransition}),
  'roster-swift-phase-gated':createTightSwiftPolicy(earlyHangers,function* (m,ps,h){
    yield* searchSteps(m,ps,h,!m.wave&&m.round===m.gd.bossRound?'swift-final':swiftGrowthReady(m,ps)?'swift-phase-growth':'roster');}),
  'roster-dynamic-six':createSixSearchPolicy(roster),
  layout:Object.freeze({...baseline,name:'Sargon contact search ablation',*finalBoardSteps(m,ps,h){yield* searchSteps(m,ps,h,'layout');}})});
