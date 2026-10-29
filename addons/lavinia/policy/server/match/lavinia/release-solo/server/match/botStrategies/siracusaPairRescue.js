// [ASSUMED] User's 19 observed decisions generalized into one independent acquisition factor.
// Only present holdings, visible shops and generated traits. Real sell/equip/destroy/buy/freeze APIs.
// No seed branches, future shop/reward inspection or additional combat forecasts.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { botSaleAllowed, botSell } from '../botSiracusaSales.js';
import { routeLayerEngine } from './siracusaFocusedDraft.js';

const CORE='siracusaShip';
const ID={provence:'chess_char_1_07_a',texas:'chess_char_1_08_a',lappland:'chess_char_2_16_a',
  hone:'chess_char_3_18_a',vigil:'chess_char_3_19_a',aroma:'chess_char_4_10_a',alter:'chess_char_4_16_a',
  surtr:'chess_char_5_07_a',suzu:'chess_char_5_10_a',angel:'chess_char_5_20_a',
  passenger:'chess_char_6_05_a',degen:'chess_char_6_19_a',qiubai:'chess_char_6_15_a',lapAlt:'chess_char_6_18_a'};
const KEYS=new Set([ID.hone,ID.aroma,ID.alter,ID.surtr,ID.suzu,ID.angel,ID.lapAlt]);
export const pairRescueScope=(m,ps)=>m.difficulty==='ABYSS'&&((m.mode==='solo'&&m.isSolo&&m.order.length===1)||(m.mode==='coop'&&!m.isSolo&&[2,4].includes(m.order.length)))
  &&m.round>=1&&ps.bandId==='band_chiave'&&ps._botFocusId===CORE;
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const own=(ps,id)=>ps.allChess().filter(p=>base(ps,p)===id);
const board=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const nativeCount=(ps,pieces)=>new Set(pieces.filter(p=>pieceBonds(ps.gd,p).includes(CORE)).map(p=>base(ps,p))).size;
const free=ps=>ps.hand.filter(p=>!p).length;
const log=(ps,row)=>{const xs=ps._botPairRescueHistory||=[];const e={...row};if(JSON.stringify(xs.at(-1))!==JSON.stringify(e))xs.push(e);};

export function pairRescueTargets(parent,m,ps){
  if(!pairRescueScope(m,ps))return [];
  return ps.shop.slots.flatMap((slot,index)=>{
    if(slot?.kind!=='chess'||slot.sold||ps.gd.isGolden(slot.id)||!ps.completesChessMerge(slot.id))return [];
    const rec=ps.gd.chess(slot.id),id=base(ps,slot);
    if(parent.purchaseAllowed?.(m,ps,rec)===false)return [];
    if(!rec.bonds.includes(CORE)&&!routeLayerEngine(ps.gd,rec,['swiftShip','arcaneShip','raidShip'])&&!parent.rewardPairEligible?.(m,ps,rec))return [];
    const pool=ps.poolOf(id);
    if(pool.has(id)&&pool.left(id)<1)return [];
    const elite=own(ps,id).some(p=>ps.gd.isGolden(p.id));
    return [{slot,index,id,price:ps.priceOf(slot),score:rec.tier*10+Number(!elite)*100+Number(KEYS.has(id))*25}];
  }).sort((a,b)=>b.score-a.score||a.price-b.price||a.index-b.index);
}

function authorizedSixRetirement(ps,p){
  if(ps.find(p.uid)?.area==='board')return false;
  const id=base(ps,p),rec=ps.gd.chess(p.id);
  // Explicit user exceptions include newly rewarded copies; the other new-six protections remain.
  return id===ID.passenger&&!routeLayerEngine(ps.gd,rec,['swiftShip'])
    ||id===ID.qiubai&&(own(ps,ID.surtr).length>0||own(ps,ID.alter).length>0);
}
function safeRemoval(m,ps,p,target){
  if(!target||!p||p.kind!=='chess'||p.items?.length||!botSaleAllowed(m,ps,p)&&!authorizedSixRetirement(ps,p))return false;
  const all=ps.allChess(),remaining=all.filter(q=>q.uid!==p.uid),id=base(ps,p);
  if(nativeCount(ps,remaining)<Math.min(6,nativeCount(ps,all)))return false;
  if(id===target.id&&!ps.gd.isGolden(p.id))return false; // Never spend the target's own normal pair.
  if(KEYS.has(id)&&!remaining.some(q=>base(ps,q)===id))return false;
  if(ps.bonds.investShip?.active){
    const investors=new Set(remaining.filter(q=>pieceBonds(ps.gd,q).includes('investShip')).map(q=>base(ps,q)));
    if(investors.size<3)return false;
  }
  return true;
}

function pineCredit(ps,p){
  const rec=ps.gd.chess(p.id);
  if(rec.isGolden)return 0;
  const g=rec.garrisonIds.map(id=>ps.gd.garrison(id)).find(g=>g?.effectKey==='SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS');
  if(!g||ps.gd.chess(p.id).name!=='松果')return 0;
  // The public tier-I pool guarantees one chess choice, but its identity is not inspected before selling.
  const pool=ps.gd.choices?.pools?.[g.bbStr?.pool1];
  const ids=pool?.items||pool?.weighted?.map(x=>x[0])
    ||(pool?.rule==='shopEligible'?ps.gd.visibleChess.filter(id=>ps.gd.chess(id)?.tier===pool.tier):[]);
  return ids.some(id=>!ps.m.pool.has(id)||ps.m.pool.left(id)>0)?1:0;
}

export function pairRescueSaleRank(m,ps,p,target,selected=new Set()){
  if(!safeRemoval(m,ps,p,target))return null;
  const gd=ps.gd,id=base(ps,p),rec=gd.chess(p.id),where=ps.find(p.uid)?.area;
  const onBoard=where==='board',chosen=selected.has(p.uid),late=m.round>=8;
  if(ps._botPairRescueGiftUids?.has(p.uid)&&!onBoard&&!chosen&&rec.tier===1)return 5;
  // Previously used bridge defenders are dispensable after the native front has taken over.
  if(['蛇屠箱','松果'].includes(rec.name)&&!onBoard&&!chosen)return rec.name==='松果'?12:10;
  if(rec.name==='古米'&&m.round<=7){
    const others=board(ps).filter(q=>q.uid!==p.uid&&gd.chess(q.id)?.position==='MELEE'&&(gd.chess(q.id)?.stats?.blockCnt||0)>0);
    if(!onBoard&&!chosen||onBoard&&nativeCount(ps,board(ps))>=3&&others.length>=2)return 18;
  }
  if(!late)return null;
  if(id===ID.texas&&!onBoard)return 20; // Real sale trait grants one/two free refreshes.
  if(id===ID.provence&&!onBoard)return 25;
  if(id===ID.passenger&&!onBoard&&!routeLayerEngine(gd,rec,['swiftShip']))return 30;
  if(id===ID.qiubai&&!onBoard&&(own(ps,ID.surtr).length||own(ps,ID.alter).length))return 35;
  if(id===ID.vigil){
    if(!onBoard&&gd.isGolden(p.id)&&target.id===id&&own(ps,id).filter(q=>!gd.isGolden(q.id)).length>=2)return 15;
    if(!onBoard&&(!chosen||nativeCount(ps,board(ps))>=6||own(ps,id).length>1))return 40;
    const degen=ps.allChess().find(q=>base(ps,q)===ID.degen&&ps.find(q.uid)?.area!=='board');
    if(onBoard&&degen&&nativeCount(ps,board(ps).filter(q=>q.uid!==p.uid))>=6)return 45;
  }
  return null;
}

/** Complete present-asset funding/space plan before committing its first sale; at most three old assets. */
export function pairRescueSalePlan(m,ps,target,selected=new Set()){
  const candidates=ps.allChess().map(p=>({p,rank:pairRescueSaleRank(m,ps,p,target,selected)}))
    .filter(x=>x.rank!=null).sort((a,b)=>a.rank-b.rank||a.p.uid-b.p.uid);
  let best=null;
  const visit=(at,sales,refund,weight)=>{
    const removed=new Set(sales.map(x=>x.p.uid)),remaining=ps.allChess().filter(p=>!removed.has(p.uid));
    if(nativeCount(ps,remaining)<Math.min(6,nativeCount(ps,ps.allChess())))return;
    const handSales=sales.filter(x=>ps.find(x.p.uid)?.area==='hand').length;
    const tempLeft=ps.temp.filter(p=>p&&!removed.has(p.uid)&&!(p.kind==='token'&&removed.has(p.ownerUid))).length;
    const tokenRoom=ps.hand.filter(p=>p?.kind==='token'&&removed.has(p.ownerUid)).length;
    const room=free(ps)+handSales+tokenRoom-tempLeft;
    if(ps.funds+refund>=target.price&&room>=1){
      const score=weight+sales.length*2;
      if(!best||score<best.score||score===best.score&&sales.length<best.sales.length)best={sales,refund,score};
      return;
    }
    if(sales.length>=3)return;
    for(let i=at;i<candidates.length;i++){
      const x=candidates[i];visit(i+1,[...sales,x],refund+ps.gd.sellPrice(x.p.id)+pineCredit(ps,x.p),weight+x.rank);
    }
  };
  visit(0,[],0,0);return best;
}

function roomAction(m,ps,target){
  if(free(ps)>0)return false;
  const solvent=[...ps.hand,...ps.temp].find(p=>p?.kind==='item'&&ps.gd.item(p.id)?.name==='源石溶剂');
  if(solvent&&ps.destroy(solvent.uid)?.ok){log(ps,{kind:'destroy-solvent',round:m.round,target:target.id,item:solvent.id});return true;}
  const dress=[...ps.hand,...ps.temp].find(p=>p?.kind==='item'&&ps.gd.item(p.id)?.giveBondId===CORE);
  if(dress){
    const homes=ps.allChess().filter(p=>!ps.gd.chess(p.id)?.bonds.includes(CORE)&&(p.items?.length||0)<ps.gd.equipPerChess)
      .sort((a,b)=>Number(base(ps,b)===ID.surtr)-Number(base(ps,a)===ID.surtr)||ps.gd.chess(b.id).tier-ps.gd.chess(a.id).tier||a.uid-b.uid);
    if(homes[0]&&ps.equip(dress.uid,homes[0].uid)?.ok){log(ps,{kind:'park-dress',round:m.round,target:target.id,carrier:homes[0].id});return true;}
  }
  return false;
}

export function withSiracusaPairRescue(parent){
  const target=(m,ps)=>pairRescueTargets(parent,m,ps)[0];
  const held=(m,ps)=>{const t=target(m,ps);return !!t&&(t.price>ps.funds||free(ps)<1);};
  return Object.freeze({...parent,
    trade(m,ps,ctx,h){
      if(!pairRescueScope(m,ps))return parent.trade(m,ps,ctx,h);
      const t=target(m,ps);
      if(!t)return parent.trade(m,ps,ctx,h);
      if(t.price<=ps.funds&&free(ps)>0){
        const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
        if(ps.buy(t.index)?.ok){parent.afterPurchase?.(m,ps,t.slot,before);parent.useEconomy?.(m,ps);
          log(ps,{kind:'buy-third',round:m.round,target:t.id,fundsBefore:funds,price:t.price,fundsAfter:ps.funds});return true;}
      }
      if(roomAction(m,ps,t))return true;
      const chosen=new Set((h?.lineupFor?.(ps)?.set||board(ps)).map(p=>p.uid));
      const plan=pairRescueSalePlan(m,ps,t,chosen),sale=plan?.sales[0]?.p;
      if(sale){
        const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds,offers=ps.offers.length;
        const pine=pineCredit(ps,sale)>0;
        if((authorizedSixRetirement(ps,sale)?ps.sell(sale.uid):botSell(m,ps,sale.uid))?.ok){
          if(pine&&ps.offers.length>offers)ps._botPairRescuePinePending={round:m.round,before};
          log(ps,{kind:'sale',round:m.round,target:t.id,sold:sale.id,uid:sale.uid,fundsBefore:funds,fundsAfter:ps.funds,plannedSales:plan.sales.map(x=>x.p.id)});return true;
        }
      }
      // Leave a wanted third intact. This is the owner's explicit exception to spending the last fund on a refresh.
      log(ps,{kind:'hold-third',round:m.round,target:t.id,funds:ps.funds,price:t.price,handFree:free(ps)});
      return false;
    },
    cleanupAcquisitions(m,ps){
      parent.cleanupAcquisitions?.(m,ps);
      const pending=ps._botPairRescuePinePending;
      if(pending?.round===m.round){
        ps._botPairRescueGiftUids||=new Set();
        for(const p of ps.allChess())if(!pending.before.has(p.uid))ps._botPairRescueGiftUids.add(p.uid);
        ps._botPairRescuePinePending=null;
      }
    },
    hasVisiblePair:(m,ps)=>!!target(m,ps),
    retainVisiblePair:held,
    holdShop:(m,ps)=>held(m,ps)||parent.holdShop?.(m,ps),
    allowFundedHold:(m,ps)=>held(m,ps)||parent.allowFundedHold?.(m,ps),
  });
}
