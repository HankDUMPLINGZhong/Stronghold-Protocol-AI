// [ASSUMED] Independent ABYSS timing experiments on 28/8. No gear, surplus, reward or formation changes.
import {ids} from './sargonPepe.js';
import {waitingPairs} from './sargonPairWait.js';
import {mimicUseEligible} from './sargonMimic.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'five-balance',...e});
const valuable=ps=>waitingPairs(ps,'all').filter(p=>mimicUseEligible(ps,{id:p.id}));
const budget=ps=>Math.max(0,ps.shop.upgradePrice)+5;
const chessPrice=(ps,id)=>ps.priceOf({kind:'chess',id,basePrice:ps.gd.chessPrice(id)});
const searchCost=ps=>ps.gd.refreshPrice+Math.min(...valuable(ps).map(p=>chessPrice(ps,p.id)));
export function createFiveBalancePolicy(parent,mode){
  if(!['visible','budget','quality'].includes(mode))throw Error('Unknown five balance mode');
  const close=(m,ps,reason)=>{const s=ps._sargonFiveBalance;if(!s||s.closed)return;
    s.closed=true;note(ps,{mode,phase:'close',round:m.round,opened:s.opened,reason,rolls:s.rolls,funds:ps.funds});};
  const pending=(m,ps)=>{
    const s=ps._sargonFiveBalance;if(!s||s.closed)return false;
    if(ps.shop.level!==5||m.round!==s.opened){close(m,ps,'prep-expired');return false;}
    if(!valuable(ps).some(p=>s.targets.includes(p.id))){close(m,ps,'pairs-resolved');return false;}
    if(mode==='budget'&&(s.rolls>=2||ps.funds<budget(ps)+searchCost(ps))){close(m,ps,'search-budget');return false;}
    return true;
  };
  const gate=(m,ps,...args)=>{
    if(ps.shop.level!==5)return parent.beforeUpgrade(m,ps,...args);
    if(pending(m,ps))return false;
    if(mode!=='visible'&&!ps._sargonFiveBalance&&m.round<=12&&parent.levelTarget(m,ps)>5
      &&parent.beforeUpgrade(m,ps,...args)&&ps.funds>=budget(ps)){
      const pairs=valuable(ps),owned=ps.allChess();
      const core=new Set(owned.filter(p=>ps.gd.chess(p.id).bonds.includes('sargonShip')).map(p=>base(ps,p))).size;
      const main=owned.some(p=>[ids.passenger,ids.pepe].includes(base(ps,p)));
      const eligible=mode==='budget'?ps.funds>=budget(ps)+searchCost(ps):main&&core>=6&&ps.lp>=12;
      if(pairs.length&&eligible){
        ps._sargonFiveBalance={opened:m.round,targets:pairs.map(p=>p.id),rolls:0,closed:false};
        note(ps,{mode,phase:'open',round:m.round,pairs,funds:ps.funds,upgrade:ps.shop.upgradePrice,core,main,lp:ps.lp});return false;
      }
    }
    return parent.beforeUpgrade(m,ps,...args);
  };
  const child={...parent,
    preparePurchases(m,ps,h={}){
      // Only an actual third; never eagerly buy an unrelated first/second before checking the upgrade.
      if(ps.shop.level===5&&parent.levelTarget(m,ps)>5){
        for(let guard=0;guard<8;guard++){
          const maySpendWindow=mode==='quality'&&pending(m,ps);
          const pick=ps.shop.slots.flatMap((s,index)=>s&&!s.sold&&s.kind==='chess'
            &&ps.completesChessMerge(s.id)&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id))
            &&ps.funds-ps.priceOf(s)>=(maySpendWindow?0:budget(ps))
            ?[{index,id:s.id,price:ps.priceOf(s),tier:ps.gd.chess(s.id).tier}]:[])
            .sort((a,b)=>b.tier-a.tier||a.index-b.index)[0];
          if(!pick)break;
          if(!ps.hand.some(p=>!p)&&!h.freePurchaseSlot?.())break;
          const slot=ps.shop.slots[pick.index];
          if(!slot||slot.sold||!ps.completesChessMerge(slot.id)||ps.funds-ps.priceOf(slot)<(maySpendWindow?0:budget(ps)))break;
          const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
          if(!ps.buy(pick.index)?.ok)break;
          parent.afterPurchase?.(m,ps,slot,before);
          note(ps,{mode,phase:'third',round:m.round,...pick,fundsBefore:funds,fundsAfter:ps.funds,budget:budget(ps)});
        }
      }
      parent.preparePurchases?.(m,ps,h);
    },
    beforeUpgrade:gate,
    priorityLevel:(m,ps)=>ps.shop.level===5?ps.shop.level<parent.levelTarget(m,ps)&&gate(m,ps):parent.priorityLevel(m,ps),
    spendReserve(m,ps){
      if(pending(m,ps))return mode==='budget'?budget(ps):0;
      return parent.spendReserve(m,ps);
    }
  };
  if(mode==='budget'){
    child.beforeShopRefresh=(m,ps,h)=>{
      const s=ps._sargonFiveBalance;
      // End this shopping loop after the capped search, so its next levelUp call can spend the saved budget.
      if(s?.closed&&s.opened===m.round&&ps.shop.level===5)return false;
      if(s&&!s.closed){
        if(!pending(m,ps))return false;
        if(parent.beforeShopRefresh?.(m,ps,h)===false)return false;
        s.rolls++;note(ps,{mode,phase:'search',round:m.round,roll:s.rolls,funds:ps.funds,budget:budget(ps)});return true;
      }
      return parent.beforeShopRefresh?.(m,ps,h);
    };
    child.purchaseAllowed=(m,ps,r)=>parent.purchaseAllowed(m,ps,r)&&(!pending(m,ps)
      ||[ids.passenger,ids.pepe].includes(base(ps,r))||ps.funds-chessPrice(ps,r.id??r.chessId)>=budget(ps));
  }
  const selected={...parent,name:`28/8 ABYSS five/six balance: ${mode}`};
  for(const key of ['preparePurchases','beforeUpgrade','priorityLevel','spendReserve',...(mode==='budget'?['beforeShopRefresh','purchaseAllowed']:[])])
    selected[key]=(m,ps,...args)=>m.difficulty==='ABYSS'?child[key](m,ps,...args):parent[key]?.(m,ps,...args);
  return Object.freeze(selected);
}
