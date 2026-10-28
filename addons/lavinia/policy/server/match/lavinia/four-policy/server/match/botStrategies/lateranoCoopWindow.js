// [ASSUMED] Independent co-op migration of solo R4–14 facing -> near -> reposition search.
// Same public geometry, fixed roster/items/summons. Normal waves protect own defense and safe farming;
// R14 compares actual shared-team boss fields, never an empty teammate or the actual combat seed.
import { lateranoWindowSteps } from './lateranoWindowRefinement.js';
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { coopEntryState, selectCoopSafety } from './lateranoCoopSafety.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';

export function* coopWindowForecast(m, ps, chosen, plans, inputs, recipe) {
  if (!m.wave) return yield* createCoopBossForecast(m,ps,plans,10);
  return yield* createForecastSteps(m,ps,chosen,plans,inputs,{
    rehearsalValue: recipe.rehearsalValue,
    prepareForecastInput:(m,ps,_chosen,plan,input)=>prepareDevelopmentInput(m,ps,plan.lineup,plan,input),
    forecastContext:()=>({}), observeForecast:(_battle,_ctx,plan)=>pp=>coopEntryState(ps,plan,pp),
    selectForecast:selectCoopSafety,
  });
}

export function* coopWindowSteps(m, ps, h, recipe, { bossOnly = false } = {}) {
  if (m.mode !== 'coop' || m.isSolo) return;
  yield* lateranoWindowSteps(m,ps,{...h,windowForecast:coopWindowForecast},recipe,{cooperative:true,bossOnly});
}

export function withLateranoCoopWindow(recipe, { bossOnly = false } = {}) {
  return Object.freeze({...recipe,*finalBoardSteps(m,ps,h){
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m,ps,h);
    yield* coopWindowSteps(m,ps,h,recipe,{bossOnly});
  }});
}
