// [ASSUMED] Independent R14 rescue factors. Copy beside the frozen strategy modules.
import {completeForecastRows,selectOwnBossDamage,sargonPlanning} from '../botCoopForecast.js';
import {createForecastSteps} from '../botForecast.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';
import {lionCoveragePlans} from './sargonLionCoverage.js';
import {anchorShadow} from './sargonRosterFactors.js';
import {finalContact} from './sargonRound17.js';
import {ids} from './sargonPepe.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id);
const rowsAt=(job,i)=>job.outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const main=new Set([ids.passenger,ids.pepe,ids.titi,ids.minimalist]);
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push(e);
export const reliablyWins=rows=>completeForecastRows(rows)&&rows.every(r=>r.won>0);
const sig=p=>[...p].map(([u,k])=>`${u}@${k}:${p.dirs.get(u)}`).sort().join('|');

/** Preserve held cycle pieces and the current roster before using static roster value as a tie-break. */
export function pickEmpireRoster(ps,incumbent,rows){
  const current=new Set(incumbent.lineup.map(p=>p.uid));
  const cycles=incumbent.lineup.filter(p=>[ids.minimalist,ids.leonhardt].includes(base(ps,p)));
  const ranked=rows.filter(r=>r.lineup.some(p=>base(ps,p)===ids.papyrus)).map(r=>({...r,
    cycles:cycles.filter(p=>r.lineup.some(q=>q.uid===p.uid)).length,
    retained:r.lineup.filter(p=>current.has(p.uid)).length}));
  ranked.sort((a,b)=>b.cycles-a.cycles||b.retained-a.retained||b.score-a.score||a.signature.localeCompare(b.signature));
  return ranked[0];
}

/** Add only complete ten-sample trials; every inherited candidate and reference row survives. */
function* compareExtra(m,ps,inherited,plans,h,factor,detail){
  const incumbent=inherited.best,reference=rowsAt(inherited,inherited.bestIndex);
  if(!completeForecastRows(reference))return inherited;
  const seen=new Set(inherited.plans.map(sig));plans=plans.filter(p=>!seen.has(sig(p))&&seen.add(sig(p)));
  if(!plans.length){note(ps,{factor,round:m.round,phase:'gate',reason:'no-new-legal-layout',...detail});return inherited;}
  const job=yield* createForecastSteps(m,ps,incumbent.lineup,[incumbent,...plans],h.input,
    {...h.policy,reuseForecastRows:p=>p===incumbent?reference:null});
  if(!job){note(ps,{factor,round:m.round,phase:'gate',reason:'no-forecast-budget',...detail});return inherited;}
  while(!job.run(4))yield;
  const combined=[...inherited.plans],outcomes=[...inherited.outcomes],added=[];
  for(let i=1;i<job.plans.length;i++){
    const rows=rowsAt(job,i);if(!completeForecastRows(rows))continue;
    const index=combined.length;combined.push(job.plans[i]);added.push(job.plans[i]);
    outcomes.push(...rows.map(r=>({...r,index})));
  }
  const index=selectOwnBossDamage(combined,outcomes),best=combined[index];
  note(ps,{factor,round:m.round,phase:'comparison',...detail,inheritedIndex:inherited.bestIndex,index,
    proposed:plans.length,completed:added.length,
    candidates:job.plans.map(p=>({roster:p.lineup.map(p=>({uid:p.uid,id:p.id})),tiles:[...p],dirs:[...p.dirs]})),
    outcomes:job.outcomes});
  return {...inherited,plans:combined,outcomes,bestIndex:index,best,chosen:best.lineup,development:{index}};
}

/** Give one role-preserving held Papyrus roster its Empire geometry before discarding its medic. */
export function* jointEmpireRosterSteps(m,ps,inherited,h){
  if(m.isSolo||!sargonPlanning(m,ps)||m.wave||m.round!==m.gd.bossRound||m.bossId!=='boss_6')return inherited;
  const factor='rescue-empire-joint',incumbent=inherited.best;
  if(incumbent.lineup.some(p=>base(ps,p)===ids.papyrus)){
    note(ps,{factor,round:m.round,phase:'gate',reason:'selected-roster-already-has-papyrus'});return inherited;}
  const row=pickEmpireRoster(ps,incumbent,h.rosters());
  if(!row){note(ps,{factor,round:m.round,phase:'gate',reason:'no-legal-held-papyrus-roster'});return inherited;}
  const plan=yield* h.plan(row.lineup);
  if(plan.size!==row.lineup.length||new Set(plan.values()).size!==row.lineup.length)return inherited;
  const shadow=anchorShadow(ps,plan),result=yield* lionCoveragePlans(m,shadow,h.helpers,plan,{balanced:true});
  if(!result.plans.length){note(ps,{factor,round:m.round,phase:'gate',reason:result.reason});return inherited;}
  return yield* compareExtra(m,ps,inherited,result.plans,h,factor,{cycles:row.cycles,retained:row.retained,
    proposals:result.proposals,medicUid:result.medicUid});
}

/** Main/cycle pieces knocked out in the first thirty seconds in at least half of common trials. */
export function earlyDeaths(ps,lineup,rows){
  if(!completeForecastRows(rows))return [];
  return lineup.filter(p=>main.has(base(ps,p))).map(p=>{
    const times=rows.map(r=>r.firstDeaths?.[p.uid]).filter(t=>Number.isFinite(t)&&t<=30);
    return {p,n:times.length,mean:times.length?times.reduce((n,t)=>n+t,0)/times.length:Infinity};
  }).filter(r=>r.n>=rows.length/2).sort((a,b)=>b.n-a.n||a.mean-b.mean||a.p.uid-b.p.uid);
}

/** Legal free-tile/turn alternatives: keep contact and existing medical cover, reduce public fixed-body/AOE risk. */
export function earlyDeathPlans(m,ps,h,original,rows){
  const targets=earlyDeaths(ps,original.lineup,rows),model=h.fieldModel(m,ps),occupied=new Set(ps.board.keys());
  const positions=p=>original.get(p.uid).split(',').map(Number);
  const recs=new Map(original.lineup.map(p=>[p.uid,h.rangeRec(ps,ps.gd.chess(p.id))]));
  const centers=model.bossBodies?.map(b=>b.center)||[];
  const wave=m.bossGroupOf?.(ps)?.wave,boss=wave?.spawns.find(s=>s.tag==='boss');
  const radius=ps.gd.enemy(boss?.enemyKey)?.stats?.rangeRadius||3.4;
  const medics=original.lineup.filter(p=>{const r=recs.get(p.uid);return r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);});
  const healed=(p,key)=>acceptsHealing(recs.get(p.uid))&&medics.some(q=>{const [r,c]=positions(q);
    return healingTiles(recs.get(q.uid),r,c,original.dirs.get(q.uid)).has(key);});
  const risk=(p,r,c)=>centers.filter(([a,b])=>(r-a)*(r-a)+(c-b)*(c-b)<=radius*radius).length*10
    +original.lineup.filter(q=>q.uid!==p.uid&&main.has(base(ps,q))).reduce((n,q)=>{
      const [a,b]=positions(q);return n+(Math.abs(r-a)+Math.abs(c-b)<=1?1:0);},0);
  const plans=[],proposals=[];
  const fixedOwners=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  for(const {p,n,mean}of targets){
    if(fixedOwners.has(p.uid))continue;
    const rec=recs.get(p.uid),from=original.get(p.uid),dir=original.dirs.get(p.uid),[r,c]=positions(p);
    const contact=(key,facing)=>{const [row,col]=key.split(',').map(Number);return finalContact(model,rec,new Set(h.rangeTiles(rec,row,col,facing)));};
    const before=contact(from,dir),beforeRisk=risk(p,r,c),alternatives=[];
    for(const [key]of ps.deployMap()){
      const [row,col]=key.split(',').map(Number),distance=Math.abs(r-row)+Math.abs(c-col);
      if(!distance||distance>3||occupied.has(key)||!ps._legal(p,row,col)||healed(p,from)&&!healed(p,key))continue;
      const nextRisk=risk(p,row,col);if(nextRisk>=beforeRisk)continue;
      for(const facing of ['RIGHT','UP','DOWN','LEFT']){
        const nextContact=contact(key,facing);if(nextContact<Math.max(.01,before*.7))continue;
        alternatives.push({uid:p.uid,id:p.id,from,to:key,dir:facing,n,mean,beforeRisk,risk:nextRisk,
          beforeContact:before,contact:nextContact,distance});
      }
    }
    alternatives.sort((a,b)=>a.risk-b.risk||b.contact-a.contact||a.distance-b.distance||a.to.localeCompare(b.to)||a.dir.localeCompare(b.dir));
    const row=alternatives[0];if(!row)continue;
    const plan=new h.LayoutPlan(original);plan.dirs=new Map(original.dirs);plan.lineup=original.lineup;
    plan.set(p.uid,row.to);plan.dirs.set(p.uid,row.dir);plans.push(plan);proposals.push(row);
    if(plans.length===2)break;
  }
  return {plans,proposals,targets:targets.map(({p,n,mean})=>({uid:p.uid,id:p.id,n,mean}))};
}

export function* earlyDeathRosterSteps(m,ps,inherited,h){
  if(m.isSolo||!sargonPlanning(m,ps)||m.wave||m.round!==m.gd.bossRound)return inherited;
  const reference=rowsAt(inherited,inherited.bestIndex),result=earlyDeathPlans(m,ps,h.helpers,inherited.best,reference);
  if(!result.plans.length){note(ps,{factor:'rescue-early-death',round:m.round,phase:'gate',reason:'no-improving-safe-cell',targets:result.targets});return inherited;}
  return yield* compareExtra(m,ps,inherited,result.plans,h,'rescue-early-death',{targets:result.targets,proposals:result.proposals});
}
