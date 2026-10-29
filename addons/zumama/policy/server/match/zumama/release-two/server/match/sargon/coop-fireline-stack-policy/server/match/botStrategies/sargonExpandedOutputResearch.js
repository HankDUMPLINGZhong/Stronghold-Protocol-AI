// [ASSUMED] R14-only owned-output portfolio. Copied into the frozen experiment, never production.
import {createForecastSteps} from '../botForecast.js';
import {sargonPlanning,completeForecastRows,selectOwnBossDamage} from '../botCoopForecast.js';
import {pieceBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
import {createRng,deriveSeed} from '../../../../../../../../../../../../../../../sim/rng.js';
import {swiftPrepGains} from './sargonSwift.js';
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const sig=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs.get(u)}`).join('|');
const rowsAt=(rows,i)=>rows.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const mean=rows=>rows.reduce((n,r)=>n+r.bossDamage,0)/rows.length;
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'expanded-pool-output',round:14,...e});

/** Reserve one single-swap representative per held carry/healer, ranked by incumbent marginal damage cost. */
export function outputRepresentatives(ps,original,rows,reference,limit=4){
  const deployed=new Set(original.map(p=>p.uid)),damage=new Map();
  for(const p of original)damage.set(p.uid,reference.reduce((n,r)=>n+(r.unitStats?.find(u=>u.uid===p.uid)?.dmg||0),0)/reference.length);
  const eligible=p=>{const r=ps.gd.chess(p.id),b=pieceBonds(ps.gd,p);
    return r.attackKind==='heal'||r.subProfessionId==='incantationmedic'
      ||r.tier>=6||b.includes('preciShip')&&r.tier>=4;
  };
  const choices=[];
  for(const p of ps.allChess().filter(p=>!deployed.has(p.uid)&&eligible(p))){
    const candidates=rows.filter(r=>r.lineup.includes(p)&&r.lineup.filter(q=>!deployed.has(q.uid)).length===1);
    candidates.sort((a,b)=>{
      const removed=row=>original.find(p=>!row.lineup.includes(p));
      return (damage.get(removed(a).uid)||0)-(damage.get(removed(b).uid)||0)||b.score-a.score;
    });
    if(candidates.length)choices.push({...candidates[0],added:p,removed:original.find(q=>!candidates[0].lineup.includes(q)),
      marginal:damage.get(original.find(q=>!candidates[0].lineup.includes(q)).uid)||0});
  }
  const value=p=>{const r=ps.gd.chess(p.id);return r.tier*3+(ps.gd.isGolden(p.id)?12:0)+(r.attackKind==='heal'?3:0);};
  choices.sort((a,b)=>value(b.added)-value(a.added)||a.marginal-b.marginal||a.added.uid-b.added.uid);
  const seen=new Set();return choices.filter(r=>!seen.has(r.signature)&&seen.add(r.signature)).slice(0,limit);
}

export function createExpandedOutputPolicy(parent,api){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    yield* parent.finalBoardSteps(m,ps,h);
    if(m.isSolo||m.wave||!sargonPlanning(m,ps)||m.round!==m.gd.bossRound)return;
    const original=new h.LayoutPlan();original.lineup=field(ps);
    for(const p of original.lineup){original.set(p.uid,ps.find(p.uid).key);original.dirs.set(p.uid,p.dir||'RIGHT');}
    function* input(plan){const snapshot=yield* h.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true});
      const gains=swiftPrepGains(ps,plan.lineup,plan,snapshot.bonds);
      for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;return snapshot;}
    const policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),includeBossMetrics:true,
      observeForecast:()=>pp=>({unitStats:pp.unitStats})};
    const control=yield* createForecastSteps(m,ps,original.lineup,[original],input,policy);
    if(!control)return;while(!control.run(4))yield;
    const reference=rowsAt(control.outcomes,0);if(!completeForecastRows(reference))return;
    // Even a predicted clear in a subset of samples must not suppress an output alternative.
    const rows=api.rosters(m,ps,{swiftPortfolio:true,allCandidates:true});
    const reps=outputRepresentatives(ps,original.lineup,rows,reference),plans=[original],outcomes=[...reference],audit=[];
    const seen=new Set([sig(original)]);
    for(const [index,row]of reps.entries()){
      const alternatives=[];
      // Preserve all incumbent positions first if the replacement can occupy the old tile.
      const tile=original.get(row.removed.uid),[r,c]=tile.split(',').map(Number);
      if(ps._legal(row.added,r,c)){
        const plan=new h.LayoutPlan(original);plan.delete(row.removed.uid);plan.dirs=new Map(original.dirs);plan.dirs.delete(row.removed.uid);
        plan.set(row.added.uid,tile);plan.dirs.set(row.added.uid,original.dirs.get(row.removed.uid));plan.lineup=row.lineup;alternatives.push(plan);
      }
      const layout=yield* h.planLayoutSteps(api.shadow(ps,row.lineup),row.lineup,{formationRoles:true,fireControl:true,
        rng:createRng(deriveSeed(m.seed,`final-output:${m.round}:${ps.seat}:${index}`))});
      layout.lineup=row.lineup;
      if(layout.size===row.lineup.length&&new Set(layout.values()).size===row.lineup.length)alternatives.push(layout);
      const next=alternatives.filter(p=>!seen.has(sig(p))&&seen.add(sig(p))).slice(0,2);
      if(!next.length)continue;
      const job=yield* createForecastSteps(m,ps,original.lineup,[original,...next],input,
        {...policy,reuseForecastRows:p=>p===original?reference:null});
      if(!job)break;while(!job.run(4))yield;
      for(let i=1;i<job.plans.length;i++){
        const rs=rowsAt(job.outcomes,i);if(!completeForecastRows(rs))continue;
        const at=plans.length;plans.push(job.plans[i]);outcomes.push(...rs.map(r=>({...r,index:at})));
        audit.push({index:at,added:row.added.uid,removed:row.removed.uid,marginal:row.marginal});
      }
    }
    const index=selectOwnBossDamage(plans,outcomes),best=plans[index];
    if(index){
      const transition=api.transition(ps,original.lineup,best.lineup);if(!transition)throw Error('Unreachable output roster');
      for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);
        if(!ps.move(added.uid,{area:'board',row,col},best.dirs.get(added.uid))?.ok)throw Error('Output swap refused');}
      yield* h.applyPlanSteps(m,ps,best.lineup,best);
      if([...best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==best.dirs.get(uid)))throw Error('Output plan application drift');
    }
    note(ps,{phase:'comparison',index,proposed:reps.length,audit,controlMean:mean(reference),selectedMean:mean(rowsAt(outcomes,index)),
      candidates:plans.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
  }});
}

/** Independent factor: move the whole fixed roster together for Lucien, within the inherited shared budget. */
export function createLucienWindowPolicy(parent,api){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    yield* parent.finalBoardSteps(m,ps,h);
    if(m.isSolo||m.wave||!sargonPlanning(m,ps)||m.round!==m.gd.bossRound||m.bossId!=='boss_5')return;
    const plans=yield* api.windowPlans(m,ps,h,{ids:{faith:'none'}},{roleDiversity:true});
    if(plans.length<2)return;
    function* input(plan){const snapshot=yield* h.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true});
      const gains=swiftPrepGains(ps,plan.lineup,plan,snapshot.bonds);
      for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;return snapshot;}
    const policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),includeBossMetrics:true};
    const outcomes=[];let reference=null;
    for(let i=1;i<plans.length;i+=2){
      const job=yield* createForecastSteps(m,ps,plans[0].lineup,[plans[0],...plans.slice(i,i+2)],input,
        {...policy,reuseForecastRows:p=>p===plans[0]?reference:null});
      if(!job)break;while(!job.run(4))yield;
      if(!reference){reference=rowsAt(job.outcomes,0);outcomes.push(...reference);}
      for(const row of job.outcomes.filter(r=>r.index>0))outcomes.push({...row,index:row.index+i-1});
    }
    const index=selectOwnBossDamage(plans,outcomes),best=plans[index];
    if(index){yield* h.applyPlanSteps(m,ps,best.lineup,best);
      if([...best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==best.dirs.get(uid)))throw Error('Window application drift');}
    (ps._sargonFactorHistory||=[]).push({factor:'expanded-pool-window',round:14,index,
      candidates:plans.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],window:p.coopAtomicWindow})),outcomes});
  }});
}
