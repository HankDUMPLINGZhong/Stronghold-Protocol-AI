// [ASSUMED] User-directed independent 28/13 purchase restriction, not a game rule.
// One physical low-tier Precision companion before the first recurring Precision engine; R1 is unchanged.
import {bankRemainder} from '../botSavings.js';
const PRECISION='preciShip',CORE='sargonShip',SWIFT='swiftShip';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
export const isPrecisionCompanion=r=>r.tier<4&&r.bonds.includes(PRECISION)
  &&!r.bonds.includes(CORE)&&!r.bonds.includes(SWIFT);

/** Native and donated recurring gains qualify. Attribute scaling and on-acquire layers do not. */
export function isRecurringPrecisionEngine(gd,r){
  if(r.tier<4||!r.bonds.includes(PRECISION))return false;
  const gs=(r.garrisonIds||[]).map(id=>gd.garrison(id)).filter(Boolean);
  const traits=gs.flatMap(g=>g.bbStr?.give_garrison_id?[g,gd.garrison(g.bbStr.give_garrison_id)]:[g]).filter(Boolean);
  return traits.some(g=>g.eventType==='IN_BATTLE'&&g.bb?.bond_add_count>0
      &&g.bbStr?.bond_id?.split(',').includes(PRECISION)
    ||['SERVER_PREP_START','SERVER_PREP_FIN','SERVER_REFRESH_SHOP'].includes(g.eventType)
      &&g.bb?.count>0&&(g.effectKey==='SERVER_ADD_BOND_CHESS_ALL'
        ||g.bbStr?.bond?.split(',').includes(PRECISION)));
}
function state(ps){return ps._sargonPrecision33||=( {engine:null,seen:new Set()} );}
function observeEngine(m,ps){
  const s=state(ps);if(s.engine)return s.engine;
  const engine=ps.allChess().find(p=>isRecurringPrecisionEngine(ps.gd,ps.gd.chess(p.id)));
  if(engine){s.engine={round:m.round,uid:engine.uid,id:engine.id,name:ps.gd.chess(engine.id).name};
    (ps._sargonFactorHistory||=[]).push({factor:'precision-one-companion-round33',phase:'engine-acquired',...s.engine});}
  return s.engine;
}
export function precisionCompanionDecision(m,ps,r){
  const engine=observeEngine(m,ps);
  const owned=ps.allChess().filter(p=>isPrecisionCompanion(ps.gd.chess(p.id)));
  const scoped=isPrecisionCompanion(r),reason=!scoped?'outside-companion-scope':m.round===1?'R1-opening-exception'
    :engine?'engine-already-acquired':owned.length?'one-companion-already-owned':'first-companion';
  return {allowed:reason!=='one-companion-already-owned',reason,engine,round:m.round,id:r.chessId??r.id,
    companions:owned.map(p=>({uid:p.uid,id:p.id,base:base(ps,p),name:ps.gd.chess(p.id).name}))};
}
export function createOnePrecisionCompanionPolicy(parent){
  const allowed=(m,ps,r)=>{
    if(!parent.purchaseAllowed(m,ps,r))return false;
    const d=precisionCompanionDecision(m,ps,r);
    if(isPrecisionCompanion(r)){
      const key=JSON.stringify(d),s=state(ps);
      if(!s.seen.has(key)){s.seen.add(key);(ps._sargonFactorHistory||=[]).push({factor:'precision-one-companion-round33',phase:'purchase-gate',...d});}
    }
    return d.allowed;
  };
  return Object.freeze({...parent,name:'28/13: one low-tier Precision companion before a recurring engine',
    purchaseAllowed:allowed,
    importantBuy:(m,ps,r)=>allowed(m,ps,r)&&parent.importantBuy(m,ps,r),
    preparePurchases(m,ps,h){observeEngine(m,ps);parent.preparePurchases?.(m,ps,h);observeEngine(m,ps);},
    cleanupAcquisitions(m,ps){parent.cleanupAcquisitions?.(m,ps);observeEngine(m,ps);},
    bankRemainder(m,ps){
      if(m.round===1||observeEngine(m,ps))return parent.bankRemainder(m,ps);
      // The inherited base callback closes over its old purchase predicate. Pass the new predicate explicitly.
      return bankRemainder(m,ps,{itemAllowed:parent.itemAllowed,chessAllowed:r=>allowed(m,ps,r)});
    }});
}
