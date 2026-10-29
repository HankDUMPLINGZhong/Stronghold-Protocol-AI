// [ASSUMED] Separate map02 normal-board rule for the exposed lower-right deployable corner, not all right-side tiles.
import {coopContactContext,contactChange,contactPlan,contactLineValue,contactForecastSteps} from './lateranoCoopContact.js';

export const forbiddenCoopCorner=(stage,key)=>stage==='act1autochess_m02'&&key==='9,9';

export function coopCornerPlans(m,ps,h,recipe){
  if(![...ps.board].some(([k,p])=>p.kind==='chess'&&forbiddenCoopCorner(m.stageId,k)))return [];
  const state=coopContactContext(m,ps,h,recipe);if(state.current.some(p=>!p))return [];
  const proposals=[];
  for(let i=0;i<state.chosen.length;i++){
    if(!forbiddenCoopCorner(m.stageId,state.current[i].key))continue;
    for(const next of state.options[i]){
      if(forbiddenCoopCorner(m.stageId,next.key))continue;
      const trial=contactChange(state,state.current,i,next);
      if(!trial||trial.some(p=>forbiddenCoopCorner(m.stageId,p.key)))continue;
      proposals.push({trial,score:contactLineValue(trial,state.ctx)});
    }
  }
  proposals.sort((a,b)=>b.score-a.score);const plans=[state.original],seen=new Set();
  for(const p of proposals){const moved=p.trial.find((v,i)=>v.key!==state.current[i].key);if(seen.has(moved.key))continue;seen.add(moved.key);
    plans.push(contactPlan(state,p.trial));if(plans.length===3)break;}
  return plans;
}

/** The corner exclusion itself is the experiment; complete legal alternatives compete even against a safer control. */
export function selectCoopCorner(plans,outcomes){
  let index=0,best=null;
  for(let i=1;i<plans.length;i++){
    const rows=outcomes.filter(o=>o.index===i).sort((a,b)=>a.sample-b.sample);
    if(rows.length!==2||rows.some((r,s)=>!r.valid||r.sample!==s||![r.lost,r.leaks].every(Number.isFinite)))continue;
    const rank=[Math.max(...rows.map(r=>r.lost)),rows.reduce((n,r)=>n+r.leaks,0)];
    if(!best||rank[0]<best[0]||rank[0]===best[0]&&rank[1]<best[1]){index=i;best=rank;}
  }return {index};
}

export function withLateranoCoopCorner(parent){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
    if(m.mode!=='coop'||m.isSolo||!m.wave||m.stageId!=='act1autochess_m02'||m.round>=m.gd.bossRound||m.botRehearsal<3)return;
    yield* contactForecastSteps(m,ps,h,coopCornerPlans(m,ps,h,parent),selectCoopCorner,'corner02');
  }});
}
