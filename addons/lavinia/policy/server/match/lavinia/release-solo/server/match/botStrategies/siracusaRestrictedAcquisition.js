// User's acquisition restrictions over compatible factor 1; experiment only, no gameplay changes.
// Applies from R1. Native Miracle members retain native priority and purchase eligibility.
import { routeLayerEngine } from './siracusaFocusedDraft.js';
const CORE='siracusaShip',MIRACLE='miraShip',THORNS='chess_char_5_15_a';
const WANTED=['swiftShip','investShip','arcaneShip','raidShip'];
export const LOW_REWARD_NAMES=Object.freeze(['深靛','瑕光','隐现','蒂比','深巡','艾丝黛尔','宴','波登可','雷蛇','刺玫','华法琳','跃跃','砾','惊蛰','野鬃']);
const named=new Set(LOW_REWARD_NAMES);
export const restrictedScope=(m,ps)=>m.difficulty==='ABYSS'&&((m.mode==='solo'&&m.isSolo&&m.order.length===1)||(m.mode==='coop'&&!m.isSolo&&[2,4].includes(m.order.length)))&&m.round>=1&&ps.bandId==='band_chiave'&&ps._botFocusId===CORE;
const native=r=>r?.bonds.includes(CORE),wanted=r=>native(r)||!named.has(r?.name)&&r?.bonds.some(b=>WANTED.includes(b));
export function otherSwiftEngine(ps){return ps.allChess().some(p=>ps.gd.baseIdOf(p.id)!==THORNS&&routeLayerEngine(ps.gd,ps.gd.chess(p.id),['swiftShip']));}
export function restrictedPaidAllowed(rec,ps){
 if(!rec)return false;
 if(native(rec))return true;
 if(named.has(rec.name))return false;
 if(ps.gd.baseIdOf(rec.chessId)===THORNS)return !otherSwiftEngine(ps);
 return !rec.bonds.includes(MIRACLE);
}
export function restrictedRewardPriority(rec){
 if(native(rec))return 500;
 if(named.has(rec.name))return 10;
 if(wanted(rec))return 300;
 if(rec.bonds.includes(MIRACLE))return 100;
 return 0;
}
export function restrictedRewardAllowed(ps,rec){
 if(native(rec)||named.has(rec.name)||!rec.bonds.includes(MIRACLE)||wanted(rec))return true;
 return !(ps.offers?.[0]?.slots||[]).some(s=>s?.kind==='chess'&&!s.sold&&wanted(ps.gd.chess(s.id)));
}
// Parent trade/parking hooks close over older recipes. Give their planners a filtered shop,
// preserving real indices and invoking all actual game actions with their real receiver.
export function restrictedPaidView(ps){return new Proxy(ps,{
 get(target,key){
  if(key==='shop')return new Proxy(target.shop,{get(shop,k){
   if(k==='slots')return shop.slots.map(s=>s?.kind==='chess'&&!s.sold&&!restrictedPaidAllowed(target.gd.chess(s.id),target)?null:s);
   const value=Reflect.get(shop,k,shop);return typeof value==='function'?value.bind(shop):value;
  }});
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }
});}
export function withRestrictedAcquisition(parent){
 const view=(m,ps)=>restrictedScope(m,ps)?restrictedPaidView(ps):ps;
 return Object.freeze({...parent,
  purchaseAllowed:(m,ps,rec)=>(!restrictedScope(m,ps)||restrictedPaidAllowed(rec,ps))&&parent.purchaseAllowed(m,ps,rec),
  importantBuy:(m,ps,rec)=>(!restrictedScope(m,ps)||restrictedPaidAllowed(rec,ps))&&parent.importantBuy(m,ps,rec),
  criticalBuy:(m,ps,rec,...args)=>(!restrictedScope(m,ps)||restrictedPaidAllowed(rec,ps))&&parent.criticalBuy(m,ps,rec,...args),
  beforeUpgrade:(m,ps,...args)=>parent.beforeUpgrade(m,view(m,ps),...args),
  trade:(m,ps,...args)=>parent.trade(m,view(m,ps),...args),
  bankRemainder:(m,ps,...args)=>parent.bankRemainder(m,view(m,ps),...args),
  rewardAllowed(m,ps,rec){
   if(restrictedScope(m,ps)&&ps.offers?.[0]?.source==='merge')return restrictedRewardAllowed(ps,rec);
   return parent.rewardAllowed(m,ps,rec);
  },
  rewardPriority(m,ps,slot){
   if(restrictedScope(m,ps)&&ps.offers?.[0]?.source==='merge'&&slot.kind==='chess')return restrictedRewardPriority(ps.gd.chess(slot.id));
   return parent.rewardPriority?.(m,ps,slot)||0;
  },
 });
}
