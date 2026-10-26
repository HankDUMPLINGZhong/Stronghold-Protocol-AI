// [ASSUMED] Independent ABYSS children of 28/8: reserve no purchase money when upgrading five to six.
// The deferred counter survives round starts; only a manual refresh consumes it (bands/meta.js).
import {ids} from './sargonPepe.js';
const special=ps=>ps.counters['band:pepe:special']||0;
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'lean-six',...e});
const price=ps=>ps.shop.freeRefreshes>0?0:ps.gd.refreshPrice;
const formed=(ps,resident=false)=>{
  const owned=ps.allChess(),has=id=>owned.some(p=>base(ps,p)===id&&(!resident||ps.find(p.uid)?.area==='board'));
  return has(ids.titi)&&(has(ids.passenger)||has(ids.pepe))
    &&new Set(owned.filter(p=>ps.gd.chess(p.id).bonds.includes('sargonShip')).map(p=>base(ps,p))).size>=6;
};
const shopView=ps=>ps.shop.slots.filter(s=>s&&!s.sold).map(s=>({kind:s.kind,id:s.id,price:ps.priceOf(s)}));
export function leanSixLockTargets(parent,m,ps){
  const state=ps._sargonLeanSix;
  if(!state||state.slots!==ps.shop.slots||state.rolledAt!==m.round||m.round>=m.gd.bossRound)return [];
  return ps.shop.slots.filter(s=>s&&!s.sold&&s.kind==='chess'&&(ps.priceOf(s)>ps.funds||!ps.hand.some(p=>!p)))
    .filter(s=>{
      const r=ps.gd.chess(s.id),rich=Object.assign(Object.create(ps),{funds:Math.max(ps.funds,ps.priceOf(s)+10)});
      if(!parent.purchaseAllowed(m,rich,r))return false;
      return [ids.passenger,ids.pepe,ids.titi].includes(base(ps,s))
        ||r.tier>=5&&r.bonds.includes('sargonShip')||parent.importantBuy(m,rich,r);
    });
}
export function createLeanSixPolicy(parent,mode){
  if(!['defer','roll-lock','formed','resident'].includes(mode))throw Error('Unknown lean six mode');
  const conditional=['formed','resident'].includes(mode),ready=ps=>formed(ps,mode==='resident');
  const reserve=ps=>mode==='defer'?0:conditional&&!ready(ps)?5:1;
  const lock=(m,ps)=>{
    const targets=leanSixLockTargets(parent,m,ps);if(!targets.length)return false;
    if(!ps.shop.frozen)ps.freeze();
    const key=JSON.stringify([m.round,ps.funds,targets.map(s=>s.id)]),state=ps._sargonLeanSix;
    if(state.lastLock!==key){state.lastLock=key;note(ps,{mode,phase:'lock',round:m.round,funds:ps.funds,targets:targets.map(s=>({id:s.id,price:ps.priceOf(s)}))});}
    return true;
  };
  const rollDeferred=(m,ps)=>{
    const state=ps._sargonLeanSix;
    if(!state?.pending||ps.shop.level!==6||!(special(ps)>0)||ps.funds<price(ps)
      ||m.round===state.upgradedAt&&m.round<m.gd.bossRound||!parent.beforeUpgrade(m,ps))return;
    const funds=ps.funds,before=special(ps);
    if(!ps.refresh()?.ok)return;
    state.pending=false;state.rolledAt=m.round;state.slots=ps.shop.slots;
    note(ps,{mode,phase:'special',round:m.round,upgradedAt:state.upgradedAt,fundsBefore:funds,fundsAfter:ps.funds,
      specialBefore:before,specialAfter:special(ps),shop:shopView(ps)});
  };
  const child={...parent,
    upgradeReserve:(m,ps)=>ps.shop.level===5?reserve(ps):parent.upgradeReserve(m,ps),
    spendReserve:(m,ps)=>ps.shop.level===5
      ?parent.priorityLevel(m,ps)&&ps.funds>=Math.max(0,ps.shop.upgradePrice)+reserve(ps)?Math.max(0,ps.shop.upgradePrice):0
      :parent.spendReserve(m,ps),
    onLevelUp(m,ps,h={}){
      if(ps.shop.level!==6){parent.onLevelUp(m,ps,h);return;}
      if(conditional&&(!ready(ps)||ps.funds>=5)){parent.onLevelUp(m,ps,h);return;}
      const funds=ps.funds,before=special(ps),state=ps._sargonLeanSix={upgradedAt:m.round,pending:mode==='defer',rolledAt:null,slots:null};
      note(ps,{mode,phase:'upgrade',round:m.round,funds,reserve:reserve(ps),special:before});
      if(mode==='defer'){
        // Defer the parent's immediate-refresh hook; its ordinary purchase helper still runs in preparePurchases.
        if(m.round>=m.gd.bossRound)rollDeferred(m,ps);
      }else{
        parent.onLevelUp(m,ps,h);
        if(special(ps)<before){state.rolledAt=m.round;state.slots=ps.shop.slots;
          note(ps,{mode,phase:'special',round:m.round,upgradedAt:m.round,fundsBefore:funds,fundsAfter:ps.funds,
            specialBefore:before,specialAfter:special(ps),shop:shopView(ps)});}
      }
      lock(m,ps);
    },
    preparePurchases(m,ps,h={}){
      parent.preparePurchases?.(m,ps,h);
      rollDeferred(m,ps);
      lock(m,ps);
    },
    beforeShopRefresh(m,ps,h){
      // No manual refresh may accidentally consume a deferred counter during the upgrade prep.
      if(ps._sargonLeanSix?.pending&&special(ps)>0)return false;
      if(lock(m,ps))return false;
      return parent.beforeShopRefresh?.(m,ps,h);
    }
  };
  const selected={...parent,name:`28/8 ABYSS lean six: ${mode}`};
  // Do not add holdShop: merely defining that optional hook changes legacy unfreezing on HARD and before five.
  for(const key of ['upgradeReserve','spendReserve','onLevelUp','preparePurchases','beforeShopRefresh'])
    selected[key]=(m,ps,...args)=>m.difficulty==='ABYSS'?child[key](m,ps,...args):parent[key]?.(m,ps,...args);
  return Object.freeze(selected);
}
