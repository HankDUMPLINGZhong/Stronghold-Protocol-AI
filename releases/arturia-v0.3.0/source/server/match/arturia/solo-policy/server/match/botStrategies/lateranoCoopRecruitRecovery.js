// [ASSUMED] Optional post-recruit co-op defense search. Actual purchases/rewards have already settled.
// Only current own assets/public waves and independent common forecasts. No seed-specific tiles or real-result input.
import {createForecastSteps} from '../botForecast.js';
import {prepareDevelopmentInput} from '../botLateranoDevelopment.js';
import {bossFormationSnapshot} from './lateranoBossFormation.js';
import {stealthBattleInput} from './lateranoStealthWave.js';
import {coopRolePlans,applyCoopRolePlan} from './lateranoCoopRoles.js';
import {coopEntryState,coopGrowthFirstEnabled} from './lateranoCoopSafety.js';
import {allCoopForecastsFatal} from './lateranoCoopRescue.js';

export const COOP_RECRUIT_RECOVERY_LIMITS=Object.freeze({candidates:48,fieldSteps:240_000,wallMs:10_000});
const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([uid,key])=>`${uid}@${key}:${p.dirs.get(uid)}`).join('|');
const stamp=(m,ps)=>JSON.stringify([m.round,m.stageId,ps.lp,ps.funds,ps.round.spent,ps.round.refreshes,ps.battleInput(),
 ps.allChess().map(p=>[p.uid,p.id,p.items?.map(i=>[i.uid,i.id])])]);
const mean=(a,k)=>a.reduce((s,r)=>s+r[k],0)/a.length;
const valid=rs=>rs.length===2&&new Set(rs.map(r=>r.sample)).size===2&&rs.every(r=>r.valid&&[0,1].includes(r.sample)
 &&['lost','leaks','criticalDown','entryReady'].every(k=>Number.isFinite(r[k])));
const score=rs=>[Math.max(...rs.map(r=>r.lost)),mean(rs,'lost'),Math.max(...rs.map(r=>r.leaks)),mean(rs,'leaks'),
 Math.max(...rs.map(r=>r.criticalDown)),-mean(rs,'entryReady')];
const better=(a,b,n=a.length)=>{for(let i=0;i<n;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]<b[i];return false;};

/** LP loss/leakage is comparable; different bond-layer units are never added into this emergency score. */
export function selectRecruitRecovery(entries,{growthFirst=false}={}){
 let best=0;
 const rank=rs=>growthFirst?[...score(rs).slice(0,5),-mean(rs,'growth')]:score(rs);
 const complete=rs=>valid(rs)&&(!growthFirst||rs.every(r=>Number.isFinite(r.growth)));
 if(!entries.length||!complete(entries[0].outcomes))return best;
 for(let i=1;i<entries.length;i++)if(complete(entries[i].outcomes)&&better(rank(entries[i].outcomes),rank(entries[best].outcomes)))best=i;
 // Equal defense is not enough to disturb a farming formation or the inherited Unite preparation.
 return better(score(entries[best].outcomes),score(entries[0].outcomes),4)?best:0;
}

/** Current roster first, then legal owned-role entries. Local facing/reciprocal swaps preserve pinned summons. */
export function* recruitRecoveryPlans(m,ps,h,recipe,maximum=48){
 const bases=coopRolePlans(m,ps,h,recipe),seen=new Set(),pinned=new Set([...ps.board.values()]
  .filter(p=>p.kind==='token').map(p=>p.ownerUid));
 let count=0;
 const unique=p=>{
  if(count>=maximum||p.lineup.length!==p.size||new Set(p.values()).size!==p.size
   ||p.lineup.some(u=>!p.has(u.uid)||!ps._legal(u,...p.get(u.uid).split(',').map(Number))))return false;
  const key=signature(p);if(seen.has(key))return false;seen.add(key);count++;return true;
 };
 const groups=[];
 const melee=p=>['TANK','WARRIOR','PIONEER'].includes(ps.gd.chess(p.id).profession);
 for(const base of bases){
  const group={base,mixed:[],turns:[],same:[]};groups.push(group);
  const copy=()=>{const p=new h.LayoutPlan(base);p.dirs=new Map(base.dirs);p.lineup=base.lineup;return p;};
  for(const u of base.lineup){
   if(pinned.has(u.uid))continue;
   for(const dir of ['RIGHT','UP','DOWN','LEFT']){const p=copy();p.dirs.set(u.uid,dir);group.turns.push(p);}
  }
  for(let i=0;i<base.lineup.length;i++)for(let j=i+1;j<base.lineup.length;j++){
   const u=base.lineup[i],v=base.lineup[j];if(pinned.has(u.uid)||pinned.has(v.uid))continue;
   const uk=base.get(u.uid),vk=base.get(v.uid);
   if(!ps._legal(u,...vk.split(',').map(Number))||!ps._legal(v,...uk.split(',').map(Number)))continue;
   const p=copy();p.set(u.uid,vk);p.set(v.uid,uk);group[melee(u)!==melee(v)?'mixed':'same'].push(p);
  }
 }
 // Diversify by roster before exhausting any one roster. Melee/ranged exchanges redistribute contact and fire
 // windows; this priority does not classify a melee damage dealer as a tank. Complete forecasts remain decisive.
 for(const {base}of groups)if(unique(base))yield base;
 for(const phase of ['mixed','turns','same']){
  const length=Math.max(0,...groups.map(g=>g[phase].length));
  for(let i=0;i<length;i++)for(const g of groups){
   const p=g[phase][i];if(p&&unique(p))yield p;
   if(count>=maximum)return;
  }
 }
}

const eligible=(m,ps,anyFatal)=>m.mode==='coop'&&!m.isSolo&&!!m.wave&&m.round<m.gd.bossRound&&m.botRehearsal>=3
 &&ps.bandId==='band_paganini'&&ps._botFocusId==='lateranoShip'
 &&(anyFatal||ps._botCoopUnusedHistory?.some(r=>r.round===m.round&&r.kind==='recruit-buy'&&r.used));

export function withLateranoCoopRecruitRecovery(parent,limits=COOP_RECRUIT_RECOVERY_LIMITS,{anyFatal=false}={}){
 return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
  if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
  if(!eligible(m,ps,anyFatal)||ps._botCoopRecruitRecoveryRound===m.round)return;
  ps._botCoopRecruitRecoveryRound=m.round;
  const started=performance.now(),before=stamp(m,ps),original=bossFormationSnapshot(ps,h),entries=[],cache=new Map();
  const audit={round:m.round,limits:{...limits},reason:'cancelled',fieldSteps:0,evaluated:0,generated:0,selected:0,
   changed:false,batches:[],before:original.lineup.map(p=>({uid:p.uid,id:p.id,key:original.get(p.uid),dir:original.dirs.get(p.uid)}))};
  (ps._botCoopRecruitRecoveryHistory||=[]).push(audit);
  const expired=()=>{
   if(stamp(m,ps)!==before){audit.reason='own-state-changed';return true;}
   if(audit.fieldSteps>=limits.fieldSteps){audit.reason='field-step-budget';return true;}
   if(!m.sched.virtual&&performance.now()-started>=limits.wallMs){audit.reason='wall-budget';return true;}
   return false;
  };
  function* evaluate(plans){
   const pending=plans.filter(p=>!cache.has(signature(p)));if(!pending.length)return true;
   if(expired())return false;
   function* inputs(plan){yield;return stealthBattleInput(ps,plan);}
   const job=yield* createForecastSteps(m,ps,pending[0].lineup,pending,inputs,{
    forecastReadinessOnly:true,prepareForecastInput:(m,ps,_c,p,input)=>prepareDevelopmentInput(m,ps,p.lineup,p,input),
    forecastContext:()=>({}),observeForecast:(battle,_ctx,p)=>{
     battle.on('tick',()=>{audit.fieldSteps++;});return pp=>coopEntryState(ps,p,pp);
    },selectForecast:()=>({index:0}),
   });
   if(!job){audit.reason='no-forecast';return false;}
   while(!job.run(4)){if(expired())return false;yield;}
   audit.batches.push({outcomes:job.outcomes,plans:pending.map(signature)});
   for(let i=0;i<pending.length;i++){
    const outcomes=job.outcomes.filter(r=>r.index===i);
    if(valid(outcomes)){cache.set(signature(pending[i]),outcomes);audit.evaluated++;}
   }
   return true;
  }
  try{
   if(!original.lineup.length){audit.reason='empty-board';return;}
   if(!(yield* evaluate([original])))return;
   const control=cache.get(signature(original));
   if(!control||!allCoopForecastsFatal(control,ps.lp)){audit.reason='not-fatal';return;}
   entries.push({plan:original,outcomes:control});audit.originalOutcomes=control;
   let pending=[];
   for(const p of recruitRecoveryPlans(m,ps,h,parent,limits.candidates)){
    audit.generated++;
    if(expired())break;
    if(signature(p)===signature(original))continue;
    pending.push(p);if(pending.length<2){yield;continue;}
    const done=yield* evaluate(pending);
    for(const p of pending){const outcomes=cache.get(signature(p));if(outcomes)entries.push({plan:p,outcomes});}
    pending=[];yield;if(!done)break;
   }
   if(pending.length&&!expired()){
    yield* evaluate(pending);
    for(const p of pending){const outcomes=cache.get(signature(p));if(outcomes)entries.push({plan:p,outcomes});}
   }
   if(stamp(m,ps)!==before){audit.reason='own-state-changed';return;}
   audit.growthFirst=coopGrowthFirstEnabled(m,ps);
   audit.selected=selectRecruitRecovery(entries,{growthFirst:audit.growthFirst});const selected=entries[audit.selected];
   audit.selectedOutcomes=selected.outcomes;
   if(audit.selected){applyCoopRolePlan(ps,selected.plan);audit.changed=true;}
   if(audit.reason==='cancelled')audit.reason=audit.changed?'improved':'no-improvement';
   audit.after=selected.plan.lineup.map(p=>({uid:p.uid,id:p.id,key:selected.plan.get(p.uid),dir:selected.plan.dirs.get(p.uid)}));
  }finally{audit.ms=performance.now()-started;}
 }});
}
