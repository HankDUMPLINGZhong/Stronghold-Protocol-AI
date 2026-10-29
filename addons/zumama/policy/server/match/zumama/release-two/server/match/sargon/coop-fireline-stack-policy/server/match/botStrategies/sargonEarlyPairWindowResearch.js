// [ASSUMED] R1-7 may build a pair in owned foreign Precision/Stead; R8+ only completes existing pairs.
// This module changes purchase/sale decisions only, using own inventory and the current shop.
import {companionSpendingReserve} from './sargonCompanionBudget.js';
import {isPrecisionCompanion} from './sargonPrecision33.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const mains=new Set(['chess_char_6_05_a','chess_char_6_06_a','chess_char_5_02_a']);
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'early-pair-window',...e});
export const windowFamily=r=>!r.bonds.includes('sargonShip')&&r.bonds.some(b=>['preciShip','steadShip'].includes(b));
export const latePairWindowFamily=r=>!r.bonds.includes('sargonShip')&&(r.bonds.includes('steadShip')||isPrecisionCompanion(r));
const own=(ps,r)=>ps.allChess().filter(p=>base(ps,p)===base(ps,r));
export function latePairWindowVeto(m,ps,r){
  return m.round>=8&&latePairWindowFamily(r)&&!ps.completesChessMerge(r.chessId??r.id);
}
export function earlyPairDecision(parent,m,ps,r){
  const copies=own(ps,r),normal=copies.filter(p=>!ps.gd.isGolden(p.id));
  let reason='accepted',price,budget;
  if(m.round>7||!windowFamily(r)||normal.length!==1||copies.some(p=>ps.gd.isGolden(p.id)))reason='not-early-second';
  else{
    const slot=ps.shop.slots.find(s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)===base(ps,r));
    if(!slot)reason='not-in-shop';
    else{
      price=ps.priceOf(slot);budget=companionSpendingReserve(m,ps,parent,0);
      if(ps.funds-price<budget.reserve)reason='upgrade-main-budget';
      else if(ps.shop.slots.some(s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)!==base(ps,r)
        &&ps.priceOf(s)<=ps.funds&&mains.has(base(ps,s))&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id))
        &&parent.importantBuy(m,ps,ps.gd.chess(s.id))))reason='visible-main-first';
    }
  }
  return {allowed:reason==='accepted',reason,price,budget};
}
// Do not discount active units, elites, pairs, equipment carriers or native Sargon units.
export function lateSingleSalePenalty(m,ps,p){
  const r=ps.gd.chess(p.id??p.chessId),pieces=own(ps,r),unit=pieces[0];
  return m.round>=8&&latePairWindowFamily(r)&&pieces.length===1&&!ps.gd.isGolden(unit.id)
    &&ps.find(unit.uid)?.area!=='board'&&!(unit.items||[]).length?1000:0;
}
export function createEarlyPairWindowPolicy(parent){
  const allowed=(m,ps,r)=>!latePairWindowVeto(m,ps,r)
    &&(parent.purchaseAllowed(m,ps,r)||earlyPairDecision(parent,m,ps,r).allowed);
  return Object.freeze({...parent,name:parent.name+'; foreign Precision/Stead R7 pair window',
    purchaseAllowed:allowed,
    importantBuy:(m,ps,r)=>!latePairWindowVeto(m,ps,r)&&parent.importantBuy(m,ps,r),
    criticalBuy:(m,ps,r)=>!latePairWindowVeto(m,ps,r)&&parent.criticalBuy(m,ps,r),
    keep:(m,ps,r,...args)=>lateSingleSalePenalty(m,ps,r)?false:parent.keep(m,ps,r,...args),
    preserve:(m,ps,r,...args)=>lateSingleSalePenalty(m,ps,r)?false:parent.preserve?.(m,ps,r,...args),
    benchSalePenalty:lateSingleSalePenalty,
    installPurchaseGuards(m,ps){
      if(ps._sargonPairWindowInstalled)return;ps._sargonPairWindowInstalled=true;
      ps._sargonEarlyPairCanBuy=slot=>slot.kind!=='chess'||!latePairWindowVeto(m,ps,ps.gd.chess(slot.id));
      const buy=ps.buy,sell=ps.sell;
      ps.buy=function(index,...args){
        const slot=this.shop.slots[index];if(slot&&!slot.sold&&!this._sargonEarlyPairCanBuy(slot))return {ok:false,error:'LATE_UNPAIRED_FOREIGN'};
        const target=slot?.kind==='chess'?ps.gd.chess(slot.id):null;
        const before=target&&windowFamily(target)?{copies:own(ps,target).filter(p=>!ps.gd.isGolden(p.id)).length,
          merge:ps.completesChessMerge(slot.id),parentAllowed:parent.purchaseAllowed(m,ps,target)}:null;
        const result=buy.call(this,index,...args);
        if(result?.ok&&before)note(this,{phase:'buy',round:m.round,id:slot.id,name:target.name,...before});
        return result;
      };
      ps.sell=function(uid,...args){
        const p=this.find(uid)?.piece,penalty=p?lateSingleSalePenalty(m,this,p):0;
        const result=sell.call(this,uid,...args);
        if(result?.ok&&penalty)note(this,{phase:'sell-deprioritized-single',round:m.round,id:p.id,name:this.gd.chess(p.id).name,uid});
        return result;
      };
    }});
}
