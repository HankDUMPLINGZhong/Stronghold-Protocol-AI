// [ASSUMED] On the two-limit parent, stop paid Thorns and repair normal-wave Kroos adjacency behind real firing gates.
import {canPlace,placeClass} from '../../../../../../../../../../board.js';
import {frontOf,DIRS} from '../../../../../../../../../../../sim/dir.js';
import {ids} from './sargonPepe.js';
import {swiftIds} from './sargonSwift.js';
const base=(gd,r)=>gd.baseIdOf(r.chessId??r.id);

/** A public-data cycle proxy for the fallback group, not predicted future casts. */
export function quickCycle(rec){
  const skill=rec.skill;if(!skill||!(skill.spCost>=0))return Infinity;
  const interval=Math.max(.2,(rec.stats?.bat||1)*100/Math.max(1,rec.stats?.aspd||100));
  const recharge=skill.spType==='INCREASE_WITH_TIME'?skill.spCost/Math.max(.1,rec.stats?.spRecovery||1)
    :skill.spType==='INCREASE_WHEN_ATTACK'?skill.spCost*interval:Infinity;
  return recharge+Math.max(0,skill.duration||0);
}
export function kroosRecipientRank(gd,u){
  const index=[ids.passenger,ids.leonhardt,ids.minimalist,ids.papyrus].indexOf(base(gd,u.rec));
  return index>=0?index:quickCycle(u.rec)<=30?4:Infinity;
}
/** Count only incoming tiles through the first blocker. No reward for tiles enemies cannot reach before stopping. */
export function kroosFiring(model,u,units){
  let score=0,total=0;
  for(const rt of model.routes){
    if(rt.fallback||!(rt.n>0)||rt.fly&&!u.rec.canHitFly)continue;
    const stop=rt.fly?-1:rt.tiles.findIndex(k=>units.some(v=>v.uid!==u.uid&&v.block>0&&v.key===k));
    const incoming=stop<0?rt.tiles:rt.tiles.slice(0,stop+1),hits=incoming.filter(k=>u.cover.has(k)).length;
    const contact=stop>=0&&u.cover.has(rt.tiles[stop]);
    total+=rt.n;score+=rt.n*(Math.min(4,hits)+(contact?3:0))*Math.max(.4,rt.tileTime||1);
  }
  return total?score/total:0;
}
export function repairKroosPriority(m,ps,units,out,model,h){
  if(!m.wave||m.round>=m.gd.bossRound)return;
  const gd=ps.gd;
  for(let i=0;i<units.length;i++){
    const initial=units[i];if(base(gd,initial.rec)!==ids.kroos)continue;
    const blocked=new Set([...h.occupied,...units.filter((_,j)=>j!==i).map(u=>u.key)]),candidates=[];
    for(const [key]of h.map){
      const [r,c]=key.split(',').map(Number);
      if(blocked.has(key)||!canPlace(h.map,placeClass(ps,initial.rec),r,c))continue;
      for(const dir of DIRS){
        if(!h.allows(initial.uid,r,c,dir))continue;
        const u=h.unitOf(initial.rec,key,r,c,dir,model);u.uid=initial.uid;
        const fire=kroosFiring(model,u,units);if(!(fire>0))continue;
        const [fr,fc]=frontOf(r,c,dir),target=units.find(v=>v.uid!==initial.uid&&v.r===fr&&v.c===fc);
        candidates.push({u,fire,target,rank:target?kroosRecipientRank(gd,target):Infinity});
      }
    }
    const maxFire=Math.max(0,...candidates.map(c=>c.fire));if(!maxFire)continue;
    const before=h.scoreLayout(),tolerance=Math.max(.05,Math.abs(before)*.02),rows=[];
    for(const c of candidates){
      if(!Number.isFinite(c.rank)||c.fire+1e-8<maxFire*.9)continue;
      units[i]=c.u;c.score=h.scoreLayout();
      if(c.score+tolerance>=before)rows.push(c);
    }
    units[i]=initial;
    if(!rows.length)continue;
    rows.sort((a,b)=>a.rank-b.rank||b.score-a.score||b.fire-a.fire
      ||Number(b.u.key===initial.key&&b.u.dir===initial.dir)-Number(a.u.key===initial.key&&a.u.dir===initial.dir)
      ||a.u.key.localeCompare(b.u.key)||a.u.dir.localeCompare(b.u.dir));
    const best=rows[0];
    if(best.u.key===initial.key&&best.u.dir===initial.dir)continue;
    units[i]=best.u;out.set(initial.uid,best.u.key);out.dirs.set(initial.uid,best.u.dir);
    (ps._sargonFactorHistory||=[]).push({factor:'kroos-round16',phase:'layout-repair',round:m.round,
      uid:initial.uid,from:initial.key,fromDir:initial.dir,to:best.u.key,dir:best.u.dir,
      target:best.target?.rec.chessId??null,rank:Number.isFinite(best.rank)?best.rank:null,
      fire:best.fire,maxFire,beforeScore:before,afterScore:best.score,tolerance});
  }
}
export function createKroosPriorityPolicy(parent){
  const thorns=(ps,r)=>base(ps.gd,r)===swiftIds.thorns;
  return Object.freeze({...parent,name:'Two-limit Swift with firing-safe Kroos recipient priority and no paid Thorns',
    purchaseAllowed:(m,ps,r)=>!thorns(ps,r)&&parent.purchaseAllowed(m,ps,r),
    importantBuy:(m,ps,r)=>!thorns(ps,r)&&parent.importantBuy(m,ps,r),
    repairContact(m,ps,units,out,model,h){parent.repairContact?.(m,ps,units,out,model,h);repairKroosPriority(m,ps,units,out,model,h);}});
}
