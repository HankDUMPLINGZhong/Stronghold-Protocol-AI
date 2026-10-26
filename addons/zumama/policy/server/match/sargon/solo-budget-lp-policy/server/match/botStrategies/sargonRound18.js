import {recordSwiftLpTrade} from './sargonSwiftLpTrade.js';
// [ASSUMED] Without a deployed Sargon/Precision overlap, offer two Swift at one Precision.
// Additive to the complete parent search; actual owned pieces and independent paired forecasts only.
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {createForecastSteps} from '../botForecast.js';
import {isSwiftEngine,swiftForecastPolicy,selectSwiftForecast} from './sargonSwift.js';
import {videoForecastMetrics} from './sargonVideoFactors.js';

export const hasSargonPrecision=(gd,lineup)=>lineup.some(p=>{
  const bonds=pieceBonds(gd,p);return bonds.includes('sargonShip')&&bonds.includes('preciShip');
});

/** Use the inherited per-sample combat protections, then prefer real Swift growth in safe normal waves. */
export function selectSwiftPriority(plans,outcomes,context){
  return selectSwiftForecast(plans,outcomes.map(r=>({...r,growth:r.gains?.swiftShip||0})),context);
}

export function createSwiftPriorityPolicy(parent,api){
  return Object.freeze({...parent,name:'Sargon Swift before external Precision',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(!m.isSolo||m.botRehearsal<2||m.round>m.gd.bossRound)return;
      const original=new h.LayoutPlan();original.lineup=[];
      for(const [key,p]of ps.board)if(p.kind==='chess'){
        original.lineup.push(p);original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');
      }
      const before=api.shadow(ps,original.lineup).bonds;
      if(hasSargonPrecision(ps.gd,original.lineup)||before.swiftShip?.active)return;
      const engine=p=>isSwiftEngine(ps.gd,p)||parent.swiftExtraEngine?.(ps.gd,p);
      const rows=api.rosters(m,ps).filter(r=>r.swift>=2&&r.lineup.some(engine));
      const first=rows.find(r=>r.precision===1)||rows[0];
      const second=rows.find(r=>r!==first&&r.precision!==first.precision)||rows.find(r=>r!==first);
      const plans=[original];
      for(const [index,row]of [first,second].filter(Boolean).entries()){
        const plan=yield* h.planLayoutSteps(api.shadow(ps,row.lineup),row.lineup,{formationRoles:true,fireControl:true,
          rng:createRng(deriveSeed(m.seed,`sargon-swift-priority:${m.round}:${ps.seat}:${index}`))});
        if(plan.size!==row.lineup.length||new Set(plan.values()).size!==row.lineup.length)continue;
        plan.lineup=row.lineup;plans.push(plan);
      }
      if(plans.length<2)return;
      const policy=videoForecastMetrics({...swiftForecastPolicy(m,ps,plans,lineup=>api.shadow(ps,lineup).bonds),
        selectForecast:selectSwiftPriority},ps);
      const job=yield* createForecastSteps(m,ps,original.lineup,plans,
        plan=>h.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true}),policy);
      if(!job)return;while(!job.run(4))yield;
      if(job.bestIndex){
        const transition=api.transition(ps,original.lineup,job.chosen);
        if(!transition)throw Error('Swift priority selected an unreachable roster');
        for(const {added,key}of transition.pairs){
          const [row,col]=key.split(',').map(Number);
          if(!ps.move(added.uid,{area:'board',row,col},job.best.dirs.get(added.uid))?.ok)throw Error('Swift priority swap rejected');
        }
        yield* h.applyPlanSteps(m,ps,job.chosen,job.best);
        if([...job.best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==job.best.dirs.get(uid)))throw Error('Swift priority layout rejected');
      }
      recordSwiftLpTrade(m,ps,job,'swift-priority-round18');
      (ps._sargonFactorHistory||=[]).push({factor:'swift-priority-round18',round:m.round,index:job.bestIndex,
        simulations:job.outcomes.length,before:{core:before.sargonShip?.count,precision:before.preciShip?.count,swift:before.swiftShip},
        candidates:job.plans.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],
          bonds:api.shadow(ps,p.lineup).bonds,prepGains:p.swiftGains})),outcomes:job.outcomes});
    }});
}
