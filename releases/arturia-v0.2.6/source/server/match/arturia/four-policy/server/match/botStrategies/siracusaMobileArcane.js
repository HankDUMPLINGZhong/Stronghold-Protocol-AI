// [ASSUMED] Owner's independent small-mobile-leader experiment over the confirmed 23/3 acquisition policy.
// No manual map/seed coordinates. Real generated layer triggers distinguish projects from mere bond tags.
import {routeLayerEngine} from './siracusaFocusedDraft.js';
import {bankRemainder} from '../botSavings.js';
import {pieceBonds} from '../../../../../bondsMeta.js';
const CORE='siracusaShip',SURTR='chess_char_5_07_a',AROMA='chess_char_4_10_a',TEXAS2='chess_char_4_16_a';
const PREFERRED_RAID=new Set(['chess_char_3_12_a','chess_char_4_04_a']);
const gdOf=(m,ps)=>ps.gd||m.gd,base=(gd,p)=>gd.baseIdOf(p.id??p.chessId),owned=(ps)=>ps.allChess();
export const mobileSmallLeader=m=>m.bossId==='boss_2'||m.bossId==='boss_5';
const has=(gd,ps,id)=>owned(ps).some(p=>base(gd,p)===id);
const external=(rec)=>rec&&!rec.bonds.includes(CORE)&&!rec.bonds.includes('investShip');
const engine=(gd,rec,bond)=>routeLayerEngine(gd,rec,[bond]);
function groups(gd,ps,predicate){const out=new Map();for(const p of owned(ps)){const rec=gd.chess(p.id);if(!predicate(rec))continue;
 const id=base(gd,p),a=out.get(id)||[];a.push(p);out.set(id,a);}return out;}
function raidRank(gd,rec){return PREFERRED_RAID.has(base(gd,rec))?100:(engine(gd,rec,'raidShip')?50:0)+(rec.tier||0);}
const arcaneRank=(gd,rec)=>(engine(gd,rec,'arcaneShip')?100:0)+(rec.tier||0)+(rec.isGolden?0.5:0);
function best(gd,ps,predicate,rank){return owned(ps).filter(p=>predicate(gd.chess(p.id))).sort((a,b)=>rank(gd,gd.chess(b.id))-rank(gd,gd.chess(a.id))||(gd.isGolden(b.id)?1:0)-(gd.isGolden(a.id)?1:0)||a.uid-b.uid)[0];}
export function mobileArcaneReserve(m,ps){const gd=gdOf(m,ps);return best(gd,ps,r=>external(r)&&r.bonds.includes('arcaneShip')&&base(gd,r)!==SURTR&&engine(gd,r,'arcaneShip'),arcaneRank);}
function raidReserve(m,ps){const gd=gdOf(m,ps);if(has(gd,ps,SURTR)&&has(gd,ps,TEXAS2))return null;
 return best(gd,ps,r=>external(r)&&r.bonds.includes('raidShip')&&base(gd,r)!==SURTR,raidRank);}
function projectAllowed(gd,ps,rec,predicate,rank,stacking){const id=base(gd,rec),existing=groups(gd,ps,predicate),same=existing.get(id)||[];
 if(same.length){if(same.some(p=>gd.isGolden(p.id)))return false;return stacking&&same.length<3;}
 if(!existing.size)return true;
 return [...existing.values()].every(xs=>xs.every(p=>!(p.items||[]).length)&&rank(gd,rec)>Math.max(...xs.map(p=>rank(gd,gd.chess(p.id)))));
}
export function mobileProjectAllowed(m,ps,rec){if(!mobileSmallLeader(m)||m.round===1||!external(rec))return true;
 const gd=gdOf(m,ps),id=base(gd,rec);if(id===SURTR)return true;
 if(rec.bonds.includes('raidShip')){
  if(has(gd,ps,SURTR)&&has(gd,ps,TEXAS2))return false;
  if(!projectAllowed(gd,ps,rec,r=>external(r)&&r.bonds.includes('raidShip')&&base(gd,r)!==SURTR,raidRank,engine(gd,rec,'raidShip')))return false;
 }
 if(rec.bonds.includes('arcaneShip')&&!rec.bonds.includes('raidShip')&&!has(gd,ps,SURTR)){
  if(!owned(ps).some(p=>base(gd,p)===AROMA&&gd.isGolden(p.id)))return false;
  if(!engine(gd,rec,'arcaneShip'))return false;
  if(!projectAllowed(gd,ps,rec,r=>external(r)&&r.bonds.includes('arcaneShip')&&base(gd,r)!==SURTR,arcaneRank,true))return false;
 }
 if(rec.bonds.includes('swiftShip')&&!rec.bonds.includes('raidShip')&&!rec.bonds.includes('arcaneShip')){
  if(!engine(gd,rec,'swiftShip'))return false;
  const rank=(_gd,r)=>(r.tier||0)+(r.isGolden?0.5:0);
  if(!projectAllowed(gd,ps,rec,r=>external(r)&&r.bonds.includes('swiftShip'),rank,true))return false;
 }
 return true;
}
function policyAllows(baseline,m,ps,rec,reward){const cb=reward?'rewardAllowed':'purchaseAllowed';
 if(baseline[cb]?.(m,ps,rec))return true;
 if(m.round===1||rec.bonds.includes('investShip'))return false;
 const gd=gdOf(m,ps);
 if(engine(gd,rec,'swiftShip')){const shadow=Object.assign(Object.create(ps),{_botRoute:{id:'siracusaShip:swift'}});if(baseline[cb]?.(m,shadow,rec))return true;}
 // One low-tier Raid bridge is the owner's explicit exception; safe level-two paid shopping still rolls for keys.
 return rec.bonds.includes('raidShip')&&(rec.tier||0)<=3&&(reward||ps.shop.level!==2||ps._botDraftSafety?.round!==m.round||!ps._botDraftSafety.safe);
}
function cleanup(m,ps){if(!mobileSmallLeader(m)||m.round===1)return;const gd=gdOf(m,ps),raid=raidReserve(m,ps),arcane=mobileArcaneReserve(m,ps);
 for(const p of [...owned(ps)]){const rec=gd.chess(p.id);if(!external(rec)||base(gd,p)===SURTR||(p.items||[]).length)continue;
  if(rec.bonds.includes('raidShip')&&(!raid||base(gd,p)!==base(gd,raid)))ps.sell(p.uid);
  else if(rec.bonds.includes('arcaneShip')&&!rec.bonds.includes('raidShip')&&arcane&&base(gd,p)!==base(gd,arcane))ps.sell(p.uid);
 }
}
const cache=new WeakMap();
export function withSiracusaMobileArcane(baseline){if(!cache.has(baseline))cache.set(baseline,Object.freeze({...baseline,
 finalFacing:(gd,p)=>p.kind==='chess'&&pieceBonds(gd,p).includes('raidShip')?'RIGHT':null,
 selectRoute(m,ps,counts){const old=baseline.selectRoute(m,ps,counts),gd=gdOf(m,ps);
  return mobileSmallLeader(m)&&m.opts?.botSiracusaArcaneWeight!==0&&['arcaneShip','raidShip'].every(id=>gd.bond(id)&&!gd.modeInactiveBonds.has(id))
   ?baseline.routes.find(r=>r.id==='siracusaShip:arcane-raid'):old;},
 purchaseAllowed:(m,ps,rec)=>mobileSmallLeader(m)?policyAllows(baseline,m,ps,rec,false)&&mobileProjectAllowed(m,ps,rec):baseline.purchaseAllowed(m,ps,rec),
 rewardAllowed:(m,ps,rec)=>mobileSmallLeader(m)?policyAllows(baseline,m,ps,rec,true)&&mobileProjectAllowed(m,ps,rec):baseline.rewardAllowed(m,ps,rec),
 criticalBuy:(m,ps,rec,plan)=>mobileSmallLeader(m)&&base(gdOf(m,ps),rec)===SURTR||baseline.criticalBuy(m,ps,rec,plan),
 importantBuy:(m,ps,rec)=>mobileSmallLeader(m)&&base(gdOf(m,ps),rec)===SURTR||baseline.importantBuy(m,ps,rec),
 buyBonus(m,ps,rec,plan,counts){const value=baseline.buyBonus(m,ps,rec,plan,counts);if(!mobileSmallLeader(m))return value;
  const gd=gdOf(m,ps);return value+(base(gd,rec)===SURTR?80:rec.bonds.includes('raidShip')&&PREFERRED_RAID.has(base(gd,rec))?25:0);},
 preserve(m,ps,rec){if(baseline.preserve(m,ps,rec))return true;if(!mobileSmallLeader(m))return false;
  return base(gdOf(m,ps),rec)===SURTR||[mobileArcaneReserve(m,ps),raidReserve(m,ps)].some(p=>p&&p.id===rec?.chessId);},
 shopLockAudit(m,ps){const old=baseline.shopLockAudit(m,ps);if(!mobileSmallLeader(m))return old;
  const arcane=mobileArcaneReserve(m,ps),raid=raidReserve(m,ps);return {...old,mobileArcane:{route:ps._botRoute?.id,swiftLayers:ps.layers.swiftShip||0,
   arcaneReserve:arcane?{uid:arcane.uid,id:arcane.id}:null,raidReserve:raid?{uid:raid.uid,id:raid.id}:null}};},
 bankRemainder(m,ps){if(!mobileSmallLeader(m))return baseline.bankRemainder(m,ps);if(m.round===2)return false;
  const bought=bankRemainder(m,ps,{itemAllowed:baseline.itemAllowed,chessAllowed:rec=>policyAllows(baseline,m,ps,rec,false)&&mobileProjectAllowed(m,ps,rec)
   &&!(external(rec)&&['arcaneShip','raidShip','swiftShip'].some(id=>rec.bonds.includes(id)))});cleanup(m,ps);return bought;},
 cleanupAcquisitions(m,ps){baseline.cleanupAcquisitions?.(m,ps);cleanup(m,ps);},
 afterPurchase(m,ps,slot,before){baseline.afterPurchase?.(m,ps,slot,before);cleanup(m,ps);},
}));return cache.get(baseline);}
