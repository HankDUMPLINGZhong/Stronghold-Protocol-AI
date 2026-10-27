// [ASSUMED] Keep Papyrus available; only compare optional deployments after all inherited final forecasts fail.
import { ids } from './sargonPepe.js';
import { createPapyrusResidentPolicy } from './sargonRound12.js';
import { createForecastSteps } from '../botForecast.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'papyrus-conditional',...e});
const complete=rows=>rows.length===2&&[0,1].every(sample=>rows.some(r=>r.sample===sample&&r.valid));
const rowsAt=(job,index)=>job.outcomes.filter(r=>r.index===index).sort((a,b)=>a.sample-b.sample);

export function createConditionalPapyrusPolicy(parent){
  return Object.freeze({...parent,name:'26/7: protect Papyrus ownership, compare optional final deployment',
    preserve:createPapyrusResidentPolicy(parent).preserve,conditionalPapyrus:true});
}
export function papyrusForecastMetrics(policy,ps){
  return {...policy,includeBossMetrics:true,
    observeForecast(battle,context,plan){
      const observe=policy.observeForecast(battle,context,plan),deaths={};
      battle.on('death',({unit})=>{if(unit?.kind==='op'&&unit.ownerId===ps.playerId)deaths[unit.uid]??=battle.time;});
      return pp=>({...observe(pp),firstDeaths:deaths});
    }};
}
export function canComparePapyrus(m,ps,job){
  return !m.wave&&m.isSolo&&m.round===m.gd.bossRound&&ps.allChess().some(p=>base(ps,p)===ids.papyrus)
    &&job.plans.every((_,i)=>complete(rowsAt(job,i)))&&job.outcomes.every(r=>r.won===0);
}

/** A candidate must pay for its output cost in the same paired samples; healing volume alone never wins. */
export function selectPapyrusForecast(plans,outcomes){
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  if(!complete(rows[0]))return {index:0};
  const worst=rs=>Math.min(...rs.map(r=>r.damageShare)),sum=rs=>rs.reduce((n,r)=>n+r.damageShare,0);
  let index=0;
  for(let i=1;i<rows.length;i++){
    const next=rows[i],old=rows[index];if(!complete(next))continue;
    // The unchanged incumbent anchors EACH sample. Do not trade a serious failure for an optimistic mean.
    if(next.some((r,s)=>r.won<rows[0][s].won||r.damageShare+1e-6<rows[0][s].damageShare))continue;
    const wins=next.reduce((n,r)=>n+r.won,0),oldWins=old.reduce((n,r)=>n+r.won,0);
    if(wins>oldWins||wins===oldWins&&(worst(next)>worst(old)+1e-6
      ||Math.abs(worst(next)-worst(old))<=1e-6&&sum(next)>sum(old)+1e-6))index=i;
  }
  return {index};
}

/** All inherited plans/outcomes survive. At most two new rosters, with the incumbent's unchanged rows reused. */
export function* considerPapyrusSteps(m,ps,inherited,h){
  if(!canComparePapyrus(m,ps,inherited)){
    if(!m.wave&&m.round===m.gd.bossRound)note(ps,{round:m.round,phase:'papyrus-gate',
      reason:inherited.outcomes.some(r=>r.won>0)?'inherited-predicted-win':'unavailable-or-invalid'});
    return inherited;
  }
  const incumbent=inherited.best,reference=rowsAt(inherited,inherited.bestIndex),originalIds=new Set(incumbent.lineup.map(p=>p.uid));
  const damage=new Map();for(const r of reference)for(const u of r.unitStats||[])damage.set(u.uid,(damage.get(u.uid)||0)+u.dmg/2);
  const rows=h.rosters().filter(r=>r.lineup.filter(p=>base(ps,p)===ids.papyrus).length===1);
  for(const r of rows){const uids=new Set(r.lineup.map(p=>p.uid));
    r.removed=incumbent.lineup.filter(p=>!uids.has(p.uid));
    r.outputCost=r.removed.reduce((n,p)=>n+(damage.get(p.uid)||0),0);
    r.added=r.lineup.filter(p=>!originalIds.has(p.uid));}
  const cheap=[...rows].sort((a,b)=>a.outputCost-b.outputCost||b.score-a.score||a.signature.localeCompare(b.signature));
  const chosen=[cheap[0],rows.find(r=>r.signature!==cheap[0]?.signature)].filter(Boolean);
  const plans=[incumbent],proposals=[];
  for(const [index,row]of chosen.entries()){
    const plan=yield* h.plan(row.lineup,index);
    if(plan.size!==row.lineup.length||new Set(plan.values()).size!==row.lineup.length)continue;
    plans.push(plan);proposals.push({outputCost:row.outputCost,removed:row.removed.map(p=>({uid:p.uid,id:p.id})),
      added:row.added.map(p=>({uid:p.uid,id:p.id})),score:row.score});
  }
  if(plans.length<2){note(ps,{round:m.round,phase:'papyrus-gate',reason:'no-legal-alternative'});return inherited;}
  const job=yield* createForecastSteps(m,ps,incumbent.lineup,plans,h.input,{...h.policy,
    reuseForecastRows:plan=>plan===incumbent?reference:null,selectForecast:selectPapyrusForecast});
  if(!job)return inherited;while(!job.run(4))yield;
  for(const row of rowsAt(job,0)){
    const old=reference.find(r=>r.sample===row.sample);
    if(JSON.stringify({...old,index:0})!==JSON.stringify(row))throw Error('Papyrus incumbent forecast drift');
  }
  const offset=inherited.plans.length,added=job.plans.slice(1),extraOutcomes=job.outcomes.filter(r=>r.index>0)
    .map(r=>({...r,index:offset+r.index-1}));
  note(ps,{round:m.round,phase:'papyrus-comparison',inheritedPlans:offset,inheritedIndex:inherited.bestIndex,
    selectedExtra:job.bestIndex,newPlans:added.length,newSimulations:extraOutcomes.length,reusedSamples:2,proposals,
    inheritedOutcomes:inherited.outcomes});
  return {...inherited,plans:[...inherited.plans,...added],outcomes:[...inherited.outcomes,...extraOutcomes],
    bestIndex:job.bestIndex?offset+job.bestIndex-1:inherited.bestIndex,best:job.best,chosen:job.chosen};
}
