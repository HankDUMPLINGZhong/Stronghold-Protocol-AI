// [ASSUMED] Four-player C: observed ineffective slots may be replaced using owned assets only.
// Every roster receives the same layout pass. Forecast seeds are the inherited independent samples.
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {bodyKeys} from '../../../../../../../../../../../sim/body.js';
import {createForecastSteps} from '../botForecast.js';
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {swiftPrepGains} from './sargonSwift.js';
import {ids} from './sargonPepe.js';
import {fourReview} from './sargonFourReviewGates.js';
import {geometry99} from './sargonCoop99.js';
import {safetyPlans} from './sargonVideoFactors.js';
import {selectPapyrusForecast} from './sargonRound13.js';
const core='sargonShip',base=(ps,p)=>ps.gd.baseIdOf(p.id),mains=new Set([ids.pepe,ids.passenger,ids.titi,ids.gavial4,ids.gavial5,ids.minimalist]);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const medic=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const complete=rs=>rs.length===2&&rs.every((r,i)=>r.valid&&r.sample===i);
const signature=p=>JSON.stringify([...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>[u,k,p.dirs.get(u)]));
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'four-review-C',...e});
function current(ps,h){const p=new h.LayoutPlan();p.lineup=field(ps);for(const [k,q]of ps.board)if(q.kind==='chess'){p.set(q.uid,k);p.dirs.set(q.uid,q.dir||'RIGHT');}return p;}
function observe(ps,b){
  const casts={},firstDeath={},deaths={},alive={},contact={};
  b.on('skillStart',({unit:u})=>{if(u?.kind==='op'&&u.ownerId===ps.playerId)casts[u.uid]=(casts[u.uid]||0)+1;});
  b.on('death',({unit:u,reason})=>{if(reason==='killed'&&u?.kind==='op'&&u.ownerId===ps.playerId){firstDeath[u.uid]??=b.time;deaths[u.uid]=(deaths[u.uid]||0)+1;}});
  b.on('tick',()=>{if(b.tickCount%15)return;const bosses=b.enemies.filter(e=>e.isBoss&&e.alive&&!e.hidden),body=new Set(bosses.flatMap(bodyKeys));
    for(const u of b.units)if(u.kind==='op'&&u.ownerId===ps.playerId&&u.alive&&u.deployed&&!u.hidden){
      alive[u.uid]=(alive[u.uid]||0)+.5;if([...u.rangeKeys].some(k=>body.has(k)))contact[u.uid]=(contact[u.uid]||0)+.5;
    }});
  return pp=>({unitStats:pp.unitStats,casts,firstDeath,unitDeaths:deaths,aliveSeconds:alive,contactSeconds:contact});
}
/** Two complete independent samples must agree on the bottleneck. No actual-combat observations. */
export function contributionTargets(ps,lineup,rows){
  if(!complete(rows))return [];
  return lineup.flatMap(p=>{
    const rec=ps.gd.chess(p.id);if(medic(rec))return [];
    const early=rec.position==='MELEE'&&mains.has(base(ps,p))&&rows.every(r=>
      (r.firstDeath?.[p.uid]??Infinity)<=30&&(r.unitDeaths?.[p.uid]||0)>=2&&(r.casts?.[p.uid]||0)===0);
    const idle=pieceBonds(ps.gd,p).includes(core)&&rows.every(r=>{
      const total=(r.unitStats||[]).reduce((n,s)=>n+(s.dmg||0),0),damage=r.unitStats?.find(s=>s.uid===p.uid)?.dmg||0;
      return (r.aliveSeconds?.[p.uid]||0)>=10&&(r.contactSeconds?.[p.uid]||0)/r.aliveSeconds[p.uid]<.1&&damage<=Math.max(1,total*.01);
    });
    return early||idle?[{uid:p.uid,id:p.id,base:base(ps,p),reason:early?'early-death-no-casts':'low-contact-low-damage'}]:[];
  });
}
export function contributionRosterAllowed(before,after){
  return (after.sargonShip?.count||0)>=6&&['preciShip','swiftShip'].every(k=>(after[k]?.tier||0)>=(before[k]?.tier||0));
}
export function createFourContributionPolicy(parent,api){return Object.freeze({...parent,name:parent.name+'; optional C final contribution',
  *finalBoardSteps(m,ps,h){
    yield* parent.finalBoardSteps(m,ps,h);
    if(!fourReview(m,ps,'C')||m.wave||m.round!==m.gd.bossRound||m.botRehearsal<2)return;
    const original=current(ps,h),policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),selectForecast:selectPapyrusForecast,
      includeBossMetrics:true,observeForecast:b=>observe(ps,b)};
    function* input(p){const q=yield* h.bossInputSteps(m,ps,p.lineup,p,{keepWithdrawn:true});
      for(const [id,n]of Object.entries(swiftPrepGains(ps,p.lineup,p,q.bonds)))if(q.bonds[id])q.bonds[id].layers+=n;return q;}
    const probe=yield* createForecastSteps(m,ps,original.lineup,[original],input,policy);if(!probe)return;
    while(!probe.run(4))yield;const reference=probe.outcomes;
    if(!complete(reference)||reference.some(r=>r.won)){note(ps,{round:m.round,phase:'gate',reason:'invalid-or-predicted-win'});return;}
    const targets=contributionTargets(ps,original.lineup,reference);
    if(!targets.length){note(ps,{round:m.round,phase:'gate',reason:'no-agreed-ineffective-slot',outcomes:reference});return;}
    const eligible=new Set(targets.map(t=>t.uid)),before=api.shadow(ps,original.lineup).bonds;
    const rows=api.rosters(m,ps,{allowEquivalent:true,allCandidates:true,relaxedBases:targets.map(t=>t.base)}).filter(row=>
      original.lineup.some(p=>!row.lineup.includes(p))&&original.lineup.filter(p=>!row.lineup.includes(p)).every(p=>eligible.has(p.uid))
      &&contributionRosterAllowed(before,api.shadow(ps,row.lineup).bonds));
    // Bound to two actual reachable rosters, keeping distinct added types when available.
    const addedKey=row=>row.lineup.filter(p=>!original.lineup.includes(p)).map(p=>base(ps,p)).sort().join('|');
    const chosen=[rows[0],rows.find(row=>addedKey(row)!==addedKey(rows[0]))].filter(Boolean);
    const candidates=[original],seen=new Set([signature(original)]),rosterNotes=[];
    for(const [i,lineup]of [original.lineup,...chosen.map(r=>r.lineup)].entries()){
      const plan=yield* h.planLayoutSteps(api.shadow(ps,lineup),lineup,{formationRoles:true,fireControl:true,
        rng:createRng(deriveSeed(m.seed,`four-review-C-layout:${m.round}:${ps.seat}`))});plan.lineup=lineup;
      if(plan.size!==lineup.length||new Set(plan.values()).size!==lineup.length)continue;
      const weights=new Map(lineup.filter(p=>!medic(ps.gd.chess(p.id))).map(p=>[p.uid,mains.has(base(ps,p))?4:1]));
      // Identical contact/linked-medical and exposure/medical budgets for the original and each new roster.
      const linked=geometry99(m,ps,h,plan,[],weights,'outputs').plans[0],safe=safetyPlans(m,ps,linked||plan,h)[0];
      const plans=[plan,linked,safe].filter(Boolean);
      for(const p of plans)if(!seen.has(signature(p))){seen.add(signature(p));candidates.push(p);}
      rosterNotes.push({roster:i,ids:lineup.map(p=>({uid:p.uid,id:p.id})),generated:plans.length});
    }
    const outcomes=[...reference];
    for(let i=1;i<candidates.length;i+=2){const job=yield* createForecastSteps(m,ps,original.lineup,[original,...candidates.slice(i,i+2)],input,
      {...policy,reuseForecastRows:p=>p===original?reference:null});if(!job)return;while(!job.run(4))yield;
      outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:candidates.indexOf(job.plans[r.index])})));}
    const {index}=selectPapyrusForecast(candidates,outcomes),best=candidates[index];
    if(index){const transition=api.transition(ps,original.lineup,best.lineup);if(!transition)throw Error('Contribution roster unreachable');
      for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);if(!ps.move(added.uid,{area:'board',row,col},best.dirs.get(added.uid))?.ok)throw Error('Contribution roster move rejected');}
      yield* h.applyPlanSteps(m,ps,best.lineup,best);
      if([...best].some(([u,k])=>ps.find(u)?.key!==k||ps.find(u)?.piece.dir!==best.dirs.get(u)))throw Error('Contribution layout rejected');}
    note(ps,{round:m.round,phase:'comparison',targets,availableRosters:rows.length,rosterNotes,index,
      candidates:candidates.map(p=>({roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
  }});}
