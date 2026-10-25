// [ASSUMED] Independent follow-ups to the four-seat failure review. No opening/economic/default changes.
import {bossFormationSnapshot,linkedFormationPlan} from './lateranoBossFormation.js';
import {coopRolePlans,applyCoopRolePlan} from './lateranoCoopRoles.js';
import {createCoopBossForecast} from './lateranoCoopBoss.js';
import {coopSelfBossSession} from './lateranoCoopBossSelf.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';

const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs.get(u)}`).join('|');
const bossEligible=m=>m.mode==='coop'&&!m.isSolo&&!m.wave&&m.round===m.gd.bossRound&&m.botRehearsal>=3;
const dirs=['RIGHT','UP','DOWN','LEFT'];

/** The two model trials differ only in a scoped own-forecast setting. No team units are substituted. */
export function withCoopOwnBossModel(parent,kind){
 if(!['template','pool'].includes(kind))throw Error('Unknown own boss model');
 return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
  if(!bossEligible(m)){if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);return;}
  const old=ps._botCoopOwnBossModel;ps._botCoopOwnBossModel=kind;
  try{if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);}
  finally{if(old===undefined)delete ps._botCoopOwnBossModel;else ps._botCoopOwnBossModel=old;}
 }});
}

/** A bounded neighborhood, on the current roster and at most one already-owned missing-healer roster.
 * Main/medic/frontline moves are correlated and can use empty cells. Public routes propose; forecasts decide.
 */
export function coopBossRecoveryPlans(m,ps,h,recipe,maximum=8){
 const original=bossFormationSnapshot(ps,h),rec=p=>h.rangeRec(ps,ps.gd.chess(p.id)),id=p=>ps.gd.baseIdOf(p.id),
  mains=new Set([recipe.ids.exusiaiAlter,recipe.ids.lemuen,recipe.ids.executorAlter,recipe.ids.archetto]),
  isHeal=p=>rec(p).attackKind==='heal'||['guardian','incantationmedic'].includes(rec(p).subProfessionId)||id(p)===recipe.ids.titi,
  isTank=p=>rec(p).profession==='TANK'&&(rec(p).stats?.blockCnt||0)>0,
  pinned=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid)),
  reserved=new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([k])=>k)),bases=[original],
  healRange=ps._botCoopHealingRange||healingTiles;
 if(!original.lineup.some(isHeal)){
  const extra=coopRolePlans(m,ps,h,recipe,{final:true}).find(p=>p.lineup.some(isHeal));if(extra)bases.push(extra);
 }
 if(ps._botCoopHeldHealingPlans)for(const plan of ps._botCoopHeldHealingPlans())
  if(!bases.some(p=>p.lineup.map(u=>u.uid).sort().join()===plan.lineup.map(u=>u.uid).sort().join()))bases.push(plan);
 const model=h.fieldModel(m,ps),bodies=new Set(model.bossBodies.flatMap(b=>b.tiles)),
  routes=model.routes.filter(r=>!r.fallback&&(r.dwell>0||!bodies.size));
 const all=[];
 for(const base of bases){
  const occupied=new Set(base.values()),at=u=>{const [r,c]=base.get(u.uid).split(',').map(Number);return{r,c,key:base.get(u.uid),dir:base.dirs.get(u.uid),uid:u.uid};},
   carries=base.lineup.filter(p=>mains.has(id(p))).sort((a,b)=>rec(b).tier-rec(a).tier||Number(ps.gd.isGolden(b.id))-Number(ps.gd.isGolden(a.id))||a.uid-b.uid).slice(0,2),
   medics=base.lineup.filter(isHeal).slice(0,2),tanks=base.lineup.filter(isTank).sort((a,b)=>rec(b).stats.def-rec(a).stats.def).slice(0,1),
   options=new Map();
  const contact=(u,loc)=>{
   const cover=new Set(h.rangeTiles(rec(u),loc.r,loc.c,loc.dir));
   return {cover,n:bodies.size?[...bodies].filter(k=>cover.has(k)).length:
    routes.reduce((s,r)=>s+r.tiles.filter(k=>cover.has(k)).length/Math.max(1,r.tiles.length),0)};
  };
  for(const u of [...new Set([...carries,...medics,...tanks])]){
   const old=at(u),list=[old];
   if(!pinned.has(u.uid))for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
    const r=old.r+dr,c=old.c+dc,key=`${r},${c}`;
    if(Math.abs(dr)+Math.abs(dc)>2||r<9||r>12||c<2||c>10||reserved.has(key)
     ||occupied.has(key)&&key!==old.key||!ps._legal(u,r,c))continue;
    for(const dir of dirs)list.push({uid:u.uid,key,r,c,dir});
   }
   options.set(u.uid,list);
  }
  const score=p=>{
   let value=0;const locs=p.lineup.map(u=>{const [r,c]=p.get(u.uid).split(',').map(Number);return{u,r,c,key:p.get(u.uid),dir:p.dirs.get(u.uid)};});
   for(const c of locs.filter(l=>carries.includes(l.u))){
    const hit=contact(c.u,c);if(!hit.n)return -Infinity;
    value+=hit.n*18;
    if(acceptsHealing(rec(c.u))&&medics.length)value+=locs.some(l=>isHeal(l.u)&&healRange(rec(l.u),l.r,l.c,l.dir).has(c.key))?45:-65;
   }
   for(const med of locs.filter(l=>medics.includes(l.u))){
    const heal=healRange(rec(med.u),med.r,med.c,med.dir);
    value+=locs.filter(l=>tanks.includes(l.u)&&heal.has(l.key)).length*15;
    for(const rt of model.routes.filter(r=>!r.fallback&&!r.dwell&&!r.fly)){
     const index=rt.tiles.indexOf(med.key);if(index<0)continue;
     if(!locs.some(l=>isTank(l.u)&&rt.tiles.includes(l.key)&&rt.tiles.indexOf(l.key)<index))value-=30;
    }
   }
   const fragile=locs.filter(l=>carries.includes(l.u)||medics.includes(l.u));
   for(let i=0;i<fragile.length;i++)for(let j=i+1;j<fragile.length;j++){
    const a=fragile[i],b=fragile[j],dr=Math.abs(a.r-b.r),dc=Math.abs(a.c-b.c);
    if(m.bossId==='boss_1'&&Math.max(dr,dc)<=1)value-=40;
    if(m.bossId==='boss_5'&&dr*dr+dc*dc<=4)value-=35;
    if(m.bossId==='boss_6'&&dr+dc<=1)value-=35;
    if(m.bossId==='boss_7'&&a.c===b.c)value-=55;
   }
   return value-locs.filter(l=>l.key!==base.get(l.u.uid)).length*2;
  };
  const offer=(targets,family)=>{
   if(new Set(targets.map(t=>t.uid)).size!==targets.length)return;
   if(!targets.some(t=>t.key!==base.get(t.uid)&&!occupied.has(t.key)))return;
   const p=linkedFormationPlan(ps,h,base,targets);if(!p)return;const value=score(p);if(!Number.isFinite(value))return;
   p.coopRecovery={family,score:value,roster:base===original?'current':'owned-healer'};all.push(p);
  };
  if(ps._botCoopHeldHealingPlans&&base.coopIncantation){
   const value=score(base);if(Number.isFinite(value)){
    base.coopRecovery={family:'owned-entry',score:value,roster:'owned-healer'};all.push(base);
   }
  }
  for(const carry of carries){
   const cs=options.get(carry.uid).filter(l=>contact(carry,l).n>0);
   for(const c of cs)offer([c],'carry');
   for(const medic of medics)if(medic!==carry){
    for(const med of options.get(medic.uid))offer([med],'medic');
    for(const c of cs)for(const med of options.get(medic.uid)){
     if(!healRange(rec(medic),med.r,med.c,med.dir).has(c.key)&&acceptsHealing(rec(carry)))continue;
     offer([c,med],'carry-medic');
    }
   }
   for(const tank of tanks)if(tank!==carry){
    const ts=options.get(tank.uid);
    for(const t of ts)offer([t],'tank');
    for(const c of cs)for(const t of ts)offer([c,t],'carry-tank');
    for(const medic of medics)if(medic!==tank&&medic!==carry)
     for(const t of ts)for(const med of options.get(medic.uid)){
      const heal=healRange(rec(medic),med.r,med.c,med.dir);
      if(!heal.has(t.key)||acceptsHealing(rec(carry))&&!heal.has(base.get(carry.uid)))continue;
      offer([at(carry),t,med],'medic-tank');
     }
   }
  }
 }
 all.sort((a,b)=>b.coopRecovery.score-a.coopRecovery.score||signature(a).localeCompare(signature(b)));
 const selected=[],seen=new Set([signature(original)]);
 if(ps._botCoopHeldHealingPlans){
  for(const family of ['owned-entry','carry-medic','medic-tank','carry-tank','medic','carry','tank'])
   for(const roster of ['owned-healer','current']){
    const p=all.find(p=>p.coopRecovery.roster===roster&&p.coopRecovery.family===family&&!seen.has(signature(p)));
    if(p&&selected.length<maximum){selected.push(p);seen.add(signature(p));}
   }
  return [original,...selected];
 }
 for(const roster of ['current','owned-healer'])for(const family of ['carry-medic','medic-tank','carry-tank','medic','carry','tank']){
  const p=all.find(p=>p.coopRecovery.roster===roster&&p.coopRecovery.family===family&&!seen.has(signature(p)));
  if(p){selected.push(p);seen.add(signature(p));if(selected.length>=maximum)break;}
 }
 return [original,...selected.slice(0,maximum)];
}

export function withCoopBossLocalRecovery(parent){
 return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
  if(!bossEligible(m)){if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);return;}
  const old=ps._botCoopAfterOwnBoss;
  ps._botCoopAfterOwnBoss=function*(m,ps,h){
   if(old)yield* old(m,ps,h);
   const session=coopSelfBossSession(ps);if(!session)return;
   const started=performance.now(),plans=coopBossRecoveryPlans(m,ps,h,parent);
   if(plans.length<2)return;
   const job=yield* createCoopBossForecast(m,ps,plans,10);if(!job)return;while(!job.run(4))yield;
   if(!job.stale&&job.bestIndex)applyCoopRolePlan(ps,job.best);
   (ps._botCoopLocalRecoveryHistory||=[]).push({round:m.round,index:job.bestIndex,stale:job.stale,changed:!job.stale&&!!job.bestIndex,
    plans:plans.map(p=>({roster:p.lineup.map(u=>u.id),positions:[...p],dirs:[...p.dirs],proposal:p.coopRecovery})),
    outcomes:job.outcomes,reason:session.reason,ms:performance.now()-started});
   if(ps._botCoopAfterLocalBoss)yield* ps._botCoopAfterLocalBoss(m,ps,h);
  };
  try{if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);}
  finally{if(old===undefined)delete ps._botCoopAfterOwnBoss;else ps._botCoopAfterOwnBoss=old;}
 }});
}
