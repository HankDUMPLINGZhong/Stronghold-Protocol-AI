// [ASSUMED] User-directed ABYSS child of 28/8; HARD dispatches to the frozen parent without extra actions.
// One prep only, fixed initial targets, no extension for newly formed pairs and no new window at R14.
import {createRestrainedPairPolicy,waitingPairs} from './sargonPairWait.js';
import {createMainFirstPolicy,buyImportantOperators} from './sargonRound12.js';
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'abyss-pair-window',...e});
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
export function abyssItemAllowed(parent,m,ps,r){
  const effects=new Set((r.buffs||[]).map(b=>b.key));
  if(base(ps,r)==='chess_item_3_12_e_a')return false; // No paid random-return piggy banks.
  if(effects.has('gain_coin_when_round_start')&&(m.round>8||ps.shop.level>=5))return false;
  return parent.purchaseItemAllowed(m,ps,r);
}
export function buyWindowThirds(parent,m,ps,h={}){
  if(ps.shop.level!==5)return;
  // Core shopping first, with the same second-copy restrictions. The helper only buys real visible cards.
  buyImportantOperators(parent,m,ps,h);
  for(let guard=0;guard<12;guard++){
    const offers=ps.shop.slots.flatMap((s,index)=>{
      if(!s||s.sold||s.kind!=='chess'||ps.gd.isGolden(s.id)||!ps.completesChessMerge(s.id)
        ||ps.allChess().some(p=>base(ps,p)===base(ps,s)&&ps.gd.isGolden(p.id)))return [];
      return [{index,id:s.id,name:ps.gd.chess(s.id).name,price:ps.priceOf(s),tier:ps.gd.chess(s.id).tier}];
    }).filter(s=>s.price<=ps.funds).sort((a,b)=>b.tier-a.tier||a.index-b.index);
    const pick=offers[0];if(!pick)return;
    const state=ps._sargonAbyssPairWindow,expired=state&&(state.closed||m.round>state.opened);
    const budget=Math.max(0,ps.shop.upgradePrice)+parent.upgradeReserve(m,ps);
    if((expired||m.round>=m.gd.bossRound)&&parent.priorityLevel(m,ps)&&ps.funds>=budget&&ps.funds-pick.price<budget){
      note(ps,{phase:'third-budget',round:m.round,...pick,funds:ps.funds,budget});return;
    }
    if(!ps.hand.some(p=>!p)&&!h.freePurchaseSlot?.())return;
    const slot=ps.shop.slots[pick.index];
    if(!slot||slot.sold||slot.id!==pick.id||ps.priceOf(slot)>ps.funds||!ps.completesChessMerge(slot.id))continue;
    const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
    if(!ps.buy(pick.index)?.ok)return;
    parent.afterPurchase?.(m,ps,slot,before);
    note(ps,{phase:'third-buy',round:m.round,...pick,fundsBefore:funds,fundsAfter:ps.funds});
  }
}
export function createAbyssWindowPolicy(baseline,{secondScope='all'}={}){
  if(!['all','from-five'].includes(secondScope))throw Error('Unknown second-copy scope');
  const limited=createRestrainedPairPolicy(baseline);
  const restrained=secondScope==='all'?limited:Object.freeze({...baseline,
    purchaseAllowed:(m,ps,r)=>ps.shop.level>=5?limited.purchaseAllowed(m,ps,r):baseline.purchaseAllowed(m,ps,r)});
  const items=Object.freeze({...restrained,bankRemainder:()=>false,
    purchaseItemAllowed:(m,ps,r)=>abyssItemAllowed(restrained,m,ps,r)});
  const parent=createMainFirstPolicy(items);
  const pending=(m,ps)=>{
    const state=ps._sargonAbyssPairWindow;
    return state&&!state.closed&&m.round===state.opened&&ps.shop.level===5
      ?waitingPairs(ps,'all').filter(p=>state.targets.includes(p.id)):[];
  };
  const close=(m,ps,reason)=>{const state=ps._sargonAbyssPairWindow;if(!state||state.closed)return;
    state.closed=true;note(ps,{phase:'window-close',round:m.round,opened:state.opened,reason,funds:ps.funds,pending:waitingPairs(ps,'all')});};
  const child=Object.freeze({...parent,
    preparePurchases(m,ps,h={}){buyWindowThirds(parent,m,ps,h);parent.preparePurchases?.(m,ps,h);},
    beforeUpgrade(m,ps,...args){
      const state=ps._sargonAbyssPairWindow;
      if(state){
        if(m.round>state.opened)close(m,ps,'one-prep-expired');
        else if(!pending(m,ps).length)close(m,ps,'initial-pairs-resolved');
        if(pending(m,ps).length)return false;
        return parent.beforeUpgrade(m,ps,...args);
      }
      if(ps.shop.level!==5||m.round>=m.gd.bossRound||parent.levelTarget(m,ps)<=5
        ||!parent.beforeUpgrade(m,ps,...args)||ps.funds<ps.shop.upgradePrice+parent.upgradeReserve(m,ps))
        return parent.beforeUpgrade(m,ps,...args);
      const pairs=waitingPairs(ps,'all');if(!pairs.length)return true;
      ps._sargonAbyssPairWindow={opened:m.round,targets:pairs.map(p=>p.id),closed:false};
      note(ps,{phase:'window-open',round:m.round,pairs,funds:ps.funds,price:ps.shop.upgradePrice});return false;
    },
    priorityLevel:(m,ps)=>pending(m,ps).length?false:parent.priorityLevel(m,ps),
    spendReserve:(m,ps)=>pending(m,ps).length?0:parent.spendReserve(m,ps)});
  const selected={...baseline,name:'28/8 HARD unchanged; ABYSS restrained pairs, one-prep window and focused surplus'};
  for(const key of ['purchaseAllowed','purchaseItemAllowed','preparePurchases','onLevelUp','bankRemainder','beforeUpgrade','priorityLevel','spendReserve'])
    selected[key]=(m,ps,...args)=>m.difficulty==='ABYSS'?child[key]?.(m,ps,...args):baseline[key]?.(m,ps,...args);
  return Object.freeze(selected);
}
