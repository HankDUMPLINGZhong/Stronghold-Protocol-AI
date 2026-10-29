// [ASSUMED] Independent shopping fixes on frozen 28/7; no extra forecast or future-shop knowledge.
import {ids} from './sargonPepe.js';
import {foreignEngineRank} from './sargonRound22.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const carries=[ids.passenger,ids.pepe],main=[...carries,ids.titi];
const ownedElite=(ps,id)=>ps.allChess().some(p=>base(ps,p)===id&&ps.gd.isGolden(p.id));
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'shopping-round24',...e});
const live=(ps,s)=>s&&!s.sold&&s.kind==='chess'&&!ps.gd.isGolden(s.id)&&!ownedElite(ps,base(ps,s));

export function carryOffers(parent,m,ps){
  return ps.shop.slots.flatMap((s,index)=>live(ps,s)&&carries.includes(base(ps,s))
    &&ps.priceOf(s)<=ps.funds&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id))
    ?[{index,id:s.id,price:ps.priceOf(s),merge:ps.completesChessMerge(s.id)}]:[])
    .sort((a,b)=>Number(b.merge)-Number(a.merge)||carries.indexOf(base(ps,a))-carries.indexOf(base(ps,b))||a.index-b.index);
}
export function buyCarriesBeforeCompetitor(parent,m,ps,h={},cause='titi'){
  for(let guard=0;guard<12;guard++){
    let offer=carryOffers(parent,m,ps)[0];if(!offer)return true;
    if(!ps.hand.some(p=>!p)&&!h.freePurchaseSlot?.())return false;
    offer=carryOffers(parent,m,ps)[0];if(!offer)return true;
    if(!ps.hand.some(p=>!p))return false;
    const funds=ps.funds,slot=ps.shop.slots[offer.index],before=new Set(ps.allChess().map(p=>p.uid));
    if(!ps.buy(offer.index)?.ok)return false;
    parent.afterPurchase?.(m,ps,slot,before);
    note(ps,{phase:'carry-first',cause,round:m.round,id:offer.id,price:offer.price,merge:offer.merge,fundsBefore:funds,fundsAfter:ps.funds});
  }
  return !carryOffers(parent,m,ps).length;
}
export function createCarryFirstShopPolicy(parent){
  const titiVisible=(m,ps)=>ps.shop.slots.some(s=>live(ps,s)&&base(ps,s)===ids.titi
    &&ps.priceOf(s)<=ps.funds&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id)));
  const helpers=(m,ps,h={})=>({...h,beforeMimicPurchase:()=>buyCarriesBeforeCompetitor(parent,m,ps,h,'mimic')
    &&h.beforeMimicPurchase?.()!==false});
  return Object.freeze({...parent,name:'28/7: visible Passenger and Pepe before mimic or Titi',
    preparePurchases(m,ps,h={}){
      if(titiVisible(m,ps))buyCarriesBeforeCompetitor(parent,m,ps,h,'titi');
      parent.preparePurchases?.(m,ps,helpers(m,ps,h));
    },
    onLevelUp(m,ps,h={}){
      parent.onLevelUp(m,ps,helpers(m,ps,h));
      if(titiVisible(m,ps))buyCarriesBeforeCompetitor(parent,m,ps,h,'titi');
    },
    purchaseAllowed:(m,ps,r)=>base(ps,r)===ids.titi&&carryOffers(parent,m,ps).length?false:parent.purchaseAllowed(m,ps,r),
    purchaseItemAllowed:(m,ps,r)=>(r.id??r.itemId??'').startsWith('chess_item_5_05')&&carryOffers(parent,m,ps).length
      ?false:parent.purchaseItemAllowed(m,ps,r)});
}

export function keyThirdOffers(m,ps){
  if(m.round>m.gd.bossRound)return [];
  return ps.shop.slots.flatMap((s,index)=>{
    if(!live(ps,s)||!ps.completesChessMerge(s.id))return [];
    const r=ps.gd.chess(s.id),id=base(ps,s),foreign=foreignEngineRank(ps.gd,r);
    if(!(r.bonds.includes('sargonShip')&&r.tier>=3)&&!foreign)return [];
    return [{index,id:s.id,name:r.name,price:ps.priceOf(s),rank:main.includes(id)?100-main.indexOf(id)
      :r.bonds.includes('sargonShip')?50+r.tier:foreign*10+r.tier}];
  }).sort((a,b)=>b.rank-a.rank||a.index-b.index);
}
/** Spend on a real completed merge before discarding this shop, preserving a visible important main's price. */
export function protectKeyThirds(parent,m,ps,h={},cause='refresh'){
  for(let guard=0;guard<12;guard++){
    let pick=keyThirdOffers(m,ps)[0];if(!pick)return true;
    const visibleMain=ps.shop.slots.filter(s=>live(ps,s)&&s.id!==pick.id&&main.includes(base(ps,s)))
      .filter(s=>parent.importantBuy(m,ps,ps.gd.chess(s.id)))
      .reduce((n,s)=>Math.max(n,ps.priceOf(s)),0);
    let reason=ps.funds<pick.price?'cash':ps.funds-pick.price<visibleMain?'visible-main-budget':'buy';
    if(reason==='buy'&&!ps.hand.some(p=>!p)){
      // Consuming equipment can change the pair, funds or visible main: rebuild all decisions after a successful repair.
      if(h.freePurchaseSlot?.())continue;
      reason='capacity';
    }
    if(reason!=='buy'||ps.funds<pick.price||!ps.hand.some(p=>!p)){
      if(!ps.shop.frozen)ps.freeze();
      note(ps,{phase:'third-hold',cause,round:m.round,...pick,funds:ps.funds,visibleMain,reason:reason==='buy'?'cash-or-capacity':reason});
      return false;
    }
    const funds=ps.funds,slot=ps.shop.slots[pick.index],before=new Set(ps.allChess().map(p=>p.uid));
    if(!ps.buy(pick.index)?.ok)throw Error('Protected third purchase rejected');
    parent.afterPurchase?.(m,ps,slot,before);
    note(ps,{phase:'third-buy',cause,round:m.round,...pick,fundsBefore:funds,fundsAfter:ps.funds,visibleMain});
  }
  return !keyThirdOffers(m,ps).length;
}
export function createKeyThirdRefreshPolicy(parent){
  return Object.freeze({...parent,name:'28/7: complete key thirds before any planned refresh, including Degen',
    beforeShopRefresh:(m,ps,h)=>protectKeyThirds(parent,m,ps,h,'ordinary'),
    onLevelUp(m,ps,h={}){
      if(ps.counters['band:pepe:special']>0&&!protectKeyThirds(parent,m,ps,h,'special'))return;
      parent.onLevelUp(m,ps,h);
    }});
}
