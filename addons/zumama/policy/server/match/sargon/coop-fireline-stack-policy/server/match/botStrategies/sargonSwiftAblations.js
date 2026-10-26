// [ASSUMED] Separate final conversion from optional growth investments; retain the frozen round-4 policy.
// Rates come from garrisons, budgets/windows are AI policy. No future shops or settlement writes.
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { rotateOffset } from '../../../../../../../../../../../sim/dir.js';
import { ids } from './sargonPepe.js';
import { createSwiftPolicy, isSwiftEngine, swiftIds } from './sargonSwift.js';

const CORE='sargonShip',SWIFT='swiftShip';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const own=(ps,r)=>ps.allChess().filter(p=>base(ps,p)===base(ps,r));
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const has=(ps,p,b)=>pieceBonds(ps.gd,p).includes(b);
const nymph=(ps,r)=>[swiftIds.nymph,swiftIds.nymphHidden].includes(base(ps,r));
const optional=(ps,r)=>base(ps,r)===swiftIds.thorns||nymph(ps,r);
const coreEngines=new Set([ids.philae,ids.gavial4,ids.gavial5,ids.titi,ids.passenger,ids.pepe]);
export const swiftGrowthReady=(m,ps)=>ps.shop.level>=6&&m.round<m.gd.bossRound
  &&ps.lp>m.gd.lpCapPerRound+4
  &&!(m.lastResults?.get(ps.playerId)?.leaked||[]).some(l=>l.counted!==false)
  &&ps.allChess().some(p=>ps.gd.isGolden(p.id)&&[ids.philae,ids.gavial4,ids.gavial5].includes(base(ps,p)));

/** Actual directional contribution, not "Thorns always doubles Swift". Nymph uses the current real hand. */
export function swiftEngineRate(ps,r,{handCount=ps.hand.filter(p=>p?.kind==='chess').length,target=null}={}){
  let n=0;
  for(const gid of r.garrisonIds||[]){const g=ps.gd.garrison(gid);
    if(g?.eventType!=='SERVER_PREP_FIN')continue;
    if(g.effectKey==='SERVER_ADD_BOND_CHESS_ALL'&&r.bonds.includes(SWIFT))n+=g.bb.count;
    if(g.effectKey==='SERVER_ADD_BOND_METHOD'&&g.bbStr.bond===SWIFT&&g.bbStr.add_method==='hand_count')n+=g.bb.multi*handCount;
    if(g.effectKey==='SERVER_ADD_BOND_POSITION')n+=g.bb.count*(1+Number(!!target&&has(ps,target,SWIFT)));
  }
  return n;
}
function deployedRate(ps,p){
  const loc=ps.find(p.uid),[r,c]=loc.key.split(',').map(Number),[dr,dc]=rotateOffset(0,1,p.dir||'RIGHT');
  return swiftEngineRate(ps,ps.gd.chess(p.id),{target:ps.board.get(`${r+dr},${c+dc}`)});
}

export function tightSwiftDecision(m,ps,r,parent){
  const copies=own(ps,r),id=base(ps,r),priceSlot=ps.shop.slots.find(s=>s&&!s.sold&&s.kind==='chess'&&s.id===r.chessId);
  const price=priceSlot?ps.priceOf(priceSlot):r.price;
  const rate=swiftEngineRate(ps,r),remaining=Math.max(0,m.gd.bossRound-m.round);
  const currentRate=field(ps).filter(p=>isSwiftEngine(ps.gd,p)&&base(ps,p)!==id).reduce((n,p)=>n+deployedRate(ps,p),0);
  const projected=(ps.layers.swiftShip||0)+(rate+currentRate)*remaining;
  const mainPrice=Math.max(...[ids.passenger,ids.pepe,ids.titi].map(id=>ps.gd.chess(id).price));
  const reserve=Math.max(parent.upgradeReserve(m,ps),1+mainPrice);
  let reason='accepted';
  if(copies.some(p=>ps.gd.isGolden(p.id)))reason='already-elite';
  else if(copies.length===1)reason='no-new-paid-pair';
  else if(ps.shop.level<6)reason='six-first';
  else if(remaining<3)reason='late-growth';
  else if(new Set(ps.allChess().filter(p=>has(ps,p,CORE)).map(p=>base(ps,p))).size+(ps.bondCountBonus?.[CORE]||0)<6)reason='core-six-first';
  else if(!ps.allChess().some(p=>ps.gd.isGolden(p.id)&&[ids.philae,ids.gavial4,ids.gavial5].includes(base(ps,p))))reason='elite-front-first';
  else if(ps.lp<=m.gd.lpCapPerRound+4)reason='low-lp';
  else if((m.lastResults?.get(ps.playerId)?.leaked||[]).some(l=>l.counted!==false))reason='repair-leaks-first';
  else if(!field(ps).some(p=>has(ps,p,SWIFT)&&base(ps,p)!==id)&&(ps.bondCountBonus?.swiftShip||0)<1)reason='no-live-partner';
  else if(nymph(ps,r)&&rate<=4)reason='thin-hand';
  else if(projected<40)reason='insufficient-growth-window';
  else if(ps.funds-price<reserve)reason='main-refresh-reserve';
  else if(ps.shop.slots.some(s=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return false;
    const c=ps.gd.chess(s.id);return c.bonds.includes(CORE)&&coreEngines.has(base(ps,c))
      &&!own(ps,c).some(p=>ps.gd.isGolden(p.id));
  }))reason='visible-core-first';
  return {allowed:reason==='accepted',reason,price,rate,currentRate,remaining,projected,reserve,level:ps.shop.level,funds:ps.funds};
}
function audit(m,ps,r,decision){
  // Shopping predicates can run repeatedly; retain only distinct public state/offer decisions.
  const key=JSON.stringify([m.round,r.chessId,decision]);
  const seen=ps._sargonTightChecks||=new Set();if(seen.has(key))return;seen.add(key);
  (ps._sargonFactorHistory||=[]).push({factor:'swift-gate',phase:'purchase-gate',round:m.round,id:r.chessId,...decision});
}
export function rateTransferTarget(m,ps,r,owned){
  const gd=ps.gd,signature=it=>['sargonShip','preciShip'].includes(it?.giveBondId);
  if(!r.canGiveBond&&!signature(r))return undefined;
  const bag=ps.hand.filter(p=>p?.kind==='item').map(p=>gd.item(p.id));
  const candidates=owned.filter(p=>isSwiftEngine(gd,p)).filter(p=>{
    const worn=(p.items||[]).map(i=>gd.item(i.id)),needed=r.canGiveBond?[...worn,...bag].find(i=>signature(i)&&!has(ps,p,i.giveBondId))
      :!has(ps,p,r.giveBondId)&&[...worn,...bag].find(i=>i.canGiveBond);
    return needed&&(p.items?.length||0)+(worn.includes(needed)?1:2)<=gd.equipPerChess;
  });
  const score=p=>Number(ps.find(p.uid)?.area==='board')*100+Number(has(ps,p,'preciShip'))*15
    +swiftEngineRate(ps,gd.chess(p.id));
  candidates.sort((a,b)=>score(b)-score(a)||a.uid-b.uid);
  // No real pair: inherit normal equipment handling instead of occupying a bench slot with a speculative ball.
  return candidates[0];
}
function transferHooks(parent){
  return {
    ownedItemTarget(m,ps,r,owned){const target=rateTransferTarget(m,ps,r,owned);return target===undefined?parent.ownedItemTarget(m,ps,r,owned):target;},
    purchaseItemAllowed:(m,ps,r)=>parent.purchaseItemAllowed(m,ps,r)||rateTransferTarget(m,ps,r,ps.allChess())!=null,
    itemBonus:(m,ps,r)=>parent.itemBonus(m,ps,r)+(rateTransferTarget(m,ps,r,ps.allChess())?18:0)
  };
}

/** Normal acquisitions, unit scores and growth search are inherited verbatim; only real transfers and final options. */
export function createFinalSwiftPolicy(parent,finalBoardSteps){
  const finalAlternative=(m,ps,r)=>m.round===m.gd.bossRound&&isSwiftEngine(ps.gd,r)&&own(ps,r).length===1
    &&new Set(ps.allChess().filter(p=>has(ps,p,SWIFT)).map(p=>base(ps,p))).size+(ps.bondCountBonus?.swiftShip||0)>=2;
  return Object.freeze({...parent,name:'Sargon final dual routes and real transfer compression',finalBoardSteps,...transferHooks(parent),
    keep:(m,ps,r)=>parent.keep(m,ps,r)||finalAlternative(m,ps,r),
    preserve:(m,ps,r)=>parent.preserve(m,ps,r)||finalAlternative(m,ps,r)});
}

/** Full growth branch with explicit core-first spending and rate-corrected engines. */
export function createTightSwiftPolicy(parent,finalBoardSteps){
  const growth=createSwiftPolicy(parent,finalBoardSteps);
  const allowed=(m,ps,r)=>{
    if(!optional(ps,r))return parent.purchaseAllowed(m,ps,r);
    const decision=tightSwiftDecision(m,ps,r,parent);audit(m,ps,r,decision);return decision.allowed;
  };
  const final=createFinalSwiftPolicy(parent,finalBoardSteps);
  return Object.freeze({...growth,...transferHooks(parent),name:'Sargon gated Swift development',layoutPlayerContext:true,
    purchaseAllowed:allowed,
    buyBonus(m,ps,r){return parent.buyBonus(m,ps,r)+(swiftGrowthReady(m,ps)&&m.gd.bossRound-m.round>=3
      &&!own(ps,r).length&&isSwiftEngine(ps.gd,r)?Math.min(48,swiftEngineRate(ps,r)*4):0);},
    unitBonus(m,ps,r){return parent.unitBonus(m,ps,r)+(isSwiftEngine(ps.gd,r)&&swiftGrowthReady(m,ps)?Math.min(24,swiftEngineRate(ps,r)*2):0);},
    lineupBonus(gd,pieces,bonds,ctx){return swiftGrowthReady(ctx.ps.m,ctx.ps)?growth.lineupBonus(gd,pieces,bonds,ctx):parent.lineupBonus(gd,pieces,bonds,ctx);},
    layoutValue(gd,units,plan,bonds,model){return swiftGrowthReady(plan.ps.m,plan.ps)?growth.layoutValue(gd,units,plan,bonds,model):parent.layoutValue(gd,units,plan,bonds,model);},
    keep:(m,ps,r)=>swiftGrowthReady(m,ps)?growth.keep(m,ps,r):final.keep(m,ps,r),
    preserve:(m,ps,r)=>swiftGrowthReady(m,ps)?growth.preserve(m,ps,r):final.preserve(m,ps,r),
    importantBuy:(m,ps,r)=>parent.importantBuy(m,ps,r)||swiftGrowthReady(m,ps)&&m.gd.bossRound-m.round>=3
      &&isSwiftEngine(ps.gd,r)&&!own(ps,r).length&&allowed(m,ps,r)
  });
}
