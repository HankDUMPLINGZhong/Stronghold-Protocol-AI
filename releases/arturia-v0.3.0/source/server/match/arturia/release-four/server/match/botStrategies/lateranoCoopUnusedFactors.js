// [ASSUMED] Five independent co-op trials over the retained17/56 recipe. None changes the default profile.
// Only current own assets/public wave enter decisions; all grants and promotions use the real player API.
import {pieceBonds} from '../../../../../bondsMeta.js';
import {prepLayerForecast,prepareDevelopmentInput} from '../botLateranoDevelopment.js';
import {createForecastSteps} from '../botForecast.js';
import {bossFormationSnapshot} from './lateranoBossFormation.js';
import {stealthBattleInput} from './lateranoStealthWave.js';
import {allCoopForecastsFatal} from './lateranoCoopRescue.js';

const CORE='lateranoShip',VISION='visiShip',MIMIC='chess_item_5_05_e_a';
const RECRUIT=new Set(['chess_item_2_06_e_a','chess_item_4_01_e_a','chess_item_5_04_e_a']);
const scoped=(m,ps)=>m.mode==='coop'&&!m.isSolo&&ps.bandId==='band_paganini'&&ps._botFocusId===CORE;
const inventory=ps=>[...ps.hand,...ps.temp].filter(p=>p?.kind==='item');
const log=(ps,kind,row)=>(ps._botCoopUnusedHistory||=[]).push({kind,...row});

/** Candidate prep-finish layers are battle inputs, not real meta mutations. No next-round settlement in R14. */
export function projectCoopBossPrep(m,ps,plan,input){
  const gd=ps.gd||m.gd,units=plan.lineup.map(p=>{
    const key=plan.get(p.uid),[r,c]=key.split(',').map(Number);
    return {uid:p.uid,rec:gd.chess(p.id),bonds:pieceBonds(gd,p),key,r,c,dir:plan.dirOf(p.uid)};
  });
  const fin=prepLayerForecast(gd,units,input.bonds,'SERVER_PREP_FIN',ps.round.spent,ps.round.refreshes);
  for(const [id,n]of Object.entries(fin))input.bonds[id].layers+=n;
  log(ps,'boss-prep',{round:m.round,gains:fin});return input;
}

export function withCoopBossPrep(parent){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(!scoped(m,ps)||m.round!==m.gd.bossRound){yield* parent.finalBoardSteps(m,ps,h);return;}
    const previous=ps._botCoopBossPrepInput;ps._botCoopBossPrepInput=projectCoopBossPrep;
    try{yield* parent.finalBoardSteps(m,ps,h);}finally{ps._botCoopBossPrepInput=previous;}
  }});
}

/** R14 speculative off-core Vision singles cannot pay a future development dividend.
 * Actual merges, a missing Saint partner, native cards and cash-safe cycles remain unchanged. */
export function lateVisionSpeculation(m,ps,parent,rec){
  if(!scoped(m,ps)||m.round!==m.gd.bossRound||!rec.bonds.includes(VISION)||rec.bonds.includes(CORE))return false;
  const gd=ps.gd||m.gd,owned=ps.allChess();
  if(ps.completesChessMerge(rec.chessId||rec.id)||rec.bonds.some(b=>['preciShip','skillfulShip','steadShip'].includes(b)))return false;
  const saint=owned.some(p=>gd.baseIdOf(p.id)===parent.ids.executorAlter);
  if(saint&&!owned.some(p=>gd.baseIdOf(p.id)!==parent.ids.executorAlter&&pieceBonds(gd,p).includes(VISION)))return false;
  if(parent.cycleValue?.(m,ps,rec,{ps,route:ps._botRoute})>0)return false;
  return owned.some(p=>pieceBonds(gd,p).includes(VISION));
}

export function withCoopLateVision(parent){
  return Object.freeze({...parent,purchaseAllowed(m,ps,rec){
    if(parent.purchaseAllowed(m,ps,rec)===false)return false;
    const denied=lateVisionSpeculation(m,ps,parent,rec);
    if(denied)log(ps,'late-vision-skip',{round:m.round,id:rec.chessId||rec.id});return !denied;
  }});
}

/** Only ordinary real native engine pairs. Existing main/route promotion targets always act first. */
export function coopRoutineMimicTarget(m,ps,parent){
  if(!scoped(m,ps)||m.round<12||m.round>13)return null;
  const gd=ps.gd||m.gd,owned=ps.allChess(),base=p=>gd.baseIdOf(p.id);
  return owned.filter(p=>[parent.ids.mostima,parent.ids.archetto].includes(base(p))&&!gd.isGolden(p.id)
    &&(p.items?.length||0)<gd.equipPerChess&&!owned.some(q=>base(q)===base(p)&&gd.isGolden(q.id))
    &&owned.filter(q=>base(q)===base(p)&&!gd.isGolden(q.id)).length>=2
    &&(!(ps.poolOf?.(p.id)||m.pool).has(base(p))||(ps.poolOf?.(p.id)||m.pool).left(base(p))>0))
    .sort((a,b)=>Number(base(b)===parent.ids.mostima)-Number(base(a)===parent.ids.mostima)||a.uid-b.uid)[0]||null;
}

export function withCoopRoutineMimic(parent){
  return Object.freeze({...parent,useEconomy(m,ps){
    parent.useEconomy(m,ps);
    for(const item of inventory(ps)){
      if((ps.gd||m.gd).baseIdOf(item.id)!==MIMIC)continue;
      const rec=(ps.gd||m.gd).item(item.id);
      if(parent.ownedItemTarget?.(m,ps,rec,ps.allChess()))continue;
      const target=coopRoutineMimicTarget(m,ps,parent);if(!target)continue;
      if(ps.equip(item.uid,target.uid)?.ok)log(ps,'routine-mimic',{round:m.round,id:target.id,uid:target.uid});
    }
  }});
}

/** Local withdrawal-only priority: never changes buying, ordinary fundraising or lineup selection. */
export function coopWithdrawalPriority(m,ps,parent,p){
  if(!scoped(m,ps)||p?.kind!=='chess')return 0;
  const gd=ps.gd||m.gd,id=gd.baseIdOf(p.id),ids=parent.ids;
  if([ids.ptilopsis4,ids.ptilopsis5,ids.astgenne,ids.titi].includes(id))return 3;
  if(id===ids.ayerscarpe&&gd.isGolden(p.id))return 2;
  return 0;
}
export function withCoopWithdrawal(parent){
  return Object.freeze({...parent,withdrawalPriority:(m,ps,p)=>coopWithdrawalPriority(m,ps,parent,p)});
}

/** Native same-bond recruitment; Beacon uses only a surplus off-board single, never a kept role/core. */
export function coopRecruitTarget(m,ps,parent,item){
  const gd=ps.gd||m.gd,id=gd.baseIdOf(item.id),own=ps.allChess();
  if(id==='chess_item_5_04_e_a')return own.filter(p=>ps.find(p.uid)?.area!=='board'&&!gd.isGolden(p.id)
    &&!(p.items?.length)&&!pieceBonds(gd,p).includes(CORE)&&!parent.keep(m,ps,gd.chess(p.id))
    &&!parent.preserve(m,ps,gd.chess(p.id))&&own.filter(q=>gd.baseIdOf(q.id)===gd.baseIdOf(p.id)).length===1)
    .sort((a,b)=>gd.tierOf(b.id)-gd.tierOf(a.id)||a.uid-b.uid)[0]||null;
  return own.filter(p=>!gd.isGolden(p.id)&&pieceBonds(gd,p).includes(CORE)&&(p.items?.length||0)<gd.equipPerChess)
    .sort((a,b)=>Number(pieceBonds(gd,a).length>1)-Number(pieceBonds(gd,b).length>1)||gd.tierOf(b.id)-gd.tierOf(a.id)||a.uid-b.uid)[0]||null;
}

export function withCoopRecruitBeforeRefresh(parent){
  return Object.freeze({...parent,*beforeRefreshSteps(m,ps,h){
    if(!scoped(m,ps)||!m.wave||m.round>=m.gd.bossRound||m.botRehearsal<3)return false;
    const gd=ps.gd||m.gd;
    const candidates=ps.shop.slots.map((slot,index)=>({slot,index})).filter(({slot})=>slot&&!slot.sold&&slot.kind==='item'
      &&RECRUIT.has(gd.baseIdOf(slot.id))&&ps.priceOf(slot)<=ps.funds&&coopRecruitTarget(m,ps,parent,slot));
    if(!candidates.length||!ps.hand.some(p=>!p))return false;
    const original=bossFormationSnapshot(ps,h);if(!original.lineup.length)return false;
    // A fresh complete own forecast now, while the actual item is still visible. One check per unchanged input.
    const stamp=JSON.stringify([m.round,ps.lp,ps.round.spent,ps.battleInput()]);
    let fatal;
    if(ps._botCoopRecruitRisk?.stamp===stamp)fatal=ps._botCoopRecruitRisk.fatal;
    else{
      function* inputSteps(plan){yield;return stealthBattleInput(ps,plan);}
      const job=yield* createForecastSteps(m,ps,original.lineup,[original],inputSteps,{
        forecastReadinessOnly:true,prepareForecastInput:(m,ps,_chosen,p,input)=>prepareDevelopmentInput(m,ps,p.lineup,p,input),
        forecastContext:()=>({}),observeForecast:()=>()=>({}),selectForecast:()=>({index:0}),
      });
      if(!job)return false;while(!job.run(4))yield;
      fatal=allCoopForecastsFatal(job.outcomes,ps.lp);ps._botCoopRecruitRisk={stamp,fatal};
      log(ps,'recruit-risk',{round:m.round,fatal,outcomes:job.outcomes,offered:candidates.map(c=>c.slot.id)});
    }
    if(!fatal)return false;
    for(const {slot,index}of candidates){
      const target=coopRecruitTarget(m,ps,parent,slot);if(!target||ps.shop.slots[index]!==slot||slot.sold)continue;
      const before=new Set(inventory(ps).map(p=>p.uid)),settled=parent.observeSpend?.(m,ps);
      const purchased=ps.buy(index);settled?.();if(!purchased?.ok)continue;
      const item=inventory(ps).find(p=>!before.has(p.uid)&&gd.baseIdOf(p.id)===gd.baseIdOf(slot.id));
      const used=!!item&&!!ps.equip(item.uid,target.uid)?.ok;
      log(ps,'recruit-buy',{round:m.round,id:slot.id,target:target.id,used,funds:ps.funds});
      h.takeOffers();parent.useEconomy(m,ps);return true;
    }
    return false;
  }});
}
