// [ASSUMED] Three independent children of frozen 26/8. Shop funds, real inventory and paired normal-wave safety only.
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { ids } from './sargonPepe.js';
import { swiftIds } from './sargonSwift.js';
import { swiftEngineRate } from './sargonSwift24Baseline.js';
export const DEGEN='chess_char_6_19_a';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId),field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const nymph=(ps,r)=>[swiftIds.nymph,swiftIds.nymphHidden].includes(base(ps,r));
const main=new Set([ids.passenger,ids.pepe,ids.titi,ids.gavial4,ids.gavial5,ids.philae]);
const own=(ps,r)=>ps.allChess().filter(p=>base(ps,p)===base(ps,r));
const has=(ps,p,b)=>pieceBonds(ps.gd,p).includes(b);
function audit(ps,e){const key=JSON.stringify(e),seen=ps._sargonRound14Seen||=new Set();
  if(!seen.has(key)){seen.add(key);(ps._sargonFactorHistory||=[]).push({factor:'swift-round14',...e});}}

/** Fixed six-first spending. A short, efficient investment need not itself reach 40 to be worth comparing. */
export function efficientNymphDecision(parent,m,ps,r){
  const copies=own(ps,r),remaining=Math.max(0,m.gd.bossRound-m.round);
  const slot=ps.shop.slots.find(s=>s&&!s.sold&&s.kind==='chess'&&s.id===r.chessId),price=slot?ps.priceOf(slot):r.price;
  const rate=swiftEngineRate(ps,r),reserve=Math.max(parent.upgradeReserve(m,ps),ps.gd.refreshPrice+
    Math.max(...[ids.passenger,ids.pepe,ids.titi].map(id=>ps.gd.chess(id).price)));
  let reason='accepted';
  if(copies.some(p=>ps.gd.isGolden(p.id)))reason='already-elite';
  else if(copies.length===1)reason='no-new-paid-pair';
  else if(ps.shop.level<6)reason='six-first';
  else if(remaining<1)reason='no-normal-wave';
  else if(new Set(ps.allChess().filter(p=>has(ps,p,'sargonShip')).map(p=>base(ps,p))).size+(ps.bondCountBonus?.sargonShip||0)<6)reason='core-six-first';
  else if(!ps.allChess().some(p=>ps.gd.isGolden(p.id)&&[ids.philae,ids.gavial4,ids.gavial5].includes(base(ps,p))))reason='elite-front-first';
  else if((m.lastResults?.get(ps.playerId)?.leaked||[]).some(l=>l.counted!==false))reason='repair-leaks-first';
  else if(!field(ps).some(p=>has(ps,p,'swiftShip')&&base(ps,p)!==base(ps,r))&&(ps.bondCountBonus?.swiftShip||0)<1)reason='no-live-partner';
  else if(rate<8||rate*remaining<10)reason='low-efficiency';
  else if(ps.funds-price<reserve)reason='main-refresh-reserve';
  else if(ps.shop.slots.some(s=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return false;
    const c=ps.gd.chess(s.id);return c.bonds.includes('sargonShip')&&main.has(base(ps,c))
      &&(!own(ps,c).length||ps.completesChessMerge(s.id));
  }))reason='visible-core-first';
  return {allowed:reason==='accepted',reason,remaining,rate,price,reserve,level:ps.shop.level,funds:ps.funds};
}
export function createEfficientNymphPolicy(parent){
  const allowed=(m,ps,r)=>{
    if(!nymph(ps,r)||parent.purchaseAllowed(m,ps,r))return parent.purchaseAllowed(m,ps,r);
    const d=efficientNymphDecision(parent,m,ps,r);audit(ps,{phase:'nymph-gate',round:m.round,id:r.chessId,...d});return d.allowed;
  };
  return Object.freeze({...parent,name:'26/8: efficient Nymph after six, protected main budget',purchaseAllowed:allowed,
    importantBuy:(m,ps,r)=>parent.importantBuy(m,ps,r)||nymph(ps,r)&&!own(ps,r).length&&allowed(m,ps,r)});
}

/** An owned combination's real hand count after withdrawal; no new purchase or future rewards assumed. */
export function portfolioSwiftRate(ps,lineup){
  const selected=new Set(lineup.map(p=>p.uid)),handCount=ps.hand.filter(p=>p?.kind==='chess'&&!selected.has(p.uid)).length
    +field(ps).filter(p=>!selected.has(p.uid)).length;
  return lineup.filter(p=>has(ps,p,'swiftShip')).reduce((n,p)=>n+swiftEngineRate(ps,ps.gd.chess(p.id),{handCount}),0);
}
export function chooseGrowthPortfolio(m,ps,rows,inherited){
  if(!m.wave||m.round>=m.gd.bossRound||(ps.layers.swiftShip||0)>=40)return inherited;
  const candidates=rows.filter(p=>p.swift>=2&&p.precision>=2&&p.lineup.some(p=>base(ps,p)===ids.leonhardt)
    &&p.lineup.some(p=>nymph(ps,p)));
  if(!candidates.length)return inherited;
  candidates.sort((a,b)=>portfolioSwiftRate(ps,b.lineup)-portfolioSwiftRate(ps,a.lineup)||b.score-a.score||a.signature.localeCompare(b.signature));
  const best=candidates[0];
  if(best!==inherited)audit(ps,{phase:'growth-portfolio',round:m.round,rate:portfolioSwiftRate(ps,best.lineup),
    beforeRate:inherited?portfolioSwiftRate(ps,inherited.lineup):null,roster:best.lineup.map(p=>p.id)});
  return best;
}
export function createGrowthPortfolioPolicy(parent){return Object.freeze({...parent,
  name:'26/8: offer owned Leo and Nymph together below 40',growthPortfolio:chooseGrowthPortfolio});}

/** Degen's garrison155 gains on real deployments; battle results already contain its actual gains, never the 24 cap as a promise. */
export function createDegenPolicy(parent){
  const isDegen=(ps,r)=>base(ps,r)===DEGEN;
  return Object.freeze({...parent,name:'26/8: recognize owned Degen as a recurring Swift engine',
    swiftExtraEngine:(gd,p)=>gd.baseIdOf(p.id??p.chessId)===DEGEN,
    keep:(m,ps,r)=>parent.keep(m,ps,r)||isDegen(ps,r)&&m.round<=m.gd.bossRound,
    preserve:(m,ps,r)=>parent.preserve(m,ps,r)||isDegen(ps,r)&&own(ps,r).length===1&&m.round<=m.gd.bossRound});
}
