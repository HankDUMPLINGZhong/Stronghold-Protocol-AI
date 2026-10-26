// [ASSUMED] One isolated factor: price real Swift growth in LP, without changing candidates or shopping.
import {transferOption} from './sargonTransferConfig.js';
export const SWIFT_LP_LIMITS=Object.freeze({perRound:2,total:4,lpFloor:8,layersPerLp:8,minGain:8});
const rowsAt=(rows,i)=>rows.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const complete=rows=>rows.length===2&&rows.every((r,i)=>r.valid&&r.sample===i);
export function swiftLpContext(m,ps){
  if(!transferOption(m,'lp')
    ||!m.wave||m.round<5||m.round>=m.gd.bossRound)return undefined;
  return {lp:ps.lp,layers:ps.layers.swiftShip||0,remaining:m.gd.bossRound-m.round,
    spent:ps._sargonSwiftLpSpent||0,roundSpent:ps._sargonSwiftLpRound===m.round?ps._sargonSwiftLpRoundSpent||0:0};
}
export function selectSwiftLpTrade(plans,outcomes,context,strict){
  const state=context.swiftLpTrade;if(!state||context.boss)return strict;
  const ref=rowsAt(outcomes,strict.index);if(!complete(ref))return strict;
  const limit=Math.min(SWIFT_LP_LIMITS.perRound-state.roundSpent,SWIFT_LP_LIMITS.total-state.spent);
  if(limit<=0)return strict;
  let chosen=null;
  for(let index=0;index<plans.length;index++){
    if(index===strict.index)continue;
    const rows=rowsAt(outcomes,index);if(!complete(rows))continue;
    const extra=Math.max(...rows.map((r,j)=>r.lost-ref[j].lost));
    const delta=Math.min(...rows.map((r,j)=>(r.gains?.swiftShip||0)-(ref[j].gains?.swiftShip||0)));
    const gains=Math.min(...rows.map(r=>r.gains?.swiftShip||0));
    if(extra<=0||extra>limit||delta<Math.max(SWIFT_LP_LIMITS.minGain,extra*SWIFT_LP_LIMITS.layersPerLp)
      ||state.layers+gains*state.remaining<40)continue;
    if(rows.some((r,j)=>state.lp-r.lost<SWIFT_LP_LIMITS.lpFloor||r.leaks>ref[j].leaks+SWIFT_LP_LIMITS.perRound
      ||r.deaths>ref[j].deaths||[...context.protectedUids].some(uid=>(r.protectedDeaths?.[uid]||0)>(ref[j].protectedDeaths?.[uid]||0))))continue;
    const score=delta-extra*SWIFT_LP_LIMITS.layersPerLp;
    if(!chosen||score>chosen.score||score===chosen.score&&extra<chosen.extra)chosen={index,extra,delta,gains,score};
  }
  return chosen?{index:chosen.index,swiftLpTrade:{...chosen,strictIndex:strict.index,...state}}:strict;
}
export function recordSwiftLpTrade(m,ps,job,source){
  const chosen=job.development?.swiftLpTrade;if(!chosen)return;
  if(ps._sargonSwiftLpRound!==m.round){ps._sargonSwiftLpRound=m.round;ps._sargonSwiftLpRoundSpent=0;}
  ps._sargonSwiftLpRoundSpent+=chosen.extra;ps._sargonSwiftLpSpent=(ps._sargonSwiftLpSpent||0)+chosen.extra;
  (ps._sargonFactorHistory||=[]).push({factor:'coop-swift-lp',phase:'accepted',round:m.round,source,...chosen,
    roundSpentAfter:ps._sargonSwiftLpRoundSpent,spentAfter:ps._sargonSwiftLpSpent,roster:job.chosen.map(p=>({uid:p.uid,id:p.id})),outcomes:job.outcomes});
}
