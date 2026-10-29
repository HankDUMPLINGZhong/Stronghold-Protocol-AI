// [ASSUMED] Independent final-roster research helpers. No economy or teammate inputs.
// Copied beside sargonFactors.js in each immutable test source.
import {createForecastSteps} from '../botForecast.js';
import {completeForecastRows,selectOwnBossDamage,sargonPlanning} from '../botCoopForecast.js';
import {computeBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
const optimized=new WeakSet();
const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs?.get(u)||'RIGHT'}`).join('|');
const rowsAt=(job,index)=>job.outcomes.filter(r=>r.index===index).sort((a,b)=>a.sample-b.sample);

/** Every roster keeps its entry layout and gets the same two local geometry proposal slots before selection. */
export function* fairRosterSteps(m,ps,inherited,h){
  if(m.wave||m.isSolo||!sargonPlanning(m,ps)||m.round!==m.gd.bossRound)return inherited;
  const plans=[...inherited.plans],outcomes=[...inherited.outcomes],seen=new Set(plans.map(signature)),audit=[];
  for(const [index,base]of inherited.plans.entries()){
    if(optimized.has(base))continue;
    const reference=rowsAt(inherited,index);if(!completeForecastRows(reference))continue;
    optimized.add(base);
    const alternatives=h.geometry(base).filter(p=>!seen.has(signature(p))&&seen.add(signature(p))).slice(0,2);
    const row={roster:base.lineup.map(p=>({uid:p.uid,id:p.id})),proposed:alternatives.length,completed:0};audit.push(row);
    if(!alternatives.length)continue;
    const job=yield* createForecastSteps(m,ps,base.lineup,[base,...alternatives],h.input,
      {...h.policy,singlePlanProbe:true,reuseForecastRows:p=>p===base?reference:null});
    if(!job)continue;while(!job.run(4))yield;
    for(const r of rowsAt(job,0)){
      const old=reference.find(q=>q.sample===r.sample);
      if(JSON.stringify(r)!==JSON.stringify({...old,index:0}))throw Error('Fair roster incumbent drift');
    }
    for(let i=1;i<job.plans.length;i++){
      const rows=rowsAt(job,i);if(!completeForecastRows(rows))continue;
      const destination=plans.length;plans.push(job.plans[i]);optimized.add(job.plans[i]);
      outcomes.push(...rows.map(r=>({...r,index:destination})));row.completed++;
    }
  }
  const index=selectOwnBossDamage(plans,outcomes),best=plans[index];
  (ps._sargonFactorHistory||=[]).push({factor:'fair-roster-layout',round:m.round,phase:'comparison',
    inheritedPlans:inherited.plans.length,inheritedIndex:inherited.bestIndex,index,
    addedPlans:plans.length-inherited.plans.length,allocations:audit});
  return {...inherited,plans,outcomes,bestIndex:index,best,chosen:best.lineup||inherited.chosen,development:{index}};
}

/** Use the selected plan as an enumeration anchor without moving, cloning or mutating the real chess pieces. */
export function anchorShadow(ps,plan){
  const selected=new Set(plan.lineup.map(p=>p.uid));
  const shadow=Object.assign(Object.create(ps),{
    board:new Map([...ps.board].filter(([,p])=>p.kind!=='chess')),
    hand:ps.hand.map(p=>selected.has(p?.uid)?null:p),temp:ps.temp.filter(p=>!selected.has(p?.uid))});
  for(const p of plan.lineup){const key=plan.get(p.uid);if(!key)throw Error('Missing anchor tile');shadow.board.set(key,p);}
  for(const p of ps.board.values())if(p.kind==='chess'&&!selected.has(p.uid)){
    const slot=shadow.hand.findIndex(q=>!q);if(slot<0)shadow.temp.push(p);else shadow.hand[slot]=p;
  }
  const ids=p=>p.allChess().map(q=>q.uid).sort((a,b)=>a-b).join(',');
  if(ids(shadow)!==ids(ps))throw Error('Roster anchor changed ownership');
  shadow.bonds=computeBonds(ps.gd,shadow);return shadow;
}
