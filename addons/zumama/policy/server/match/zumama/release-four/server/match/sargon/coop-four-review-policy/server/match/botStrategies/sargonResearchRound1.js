import {growthPackage,lpHeadroom} from './sargonResearchFourGates.js';
// [ASSUMED] Two independently frozen research overlays. No game-rule or teammate-roster changes.
import {createRng,deriveSeed} from '../../../../../../../../../../../../../../../sim/rng.js';
import {pieceBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
import {previewLineupOf,planLayoutSteps,bossInputSteps,LAYOUT_PARAMS} from '../botDevelopment.js';
import {createForecastSteps} from '../botForecast.js';
import {economyShadow,visibleUpgradePriority} from './sargonEconomy34.js';
import {swiftPrepGains,isSwiftEngine} from './sargonSwift.js';
import {SWIFT_LP_LIMITS} from './sargonSwiftLpTrade.js';
import {ids} from './sargonPepe.js';
import {coopOpeningSnapshot} from './sargonCoop37.js';

const openings=new WeakMap(),states=new WeakMap();
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const mainIds=new Set([ids.pepe,ids.passenger,ids.titi]);
const enabled=(m,ps)=>!m.isSolo&&m.difficulty==='ABYSS'&&m.order.length===4&&m.opts.botSargonCoopSeat===ps.playerId;
const finish=gen=>{let r;do{r=gen.next();}while(!r.done);return r.value;};
const key=(m,ps)=>JSON.stringify([m.round,ps.lp,ps.funds,ps.shop,ps.layers,ps.allChess(),[...ps.board.keys()],ps._sargonSwiftLpSpent,ps._sargonSwiftLpRoundSpent]);
const note=(ps,factor,e)=>(ps._sargonFactorHistory||=[]).push({factor,round:ps.m.round,...e});
const rowsAt=(rows,i)=>rows.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const complete=rows=>rows.length===2&&rows.every((r,i)=>r.valid&&r.sample===i);
const engine=(ps,p)=>isSwiftEngine(ps.gd,p)||base(ps,p)==='chess_char_6_19_a';

function planFor(m,shadow,lineup,tag,arm){
  const p=finish(planLayoutSteps(m,shadow,lineup,LAYOUT_PARAMS,{formationRoles:true,fireControl:true,
    rng:createRng(deriveSeed(m.seed,`zumama-research-layout:${m.round}:${psSeat(shadow)}:${tag}`))}));
  p.lineup=lineup;p.shadow=shadow;p.arm=arm;
  // Distinguish hypothetical ownership even when geometry happens to be identical.
  p.assignments=[{item:{uid:arm},target:{uid:0}}];return p;
}
const psSeat=ps=>ps.seat;
function forecast(m,ps,plans){
  const protectedUids=new Set(field(ps).filter(p=>mainIds.has(base(ps,p))).map(p=>p.uid));
  const job=finish(createForecastSteps(m,ps,plans[0].lineup,plans,function*(plan){
    const input=yield* bossInputSteps(m,plan.shadow,plan.lineup,plan,{keepWithdrawn:true});
    plan.prepGains=swiftPrepGains(plan.shadow,plan.lineup,plan,input.bonds);
    for(const[id,n]of Object.entries(plan.prepGains))if(input.bonds[id])input.bonds[id].layers+=n;
    return input;
  },{singlePlanProbe:true,equipmentAlternatives:true,forecastContext:()=>({}),selectForecast:()=>({index:0}),
    observeForecast(battle,context,plan){
      const deaths={};battle.on('death',({unit,reason})=>{if(reason==='killed'&&protectedUids.has(unit?.uid))deaths[unit.uid]=(deaths[unit.uid]||0)+1;});
      return pp=>({swiftGain:(plan.prepGains?.swiftShip||0)+(pp.layerGains?.swiftShip||0),protectedDeaths:deaths});
    }}));
  if(job)job.run(Infinity);
  return {plans:plans.map(p=>({arm:p.arm,roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs]})),
    outcomes:job?.outcomes.map(r=>({...r,index:job.plans[r.index].arm}))||[],simulations:job?.outcomes.length||0};
}

export function emergencyFourAccepted(rows,cap){return cap>0&&complete(rows)&&rows.every(r=>r.lost>=cap);}
export function residenceDecision(outcomes,context){
  const ref=rowsAt(outcomes,0);if(!complete(ref))return {allowed:true,reason:'invalid-control-fallback'};
  const candidates=[...new Set(outcomes.map(r=>r.index))].filter(i=>i>0);
  if(!candidates.length)return {allowed:false,reason:'no-activating-roster'};
  let valid=0;
  for(const index of candidates){
    const rows=rowsAt(outcomes,index);if(!complete(rows))continue;valid++;
    const gain=Math.min(...rows.map(r=>r.swiftGain||0)),projected=context.layers+gain*context.remaining;
    const extra=Math.max(...rows.map((r,j)=>r.lost-ref[j].lost));
    const delta=Math.min(...rows.map((r,j)=>(r.swiftGain||0)-(ref[j].swiftGain||0)));
    const limit=Math.min(SWIFT_LP_LIMITS.perRound-context.roundSpent,SWIFT_LP_LIMITS.total-context.spent);
    const safe=rows.every((r,j)=>context.lp-r.lost>0&&r.deaths<=ref[j].deaths
      &&Object.keys(r.protectedDeaths||{}).every(uid=>(r.protectedDeaths[uid]||0)<=(ref[j].protectedDeaths?.[uid]||0)));
    const strict=extra<=0&&rows.every((r,j)=>r.leaks<=ref[j].leaks);
    const trade=extra>0&&extra<=limit&&delta>=Math.max(SWIFT_LP_LIMITS.minGain,extra*SWIFT_LP_LIMITS.layersPerLp)
      &&rows.every((r,j)=>context.lp-r.lost>=SWIFT_LP_LIMITS.lpFloor&&r.leaks<=ref[j].leaks+SWIFT_LP_LIMITS.perRound);
    if(projected>=40&&safe&&(strict||trade))return {allowed:true,reason:'realizable-growth',index,gain,projected,extra,delta};
  }
  return valid?{allowed:false,reason:'unsafe-or-insufficient-real-growth'}:{allowed:true,reason:'invalid-candidates-fallback'};
}

export function createResearchPolicy(parent,mode,api){
  const id=mode==='A'?'zumama-emergency-zero-reserve-four':'zumama-swift-purchase-realizable-residence';
  const state=(m,ps)=>{
    let s=states.get(ps);if(!s||s.round!==m.round){s={round:m.round,probes:0,seen:new Set(),decisions:new Map()};states.set(ps,s);}return s;
  };
  const earlyReady=(m,ps)=>enabled(m,ps)&&ps.shop.level===3&&openings.get(ps)?.qualification.round===m.round
    &&openings.get(ps).qualification.eligible&&parent.beforeUpgrade(m,ps)&&!visibleUpgradePriority(parent,m,ps).length;
  function analyze(m,ps){
    if(!enabled(m,ps)||!m.wave||m.round>=m.gd.bossRound)return;
    const s=state(m,ps);if(s.analyzing)return;const signature=key(m,ps);if(s.seen.has(signature))return;
    s.seen.add(signature);s.analyzing=true;
    try{
      if(mode==='A'){
        if(ps.funds!==ps.shop.upgradePrice||parent.upgradeReserve(m,ps)<=0||!earlyReady(m,ps))return;
        const shadow=economyShadow(ps),lineup=previewLineupOf(m,shadow);
        const result=forecast(m,ps,[planFor(m,shadow,lineup,'A',0)]),originalAccepted=emergencyFourAccepted(result.outcomes,m.gd.lpCapPerRound);
        const gate={protected:!lpHeadroom(openings.get(ps).lp,result.outcomes,m.gd.lpCapPerRound),reason:'lp-after-worst-loss-must-exceed-full-cap',openingLP:openings.get(ps).lp,worstLoss:Math.max(...result.outcomes.map(r=>r.lost)),cap:m.gd.lpCapPerRound};
        const accepted=originalAccepted&&!gate.protected;
        s.emergency={signature,accepted};s.probes++;
        note(ps,id,{phase:'comparison',accepted,originalAccepted,gateArm:'lp',gate,openingLP:openings.get(ps)?.lp,funds:ps.funds,price:ps.shop.upgradePrice,...result});
        return;
      }
      const own=ps.allChess();if(!own.some(p=>engine(ps,p)))return;
      for(const slot of ps.shop.slots){
        if(!slot||slot.sold||slot.kind!=='chess'||ps.priceOf(slot)>ps.funds)continue;
        const r=ps.gd.chess(slot.id),bid=base(ps,r);
        if(!engine(ps,r)||pieceBonds(ps.gd,{id:slot.id}).includes('sargonShip')||own.some(p=>base(ps,p)===bid)
          ||!parent.purchaseAllowed(m,ps,r))continue;
        const cacheKey=signature+'|'+bid;if(s.decisions.has(cacheKey))continue;
        // A bounded read-only probe. Exhaustion preserves the parent decision, never rejects without evidence.
        if(s.probes>=8){s.decisions.set(cacheKey,true);note(ps,id,{phase:'gate',id:slot.id,reason:'probe-budget-parent-fallback'});continue;}
        const free=ps.hand.findIndex(p=>!p);if(free<0)continue;
        s.probes++;
        const original=economyShadow(ps),control=previewLineupOf(m,original),plans=[planFor(m,original,control,'B',0)];
        const shadow=economyShadow(ps),fake={kind:'chess',id:slot.id,uid:-700001,items:[],dir:'RIGHT',poolCopies:0};
        shadow.hand[free]=fake;shadow.funds-=ps.priceOf(slot);
        const required=field(ps).filter(p=>mainIds.has(base(ps,p))).map(p=>base(ps,p));
        const lineups=[previewLineupOf(m,shadow),...api.rosters(m,shadow,{allowEquivalent:true,allCandidates:true,
          swiftPortfolio:true,allowSinglePrecision:true,requiredBases:required}).map(row=>row.lineup)];
        const seen=new Set();
        for(const lineup of lineups){
          const roster=api.shadow(shadow,lineup),sig=lineup.map(p=>p.uid).sort((a,b)=>a-b).join(',');
          if(!lineup.some(p=>p.uid===fake.uid)||!roster.bonds.swiftShip?.active||seen.has(sig)
            ||(roster.bonds.sargonShip?.count||0)<Math.min(6,ps.bonds.sargonShip?.count||0)
            ||required.some(b=>!lineup.some(p=>base(ps,p)===b)))continue;
          // The preview may use a free board slot; a full board requires an executable occupied-swap transition.
          if(lineup.length===field(shadow).length&&!api.transition(shadow,field(shadow),lineup))continue;
          seen.add(sig);const plan=planFor(m,shadow,lineup,'B',plans.length);
          if(plan.size===lineup.length&&new Set(plan.values()).size===lineup.length)plans.push(plan);
          if(plans.length===3)break;
        }
        const result=forecast(m,ps,plans),opening=openings.get(ps);
        const context={lp:opening?.round===m.round?opening.lp:ps.lp,layers:ps.layers.swiftShip||0,
          remaining:m.gd.bossRound-m.round,spent:ps._sargonSwiftLpSpent||0,
          roundSpent:ps._sargonSwiftLpRound===m.round?ps._sargonSwiftLpRoundSpent||0:0};
        const decision=plans.length===1?{allowed:false,reason:'no-activating-roster'}:residenceDecision(result.outcomes,context);
        s.decisions.set(cacheKey,decision.allowed);
        note(ps,id,{phase:'comparison',id:slot.id,price:ps.priceOf(slot),...context,...decision,...result});
      }
    }finally{s.analyzing=false;}
  }
  const veto=(m,ps,r)=>mode==='B'&&enabled(m,ps)&&!state(m,ps).analyzing
    &&state(m,ps).decisions.get(key(m,ps)+'|'+base(ps,r))===false;
  return Object.freeze({...parent,name:parent.name+' / research '+mode,
    coopOpening(m,ps){parent.coopOpening?.(m,ps);if(enabled(m,ps))openings.set(ps,Object.freeze({round:m.round,lp:ps.lp,qualification:coopOpeningSnapshot(m,ps)}));},
    preparePurchases(m,ps,h){parent.preparePurchases?.(m,ps,h);analyze(m,ps);},
    upgradeReserve(m,ps){const s=state(m,ps);return mode==='A'&&s.emergency?.accepted&&s.emergency.signature===key(m,ps)
      &&earlyReady(m,ps)?0:parent.upgradeReserve(m,ps);},
    spendReserve(m,ps){const s=state(m,ps);return mode==='A'&&s.emergency?.accepted&&s.emergency.signature===key(m,ps)
      &&earlyReady(m,ps)?ps.shop.upgradePrice:parent.spendReserve(m,ps);},
    purchaseAllowed:(m,ps,r)=>parent.purchaseAllowed(m,ps,r)&&!veto(m,ps,r),
    importantBuy:(m,ps,r)=>!veto(m,ps,r)&&parent.importantBuy(m,ps,r)});
}

export const researchOpeningSnapshot=ps=>openings.get(ps);
