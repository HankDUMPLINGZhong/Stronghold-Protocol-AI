// [ASSUMED] Independent tests on frozen 26/7. No new purchase budget, forecast trial or future-shop knowledge.
import { ids } from './sargonPepe.js';
const base=(ps,r)=>ps.gd.baseIdOf(r.id??r.chessId);
const papyri=ps=>ps.allChess().filter(p=>base(ps,p)===ids.papyrus);

export function createPapyrusResidentPolicy(parent){
  return Object.freeze({...parent,name:'26/7: retain one Papyrus as a resident healer',
    requiredLineupBases:(m,ps)=>papyri(ps).length?[ids.papyrus]:[],
    preserve(m,ps,r){
      const own=papyri(ps);
      return parent.preserve(m,ps,r)||base(ps,r)===ids.papyrus
        &&(own.length===1||ps.gd.isGolden(r.chessId??r.id));
    }});
}

/** Only current visible affordable operators already important to the retained policy. Pepe leads ties. */
export function visibleImportantOperators(parent,m,ps){
  const order=[ids.pepe,ids.passenger,ids.titi];
  return ps.shop.slots.flatMap((s,index)=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return [];
    const r=ps.gd.chess(s.id);
    if(parent.purchaseAllowed(m,ps,r)===false||!parent.importantBuy(m,ps,r))return [];
    const rank=order.indexOf(base(ps,r));
    return [{index,id:s.id,rank:rank<0?3:rank,merge:ps.completesChessMerge(s.id),tier:r.tier}];
  }).sort((a,b)=>a.rank-b.rank||Number(b.merge)-Number(a.merge)||b.tier-a.tier||a.index-b.index);
}
export function buyImportantOperators(parent,m,ps,h={}){
  for(let guard=0;guard<12;guard++){
    let pick=visibleImportantOperators(parent,m,ps)[0];if(!pick)return true;
    if(!ps.hand.some(p=>!p)&&!h.freePurchaseSlot?.())return false;
    // Freeing a slot can consume items or grant operators: re-read the legal purchase and price.
    pick=visibleImportantOperators(parent,m,ps)[0];if(!pick)return true;
    const funds=ps.funds;
    if(!ps.hand.some(p=>!p)||!ps.buy(pick.index)?.ok)return false;
    (ps._sargonFactorHistory||=[]).push({factor:'main-first',phase:'important-buy',round:m.round,
      id:pick.id,fundsBefore:funds,fundsAfter:ps.funds});
  }
  return !visibleImportantOperators(parent,m,ps).length;
}
export function createMainFirstPolicy(parent){
  const helpers=(m,ps,h)=>({...h,beforeMimicPurchase:()=>buyImportantOperators(parent,m,ps,h)});
  return Object.freeze({...parent,name:'26/7: current important operators before equipment, Pepe first',
    preparePurchases(m,ps,h={}){
      parent.preparePurchases(m,ps,helpers(m,ps,h));
    },
    onLevelUp(m,ps,h={}){parent.onLevelUp(m,ps,helpers(m,ps,h));},
    purchaseItemAllowed:(m,ps,r)=>!visibleImportantOperators(parent,m,ps).length&&parent.purchaseItemAllowed(m,ps,r),
    bankRemainder:(m,ps)=>!visibleImportantOperators(parent,m,ps).length&&parent.bankRemainder(m,ps)});
}
