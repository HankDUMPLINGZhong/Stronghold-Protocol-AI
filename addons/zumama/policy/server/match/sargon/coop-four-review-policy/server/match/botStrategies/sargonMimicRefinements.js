// [ASSUMED] Independent corrections, all layered on the same retained 24/6 + mimic policy.
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { ids } from './sargonPepe.js';
const bought=ps=>ps._sargonFactorHistory?.some(e=>e.phase==='mimic-buy');
const core='sargonShip';
export function marginalRewardPriority(parent,m,ps,s){
  const original=parent.rewardPriority(m,ps,s);
  if(!bought(ps)||s.kind!=='chess')return original;
  const gd=ps.gd,r=gd.chess(s.id),owned=ps.allChess(),base=gd.baseIdOf(s.id);
  if(owned.some(p=>gd.baseIdOf(p.id)===base))return original;
  if([ids.passenger,ids.pepe,ids.titi].includes(base))return 4;
  const count=b=>new Set(owned.filter(p=>pieceBonds(gd,p).includes(b)).map(p=>gd.baseIdOf(p.id))).size+(ps.bondCountBonus?.[b]||0);
  if(r.bonds.includes(core)&&count(core)<6)return 3;
  // Free rewards can complete a useful auxiliary threshold even if ordinary purchases reject their price.
  if(r.bonds.some(b=>['preciShip','swiftShip','skillfulShip'].includes(b)
    &&count(b)===(b==='preciShip'?2:1)))return 2;
  return original;
}
export function createDeployedMimicPolicy(parent){
  return Object.freeze({...parent,name:'Mimic: deploy a four-tier engine before promotion',
    preparePurchases(m,ps,h){ps._sargonMimicDeployedOnly=true;parent.preparePurchases(m,ps,h);},
    useEconomy(m,ps){ps._sargonMimicDeployedOnly=true;parent.useEconomy(m,ps);}});
}
export function createMarginalRewardPolicy(parent){
  return Object.freeze({...parent,name:'Mimic: marginal merge-reward thresholds',
    rewardPriority:(m,ps,s)=>marginalRewardPriority(parent,m,ps,s)});
}
export function createContactMimicPolicy(parent,repair){
  return Object.freeze({...parent,name:'Mimic: final contact repair',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(bought(ps)&&!m.wave&&m.round===m.gd.bossRound)yield* repair(m,ps,h);
    }});
}
