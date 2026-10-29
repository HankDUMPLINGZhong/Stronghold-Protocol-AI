// [ASSUMED] Independent co-op normal-wave factor; fixed roster, assets and economic hooks.
// Public paths propose. Complete common forecasts preserve own defense before valuing Unite entry health.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { enemyPositionPlans, enemyTypeInfo } from './lateranoEnemyTypes.js';
import { stealthBattleInput, stealthContactPlans, stealthWaveInfo } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { coreStrategy } from '../botCoreStrategies.js';

const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_21_a']);
const average = (rows, key) => rows.reduce((n, r) => n + r[key], 0) / rows.length;

export const coopGrowthFirstEnabled=(m,ps)=>m.mode==='coop'&&!m.isSolo&&!!m.wave&&m.round<m.gd.bossRound
  &&ps.bandId==='band_paganini'&&ps._botFocusId==='lateranoShip'&&coreStrategy(m,'lateranoShip')?.coopGrowthFirst===true;

/** [ASSUMED] Normal-wave growth priority only; all acquisition, risk and boss hooks stay inherited. */
export const withCoopGrowthFirst=recipe=>Object.freeze({...recipe,coopGrowthFirst:true});

/** Only transferable state: survivors' HP and stored SP. Active skills do not restart in Unite. */
export function coopEntryState(ps, plan, pp) {
  const end = new Map((pp.unitsEnd || []).map(u => [u.uid, u]));
  let weight = 0, ready = 0, criticalDown = 0;
  for (const p of plan.lineup) {
    const r = ps.gd.chess(p.id), id = ps.gd.baseIdOf(p.id), u = end.get(p.uid);
    const healer = r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
    const front = r.profession === 'TANK' && (r.stats?.blockCnt || 0) > 0;
    const critical = MAIN.has(id) || healer || front;
    const w = MAIN.has(id) ? 4 : healer || front ? 3 : 1;
    weight += w;
    if (u?.alive) {
      const cost = Number(r.skill?.bb?.sp_cost) || Number(r.skill?.spCost) || 0;
      ready += w * (.5 + .5 * Math.max(0, Math.min(1, u.hpPct || 0))
        + (cost > 0 ? .1 * Math.max(0, Math.min(1, u.sp / cost)) : 0));
    } else if (critical) criticalDown++;
  }
  const gains = { ...pp.layerGains };
  for (const extra of [plan.development?.fin, plan.development?.next])
    for (const [id, n] of Object.entries(extra || {})) gains[id] = (gains[id] || 0) + n;
  return { entryReady: weight ? ready / weight : 0, criticalDown,
    growth: ['lateranoShip', 'preciShip', 'skillfulShip', 'visiShip'].reduce((n, id) => n + (gains[id] || 0), 0) };
}

/** Never accept extra own leaks in either sample. Keep safe farming unless entry readiness clearly improves. */
export function selectCoopSafety(plans, outcomes, {growthFirst=false}={}) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a,b) => a.sample-b.sample));
  const valid = rs => rs.length === FORECAST_SAMPLES && rs.every((r,i) => r.valid && r.sample === i
    && [r.entryReady, r.criticalDown, r.growth, r.leaks, r.lost].every(Number.isFinite));
  if (!valid(rows[0])) return { index: 0 };
  const rank = rs => [rs.filter(r => r.leaks === 0).length, -Math.max(...rs.map(r => r.lost)),
    -average(rs,'lost'), -average(rs,'leaks'), -Math.max(...rs.map(r => r.criticalDown)),
    ...(growthFirst?[average(rs,'growth')]:[Math.min(...rs.map(r => r.entryReady)), average(rs,'entryReady'), average(rs,'growth')])];
  const better = (a,b) => { for(let i=0;i<a.length;i++) if(Math.abs(a[i]-b[i])>1e-6)return a[i]>b[i]; return false; };
  let index = 0, best = rank(rows[0]);
  for(let i=1;i<plans.length;i++) {
    if(!valid(rows[i]) || rows[i].some((r,j) => r.leaks>rows[0][j].leaks || r.lost>rows[0][j].lost))continue;
    const improvesDefense = rows[i].some((r,j) => r.leaks<rows[0][j].leaks);
    if(!improvesDefense && (!growthFirst&&average(rows[i],'entryReady') < average(rows[0],'entryReady')+.1
      || rows[i].some((r,j) => r.criticalDown>rows[0][j].criticalDown || r.growth<rows[0][j].growth*.9)))continue;
    const next=rank(rows[i]);if(better(next,best)){index=i;best=next;}
  }
  return { index };
}

export function* coopSafetySteps(m, ps, h) {
  if (m.mode !== 'coop' || m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 2
    || [...ps.board.values()].filter(p=>p.kind==='chess').length < 3) return;
  const started = performance.now(), batches = [], threat = enemyTypeInfo(m, ps.gd), hidden = stealthWaveInfo(m,ps.gd).count;
  for(const stage of ['window', ...(hidden ? ['intercept'] : [])]) {
    const plans = stage === 'window' ? enemyPositionPlans(m,ps,h,threat) : stealthContactPlans(m,ps,h);
    if(plans.length<2)continue;
    function* inputSteps(plan){yield;return stealthBattleInput(ps,plan);}
    const growthFirst=coopGrowthFirstEnabled(m,ps);
    const policy = { prepareForecastInput:(m,ps,chosen,plan,input)=>prepareDevelopmentInput(m,ps,plan.lineup,plan,input),
      forecastContext:()=>({}), observeForecast:(_battle,_context,plan)=>pp=>coopEntryState(ps,plan,pp),
      selectForecast:(plans,outcomes)=>selectCoopSafety(plans,outcomes,{growthFirst}) };
    const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,inputSteps,policy);
    if(!job)continue;while(!job.run(4))yield;
    if(job.bestIndex){
      const expected=stealthBattleInput(ps,job.best);applyControlPositions(ps,job.best);
      if(JSON.stringify(ps.battleInput())!==JSON.stringify(expected))throw Error('Co-op safety layout differs from forecast');
    }
    batches.push({stage,index:job.bestIndex,outcomes:job.outcomes,growthFirst});
  }
  (ps._botCoopSafetyHistory ||= []).push({round:m.round,batches,ms:performance.now()-started});
}

export function withLateranoCoopSafety(recipe) {
  return Object.freeze({...recipe,*finalBoardSteps(m,ps,h){
    if(recipe.finalBoardSteps)yield* recipe.finalBoardSteps(m,ps,h);
    yield* coopSafetySteps(m,ps,h);
  }});
}
