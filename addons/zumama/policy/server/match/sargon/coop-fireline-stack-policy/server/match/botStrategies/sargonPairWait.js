// [ASSUMED] User-directed pair acquisition and independent five-to-six timing trials on selected 28/8.
// Re-evaluate current ordinary pairs after every purchase/merge; new qualifying pairs also hold level five.
import {mimicUseEligible} from './sargonMimic.js';
export function secondCopyAllowed(m,ps,r){
  const id=ps.gd.baseIdOf(r.id??r.chessId),owned=ps.allChess().filter(p=>ps.gd.baseIdOf(p.id)===id&&!ps.gd.isGolden(p.id));
  if(owned.length!==1)return true;
  return r.tier>=5&&r.bonds.includes('sargonShip')
    ||m.round>=1&&m.round<=13&&r.tier>=4&&r.tier<=5&&mimicUseEligible(ps,{id:r.id??r.chessId});
}
export function createRestrainedPairPolicy(parent){
  return Object.freeze({...parent,name:'28/8: paid seconds only high native or R1-13 IV-V recurring layer engines',
    purchaseAllowed(m,ps,r){
      if(!secondCopyAllowed(m,ps,r)){
        const event={factor:'pair-second-limit',round:m.round,id:r.id??r.chessId,name:r.name,tier:r.tier,level:ps.shop.level,funds:ps.funds};
        const key=JSON.stringify(event),seen=ps._sargonSecondLimitSeen||=new Set();
        if(!seen.has(key)){seen.add(key);(ps._sargonFactorHistory||=[]).push(event);}return false;
      }
      return parent.purchaseAllowed(m,ps,r);
    }});
}
export function waitingPairs(ps,mode){
  const groups=new Map();
  for(const p of ps.allChess()){
    const id=ps.gd.baseIdOf(p.id);
    if(!groups.has(id))groups.set(id,{ordinary:[],elite:false});
    const group=groups.get(id);
    if(ps.gd.isGolden(p.id))group.elite=true;else group.ordinary.push(p);
  }
  return [...groups].flatMap(([id,g])=>{
    const r=ps.gd.chess(id),inRange=r.tier>=4&&r.tier<=5;
    if(g.elite||g.ordinary.length!==2||ps.gd.mergeCount(id)!==3)return [];
    if(mode!=='all'&&!inRange&&!(mode==='tier45-sargon'&&r.bonds.includes('sargonShip')))return [];
    return [{id,name:r.name,tier:r.tier,uids:g.ordinary.map(p=>p.uid)}];
  });
}
export function createPairWaitPolicy(parent,mode){
  if(!['all','tier45','tier45-sargon'].includes(mode))throw Error('Unknown pair wait mode');
  const pairs=(m,ps)=>ps.shop.level===5&&parent.levelTarget(m,ps)>5?waitingPairs(ps,mode):[];
  return Object.freeze({...parent,name:`28/8: wait at five for ${mode} pairs`,
    beforeUpgrade(m,ps,...args){
      const pending=pairs(m,ps);
      if(pending.length){
        const event={factor:'pair-wait',mode,round:m.round,funds:ps.funds,price:ps.shop.upgradePrice,pairs:pending};
        const signature=JSON.stringify(event),seen=ps._sargonPairWaitSeen||=new Set();
        if(!seen.has(signature)){seen.add(signature);(ps._sargonFactorHistory||=[]).push(event);}
        return false;
      }
      return parent.beforeUpgrade(m,ps,...args);
    },
    // Parent functions close over the parent's gate: release its upgrade budget while waiting.
    priorityLevel:(m,ps)=>pairs(m,ps).length?false:parent.priorityLevel(m,ps),
    spendReserve:(m,ps)=>pairs(m,ps).length?0:parent.spendReserve(m,ps)});
}
