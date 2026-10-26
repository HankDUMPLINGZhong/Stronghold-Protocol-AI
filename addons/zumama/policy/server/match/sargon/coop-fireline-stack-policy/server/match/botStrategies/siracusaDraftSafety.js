import { createForecastBattle, stepForecastBattle } from '../../../../../../../../../../aiCompute/forecast.js';
// [ASSUMED] Zero counted leaks AND every counted enemy resolved in two public-wave samples = safe to roll.
// Shadow input only: no board moves, meta settlement, purchases, rewards or match RNG draws.
import {GEO} from '../../../../../../../../../../../../shared/constants.js';
import {deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {withBounties} from '../../../../../../../../../../waves.js';

export function draftSafetyKey(m,ps) {
  return JSON.stringify([m.round,ps.shop.level,ps.lp,ps.allChess().map(p=>[p.uid,p.id,p.items]),ps.layers,ps.bounties,ps.deviceOverrides]);
}
export function* evaluateDraftSafety(m,ps,input,key) {
  let safe = true;
  for (let sample=0;sample<2;sample++) {
    const battle = createForecastBattle(m, {seed:deriveSeed(m.seed,`siracusa-draft-safe:${m.round}:${ps.seat}:${sample}`),
      kind:'normal',modeId:m.modeId,round:m.round,stageId:m.stageId,rect:{...GEO.NORMAL_RECT},timeLimit:m.wave.timeLimit,
      players:[structuredClone(input)],spawns:m._sanitizeSpawns(withBounties(m.gd,m.round,m.wave,ps.bounties,ps.playerId).map(s=>({...s,ownerPlayerId:ps.playerId})),ps.playerId),
      routes:m.wave.routes,sharedBoss:null,flags:{...m.gd.dp,layerGainsEnabled:true},fieldId:`r:${ps.playerId}`,
      enemyOverrides:m.wave.overrides,waveId:m.wave.templateId});
    const cap=Math.ceil(((m.wave.timeLimit||60)+5)*30);
    for(let i=0;i<cap&&!battle.finished;i++){stepForecastBattle(battle);if(i%120===0)yield;}
    const result=battle.result(),pp=result.perPlayer?.[ps.playerId];
    if(!battle.finished||result.errors||!pp||(pp.leaked||[]).some(e=>e.counted!==false)||(pp.killedInTotal||0)<(pp.total||0))safe=false;
    yield;
  }
  ps._botDraftSafety={key,round:m.round,safe};
  const stats=ps._botRecipeStats||={};stats.draftSafetyChecks=(stats.draftSafetyChecks||0)+1;
  if(safe)stats.draftSafeChecks=(stats.draftSafeChecks||0)+1;
}
