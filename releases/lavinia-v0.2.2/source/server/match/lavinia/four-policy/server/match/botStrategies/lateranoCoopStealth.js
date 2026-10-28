// [ASSUMED] An independent co-op information-visible stealth response over the selected16/56 policy.
// Reserve one functional revealer or pursue one elite; own-side previews decide deployment.
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { stealthRevealer, stealthRosterPlans, stealthBattleInput, stealthWaveInfo } from './lateranoStealthWave.js';
import { coopEntryState } from './lateranoCoopSafety.js';
import { coopSkillfulCoverage, applyCoopRoster } from './lateranoCoopFactors.js';

export const COOP_STEALTH_SAMPLES = 6;
const INES = 'chess_char_4_04_a', CORE = 'lateranoShip';
const scoped = (m,ps) => m.mode === 'coop' && !m.isSolo && m.wave && m.round < m.gd.bossRound
  && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const hasHiddenType = m => m.factions?.includes('INVISIBLE');
const revealed = (ps,p) => {
  const r=ps.gd.chess(p.id);
  return stealthRevealer(loadoutRecord(r,resolveRecordLoadout(r,ps.loadoutFor?.(r))));
};
export function needsCoopRevealer(m,ps) {
  return scoped(m,ps) && hasHiddenType(m) && ps.shop.level>=4 && !ps.allChess().some(p=>revealed(ps,p));
}
const isInes = (ps,r) => ps.gd.baseIdOf(r.chessId||r.id)===INES;
const reserve = (m,ps,r) => scoped(m,ps) && hasHiddenType(m) && isInes(ps,r)
  && !ps.allChess().some(p=>ps.gd.baseIdOf(p.id)!==INES&&revealed(ps,p));
export function coopInesTarget(m,ps,r,pursueElite=false) {
  if(!scoped(m,ps)||!hasHiddenType(m)||ps.shop.level<4||!isInes(ps,r)||r.isGolden)return false;
  const owned=ps.allChess().filter(p=>ps.gd.baseIdOf(p.id)===INES);
  if(owned.some(p=>ps.gd.isGolden(p.id)))return false;
  return pursueElite&&owned.length>0 || needsCoopRevealer(m,ps);
}

/** Six complete common seeds; improve worst/average leaks without lowering clear frequency or own critical safety. */
export function selectCoopStealth(plans,outcomes,ctx) {
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  const valid=xs=>xs.length===COOP_STEALTH_SAMPLES && xs.every((r,i)=>r.valid&&r.sample===i
    && ['lost','leaks','criticalDown','entryReady','skillfulCovered'].every(k=>Number.isFinite(r[k])));
  const sum=(xs,k)=>xs.reduce((n,r)=>n+r[k],0),max=(xs,k)=>Math.max(...xs.map(r=>r[k]));
  const clears=xs=>xs.filter(r=>r.leaks===0).length;
  if(!valid(rows[0])||clears(rows[0])===COOP_STEALTH_SAMPLES)return{index:0};
  const rank=xs=>[xs.filter(r=>r.lost<ctx.lp).length,clears(xs),-max(xs,'lost'),-sum(xs,'lost'),-sum(xs,'leaks'),
    -max(xs,'criticalDown'),sum(xs,'entryReady')];
  let index=0,best=rank(rows[0]);
  for(let i=1;i<rows.length;i++){
    const rs=rows[i];
    if(!valid(rs)||clears(rs)<clears(rows[0])||max(rs,'lost')>max(rows[0],'lost')||sum(rs,'lost')>sum(rows[0],'lost')
      ||sum(rs,'leaks')>sum(rows[0],'leaks')||max(rs,'criticalDown')>max(rows[0],'criticalDown')
      ||rs.some((r,s)=>r.skillfulCovered<rows[0][s].skillfulCovered))continue;
    const next=rank(rs);
    for(let k=0;k<next.length;k++)if(Math.abs(next[k]-best[k])>1e-6){if(next[k]>best[k]){index=i;best=next;}break;}
  }
  return{index};
}

/** Restrict additions to actual revealers; keep carries, six natives, last tank/healer and summon owners inherited. */
export function coopStealthPlans(m,ps,h,recipe) {
  const field=[...ps.board.values()].filter(p=>p.kind==='chess'),view=Object.create(ps);
  view.allChess=()=>ps.allChess().filter(p=>field.includes(p)||revealed(ps,p));
  const plans=stealthRosterPlans(view,h,recipe),model=h.fieldModel(m,ps);
  for(const plan of plans.slice(1))for(const p of plan.lineup.filter(p=>!field.includes(p)&&revealed(ps,p))){
    const [r,c]=plan.get(p.uid).split(',').map(Number),rec=h.rangeRec(ps,ps.gd.chess(p.id));
    const score=dir=>{const cover=new Set(h.rangeTiles(rec,r,c,dir));
      return model.routes.filter(rt=>!rt.fly&&!rt.fallback).reduce((n,rt)=>n+rt.n*rt.tiles.filter(k=>cover.has(k)).length,0);};
    const dirs=[plan.dirs.get(p.uid),'RIGHT','UP','DOWN','LEFT'];
    plan.dirs.set(p.uid,dirs.sort((a,b)=>score(b)-score(a))[0]);
  }
  return plans;
}

export function* coopStealthSteps(m,ps,h,recipe) {
  if(!scoped(m,ps)||m.botRehearsal<3||!stealthWaveInfo(m,ps.gd).count)return;
  const plans=coopStealthPlans(m,ps,h,recipe);if(plans.length<2)return;
  const stamp=JSON.stringify(ps.battleInput()),round=m.round,lp=ps.lp;
  function* inputs(plan){yield;return stealthBattleInput(ps,plan);}
  const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,inputs,{
    forecastNormalSamples:COOP_STEALTH_SAMPLES,
    prepareForecastInput:(m,ps,_chosen,plan,input)=>prepareDevelopmentInput(m,ps,plan.lineup,plan,input),
    forecastContext:()=>({lp}),observeForecast:(_b,_ctx,plan)=>pp=>({...coopEntryState(ps,plan,pp),skillfulCovered:coopSkillfulCoverage(ps,plan)}),
    selectForecast:selectCoopStealth,
  });
  if(!job)return;while(!job.run(4))yield;
  const stale=m.round!==round||ps.lp!==lp||JSON.stringify(ps.battleInput())!==stamp;
  if(!stale&&job.bestIndex)applyCoopRoster(ps,plans[0],job.best);
  (ps._botCoopStealthHistory||=[]).push({round,index:job.bestIndex,stale,samples:COOP_STEALTH_SAMPLES,outcomes:job.outcomes,
    candidates:job.plans.map(p=>({positions:p.lineup.map(u=>({uid:u.uid,id:u.id,key:p.get(u.uid),dir:p.dirs.get(u.uid)}))}))});
}

export function withLateranoCoopStealth(parent,{pursueElite=false}={}) {
  const target=(m,ps,r)=>coopInesTarget(m,ps,r,pursueElite);
  const keepInes=(m,ps,r)=>reserve(m,ps,r)||pursueElite&&scoped(m,ps)&&hasHiddenType(m)&&isInes(ps,r);
  return Object.freeze({...parent,
    purchaseAllowed(m,ps,r,...xs){
      if(scoped(m,ps)&&hasHiddenType(m)&&isInes(ps,r))return target(m,ps,r);
      return parent.purchaseAllowed(m,ps,r,...xs);
    },
    importantBuy:(m,ps,r,...xs)=>target(m,ps,r)||parent.importantBuy(m,ps,r,...xs),
    criticalBuy:(m,ps,r,...xs)=>target(m,ps,r)||parent.criticalBuy(m,ps,r,...xs),
    buyBonus:(m,ps,r,...xs)=>parent.buyBonus(m,ps,r,...xs)+(target(m,ps,r)?35:0),
    keep:(m,ps,r,...xs)=>keepInes(m,ps,r)||parent.keep(m,ps,r,...xs),
    preserve:(m,ps,r,...xs)=>keepInes(m,ps,r)||parent.preserve(m,ps,r,...xs),
    trade(m,ps,ctx,h){
      const key=ps.hand.some(p=>!p)?ps.shop.slots.findIndex(s=>s&&!s.sold&&s.kind==='chess'
        &&target(m,ps,ps.gd.chess(s.id))&&ps.priceOf(s)<=ps.funds):-1;
      const native=ps.shop.slots.some(s=>s&&!s.sold&&s.kind==='chess'&&ps.gd.chess(s.id).bonds.includes(CORE)
        &&parent.criticalBuy(m,ps,ps.gd.chess(s.id))&&ps.priceOf(s)<=ps.funds);
      if(key>=0&&!native){const slot=ps.shop.slots[key],before=new Set(ps.allChess().map(p=>p.uid));
        if(ps.buy(key)?.ok){parent.afterPurchase?.(m,ps,slot,before);parent.useEconomy(m,ps);
          (ps._botCoopStealthBuys||=[]).push({round:m.round,id:slot.id});return true;}
      }
      return parent.trade(m,ps,ctx,h);
    },
    *finalBoardSteps(m,ps,h){if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);yield* coopStealthSteps(m,ps,h,parent);},
  });
}
