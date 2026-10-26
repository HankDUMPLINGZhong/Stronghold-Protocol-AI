// [ASSUMED] User-requested purchase ablation on frozen 26/8: a live Swift partner and a 40-layer projection,
// with visible important operators first. The parent's level schedule, shopping and formation search stay inherited.
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {rotateOffset} from '../../../../../../../../../../../sim/dir.js';
import {swiftIds,isSwiftEngine} from './sargonSwift.js';
import {swiftEngineRate} from './sargonSwift24Baseline.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const optionalIds=new Set([swiftIds.nymph,swiftIds.nymphHidden,swiftIds.thorns]);
const optional=(ps,r)=>optionalIds.has(base(ps,r));
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const swift=(ps,p)=>pieceBonds(ps.gd,p).includes('swiftShip');
function deployedRate(ps,p){
  const key=ps.find(p.uid)?.key;if(!key)return 0;
  const [r,c]=key.split(',').map(Number),[dr,dc]=rotateOffset(0,1,p.dir||'RIGHT');
  return swiftEngineRate(ps,ps.gd.chess(p.id),{target:ps.board.get(`${r+dr},${c+dc}`)});
}
export function twoLimitSwiftDecision(parent,m,ps,r){
  const id=base(ps,r),remaining=Math.max(0,m.gd.bossRound-m.round);
  const board=field(ps),partners=board.filter(p=>swift(ps,p)&&base(ps,p)!==id);
  const rate=swiftEngineRate(ps,r),currentRate=partners.filter(p=>isSwiftEngine(ps.gd,p)).reduce((n,p)=>n+deployedRate(ps,p),0);
  // Same public-state projection as the baseline: current inventory and directions, without hypothetical shops or battle caps.
  const projected=(ps.layers.swiftShip||0)+(rate+currentRate)*remaining;
  const important=ps.shop.slots.flatMap(s=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return [];
    const c=ps.gd.chess(s.id);
    return !optional(ps,c)&&parent.purchaseAllowed(m,ps,c)&&parent.importantBuy(m,ps,c)?[s.id]:[];
  });
  let reason='accepted';
  // Normal elite deduplication is shared by the underlying strategy; there is no optional-engine pair veto.
  if(ps.allChess().some(p=>base(ps,p)===id&&ps.gd.isGolden(p.id)))reason='already-elite';
  else if(!partners.length)reason='no-live-partner';
  else if(projected<40)reason='insufficient-growth-window';
  else if(important.length)reason='visible-important-first';
  return {allowed:reason==='accepted',reason,remaining,rate,currentRate,projected,important,
    level:ps.shop.level,funds:ps.funds,core:ps.bonds.sargonShip?.count||0};
}
export function createTwoLimitSwiftPolicy(parent){
  const allowed=(m,ps,r)=>{
    if(!optional(ps,r))return parent.purchaseAllowed(m,ps,r);
    const d=twoLimitSwiftDecision(parent,m,ps,r),event={factor:'swift-round15',phase:'purchase-gate',round:m.round,id:r.chessId,...d};
    const key=JSON.stringify(event),seen=ps._sargonRound15Seen||=new Set();
    if(!seen.has(key)){seen.add(key);(ps._sargonFactorHistory||=[]).push(event);}
    return d.allowed;
  };
  return Object.freeze({...parent,name:'26/8: Swift purchases with only partner, growth and main priority',purchaseAllowed:allowed,
    importantBuy:(m,ps,r)=>optional(ps,r)?allowed(m,ps,r):parent.importantBuy(m,ps,r)});
}
