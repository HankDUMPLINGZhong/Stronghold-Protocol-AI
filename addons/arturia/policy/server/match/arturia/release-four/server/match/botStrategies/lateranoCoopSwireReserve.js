// [ASSUMED] Optional Vision150 Swire economy: no Astgenne requirement, two spare hand slots for pair projects.
// Own assets/current visible shop only. The inherited recipe still chooses every merge reward and battle roster.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
const SWIRE='chess_char_3_03_a',COIN='chess_item_1_03_e_a',VISION='visiShip';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const free=ps=>ps.hand.filter(p=>!p).length;
const scoped=(m,ps)=>m.mode==='coop'&&!m.isSolo&&ps.bandId==='band_paganini'
  &&ps._botFocusId==='lateranoShip'&&(ps.layers[VISION]||0)>=150;
const log=(ps,row)=>(ps._botCoopFactorHistory||=[]).push({factor:'swire150-reserve',...row});
const state=ps=>ps._botCoopSwireReserve||=( {uids:[],paid:0,coins:0,sales:0,offers:[]} );
const reserved=ps=>ps.allChess().filter(p=>state(ps).uids.includes(p.uid));
const safeSale=(ps,p)=>{
  if(!p||p.items?.length||!['hand','temp'].includes(ps.find(p.uid)?.area))return false;
  if(!ps.bonds[VISION]?.active)return true;
  const remaining=ps.allChess().filter(q=>q.uid!==p.uid&&pieceBonds(ps.gd,q).includes(VISION));
  return new Set(remaining.map(q=>base(ps,q))).size+(ps.bondCountBonus?.[VISION]||0)>=2;
};
const coins=ps=>[...ps.hand,...ps.temp].filter(p=>p?.kind==='item'&&base(ps,p)===COIN);
function redeem(ps,target,only=null){
  if(!target||target.items?.length>=ps.gd.equipPerChess)return 0;
  let gained=0;
  for(const p of coins(ps))if(!only||only.has(p.uid)){
    const before=ps.funds;if(ps.equip(p.uid,target.uid)?.ok)gained+=ps.funds-before;
  }
  return gained;
}
function release(m,ps,reason){
  const s=state(ps);let n=0;
  for(const p of reserved(ps))if(safeSale(ps,p)){
    const before=ps.funds;if(ps.sell(p.uid)?.ok){s.sales+=ps.funds-before;n++;s.uids=s.uids.filter(id=>id!==p.uid);}
  }
  if(n)log(ps,{action:'release',round:m.round,reason,count:n,paid:s.paid,coins:s.coins,sales:s.sales,
    cashBalance:s.coins+s.sales-s.paid});
  if(!s.uids.length){s.paid=0;s.coins=0;s.sales=0;}
  return n;
}
function observeRewards(m,ps){
  if(ps._botCoopSwireRewardObserver)return;ps._botCoopSwireRewardObserver=true;
  const pick=ps.pickReward;
  ps.pickReward=function(index){
    const offer=ps.offers[0],project=state(ps).offers.find(o=>o.offer===offer),slot=offer?.slots[index];
    const result=pick.call(ps,index);
    if(result?.ok&&project&&slot){
      log(ps,{action:'merge-reward',round:m.round,id:slot.id,tier:offer.tier,
        paid:project.paid,coins:project.coins,sales:project.sales,
        cashBalance:project.coins+project.sales-project.paid,
        rewardSaleValue:ps.gd.sellPrice(slot.id),
        withRewardSale:project.coins+project.sales+ps.gd.sellPrice(slot.id)-project.paid});
      state(ps).offers=state(ps).offers.filter(o=>o!==project);
    }
    return result;
  };
}

function observeExternalMerge(m,ps){
  if(ps._botCoopSwireBuyObserver)return;ps._botCoopSwireBuyObserver=true;
  const buy=ps.buy;
  ps.buy=function(index){
    const s=state(ps),slot=ps.shop.slots[index];
    const watch=!ps._botCoopSwireTrading&&scoped(m,ps)&&slot?.id===SWIRE&&ps.completesChessMerge(SWIRE)
      &&ps.allChess().filter(p=>base(ps,p)===SWIRE&&!ps.gd.isGolden(p.id)).every(p=>s.uids.includes(p.uid));
    if(watch)redeem(ps,reserved(ps).find(p=>p.items?.length<ps.gd.equipPerChess));
    const own=watch?new Set(ps.allChess().map(p=>p.uid)):null,items=watch?new Set([...ps.hand,...ps.temp].filter(Boolean).map(p=>p.uid)):null;
    const offers=watch?new Set(ps.offers):null,funds=ps.funds;
    const result=buy.call(ps,index);
    if(result?.ok&&watch){
      const p=ps.allChess().find(p=>!own.has(p.uid)&&base(ps,p)===SWIRE&&ps.gd.isGolden(p.id));
      if(!p)throw Error('External third did not merge the reserved Swire pair');
      const newItems=new Set([...ps.hand,...ps.temp].filter(p=>p?.kind==='item'&&!items.has(p.uid)).map(p=>p.uid));
      const redeemed=redeem(ps,p,newItems),price=funds-ps.funds+redeemed;
      s.paid+=price;s.coins+=redeemed;s.uids=[p.uid];
      if(safeSale(ps,p)&&ps.sell(p.uid)?.ok){s.sales+=ps.gd.sellPrice(p.id);s.uids=[];}
      for(const offer of ps.offers)if(!offers.has(offer)&&offer.source==='merge')s.offers.push({offer,paid:s.paid,coins:s.coins,sales:s.sales});
      log(ps,{action:'merge-external-third',round:m.round,price,coins:redeemed,projectPaid:s.paid,projectCoins:s.coins,projectSales:s.sales});
      if(!s.uids.length){s.paid=0;s.coins=0;s.sales=0;}
    }
    return result;
  };
}

export function tradeCoopSwire150(m,ps,recipe,{spareSlots=2,holdPairs=true}={}){
  if(!scoped(m,ps)||ps._botCoopSwireTrading)return;
  ps._botCoopSwireTrading=true;
  try{
    observeRewards(m,ps);observeExternalMerge(m,ps);
    const s=state(ps);s.uids=s.uids.filter(uid=>ps.find(uid));
    const priority=ps.shop.slots.filter(x=>x&&!x.sold&&x.kind==='chess'&&base(ps,x)!==SWIRE
      &&(ps.completesChessMerge(x.id)||recipe.criticalBuy?.(m,ps,ps.gd.chess(x.id))));
    const ownThird=ps.shop.slots.some(x=>x&&!x.sold&&x.id===SWIRE&&ps.completesChessMerge(SWIRE));
    if(reserved(ps).length&&(!ownThird&&(free(ps)<spareSlots||ps.funds<=1)||priority.some(x=>ps.priceOf(x)>ps.funds)))
      release(m,ps,free(ps)<spareSlots?'space':priority.length?'reinforcement':'cash');
    // Original third-copy acquisition keeps precedence; holding Swire is an optional cash investment.
    if(priority.some(x=>ps.completesChessMerge(x.id)))return;
    for(const[index,slot]of ps.shop.slots.entries()){
      if(!slot||slot.sold||slot.kind!=='chess'||slot.id!==SWIRE)continue;
      const own=ps.allChess(),held=reserved(ps),same=own.filter(p=>base(ps,p)===SWIRE&&!ps.gd.isGolden(p.id));
      const third=ps.completesChessMerge(slot.id);
      // Do not consume a pre-existing pair or a deployed/equipped representative as an economy project.
      if(third&&(same.some(p=>!s.uids.includes(p.uid))||same.some(p=>!safeSale(ps,p))))continue;
      if(!third&&(recipe.importantBuy?.(m,ps,ps.gd.chess(slot.id))||recipe.criticalBuy?.(m,ps,ps.gd.chess(slot.id))))continue;
      const carrier=own.find(p=>p.items?.length<ps.gd.equipPerChess);redeem(ps,carrier);
      if(coins(ps).length)continue; // Never combine an old unequippable coin into the new gift.
      const price=ps.priceOf(slot),coinCount=third?2:1;
      if(price>ps.funds||free(ps)<(third?2:1+coinCount)||!m.itemPool.canGain(COIN)
        ||m.itemPool.left(COIN)<coinCount)continue;
      const refund=ps.gd.sellPrice(SWIRE),eliteRefund=ps.gd.sellPrice(ps.gd.goldenIdOf(SWIRE));
      const remaining=ps.gd.mergeCount(SWIRE)-same.length;
      // Three gains are1+1+2 coins; elite and reward each have a real sale value. No assumed combat reward value.
      const minimumReturn=(s.coins+s.sales)+coinCount+(third?eliteRefund+1:0);
      if(third&&s.paid+price>minimumReturn)continue;
      const immediate=price<=refund+1;
      if(!immediate)continue;
      const criticalPrice=Math.max(0,...priority.map(x=>ps.priceOf(x)));
      const hold=holdPairs&&!third&&same.length===held.length&&held.length<2
        &&free(ps)-1>=spareSlots&&ps.funds-price+1>=criticalPrice
        &&price*remaining<=((remaining===3?4:remaining===2?3:2)+eliteRefund+1);
      const ids=new Set(own.map(p=>p.uid)),items=new Set([...ps.hand,...ps.temp].filter(Boolean).map(p=>p.uid));
      const oldOffers=new Set(ps.offers),funds=ps.funds,spent=ps.round.spent;
      if(!ps.buy(index)?.ok)continue;
      const gained=ps.allChess().filter(p=>!ids.has(p.uid)),primary=gained.find(p=>base(ps,p)===SWIRE);
      if(!primary)throw Error('Swire project did not acquire its real primary');
      const newItems=new Set([...ps.hand,...ps.temp].filter(p=>p?.kind==='item'&&!items.has(p.uid)).map(p=>p.uid));
      const redeemed=redeem(ps,primary,newItems);if(redeemed!==coinCount)throw Error('Swire gift coin value differs from generated1+1+2');
      if(hold){s.uids.push(primary.uid);s.paid+=price;s.coins+=redeemed;}
      else{
        if(third){s.uids=same.map(p=>p.uid).filter(uid=>ps.find(uid));s.paid+=price;s.coins+=redeemed;}
        if(safeSale(ps,primary)&&ps.sell(primary.uid)?.ok){if(third)s.sales+=ps.gd.sellPrice(primary.id);}
        else if(!third)s.uids.push(primary.uid);
        if(third){
          const project={paid:s.paid,coins:s.coins,sales:s.sales};
          for(const offer of ps.offers)if(!oldOffers.has(offer)&&offer.source==='merge')s.offers.push({...project,offer});
          s.uids=ps.find(primary.uid)?[primary.uid]:[];
        }
      }
      log(ps,{action:third?'merge':hold?'hold':'cycle',round:m.round,level:ps.shop.level,price,
        coins:redeemed,primary:primary.uid,elite:ps.gd.isGolden(primary.id),fundsBefore:funds,fundsAfter:ps.funds,
        spent:ps.round.spent-spent,held:s.uids.length,free:free(ps),
        projectPaid:s.paid,projectCoins:s.coins,projectSales:s.sales});
      if(third&&!s.uids.length){s.paid=0;s.coins=0;s.sales=0;}
    }
  }finally{ps._botCoopSwireTrading=false;}
}

export function withCoopSwire150Reserve(parent,options={}){
  const run=(m,ps)=>tradeCoopSwire150(m,ps,parent,options);
  const keep=(m,ps,r)=>scoped(m,ps)&&ps.gd.baseIdOf(r.chessId??r.id)===SWIRE&&reserved(ps).length>0;
  return Object.freeze({...parent,
    liquidity(m,ps,...xs){run(m,ps);return parent.liquidity?.(m,ps,...xs);},
    useEconomy(m,ps,...xs){run(m,ps);return parent.useEconomy(m,ps,...xs);},
    keep:(m,ps,r,...xs)=>keep(m,ps,r)||parent.keep(m,ps,r,...xs),
    preserve:(m,ps,r,...xs)=>keep(m,ps,r)||parent.preserve(m,ps,r,...xs),
    cleanupAcquisitions(m,ps,...xs){
      if(!scoped(m,ps))return parent.cleanupAcquisitions?.(m,ps,...xs);
      const sell=ps.sell;ps.sell=function(uid,...ys){return state(ps).uids.includes(uid)?{ok:false}:sell.call(ps,uid,...ys);};
      try{return parent.cleanupAcquisitions?.(m,ps,...xs);}finally{ps.sell=sell;}
    },
  });
}
