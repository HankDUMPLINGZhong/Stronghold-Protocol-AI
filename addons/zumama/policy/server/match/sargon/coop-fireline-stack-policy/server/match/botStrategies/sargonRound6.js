// [ASSUMED] Two independent factors on retained 24/6. Only current shops and actually bought pieces.
import { ids } from './sargonPepe.js';
import { isSwiftEngine } from './sargonSwift.js';
import { pieceBonds, computeBonds } from '../../../../../../../../../../bondsMeta.js';
import { createRng, deriveSeed } from '../../../../../../../../../../../sim/rng.js';

const CORE='sargonShip',base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const core=(ps,p)=>pieceBonds(ps.gd,p).includes(CORE);
const frontline=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const healing=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const damage=r=>!healing(r)&&!frontline(r)&&(r.stats?.atk||0)>0;
const mains=new Set([ids.philae,ids.gavial4,ids.gavial5,ids.titi,ids.passenger,ids.pepe,ids.minimalist,ids.kroos]);
const record=(ps,event)=>(ps._sargonFactorHistory||=[]).push(event);

export function thirdCopyBudget(ps){
  const idsAtLevel=[ids.papyrus,ids.bubble,ids.philae,ids.gavial4,ids.gavial5,ids.titi,ids.passenger,ids.pepe]
    .filter(id=>ps.gd.chess(id).tier<=ps.shop.level);
  const mainPrice=Math.max(2,...idsAtLevel.map(id=>ps.gd.chessPrice(id)));
  // Do not spend a free refresh as though it were a coin; retain one actual current-level main purchase.
  const refreshPrice=ps.shop.freeRefreshes>0?0:ps.gd.refreshPrice;
  return {mainPrice,refreshPrice,reserve:mainPrice+refreshPrice};
}
export function buyThirdBeforeSpecial(m,ps,parent){
  if(![2,4,6].includes(ps.shop.level)||!(ps.counters['band:pepe:special']>0))return;
  const event={factor:'third-before-special',round:m.round,level:ps.shop.level,fundsBefore:ps.funds,
    ...thirdCopyBudget(ps),checks:[],purchases:[]};
  const rows=ps.shop.slots.flatMap((slot,index)=>{
    if(!slot||slot.sold||slot.kind!=='chess')return [];
    const r=ps.gd.chess(slot.id),id=base(ps,r);
    if(!ps.completesChessMerge(slot.id)||!r.bonds.includes(CORE)&&!mains.has(id)&&!isSwiftEngine(ps.gd,r))return [];
    if(ps.allChess().some(p=>base(ps,p)===id&&ps.gd.isGolden(p.id)))return [];
    return [{slot,index,r,id,score:Number(mains.has(id))*100+Number(isSwiftEngine(ps.gd,r))*80+r.tier}];
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
  for(const {slot,index,r,id}of rows){
    if(!ps.completesChessMerge(slot.id))continue;
    const price=ps.priceOf(slot),budget=thirdCopyBudget(ps);
    const visibleMain=ps.shop.slots.filter(s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)!==id)
      .filter(s=>mains.has(base(ps,s))&&ps.gd.chess(s.id).bonds.includes(CORE)
        &&!ps.allChess().some(p=>base(ps,p)===base(ps,s)&&ps.gd.isGolden(p.id)))
      .reduce((n,s)=>Math.max(n,ps.priceOf(s)),0);
    const chainReserve=ps.shop.level<parent.levelTarget(m,ps)?ps.shop.upgradePrice+parent.upgradeReserve(m,ps):0;
    const reserve=Math.max(budget.reserve,budget.refreshPrice+visibleMain,chainReserve);
    const reason=!parent.purchaseAllowed(m,ps,r)?'parent-purchase-gate':ps.funds-price<reserve?'main-refresh-budget'
      :!ps.hand.some(p=>!p)?'capacity':'buy';
    const check={id:slot.id,price,reserve,funds:ps.funds,reason};event.checks.push(check);
    if(reason!=='buy')continue;
    const result=ps.buy(index);if(!result?.ok){check.reason='rejected';continue;}
    event.purchases.push({id:slot.id,price,fundsAfter:ps.funds,reserve});
  }
  event.fundsAfter=ps.funds;record(ps,event);
}
export function createThirdCopyPolicy(parent){
  return Object.freeze({...parent,name:'Sargon third copy after upgrade before special refresh',
    onLevelUp(m,ps,helpers){buyThirdBeforeSpecial(m,ps,parent);parent.onLevelUp(m,ps,helpers);}});
}

export function replacementOptions(ps,incoming,lineup,shadow){
  if(!core(ps,incoming)||lineup.includes(incoming)||computeBonds(ps.gd,shadow(ps,lineup))[CORE]?.count<6)return [];
  const rec=p=>ps.gd.chess(p.id),before=computeBonds(ps.gd,shadow(ps,lineup));
  const fronts=lineup.filter(p=>frontline(rec(p))).length,dealers=lineup.filter(p=>damage(rec(p))).length;
  return lineup.flatMap(old=>{
    const id=base(ps,old),rank=id===ids.estelle?0:id===ids.philae&&fronts>=3?1:id===ids.carnelian&&dealers>=3?1:null;
    if(rank===null||rec(incoming).tier<=rec(old).tier)return [];
    const next=lineup.map(p=>p===old?incoming:p),bonds=computeBonds(ps.gd,shadow(ps,next));
    if((bonds[CORE]?.count||0)<6||next.filter(p=>frontline(rec(p))).length<Math.min(2,fronts)
      ||next.filter(p=>damage(rec(p))).length<Math.min(2,dealers))return [];
    if(['preciShip','swiftShip'].some(b=>(bonds[b]?.count||0)<(before[b]?.count||0)))return [];
    return [{old,incoming,lineup:next,rank,fronts,dealers}];
  }).sort((a,b)=>a.rank-b.rank||Number(ps.gd.isGolden(a.old.id))-Number(ps.gd.isGolden(b.old.id))||a.old.uid-b.old.uid);
}
export function createCoreReplacementPolicy(parent,{shadow,transition}){
  return Object.freeze({...parent,name:'Sargon bought higher core replacement',
    afterPurchase(m,ps,slot,before){
      parent.afterPurchase?.(m,ps,slot,before);
      if(slot.kind!=='chess'||!ps.gd.chess(slot.id).bonds.includes(CORE)||(ps.bonds[CORE]?.count||0)<6)return;
      const gained=ps.allChess().filter(p=>!before.has(p.uid)&&base(ps,p)===base(ps,slot));
      for(const p of gained)(ps._sargonHigherPurchases||=[]).push({round:m.round,uid:p.uid,id:p.id});
    },
    *finalBoardSteps(m,ps,h){
      const pending=(ps._sargonHigherPurchases||[]).filter(e=>e.round===m.round);
      const incoming=pending.map(e=>ps.find(e.uid)?.piece).filter(p=>p?.kind==='chess')
        .sort((a,b)=>ps.gd.chess(b.id).tier-ps.gd.chess(a.id).tier||a.uid-b.uid);
      const events=[];
      for(const p of incoming){
        const original=field(ps),event={factor:'higher-core-replace',round:m.round,incoming:{uid:p.uid,id:p.id},
          status:original.includes(p)?'already-fielded':'no-eligible-target',coreBefore:ps.bonds[CORE]?.count};
        events.push(event);
        const pick=replacementOptions(ps,p,original,shadow)[0];if(!pick)continue;
        const reachable=transition(ps,original,pick.lineup);if(!reachable){event.status='capacity';continue;}
        const plan=yield* h.planLayoutSteps(shadow(ps,pick.lineup),pick.lineup,{formationRoles:true,fireControl:true,
          rng:createRng(deriveSeed(m.seed,`sargon-higher:${m.round}:${ps.seat}:${p.uid}`))});
        if(plan.size!==pick.lineup.length||new Set(plan.values()).size!==pick.lineup.length){event.status='layout';continue;}
        plan.lineup=pick.lineup;
        for(const {added,key}of reachable.pairs){const [row,col]=key.split(',').map(Number);
          if(!ps.move(added.uid,{area:'board',row,col},plan.dirs.get(added.uid))?.ok)throw Error('Sargon higher core swap rejected');}
        yield* h.applyPlanSteps(m,ps,pick.lineup,plan);
        if((ps.bonds[CORE]?.count||0)<6||ps.find(p.uid)?.area!=='board'||ps.find(pick.old.uid)?.area==='board')
          throw Error('Sargon higher core replacement incomplete');
        Object.assign(event,{status:'replaced',outgoing:{uid:pick.old.uid,id:pick.old.id},rank:pick.rank,
          fronts:pick.fronts,dealers:pick.dealers,coreAfter:ps.bonds[CORE]?.count});
      }
      // The inherited three-candidate search can undo an unhelpful exchange. No extra battle samples.
      yield* parent.finalBoardSteps(m,ps,h);
      for(const event of events){event.fieldedAtEnd=ps.find(event.incoming.uid)?.area==='board';record(ps,event);}
    }});
}
