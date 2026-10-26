// [ASSUMED] Only unconditional mimic acquisition is added to retained 24/6. Original gear and SP handling stay intact.
import { createTargetShopPolicy,mimicPairTarget,emergencyMimicTarget } from './sargonTargetShops.js';
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
const MIMIC='chess_item_5_05_e',isMimic=r=>(r.id??r.itemId??'').startsWith(MIMIC);
function layeringTrait(gd,id,seen=new Set()){
  if(seen.has(id))return false;seen.add(id);const g=gd.garrison(id);
  if(!g||g.eventType==='SERVER_GAIN')return false;
  if(g.bbStr?.give_garrison_id)return layeringTrait(gd,g.bbStr.give_garrison_id,seen);
  if(g.eventType==='IN_BATTLE')return g.effectType==='ADD_BOND'&&g.effectKey!=='ADD_BOND';
  return ['SERVER_PREP_START','SERVER_PREP_FIN','SERVER_REFRESH_SHOP'].includes(g.eventType)
    &&/^SERVER_ADD_/.test(g.effectKey)&&/BOND|LAYER/.test(g.effectKey);
}
export function mimicUseEligible(ps,p){
  const r=ps.gd.chess(p.id);
  return r.tier>=5&&pieceBonds(ps.gd,p).includes('sargonShip')
    ||r.tier>=4&&(r.garrisonIds||[]).some(id=>layeringTrait(ps.gd,id));
}
const pair=ps=>mimicPairTarget(ps,{eligible:p=>mimicUseEligible(ps,p)&&(!ps._sargonMimicDeployedOnly
  ||ps.gd.chess(p.id).tier>=5&&pieceBonds(ps.gd,p).includes('sargonShip')
  ||ps.allChess().some(q=>ps.gd.baseIdOf(q.id)===ps.gd.baseIdOf(p.id)&&ps.find(q.uid)?.area==='board'))});
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'mimic-always',...e});

export function useHeldMimics(m,ps){
  for(const it of [...ps.hand,...ps.temp]){
    if(it?.kind!=='item'||!it.id.startsWith(MIMIC)||!ps.find(it.uid))continue;
    const target=pair(ps)||emergencyMimicTarget(m,ps);if(!target)continue;
    const before={round:m.round,phase:'mimic-use',item:it.id,target:target.id,
      copies:ps.countCopies(ps.gd.baseIdOf(target.id)),emergency:!pair(ps)};
    if(ps.equip(it.uid,target.uid)?.ok)note(ps,before);
  }
}
export function buyVisibleMimics(m,ps,h={}){
  for(let guard=0;guard<4;guard++){
    let index=ps.shop.slots.findIndex(s=>s&&!s.sold&&s.kind==='item'&&s.id.startsWith(MIMIC)&&ps.priceOf(s)<=ps.funds);
    if(index<0)return;
    if(h.beforeMimicPurchase?.()===false)return;
    index=ps.shop.slots.findIndex(s=>s&&!s.sold&&s.kind==='item'&&s.id.startsWith(MIMIC)&&ps.priceOf(s)<=ps.funds);
    if(index<0)return;
    if(!ps.hand.some(p=>!p)&&!h.freePurchaseSlot?.())return;
    if(h.beforeMimicPurchase?.()===false)return;
    // Freeing a slot can consume items, grant operators and change the current price; re-read everything.
    index=ps.shop.slots.findIndex(s=>s&&!s.sold&&s.kind==='item'&&s.id.startsWith(MIMIC)&&ps.priceOf(s)<=ps.funds);
    if(index<0||!ps.hand.some(p=>!p))return;
    const slot=ps.shop.slots[index],price=ps.priceOf(slot),fundsBefore=ps.funds;
    const result=ps.buy(index);if(!result?.ok)return;
    note(ps,{phase:'mimic-buy',round:m.round,item:slot.id,price,fundsBefore,fundsAfter:ps.funds});
    useHeldMimics(m,ps);
  }
}
export function createMimicOnlyPolicy(parent){
  const risk=createTargetShopPolicy(parent);
  return Object.freeze({...parent,name:'Sargon always buys mimic, conditional use',
    purchaseItemAllowed:(m,ps,r)=>isMimic(r)||parent.purchaseItemAllowed(m,ps,r),
    itemBonus:(m,ps,r)=>parent.itemBonus(m,ps,r)+(isMimic(r)?24:0),
    importantItem:(m,ps,r)=>isMimic(r)||parent.importantItem?.(m,ps,r)===true,
    ownedItemTarget:(m,ps,r,owned)=>isMimic(r)?pair(ps)||emergencyMimicTarget(m,ps):parent.ownedItemTarget(m,ps,r,owned),
    holdItem:(m,ps,r)=>isMimic(r)?!(pair(ps)||emergencyMimicTarget(m,ps)):parent.holdItem(m,ps,r),
    protectItem:(m,ps,r)=>isMimic(r)||parent.protectItem(m,ps,r),
    preparePurchases:buyVisibleMimics,
    useEconomy(m,ps){parent.useEconomy(m,ps);useHeldMimics(m,ps);},
    onLevelUp(m,ps,h){parent.onLevelUp(m,ps,h);buyVisibleMimics(m,ps,h);},
    *shoppingSteps(m,ps,h){
      yield* risk.shoppingSteps(m,ps,{...h,mimicPairTarget:()=>pair(ps),
        equipItems:()=>{useHeldMimics(m,ps);h.equipItems();}});
      useHeldMimics(m,ps);
    },
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      note(ps,{phase:'mimic-end',round:m.round,held:[...ps.hand,...ps.temp].filter(p=>p?.kind==='item'&&p.id.startsWith(MIMIC)).map(p=>p.id)});
    }});
}
