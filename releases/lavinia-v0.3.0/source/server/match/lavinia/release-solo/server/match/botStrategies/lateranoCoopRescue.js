// [ASSUMED] Independent co-op last-chance economy after every complete own forecast predicts elimination.
// Any real pair may use a held Mimic; absent pairs, prefer a pure Laterano target. No future rolls or real-result seed.
import {createForecastSteps,FORECAST_SAMPLES} from '../botForecast.js';
import {prepareDevelopmentInput} from '../botLateranoDevelopment.js';
import {bossFormationSnapshot} from './lateranoBossFormation.js';
import {stealthBattleInput} from './lateranoStealthWave.js';
import {coopRolePlans} from './lateranoCoopRoles.js';
import {enemyPositionPlans,enemyTypeInfo} from './lateranoEnemyTypes.js';
import {LATERANO_KEY_VALUATION} from './lateranoKeyValue.js';
import {lateranoKeyLiquidityPlan,withLateranoKeyLiquidity} from './lateranoKeyLiquidity.js';

const MIMIC='chess_item_5_05_e_a',CORE='lateranoShip';
const scope=(m,ps)=>m.mode==='coop'&&!m.isSolo&&!!m.wave&&m.round<m.gd.bossRound&&m.botRehearsal>=3
  &&ps.bandId==='band_paganini'&&ps._botFocusId===CORE;
const valuation=Object.freeze({...LATERANO_KEY_VALUATION,
  accept(m,ps,recipe,plan){LATERANO_KEY_VALUATION.accept(m,ps,recipe,plan);
    // Existing native/main/last-role/Vision hard sale guards remain. Only the extra margin is released.
    return plan.valuation.value>0&&plan.valuation.value>=plan.valuation.cost;
  }});
const stock=ps=>[...ps.hand,...ps.temp].filter(p=>p?.kind==='item'&&ps.gd.baseIdOf(p.id)===MIMIC);
const stamp=(m,ps)=>JSON.stringify([m.round,ps.lp,ps.funds,ps.battleInput(),ps.hand,ps.temp,ps.shop.slots]);

/** Complete, unique paired rows for EVERY candidate; one survivor or invalid/missing trial vetoes the rescue. */
export function allCoopForecastsFatal(outcomes,lp){
  if(!(lp>0)||!outcomes.length||outcomes.some(r=>!Number.isInteger(r.index)||r.index<0))return false;
  const groups=Map.groupBy(outcomes,r=>r.index);
  return [...groups.values()].every(rs=>rs.length===FORECAST_SAMPLES
    &&new Set(rs.map(r=>r.sample)).size===FORECAST_SAMPLES
    &&rs.every(r=>r.valid&&Number.isInteger(r.sample)&&r.sample>=0&&r.sample<FORECAST_SAMPLES&&Number.isFinite(r.lost)&&r.lost>=lp));
}

/** Only the real ordinary second copy counts. A free slot for the actual third/reward is mandatory. */
export function coopRescueMimicTarget(ps){
  const gd=ps.gd,own=ps.allChess(),base=p=>gd.baseIdOf(p.id);
  if(!ps.hand.some(p=>!p))return null;
  const available=own.filter(p=>!gd.isGolden(p.id)&&(p.items?.length||0)<gd.equipPerChess
    &&!own.some(q=>base(q)===base(p)&&gd.isGolden(q.id)));
  const pairs=available.filter(p=>own.filter(q=>base(q)===base(p)&&!gd.isGolden(q.id)).length>=2);
  const rank=p=>Math.min(6,gd.chess(p.id).tier+1)*20+Number(gd.chess(p.id).bonds.includes(CORE))*5
    +Number(ps.find(p.uid)?.area==='board')*3+gd.chess(p.id).tier;
  if(pairs.length)return pairs.sort((a,b)=>rank(b)-rank(a)||a.uid-b.uid)[0];
  return available.filter(p=>gd.chess(p.id).bonds.includes(CORE))
    .sort((a,b)=>Number(gd.chess(a.id).bonds.length>1)-Number(gd.chess(b.id).bonds.length>1)||rank(b)-rank(a)||a.uid-b.uid)[0]||null;
}

function recorded(m,ps){
  const rows=[];
  for(const h of ps._botCoopSafetyHistory||[])if(h.round===m.round)for(const b of h.batches)rows.push(b.outcomes);
  for(const key of ['_botCoopFactorHistory','_botCoopRoleHistory'])for(const h of ps[key]||[])
    if(h.round===m.round)rows.push(h.outcomes);
  return rows;
}

function* probe(m,ps,h,recipe){
  const original=bossFormationSnapshot(ps,h),roles=coopRolePlans(m,ps,h,recipe),plans=roles.length>1?roles
    :[original,...enemyPositionPlans(m,ps,h,enemyTypeInfo(m,ps.gd)).slice(1)];
  const before=stamp(m,ps);
  function* inputs(plan){yield;return stealthBattleInput(ps,plan);}
  const job=yield* createForecastSteps(m,ps,original.lineup,plans,inputs,{
    forecastReadinessOnly:true,prepareForecastInput:(m,ps,_chosen,p,input)=>prepareDevelopmentInput(m,ps,p.lineup,p,input),
    forecastContext:()=>({}),observeForecast:()=>()=>({}),selectForecast:()=>({index:0}),
  });
  if(!job)return null;while(!job.run(4))yield;
  return {outcomes:job.outcomes,stale:stamp(m,ps)!==before};
}

export function withLateranoCoopRescue(parent){
  const funded=withLateranoKeyLiquidity(parent,valuation);
  return Object.freeze({...parent,
    trade(m,ps,...xs){return ps._botCoopRescueActive?funded.trade(m,ps,...xs):parent.trade(m,ps,...xs);},
    *finalBoardSteps(m,ps,h){
      if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
      if(!scope(m,ps)||ps._botCoopRescueRound===m.round||!h.recoverEconomySteps)return;
      const canAct=()=>stock(ps).length&&coopRescueMimicTarget(ps)||lateranoKeyLiquidityPlan(m,ps,parent,valuation);
      if(!canAct())return;
      const previous=recorded(m,ps);if(!previous.length||previous.some(rows=>!allCoopForecastsFatal(rows,ps.lp)))return;
      let risk=yield* probe(m,ps,h,parent);if(!risk||risk.stale||!allCoopForecastsFatal(risk.outcomes,ps.lp))return;
      ps._botCoopRescueRound=m.round;
      const log={round:m.round,lp:ps.lp,before:risk.outcomes,repairs:[]};(ps._botCoopRescueHistory||=[]).push(log);
      for(let pass=0;pass<2;pass++){
        if(!scope(m,ps)||!canAct())break;
        const item=stock(ps)[0],target=item&&coopRescueMimicTarget(ps),before=stamp(m,ps);
        const action={pass,fundsBefore:ps.funds,item:item?.id,target:target?.id};log.repairs.push(action);
        if(target){const pair=ps.allChess().filter(p=>ps.gd.baseIdOf(p.id)===ps.gd.baseIdOf(target.id)&&!ps.gd.isGolden(p.id)).length>=2;
          action.kind=pair?'mimic-pair':'mimic-laterano';action.used=!!ps.equip(item.uid,target.uid)?.ok;
        }
        ps._botCoopRescueActive=true;
        try{yield* h.recoverEconomySteps();}finally{ps._botCoopRescueActive=false;}
        action.fundsAfter=ps.funds;if(stamp(m,ps)===before)break;
        if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
        risk=yield* probe(m,ps,h,parent);action.after=risk?.outcomes;action.stale=risk?.stale;
        if(!risk||risk.stale||!allCoopForecastsFatal(risk.outcomes,ps.lp)
          ||recorded(m,ps).some(rows=>!allCoopForecastsFatal(rows,ps.lp)))break;
      }
    },
  });
}
