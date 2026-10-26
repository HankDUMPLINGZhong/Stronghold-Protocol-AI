// [ASSUMED] Independent companion purchases on the selected 27/7 composition.
// Reserve timing, R1–7 early window and one paid bridge are policy, not game rules.
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {isSwiftEngine} from './sargonSwift.js';
import {ids} from './sargonPepe.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const swift=(ps,p)=>pieceBonds(ps.gd,p).includes('swiftShip');
const cheap=r=>r.tier<=3&&r.bonds.includes('swiftShip');
const engine=(ps,p)=>isSwiftEngine(ps.gd,p)||base(ps,p)==='chess_char_6_19_a';
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');

export function companionDecision(parent,m,ps,mode){
  const owned=ps.allChess(),distinct=new Set(owned.filter(p=>swift(ps,p)).map(p=>base(ps,p)));
  const liveEngine=field(ps).some(p=>engine(ps,p));
  const early=mode==='reserve'&&m.round<=7&&distinct.size===0;
  const mainPrice=Math.max(...[ids.pepe,ids.passenger,ids.titi].map(id=>ps.gd.chessPrice(id)));
  const refresh=ps.shop.freeRefreshes>0?0:ps.gd.refreshPrice;
  const conversion=Math.max(parent.upgradeReserve(m,ps),refresh+mainPrice);
  // Even an unaffordable due upgrade banks its full price. The bridge never turns it into an affordable buy.
  const upgrade=ps.shop.level<parent.levelTarget(m,ps)?ps.shop.upgradePrice:0;
  const reserve=upgrade+conversion;
  const important=ps.shop.slots.flatMap(s=>{
    if(!s||s.sold||s.kind!=='chess')return [];
    const r=ps.gd.chess(s.id);
    return parent.purchaseAllowed(m,ps,r)&&parent.importantBuy(m,ps,r)?[s.id]:[];
  });
  const candidates=ps.shop.slots.flatMap((s,index)=>{
    if(!s||s.sold||s.kind!=='chess')return [];
    const r=ps.gd.chess(s.id),price=ps.priceOf(s);
    return cheap(r)&&!owned.some(p=>base(ps,p)===base(ps,r))&&price<=3
      ?[{index,id:s.id,name:r.name,price,tier:r.tier}]:[];
  }).sort((a,b)=>a.price-b.price||b.tier-a.tier||a.index-b.index);
  let reason='accepted';
  if(m.round>=m.gd.bossRound)reason='no-farming-rounds';
  else if(ps._sargonRound21Bridge)reason='one-paid-bridge-used';
  else if(distinct.size>=2||ps.bonds.swiftShip?.active)reason='partner-already-owned';
  else if(!liveEngine&&!early)reason='no-field-engine';
  else if(important.length)reason='visible-important-first';
  else if(!ps.hand.some(p=>!p))reason='no-free-hand-slot';
  else if(!candidates.length)reason='no-cheap-companion';
  else if(ps.funds-candidates[0].price<reserve)reason='upgrade-main-budget';
  return {allowed:reason==='accepted',reason,mode,round:m.round,level:ps.shop.level,funds:ps.funds,
    liveEngine,early,ownedSwift:[...distinct],upgrade,conversion,reserve,important,candidates};
}

export function createCompanionPolicy(parent,mode){
  const retained=(m,ps,r)=>ps._sargonRound21Bridge?.base===base(ps,r)&&m.round<m.gd.bossRound
    &&new Set(ps.allChess().filter(p=>swift(ps,p)).map(p=>base(ps,p))).size<=2;
  return Object.freeze({...parent,name:`27/7 Swift companion: ${mode}`,
    preparePurchases(m,ps,h){
      parent.preparePurchases?.(m,ps,h);
      const d=companionDecision(parent,m,ps,mode);
      // Log each distinct public-state gate, without affecting any RNG or selection.
      const key=JSON.stringify(d),seen=ps._sargonRound21Seen||=new Set();
      if(!seen.has(key)){seen.add(key);(ps._sargonFactorHistory||=[]).push({factor:'swift-companion-round21',phase:'gate',...d});}
      if(!d.allowed)return;
      const c=d.candidates[0],slot=ps.shop.slots[c.index],before=new Set(ps.allChess().map(p=>p.uid));
      const result=ps.buy(c.index);
      if(!result?.ok)return;
      const piece=ps.allChess().find(p=>!before.has(p.uid)&&base(ps,p)===ps.gd.baseIdOf(c.id));
      ps._sargonRound21Bridge={base:ps.gd.baseIdOf(c.id),uid:piece?.uid};
      parent.afterPurchase?.(m,ps,slot,before);
      (ps._sargonFactorHistory||=[]).push({factor:'swift-companion-round21',phase:'purchase',...d,
        chosen:c,uid:piece?.uid,fundsAfter:ps.funds});
    },
    purchaseAllowed:(m,ps,r)=>cheap(r)&&ps._sargonRound21Bridge?.base===base(ps,r)?false:parent.purchaseAllowed(m,ps,r),
    keep:(m,ps,r)=>parent.keep(m,ps,r)||retained(m,ps,r),
    preserve:(m,ps,r)=>parent.preserve(m,ps,r)||retained(m,ps,r)});
}
