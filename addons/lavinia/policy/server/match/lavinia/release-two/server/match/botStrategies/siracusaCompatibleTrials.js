import { withSiracusaPairRescue } from './siracusaPairRescue.js';
import { selectHuman84259 } from './siracusaHuman84259.js';
import { withRewardPairCompletion } from './siracusaRewardPairs.js';
import { withRestrictedAcquisition } from './siracusaRestrictedAcquisition.js';
// [ASSUMED] Three independent four-seat experiments from two human games, not gameplay rules.
// Only current own holdings/shop/offers and generated trait data. Never actual battle RNG or future stock.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { siracusa } from './siracusa.js';
import { routeLayerEngine, draftFrontline } from './siracusaFocusedDraft.js';
import { lateranoMergeOrder } from './lateranoMergeOrder.js';
const CORE='siracusaShip',GROWTH=['swiftShip','arcaneShip','raidShip'];
const SURTR='chess_char_5_07_a',TIN='chess_char_2_19_a',SWIRE='chess_char_3_04_a',THORNS='chess_char_5_15_a',MUMU='chess_char_6_11_a';
const KEYS=['chess_char_3_18_a','chess_char_4_10_a','chess_char_4_16_a','chess_char_5_20_a'];
const scope=(m,ps)=>m.difficulty==='ABYSS'&&((m.mode==='solo'&&m.isSolo&&m.order.length===1)||(m.mode==='coop'&&!m.isSolo&&[2,4].includes(m.order.length)))&&m.round>=2&&ps.bandId==='band_chiave'&&ps._botFocusId===CORE;
const tempoScope=(m,ps)=>scope(m,ps)&&m.round<=13;
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId),copies=(ps,id)=>ps.allChess().filter(p=>base(ps,p)===id);
const kinds=(ps,bond)=>new Set(ps.allChess().filter(p=>pieceBonds(ps.gd,p).includes(bond)).map(p=>base(ps,p)));
const native=rec=>rec.bonds.includes(CORE),normal=(ps,id)=>copies(ps,id).filter(p=>!ps.gd.isGolden(p.id));
const has=(ps,id)=>copies(ps,id).length>0,elite=(ps,id)=>copies(ps,id).some(p=>ps.gd.isGolden(p.id));
const need=(ps,rec)=>rec.upgradeNum||ps.gd.goldenCopies;
const log=(ps,row)=>{const xs=ps._botCompatibleHistory||=[];const key=JSON.stringify(row);if(xs.at(-1)?._key!==key)xs.push({...row,_key:key});};
const visible=(ps)=>ps.shop.slots.filter(s=>s?.kind==='chess'&&!s.sold);
const usefulNative=(ps,rec)=>native(rec)&&(!has(ps,base(ps,rec))||!elite(ps,base(ps,rec))||ps.completesChessMerge(rec.chessId));
const nativePressure=(ps)=>visible(ps).some(s=>ps.priceOf(s)<=ps.funds&&usefulNative(ps,ps.gd.chess(s.id)));
const stable=(ps,rec)=>routeLayerEngine(ps.gd,rec,GROWTH)&&(rec.garrisonIds||[]).some(id=>{
 const g=ps.gd.garrison(id);return g&&(['SERVER_PREP_FIN','SERVER_PREP_START','SERVER_REFRESH_SHOP','SERVER_GAIN'].includes(g.eventType)||g.effectKey==='act2autochess_gar_event_onstart');
});
const matchingNative=(ps,rec)=>GROWTH.some(b=>rec.bonds.includes(b)&&ps.allChess().some(p=>pieceBonds(ps.gd,p).includes(CORE)&&pieceBonds(ps.gd,p).includes(b)));
const foreignFor=(ps,b)=>new Set(ps.allChess().filter(p=>!pieceBonds(ps.gd,p).includes(CORE)&&pieceBonds(ps.gd,p).includes(b)).map(p=>base(ps,p)));

/** Visible complete bundle only; no sale, credit, expected gift or next shop used to meet the price. */
export function currentMergeBundle(parent,m,ps,rec){
 if(!scope(m,ps)||native(rec)||rec.isGolden||nativePressure(ps))return null;
 const id=base(ps,rec),held=normal(ps,id);if(!held.length||elite(ps,id))return null;
 if(!matchingNative(ps,rec)&&id!==SWIRE)return null;
 if(![TIN,SWIRE,THORNS,SURTR].includes(id)&&!stable(ps,rec))return null;
 const missing=need(ps,rec)-held.length;if(missing<=0)return null;
 const slots=visible(ps).filter(s=>base(ps,s)===id).sort((a,b)=>ps.priceOf(a)-ps.priceOf(b)).slice(0,missing);
 if(slots.length!==missing||ps.hand.filter(p=>!p).length<missing)return null;
 const cost=slots.reduce((s,x)=>s+ps.priceOf(x),0),reserve=Math.max(0,parent.spendReserve?.(m,ps)||0,parent.purchaseReserve?.(m,ps)||0);
 if(cost+reserve>ps.funds)return null;
 return {id,slots,cost,reserve,held:held.length};
}

export function compatiblePurchase(parent,m,ps,rec){
 if(!scope(m,ps))return parent.purchaseAllowed(m,ps,rec);
 if(native(rec))return parent.purchaseAllowed(m,ps,rec);
 // Preserve the retained one-time R3 missing-frontline exception before tightening optional helpers.
 if(m.round===3&&draftFrontline(rec)&&!ps.allChess().some(p=>draftFrontline(ps.gd.chess(p.id)))
  &&parent.purchaseAllowed(m,ps,rec))return true;
 if(nativePressure(ps))return false;
 const id=base(ps,rec),held=copies(ps,id);
 if(currentMergeBundle(parent,m,ps,rec))return true;
 if(held.length)return false;
 // No new low-tier off-core budget while a two-tier field is known to clear safely.
 if(ps.shop.level===2&&ps._botDraftSafety?.round===m.round&&ps._botDraftSafety.safe)return false;
 if(id===SURTR)return kinds(ps,CORE).size>=3&&matchingNative(ps,rec);
 if(rec.bonds.includes('investShip')){
  const investors=kinds(ps,'investShip');
  if(investors.size>=3)return false;
  if(investors.size===2&&m.round<=11)return true;
  if(id===TIN)return m.round<=8&&kinds(ps,'swiftShip').size===1&&matchingNative(ps,rec);
  return id===SWIRE&&m.round<=7&&kinds(ps,CORE).size<3&&ps.lp<=16;
 }
 if(rec.bonds.includes('miraShip')&&m.round<=9&&kinds(ps,'miraShip').size===1&&foreignFor(ps,'miraShip').size===0)return true;
 if(!stable(ps,rec)||!matchingNative(ps,rec))return false;
 // One off-core engine per matching family; a higher-tier direct replacement may compete on real lineup value.
 return GROWTH.some(b=>rec.bonds.includes(b)&&kinds(ps,b).size>=1&&(
  foreignFor(ps,b).size===0||rec.tier>=5&&[...foreignFor(ps,b)].every(id=>ps.gd.chess(id).tier<rec.tier)));
}

const asRoute=(plan,id)=>({...plan,route:siracusa.routes.find(r=>r.id===id)});
const swiftPlan=plan=>asRoute(plan,'siracusaShip:swift'),arcPlan=plan=>asRoute(plan,'siracusaShip:arcane-raid');
function withCompatible(parent){return Object.freeze({...parent,
 selectRoute(m,ps,counts){const r=parent.selectRoute(m,ps,counts);return scope(m,ps)&&r?{...r,supports:GROWTH}:r;},
 purchaseAllowed(m,ps,rec){const allowed=compatiblePurchase(parent,m,ps,rec);if(scope(m,ps)&&visible(ps).some(s=>s.id===rec.chessId))log(ps,{factor:'compatible',kind:'purchase-gate',round:m.round,id:rec.chessId,allowed});return allowed;},
 buyBonus(m,ps,rec,plan,counts){const old=parent.buyBonus(m,ps,rec,plan,counts);if(!scope(m,ps))return old;
  return old-siracusa.buyBonus(m,ps,rec,plan,counts)+Math.max(siracusa.buyBonus(m,ps,rec,swiftPlan(plan),counts),siracusa.buyBonus(m,ps,rec,arcPlan(plan),counts));},
 unitBonus(m,ps,rec,plan){const old=parent.unitBonus(m,ps,rec,plan);if(!scope(m,ps))return old;
  return old-siracusa.unitBonus(m,ps,rec,plan)+Math.max(siracusa.unitBonus(m,ps,rec,swiftPlan(plan)),siracusa.unitBonus(m,ps,rec,arcPlan(plan)));},
 lineupBonus(gd,pieces,bonds,plan){const old=parent.lineupBonus(gd,pieces,bonds,plan);if(!plan.ps||!scope(plan.ps.m,plan.ps))return old;
  const ids=new Set(pieces.map(p=>gd.baseIdOf(p.id))),pair=ids.has('chess_char_5_10_a')&&ids.has('chess_char_3_18_a');
  return old-siracusa.lineupBonus(gd,pieces,bonds,plan)+siracusa.lineupBonus(gd,pieces,bonds,arcPlan(plan))+(bonds.swiftShip?.active?12:0)+(pair?20:0);},
 keep(m,ps,rec,ctx){return parent.keep(m,ps,rec,ctx)||scope(m,ps)&&rec.bonds.includes('investShip')&&kinds(ps,'investShip').size===3;},
 trade(m,ps,ctx,h){if(scope(m,ps))for(const slot of visible(ps)){
  const bundle=currentMergeBundle(parent,m,ps,ps.gd.chess(slot.id));if(!bundle)continue;
  const beforeFunds=ps.funds;
  for(const s of bundle.slots){const before=new Set(ps.allChess().map(p=>p.uid));const index=ps.shop.slots.indexOf(s);
   if(index<0||!ps.buy(index)?.ok)throw Error('Validated current merge bundle failed');parent.afterPurchase?.(m,ps,s,before);}
  if(!elite(ps,bundle.id))throw Error('Current merge bundle did not produce elite');
  log(ps,{factor:'compatible',kind:'current-shop-merge',round:m.round,id:bundle.id,cost:bundle.cost,held:bundle.held,purchased:bundle.slots.length,beforeFunds,afterFunds:ps.funds});return true;
 }return parent.trade(m,ps,ctx,h);},
});}

export function currentRewardPriority(ps,rec,round){
 const id=base(ps,rec),n=normal(ps,id).length,hasElite=elite(ps,id);
 if(native(rec)){if(!has(ps,id))return 600+(id==='chess_char_6_18_a'?200:0);if(!hasElite)return 420+n*30;return id==='chess_char_3_18_a'&&ps.bonds.investShip?.active?200:20;}
 if(n+1>=need(ps,rec)&&!hasElite)return 280;
 if(id===SURTR&&!has(ps,id)&&matchingNative(ps,rec))return 360;
 if(rec.bonds.includes('investShip')&&!has(ps,id)&&kinds(ps,'investShip').size===2&&round<=11)return 320;
 if(id===MUMU){const dress=[...ps.hand,...ps.temp,...ps.allChess().flatMap(p=>p.items||[])].some(p=>p&&ps.gd.item(p.id)?.giveBondId===CORE);if(dress||has(ps,SURTR))return 300;}
 if(!has(ps,id)&&stable(ps,rec)&&matchingNative(ps,rec))return 240+(id===THORNS?10:0);
 if(!has(ps,id)&&rec.bonds.includes('miraShip')&&kinds(ps,'miraShip').size===1)return 180;
 return 0;
}
function withRewards(parent){return Object.freeze({...parent,
 rewardAllowed(m,ps,rec){return scope(m,ps)?!!rec:parent.rewardAllowed(m,ps,rec);},
 rewardPriority(m,ps,slot){const old=parent.rewardPriority?.(m,ps,slot)||0;if(!scope(m,ps)||slot.kind!=='chess')return old;
  const score=currentRewardPriority(ps,ps.gd.chess(slot.id),m.round);log(ps,{factor:'rewards',kind:'offer-score',round:m.round,id:slot.id,score});return old+score;},
});}

const keyPair=(ps)=>KEYS.filter(id=>!elite(ps,id)&&normal(ps,id).length>=2);
function upgradeKey(ps,rec){return usefulNative(ps,rec)||base(ps,rec)===SURTR&&!has(ps,SURTR);}
function withTempo(parent){let recipe;recipe=Object.freeze({...parent,
 levelTarget(m,ps,options){const old=parent.levelTarget(m,ps,options);if(!tempoScope(m,ps)||![4,5].includes(ps.shop.level)||old<=ps.shop.level||!keyPair(ps).length)return old;
  log(ps,{factor:'tempo',kind:'hold-key-pair',round:m.round,level:ps.shop.level,ids:keyPair(ps)});return ps.shop.level;},
 beforeUpgrade(m,ps,ctx){if(!tempoScope(m,ps))return parent.beforeUpgrade(m,ps,ctx);
  const key=visible(ps).find(s=>ps.priceOf(s)<=ps.funds&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id))&&upgradeKey(ps,ps.gd.chess(s.id)));
  if(key){log(ps,{factor:'tempo',kind:'visible-key-before-upgrade',round:m.round,level:ps.shop.level,id:key.id,funds:ps.funds});return false;}
  return parent.beforeUpgrade(m,ps,ctx);},
 importantBuy(m,ps,rec){return parent.importantBuy?.(m,ps,rec)||tempoScope(m,ps)&&upgradeKey(ps,rec);},
 upgradeMergeOrder(m,ps,h){if(!tempoScope(m,ps)||m.round<6||![2,3,4,5].includes(ps.shop.level))return parent.upgradeMergeOrder?.(m,ps,h);
  const result=lateranoMergeOrder(m,ps,parent,h.scoreReward,{publicTeammates:true,partialBundle:true});
  if(result)log(ps,{factor:'tempo',kind:'merge-upgrade-order',round:m.round,level:ps.shop.level,upgradeFirst:result.upgradeFirst,cost:result.cost,current:result.current,next:result.next});return result;},
});return recipe;}
const cache=new WeakMap();
export function selectCompatibleTrial(parent,m){
 // User-adopted solo boundary: preserve the complete original defense recipe through R3.
 // Explicit historical solo experiments keep their own parent; the false control restores old12.
 const solo=m.opts?.botSiracusaSoloR4Adopted&&m.mode==='solo'&&m.isSolo&&m.order.length===1
  &&m.difficulty==='ABYSS'&&m.round>=4&&!m.opts.botSiracusaSoloExperiment;
 const factor=m.opts?.botSiracusaCompatibleTrial ?? (solo||m.opts?.botSiracusaAcquisitionAdopted&&m.mode==='coop'&&!m.isSolo&&[2,4].includes(m.order.length)&&m.difficulty==='ABYSS'?'reward-pair':false);if(!factor)return parent;
 if(!['compatible','restricted','pair-rescue','reward-pair','rewards','tempo'].includes(factor))throw Error('Unknown compatible trial');
 let variants=cache.get(parent);if(!variants){variants=new Map();cache.set(parent,variants);}if(!variants.has(factor))variants.set(factor,({compatible:withCompatible,restricted:p=>withRestrictedAcquisition(withCompatible(p)),'pair-rescue':p=>withSiracusaPairRescue(withRestrictedAcquisition(withCompatible(p))),'reward-pair':p=>withSiracusaPairRescue(withRewardPairCompletion(withRestrictedAcquisition(withCompatible(p)))),rewards:withRewards,tempo:withTempo})[factor](parent));return selectHuman84259(variants.get(factor),m);
}
