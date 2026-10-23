// [ASSUMED] Independent owned-role / R14 roster trials over selected co-op13. No acquisition changes.
// Preserve core/carries/assets/summons; allow a secondary tier to yield to an existing defender/medic.
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';
import { acceptsHealing } from '../botPositioning.js';
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { controlBonds, applyControlPositions } from './lateranoControlBoss.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { enemyPositionPlans, enemyTypeInfo } from './lateranoEnemyTypes.js';
import { coopEntryState, selectCoopSafety, coopGrowthFirstEnabled } from './lateranoCoopSafety.js';
import { coopBossPlans, createCoopBossForecast } from './lateranoCoopBoss.js';

const CORE = 'lateranoShip', MAIN = new Set(['chess_char_6_13_a','chess_char_6_01_a','chess_char_5_01_a','chess_char_3_21_a']);
const tank = r => r.profession === 'TANK' && (r.stats?.blockCnt || 0) > 0;
const healer = r => r.attackKind === 'heal' || ['guardian','incantationmedic'].includes(r.subProfessionId);
const identity = ps => JSON.stringify(ps.allChess().map(p=>[p.uid,p.id,p.items?.map(i=>i.id)||[]]).sort((a,b)=>a[0]-b[0]));
const field = ps => [...ps.board.values()].filter(p=>p.kind==='chess');
const owners = ps => new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
const base = (ps,p) => ps.gd.baseIdOf(p.id);
const quality = (ps,p) => ps.gd.chess(p.id).tier + (ps.gd.isGolden(p.id)?5:0) + (MAIN.has(base(ps,p))?10:0);

/** Build a legal entry path even when a melee replacement cannot enter the removed ranged tile.
 * A reciprocal swap stages the outgoing unit on a compatible tile; no withdrawal needs a free bench slot.
 */
export function coopRoleEntryPlan(ps,h,original,lineup) {
  const plan=new h.LayoutPlan();plan.lineup=lineup;
  for(const p of original.lineup){plan.set(p.uid,original.get(p.uid));plan.dirs.set(p.uid,original.dirs.get(p.uid));}
  const added=lineup.filter(p=>!original.lineup.includes(p)),removed=original.lineup.filter(p=>!lineup.includes(p));
  const pinned=owners(ps),occupied=new Map(original.lineup.map(p=>[original.get(p.uid),p]));
  for(let i=0;i<added.length;i++){
    const a=added[i],r=removed[i],old=plan.get(r.uid);let key=old;
    if(!ps._legal(a,...key.split(',').map(Number))){
      const other=[...occupied].find(([k,p])=>p!==r&&!pinned.has(p.uid)
        &&ps._legal(a,...k.split(',').map(Number))&&ps._legal(r,...k.split(',').map(Number))
        &&ps._legal(p,...old.split(',').map(Number)));
      if(!other)return null;
      const [k,p]=other;key=k;plan.set(p.uid,old);occupied.set(old,p);
    }
    plan.delete(r.uid);plan.dirs.delete(r.uid);plan.set(a.uid,key);plan.dirs.set(a.uid,original.dirs.get(r.uid));occupied.set(key,a);
  }
  return new Set(plan.values()).size===lineup.length?plan:null;
}

function viewOf(ps,plan) {
  const selected=new Set(plan.lineup.map(p=>p.uid));
  const view=Object.assign(Object.create(ps),{board:new Map([...ps.board].filter(([,p])=>p.kind!=='chess')),
    hand:ps.hand.map(p=>selected.has(p?.uid)?null:p),temp:ps.temp.filter(p=>!selected.has(p?.uid)),_legalityStale:false});
  view.hand.push(...field(ps).filter(p=>!selected.has(p.uid)));
  for(const p of plan.lineup)view.board.set(plan.get(p.uid),{...p,dir:plan.dirs.get(p.uid)});
  view.bonds=computeBonds(ps.gd,view);return view;
}

function unchangedRoles(ps,original,lineup,{final=false}={}) {
  const rec=p=>ps.gd.chess(p.id),pinned=owners(ps);
  if(original.lineup.some(p=>(pinned.has(p.uid)||MAIN.has(base(ps,p))||!final&&base(ps,p)==='chess_char_4_02_a')&&!lineup.includes(p)))return false;
  if(original.lineup.some(p=>tank(rec(p)))&&!lineup.some(p=>tank(rec(p))))return false;
  if(original.lineup.some(p=>healer(rec(p)))&&!lineup.some(p=>healer(rec(p))))return false;
  const bonds=controlBonds(ps,lineup);
  if((bonds[CORE]?.count||0)<Math.min(6,ps.bonds[CORE]?.count||0))return false;
  return final||!ps.bonds.visiShip?.active||bonds.visiShip?.active;
}

/** Normal swaps fill actual missing roles; final swaps offer Precision3, main upgrades or usable healing.
 * Only own bench is inspected. Stable ordering and two distinct additions bound the proposal set.
 */
export function coopRolePlans(m,ps,h,recipe,{final=false}={}) {
  const original=bossFormationSnapshot(ps,h),chosen=original.lineup,rec=p=>h.rangeRec(ps,ps.gd.chess(p.id));
  const bench=ps.allChess().filter(p=>!chosen.includes(p)),hasTank=chosen.some(p=>tank(rec(p))),hasHeal=chosen.some(p=>healer(rec(p)));
  const precise=ps.bonds.preciShip?.count||0,proposals=[];
  const offer=(lineup,added)=>{
    if(!unchangedRoles(ps,original,lineup,{final}))return;
    const afterTank=lineup.some(p=>tank(rec(p))),afterHeal=lineup.some(p=>healer(rec(p)));
    const preciseAfter=controlBonds(ps,lineup).preciShip?.count||0;
    const score=100*Number(!hasTank&&afterTank)+80*Number(!hasHeal&&afterHeal)
      +(final&&precise<3&&preciseAfter>=3?150:0)
      +lineup.reduce((n,p)=>n+quality(ps,p),0)-chosen.reduce((n,p)=>n+quality(ps,p),0);
    if(score<=0)return;
    const plan=coopRoleEntryPlan(ps,h,original,lineup);if(plan)proposals.push({plan,score,added:added.map(p=>p.uid).sort((a,b)=>a-b).join(',')});
  };
  for(const a of bench){
    const allowed=final?(pieceBonds(ps.gd,a).includes('preciShip')||MAIN.has(base(ps,a))||healer(rec(a))&&chosen.some(p=>acceptsHealing(rec(p))))
      :!hasTank&&tank(rec(a))||!hasHeal&&healer(rec(a));
    if(!allowed)continue;
    for(const r of chosen)offer(chosen.map(p=>p===r?a:p),[a]);
  }
  if(!final&&!hasTank&&!hasHeal){
    const a=bench.filter(p=>tank(rec(p))).sort((a,b)=>quality(ps,b)-quality(ps,a))[0];
    const b=bench.filter(p=>p!==a&&healer(rec(p))).sort((a,b)=>quality(ps,b)-quality(ps,a))[0];
    if(a&&b)for(let i=0;i<chosen.length;i++)for(let j=0;j<chosen.length;j++)if(i!==j)
      offer(chosen.map((p,k)=>k===i?a:k===j?b:p),[a,b]);
  }
  proposals.sort((a,b)=>b.score-a.score||a.added.localeCompare(b.added));
  const plans=[original],seen=new Set();
  for(const p of proposals){
    if(seen.has(p.added))continue;seen.add(p.added);
    const view=viewOf(ps,p.plan),lineup=p.plan.lineup;
    const alternatives=final?coopBossPlans(m,view,h,recipe):enemyPositionPlans(m,view,h,enemyTypeInfo(m,ps.gd));
    const geometry=alternatives[1]||alternatives[0];
    if(geometry){geometry.lineup=lineup;plans.push(geometry);}else plans.push(p.plan);
    if(plans.length===3)break;
  }
  return plans;
}

/** All exchange actions are legal and preserve the exact forecast, inventory, equipment and pinned summons. */
export function applyCoopRolePlan(ps,plan) {
  const before=identity(ps),expected=stealthBattleInput(ps,plan),original=field(ps),selected=new Set(plan.lineup.map(p=>p.uid));
  const removed=original.filter(p=>!selected.has(p.uid)),added=plan.lineup.filter(p=>!original.includes(p)),pinned=owners(ps);
  if(removed.length!==added.length)throw Error('Role replacement changed roster size');
  const act=(p,key,dir)=>{const [row,col]=key.split(',').map(Number),r=ps.move(p.uid,{area:'board',row,col},dir);
    if(r?.error)throw Error(`Role replacement rejected: ${r.error}`);};
  for(let i=0;i<added.length;i++){
    const a=added[i],r=removed[i];let key=ps.find(r.uid).key;
    if(!ps._legal(a,...key.split(',').map(Number))){
      const other=[...ps.board].find(([k,p])=>p.kind==='chess'&&p!==r&&!pinned.has(p.uid)
        &&ps._legal(a,...k.split(',').map(Number))&&ps._legal(r,...k.split(',').map(Number))&&ps._legal(p,...key.split(',').map(Number)));
      if(!other)throw Error('No legal role entry path');
      const [next,p]=other;act(p,key,p.dir);key=next;
    }
    act(a,key,plan.dirs.get(a.uid));
  }
  applyControlPositions(ps,plan);
  if(identity(ps)!==before)throw Error('Role replacement changed inventory');
  if(JSON.stringify(ps.battleInput())!==JSON.stringify(expected))throw Error('Role replacement differs from forecast');
}

export function selectCoopEmergencyRoles(plans,outcomes,minLeaks=3,options={}) {
  const rows=outcomes.filter(o=>o.index===0);
  if(rows.length!==2||rows.some(o=>!o.valid||o.leaks<minLeaks))return {index:0};
  const selected=selectCoopSafety(plans,outcomes,options),next=outcomes.filter(o=>o.index===selected.index);
  if(selected.index&&!(Math.max(...next.map(o=>o.lost))<Math.max(...rows.map(o=>o.lost))
    ||next.reduce((n,o)=>n+o.lost,0)<rows.reduce((n,o)=>n+o.lost,0)))return {index:0};
  return selected;
}

export function* coopEmergencyRoleSteps(m,ps,h,recipe,{minLeaks=3}={}) {
  if(m.mode!=='coop'||m.isSolo||!m.wave||m.round<7||m.round>=m.gd.bossRound||m.botRehearsal<3)return;
  const start=performance.now(),plans=coopRolePlans(m,ps,h,recipe);if(plans.length<2)return;
  function* inputs(plan){yield;return stealthBattleInput(ps,plan);}
  const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,inputs,{
    prepareForecastInput:(m,ps,_chosen,plan,input)=>prepareDevelopmentInput(m,ps,plan.lineup,plan,input),
    forecastContext:()=>({}),observeForecast:(_b,_c,plan)=>pp=>coopEntryState(ps,plan,pp),
    selectForecast:(plans,outcomes)=>selectCoopEmergencyRoles(plans,outcomes,minLeaks,{growthFirst:coopGrowthFirstEnabled(m,ps)})});
  if(!job)return;while(!job.run(4))yield;if(job.bestIndex)applyCoopRolePlan(ps,job.best);
  (ps._botCoopRoleHistory||=[]).push({round:m.round,index:job.bestIndex,outcomes:job.outcomes,
    candidates:plans.map(p=>({lineup:p.lineup.map(u=>u.id),positions:[...p].map(([uid,key])=>({uid,key,dir:p.dirs.get(uid)}))})),ms:performance.now()-start});
}

export function* coopFinalRosterSteps(m,ps,h,recipe) {
  if(m.mode!=='coop'||m.isSolo||m.wave||m.round!==m.gd.bossRound||m.botRehearsal<3)return;
  const start=performance.now(),plans=coopRolePlans(m,ps,h,recipe,{final:true});if(plans.length<2)return;
  const job=yield* createCoopBossForecast(m,ps,plans,10);if(!job)return;while(!job.run(4))yield;
  if(!job.stale)applyCoopRolePlan(ps,job.best);
  (ps._botCoopFinalRosterHistory||=[]).push({round:m.round,index:job.bestIndex,stale:job.stale,outcomes:job.outcomes,
    candidates:plans.map(p=>({lineup:p.lineup.map(u=>u.id),positions:[...p].map(([uid,key])=>({uid,key,dir:p.dirs.get(uid)}))})),ms:performance.now()-start});
}

export function withLateranoCoopRoles(recipe,{final=false,minLeaks=3}={}) {
  return Object.freeze({...recipe,*finalBoardSteps(m,ps,h){
    if(recipe.finalBoardSteps)yield* recipe.finalBoardSteps(m,ps,h);
    if(final)yield* coopFinalRosterSteps(m,ps,h,recipe);
    else yield* coopEmergencyRoleSteps(m,ps,h,recipe,{minLeaks});
  }});
}
