// User-adopted refinement of the working restricted/pair-rescue recipe, 2026-10-28.
// Track successful free reward pieces by UID. Current holdings only; never inspect future offers.
import {pairRescueScope} from './siracusaPairRescue.js';

export function rewardPairEligible(m,ps,rec){
  if(!pairRescueScope(m,ps)||!rec||rec.isGolden)return false;
  const id=ps.gd.baseIdOf(rec.chessId),need=ps.gd.mergeCount(rec.chessId);
  const normals=ps.allChess().filter(p=>!ps.gd.isGolden(p.id)&&ps.gd.baseIdOf(p.id)===id);
  return need>=3&&normals.length===need-1&&ps.completesChessMerge(rec.chessId)
    &&normals.every(p=>ps._botRewardPairOrigins?.get(p.uid)===p.id);
}

export function withRewardPairCompletion(parent){
  return Object.freeze({...parent,
    rewardPairEligible,
    purchaseAllowed(m,ps,rec){return rewardPairEligible(m,ps,rec)||parent.purchaseAllowed(m,ps,rec);},
    afterReward(m,ps,slot,before,offer){
      parent.afterReward?.(m,ps,slot,before,offer);
      if(!pairRescueScope(m,ps)||slot?.kind!=='chess'||(slot.price||0)>0||ps.gd.isGolden(slot.id))return;
      ps._botRewardPairOrigins||=new Map();
      for(const p of ps.allChess())if(!before.has(p.uid)&&p.id===slot.id)ps._botRewardPairOrigins.set(p.uid,p.id);
    },
    cleanupAcquisitions(m,ps){
      parent.cleanupAcquisitions?.(m,ps);
      if(!ps._botRewardPairOrigins)return;
      const current=new Map(ps.allChess().map(p=>[p.uid,p.id]));
      for(const [uid,id] of ps._botRewardPairOrigins)if(current.get(uid)!==id)ps._botRewardPairOrigins.delete(uid);
    },
  });
}
