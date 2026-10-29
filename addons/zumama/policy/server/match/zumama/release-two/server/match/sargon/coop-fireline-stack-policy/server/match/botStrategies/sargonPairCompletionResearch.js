import {pairFundingPlan,currentPairLeakProbe,spendLockedPairRemainder} from './sargonPairFieldSafetyResearch.js';
// [ASSUMED] User-directed policy: complete any existing pair before discarding its visible third.
// This file is copied into each frozen selected policy's botStrategies directory.
import {computeBonds,pieceBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
import {foreignEngineRank} from './sargonRound22.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'all-pair-completion',...e});
const copies=(ps,id)=>ps.allChess().filter(p=>base(ps,p)===id&&!ps.gd.isGolden(p.id));
const native=(ps,p)=>pieceBonds(ps.gd,p).includes('sargonShip');
const medic=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const mains=new Set(['chess_char_6_05_a','chess_char_6_06_a','chess_char_5_02_a']);
export function pairOffers(ps){
  return ps.shop.slots.flatMap((s,index)=>s&&!s.sold&&s.kind==='chess'&&!ps.gd.isGolden(s.id)&&ps.completesChessMerge(s.id)
    ?[{index,id:s.id,name:ps.gd.chess(s.id).name,price:ps.priceOf(s),rank:mains.has(base(ps,s))?100:
      native(ps,s)?60+ps.gd.chess(s.id).tier:foreignEngineRank(ps.gd,ps.gd.chess(s.id))*10+ps.gd.chess(s.id).tier}]:[])
    .sort((a,b)=>b.rank-a.rank||a.price-b.price||a.index-b.index);
}
export function pairSaleCandidates(parent,m,ps,targetId){
  const owned=ps.allChess(),board=field(ps),targets=new Set(pairOffers(ps).map(p=>base(ps,p)));
  const coreTypes=new Set(owned.filter(p=>native(ps,p)).map(p=>base(ps,p)));
  return owned.flatMap(p=>{
    const id=base(ps,p),r=ps.gd.chess(p.id),loc=ps.find(p.uid),onBoard=loc?.area==='board',b=pieceBonds(ps.gd,p);
    if(!loc||id===ps.gd.baseIdOf(targetId)||targets.has(id)||mains.has(id)
      ||['chess_char_3_13_a','chess_char_2_06_a'].includes(id)||foreignEngineRank(ps.gd,r)>0&&!(parent.benchSalePenalty?.(m,ps,p)>0))return [];
    if(native(ps,p)&&(r.tier>=4||coreTypes.size<=6&&!owned.some(q=>q!==p&&base(ps,q)===id)))return [];
    if((p.items||[]).some(i=>parent.protectItem?.(m,ps,ps.gd.item(i.id))))return [];
    const shadow=Object.assign(Object.create(ps),{board:new Map([...ps.board].filter(([,q])=>q!==p)),
      hand:ps.hand.map(q=>q===p?null:q),temp:(ps.temp||[]).filter(q=>q!==p)});
    const after=computeBonds(ps.gd,shadow),before=ps.bonds||computeBonds(ps.gd,ps);
    if((before.sargonShip?.count||0)>=6&&(after.sargonShip?.count||0)<6)return [];
    if(['swiftShip','preciShip'].some(k=>before[k]?.active&&!after[k]?.active))return [];
    if(m.round<=7&&before.steadShip?.active&&!after.steadShip?.active)return [];
    if(m.round<=7&&r.bonds.includes('steadShip')){
      const types=pieces=>new Set(pieces.filter(q=>ps.gd.chess(q.id).bonds.includes('steadShip')).map(q=>base(ps,q))).size;
      if(types(owned)>=2&&types(owned.filter(q=>q!==p))<2)return [];
    }
    if(onBoard&&[medic,front].some(role=>role(r)&&!board.some(q=>q!==p&&role(ps.gd.chess(q.id)))))return [];
    const related=b.some(k=>['sargonShip','swiftShip','preciShip'].includes(k));
    const score=Number(onBoard)*200+Number(native(ps,p))*100+Number(related)*40
      +Number(copies(ps,id).length>=2)*25+Number(ps.gd.isGolden(p.id))*20+r.tier-(parent.benchSalePenalty?.(m,ps,p)||0);
    return [{p,id,name:r.name,onBoard,score}];
  }).sort((a,b)=>a.score-b.score||a.p.uid-b.p.uid);
}
export function completeVisiblePairs(parent,m,ps,h={},cause='shopping'){
  for(let guard=0;guard<40;guard++){
    const offers=pairOffers(ps);if(!offers.length){ps._sargonPairBlocked=null;return true;}
    let changed=false;
    for(const offer of offers){
      if(ps.funds<offer.price||!ps.hand.some(p=>!p)){
        if(!ps.hand.some(p=>!p)&&h.freePurchaseSlot?.()){changed=true;break;}
        const funding=pairFundingPlan(parent,m,ps,offer,pairSaleCandidates);
        let reason=funding.reason;
        if(funding.ok&&funding.sales.some(x=>x.onBoard)){
          const probe=currentPairLeakProbe(parent,m,ps);
          if(!probe.safe)reason=probe.reason;
        }
        if(funding.ok&&!reason){
          // A multi-field early transaction shares its original zero-leak authorization and complete preflight.
          // Rechecking the partially liquidated board would risk selling half, then freezing before the merge.
          const earlyMulti=m.round<=4&&funding.sales.filter(x=>x.onBoard).length>1;
          const sales=earlyMulti?funding.sales:funding.sales.slice(0,1);
          if(earlyMulti)(ps._sargonFactorHistory||=[]).push({factor:'r4-pair-sales',phase:'funding-plan',round:m.round,
            target:offer.id,price:offer.price,funds:ps.funds,board:field(ps).length,
            sales:sales.map(s=>({uid:s.p.uid,id:s.p.id,name:s.name,onBoard:s.onBoard}))});
          for(const sale of sales){
            if(ps.funds>=offer.price&&ps.hand.some(p=>!p))break;
            const before={funds:ps.funds,free:ps.hand.filter(p=>!p).length,board:field(ps).length};
            if(ps.sell(sale.p.uid)?.ok){
              note(ps,{phase:'sale',cause,round:m.round,level:ps.shop.level,target:offer.id,uid:sale.p.uid,id:sale.p.id,
                name:sale.name,onBoard:sale.onBoard,boardBefore:before.board,fundsBefore:before.funds,fundsAfter:ps.funds,
                freeBefore:before.free,freeAfter:ps.hand.filter(p=>!p).length,earlyMulti});changed=true;
            }else if(earlyMulti)throw Error('Preflighted early pair sale was rejected');
          }
        }else{
          const key=JSON.stringify([m.round,offer.id,ps.funds,field(ps).map(p=>p.uid),reason]);
          if(ps._sargonPairSafetyBlockKey!==key){ps._sargonPairSafetyBlockKey=key;
            (ps._sargonFactorHistory||=[]).push({factor:'pair-field-safety',phase:'blocked',round:m.round,
              target:offer.id,reason,funds:ps.funds,price:offer.price,board:field(ps).length,cap:ps.deployCap});}
          ps._sargonPairSafetyBlocked={round:m.round,slots:ps.shop.slots};
        }
        if(changed)break;
        continue;
      }
      const slot=ps.shop.slots[offer.index],before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
      if(!slot||slot.sold||!ps.completesChessMerge(slot.id))continue;
      const result=ps.buy(offer.index);if(!result?.ok)continue;
      parent.afterPurchase?.(m,ps,slot,before);
      note(ps,{phase:'buy',cause,round:m.round,level:ps.shop.level,id:offer.id,name:offer.name,
        price:funds-ps.funds,fundsBefore:funds,fundsAfter:ps.funds,
        gained:ps.allChess().filter(p=>!before.has(p.uid)).map(p=>({uid:p.uid,id:p.id}))});
      // Merge rewards are resolved before inspecting another shop card or choosing another sale.
      h.takeOffers?.();changed=true;break;
    }
    if(changed)continue;
    if(!ps.shop.frozen)ps.freeze();
    const state={round:m.round,slots:ps.shop.slots},key=JSON.stringify([m.round,ps.funds,offers.map(p=>[p.id,p.price])]);
    ps._sargonPairBlocked=state;
    if(ps._sargonPairBlockedKey!==key){ps._sargonPairBlockedKey=key;note(ps,{phase:'hold',cause,round:m.round,
      level:ps.shop.level,funds:ps.funds,freeHand:ps.hand.filter(p=>!p).length,offers});}
    if(ps._sargonPairSafetyBlocked?.round===m.round&&ps._sargonPairSafetyBlocked.slots===ps.shop.slots
      &&spendLockedPairRemainder(parent,m,ps,h))continue;
    return false;
  }
  throw Error('Pair completion failed to converge');
}
export function createPairCompletionPolicy(parent){
  const install=(m,ps,h={})=>{ps._sargonPairHelpers={...ps._sargonPairHelpers,...h};
    ps._sargonCompletePairs=cause=>completeVisiblePairs(parent,m,ps,ps._sargonPairHelpers,cause);};
  const blocked=(m,ps)=>ps._sargonPairBlocked?.round===m.round&&ps._sargonPairBlocked.slots===ps.shop.slots&&pairOffers(ps).length>0;
  return Object.freeze({...parent,name:parent.name+'; complete visible pairs with safe liquidation',
    completePairs(m,ps,h={}){install(m,ps,h);return ps._sargonCompletePairs('buy-loop');},
    bankRemainder:(m,ps)=>blocked(m,ps)&&ps._sargonPairSafetyBlocked?.round===m.round
      ?spendLockedPairRemainder(parent,m,ps,ps._sargonPairHelpers):parent.bankRemainder?.(m,ps),
    purchaseAllowed:(m,ps,r)=>ps.completesChessMerge(r.chessId??r.id)||parent.purchaseAllowed(m,ps,r),
    importantBuy:(m,ps,r)=>ps.completesChessMerge(r.chessId??r.id)||parent.importantBuy(m,ps,r),
    criticalBuy:(m,ps,r)=>ps.completesChessMerge(r.chessId??r.id)||parent.criticalBuy(m,ps,r),
    preserve:(m,ps,r)=>copies(ps,base(ps,r)).length>=2||parent.preserve?.(m,ps,r),
    beforeUpgrade:(m,ps,...args)=>!blocked(m,ps)&&parent.beforeUpgrade(m,ps,...args),
    preparePurchases(m,ps,h={}){install(m,ps,h);parent.preparePurchases?.(m,ps,{...h,
      beforeMimicPurchase:()=>ps._sargonCompletePairs('before-mimic')&&h.beforeMimicPurchase?.()!==false});},
    onLevelUp(m,ps,h={}){install(m,ps,h);if(ps._sargonCompletePairs('after-upgrade'))parent.onLevelUp?.(m,ps,h);},
    beforeShopRefresh:(m,ps,h={})=>{install(m,ps,h);return ps._sargonCompletePairs('ordinary-refresh')
      &&parent.beforeShopRefresh?.(m,ps,h)!==false;},
    holdShop:(m,ps)=>blocked(m,ps)||parent.holdShop?.(m,ps)
  });
}
