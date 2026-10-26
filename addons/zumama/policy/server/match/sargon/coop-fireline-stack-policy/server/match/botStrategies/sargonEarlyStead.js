// [ASSUMED] Independent opening allowances: one foreign Stead with Bubble, or two distinct foreign Stead.
// Only additional purchase permissions and temporary keeping change; original exceptions remain inherited.
import {ids} from './sargonPepe.js';
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {companionSpendingReserve} from './sargonCompanionBudget.js';
const foreign=r=>r.bonds.includes('steadShip')&&!r.bonds.includes('sargonShip');
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const modeOf=m=>m.opts.botSargonEarlyStead||'standard';
const capOf=mode=>mode==='one'?1:['two','dynamic'].includes(mode)?2:0;
const nativeTypesOf=ps=>new Set(ps.allChess().filter(p=>pieceBonds(ps.gd,p).includes('sargonShip')).map(p=>base(ps,p))).size;
export function earlySteadDecision(parent,m,ps,r){
  const mode=modeOf(m),cap=capOf(mode),owned=ps.allChess(),id=base(ps,r);
  const actualForeign=owned.filter(p=>{const b=pieceBonds(ps.gd,p);return b.includes('steadShip')&&!b.includes('sargonShip');});
  const ownedTypes=new Set(actualForeign.map(p=>base(ps,p))),paidTypes=new Set(ps._sargonEarlySteadPaid||[]);
  let reason='accepted',budget,price;
  if(!cap||m.isSolo||m.opts.botSargonCoopSeat!==ps.playerId)reason='inactive';
  else if(m.round>7||ps.shop.level>=4)reason='past-opening';
  else if(!foreign(r))reason='not-foreign-stead';
  else if(owned.some(p=>base(ps,p)===id)||paidTypes.has(id))reason='no-new-pairs';
  else if(ownedTypes.size>=cap||paidTypes.size>=cap)reason='foreign-cap';
  else if(mode==='dynamic'&&ownedTypes.size!==1)reason='needs-held-foreign';
  else if(mode==='dynamic'&&nativeTypesOf(ps)>=4)reason='native-progress-first';
  else if(mode==='one'&&!owned.some(p=>base(ps,p)===ids.bubble))reason='no-bubble';
  else{
    const slot=ps.shop.slots.find(s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)===id);
    if(!slot)reason='not-in-shop';
    else{price=ps.priceOf(slot);budget=companionSpendingReserve(m,ps,parent,0);
      if(ps.funds-price<budget.reserve)reason='upgrade-main-budget';
    }
  }
  return {allowed:reason==='accepted',reason,mode,cap,round:m.round,level:ps.shop.level,id,price,budget,ownedTypes:[...ownedTypes],paidTypes:[...paidTypes]};
}
export function createEarlySteadPolicy(parent){
  return Object.freeze({...parent,
    purchaseAllowed:(m,ps,r)=>parent.purchaseAllowed(m,ps,r)||earlySteadDecision(parent,m,ps,r).allowed,
    keep:(m,ps,r)=>parent.keep(m,ps,r)||capOf(modeOf(m))>0&&m.round<=7&&ps.shop.level<4&&foreign(r)
      &&(['two','dynamic'].includes(modeOf(m))||ps.allChess().some(p=>base(ps,p)===ids.bubble)),
    afterPurchase(m,ps,slot,before){
      parent.afterPurchase?.(m,ps,slot,before);
      if(!capOf(modeOf(m))||m.round>7||slot.kind!=='chess')return;
      const r=ps.gd.chess(slot.id);if(!foreign(r))return;
      const paid=new Set(ps._sargonEarlySteadPaid||[]);paid.add(base(ps,r));ps._sargonEarlySteadPaid=[...paid];
      (ps._sargonFactorHistory||=[]).push({factor:'early-stead',phase:'purchase',mode:modeOf(m),round:m.round,id:slot.id,name:r.name,
        fundsAfter:ps.funds,paidTypes:[...paid],gained:ps.allChess().filter(p=>!before.has(p.uid)).map(p=>({uid:p.uid,id:p.id}))});
    }});
}
