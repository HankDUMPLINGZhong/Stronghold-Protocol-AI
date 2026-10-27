// [ASSUMED] R14 co-op shop/cleanup repair for the optional Vision-trade candidate, never a default change.
// Protect achievable mature secondary tiers alongside six natives and acquired carries; no future shops/results.
import {pieceBonds} from '../../../../../bondsMeta.js';
import {bossFormationSnapshot} from './lateranoBossFormation.js';
import {applyCoopRolePlan} from './lateranoCoopRoles.js';

const CORE='lateranoShip',PRECI='preciShip',SKILL='skillfulShip';
const gdOf=(m,ps)=>ps.gd||m.gd;
const base=(gd,p)=>gd.baseIdOf(p.id??p.chessId);
const scoped=(m)=>m.mode==='coop'&&!m.isSolo&&m.round===m.gd.bossRound;
const fullHeal=r=>r.subProfessionId!=='wandermedic'
  &&(r.attackKind==='heal'||r.dmgType==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId));
const tank=r=>r.profession==='TANK'&&(r.stats?.blockCnt||0)>0;
const count=(gd,pieces,bond)=>new Set(pieces.filter(p=>pieceBonds(gd,p).includes(bond)).map(p=>base(gd,p))).size;

/** Minimum slots for distinct-base bond counts. An acquired carry cannot be dropped to make a paper certificate. */
function possibilities(m,ps,recipe,pieces){
  const gd=gdOf(m,ps),groups=new Map(),main=new Set([recipe.ids.executorAlter,recipe.ids.exusiaiAlter,recipe.ids.lemuen,recipe.ids.archetto]);
  for(const p of pieces){
    const id=base(gd,p),b=pieceBonds(gd,p),r=gd.chess(p.id);
    const flags=[...[CORE,PRECI,SKILL].map(k=>Number(!gd.modeInactiveBonds.has(k)&&b.includes(k))),Number(tank(r)),Number(fullHeal(r))];
    if(!groups.has(id))groups.set(id,[]);
    if(!groups.get(id).some(a=>a.join()===flags.join()))groups.get(id).push(flags);
  }
  const caps=[6,3,2,1,1],bonus=caps.map((n,i)=>i<3?Math.min(n,ps.bondCountBonus?.[[CORE,PRECI,SKILL][i]]||0):0);
  let states=new Map([[bonus.join(','),0]]);
  for(const [id,options] of groups){
    const next=main.has(id)?new Map():new Map(states);
    for(const [key,n] of states){
      if(n>=ps.deployCap)continue;
      const current=key.split(',').map(Number);
      for(const flags of options){
        const k=current.map((v,i)=>Math.min(caps[i],v+flags[i])).join(',');
        next.set(k,Math.min(next.get(k)??Infinity,n+1));
      }
    }
    states=next;
  }
  return [...states].filter(([,n])=>n<=ps.deployCap).map(([key])=>key.split(',').map(Number));
}

export function matureCoopPortfolio(m,ps,recipe,{pieces=ps.allChess(),cache=true,roleFirst=true}={}){
  if(!scoped(m))return {precision:0,skillful:0,essential:new Set()};
  const gd=gdOf(m,ps),wantP=(ps.layers[PRECI]||0)>=20&&!gd.modeInactiveBonds.has(PRECI),
    wantS=(ps.layers[SKILL]||0)>=40&&!gd.modeInactiveBonds.has(SKILL);
  const signature=JSON.stringify([m.round,ps.deployCap,roleFirst,wantP,wantS,ps.layers[PRECI]||0,ps.layers[SKILL]||0,
    ps.bondCountBonus,pieces.map(p=>[p.uid,p.id,p.items?.map(i=>i.id)]).sort((a,b)=>a[0]-b[0])]);
  if(cache&&ps._botCoopMarketPortfolio?.signature===signature)return ps._botCoopMarketPortfolio.value;
  let states=possibilities(m,ps,recipe,pieces).filter(s=>s[0]>=6);
  const needTank=roleFirst&&states.some(s=>s[3]>0),needHeal=roleFirst&&states.some(s=>s[3]>=Number(needTank)&&s[4]>0);
  states=states.filter(s=>s[3]>=Number(needTank)&&s[4]>=Number(needHeal));
  const both=states.some(s=>(!wantP||s[1]>=3)&&(!wantS||s[2]>=2));
  let precision=wantP&&states.some(s=>s[1]>=3)?3:0,skillful=wantS&&states.some(s=>s[2]>=2)?2:0;
  if(!both&&precision&&skillful){
    // The value trial does not compare raw layer counts across different bond formulas.
    if(!roleFirst){precision=0;skillful=0;}
    else if((ps.layers[PRECI]||0)>=(ps.layers[SKILL]||0))skillful=0;else precision=0;
  }
  const essential=new Set();
  if(precision||skillful)for(const id of new Set(pieces.map(p=>base(gd,p)))){
    if(!pieces.some(p=>base(gd,p)===id&&(pieceBonds(gd,p).some(k=>k===PRECI&&precision||k===SKILL&&skillful)
      ||needTank&&tank(gd.chess(p.id))||needHeal&&fullHeal(gd.chess(p.id)))))continue;
    if(!possibilities(m,ps,recipe,pieces.filter(p=>base(gd,p)!==id)).some(s=>s[0]>=6&&s[1]>=precision&&s[2]>=skillful
      &&s[3]>=Number(needTank)&&s[4]>=Number(needHeal)))essential.add(id);
  }
  const value={precision,skillful,tank:needTank,healer:needHeal,essential};
  if(cache)ps._botCoopMarketPortfolio={signature,value};
  return value;
}

export function matureCoopRetain(m,ps,recipe,rec,options={}){
  if(!scoped(m))return false;
  const gd=gdOf(m,ps),own=ps.allChess(),id=base(gd,rec),same=own.filter(p=>base(gd,p)===id);
  if(same.length!==1)return false;
  // An elemental medic is not interchangeable with the last normal-throughput healer / Skillful bridge.
  if(fullHeal(rec)&&own.some(p=>base(gd,p)===recipe.ids.archetto)
    &&(ps.layers[SKILL]||0)>=40&&!own.some(p=>base(gd,p)!==id&&fullHeal(gd.chess(p.id))))return true;
  return matureCoopPortfolio(m,ps,recipe,options).essential.has(id);
}

/** New first copies completing a mature tier, or a missing normal healer; second bridge copies are not upgrades. */
export function matureCoopVisibleBuy(m,ps,recipe,rec,options={}){
  if(!scoped(m)||!rec||rec.isGolden||recipe.purchaseAllowed(m,ps,rec)===false)return false;
  const gd=gdOf(m,ps),id=base(gd,rec),own=ps.allChess();
  if(own.some(p=>base(gd,p)===id))return false;
  const now=matureCoopPortfolio(m,ps,recipe,options),future=matureCoopPortfolio(m,ps,recipe,{...options,pieces:[...own,{uid:-1,id:rec.chessId||rec.id,items:[]}],cache:false});
  if(future.precision>now.precision||future.skillful>now.skillful)return true;
  return (now.precision>0||now.skillful>0)&&fullHeal(rec)&&rec.bonds.includes(SKILL)&&!own.some(p=>fullHeal(gd.chess(p.id)));
}

const met=(gd,pieces,bonus,goal)=>count(gd,pieces,CORE)+(bonus?.[CORE]||0)>=6
  &&count(gd,pieces,PRECI)+(bonus?.[PRECI]||0)>=goal.precision
  &&count(gd,pieces,SKILL)+(bonus?.[SKILL]||0)>=goal.skillful
  &&(!goal.tank||pieces.some(p=>tank(gd.chess(p.id))))&&(!goal.healer||pieces.some(p=>fullHeal(gd.chess(p.id))));

export function withLateranoCoopMarketRepair(recipe,{roleFirst=true}={}){
  const options={roleFirst};
  const relevant=(m,ps,r)=>matureCoopVisibleBuy(m,ps,recipe,r,options);
  const protectedRec=(m,ps,r)=>matureCoopRetain(m,ps,recipe,r,options);
  return Object.freeze({...recipe,
    keep:(m,ps,r,...xs)=>protectedRec(m,ps,r)||recipe.keep(m,ps,r,...xs),
    preserve:(m,ps,r,...xs)=>protectedRec(m,ps,r)||recipe.preserve(m,ps,r,...xs),
    importantBuy:(m,ps,r,...xs)=>relevant(m,ps,r)||recipe.importantBuy(m,ps,r,...xs),
    criticalBuy:(m,ps,r,...xs)=>relevant(m,ps,r)||recipe.criticalBuy(m,ps,r,...xs),
    buyBonus(m,ps,r,...xs){return recipe.buyBonus(m,ps,r,...xs)+(relevant(m,ps,r)?35:0);},
    // Keep holdShop absent when the parent lacks it: the shared legacy tail tests hook presence, not only its result.
    // shoppingRepair already freezes unaffordable importantBuy targets, including the new R14 first-copy bridges.
    trade(m,ps,ctx,h){
      if(recipe.trade(m,ps,ctx,h))return true;
      if(!scoped(m))return false;
      const slot=ps.shop.slots.map((s,index)=>({s,index})).find(({s})=>s&&!s.sold&&s.kind==='chess'
        &&ps.priceOf(s)<=ps.funds&&ps.hand.some(p=>!p)&&relevant(m,ps,gdOf(m,ps).chess(s.id)));
      if(!slot)return false;
      const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
      if(!ps.buy(slot.index)?.ok)return false;
      recipe.afterPurchase?.(m,ps,slot.s,before);recipe.useEconomy(m,ps);
      (ps._botCoopMarketHistory||=[]).push({round:m.round,kind:'visible-buy',id:slot.s.id,fundsBefore:funds,fundsAfter:ps.funds});
      return true;
    },
    lineupBonus(gd,pieces,bonds,plan){
      const value=recipe.lineupBonus(gd,pieces,bonds,plan),m=plan.ps?.m;
      if(!m||!scoped(m))return value;
      const goal=matureCoopPortfolio(m,plan.ps,recipe,options);
      if(!goal.precision&&!goal.skillful)return value;
      return value-500*Number(goal.precision>0&&(bonds[PRECI]?.count||0)<goal.precision)
        -500*Number(goal.skillful>0&&(bonds[SKILL]?.count||0)<goal.skillful)
        -800*Number(goal.tank&&!pieces.some(p=>tank(gd.chess(p.id))))
        -600*Number(goal.healer&&!pieces.some(p=>fullHeal(gd.chess(p.id))));
    },
    *finalBoardSteps(m,ps,h){
      const goal=matureCoopPortfolio(m,ps,recipe,options),before=scoped(m)?bossFormationSnapshot(ps,h):null;
      if(recipe.finalBoardSteps)yield* recipe.finalBoardSteps(m,ps,h);
      if(before&&(goal.precision||goal.skillful)&&met(ps.gd,before.lineup,ps.bondCountBonus,goal)
        &&!met(ps.gd,[...ps.board.values()].filter(p=>p.kind==='chess'),ps.bondCountBonus,goal)){
        applyCoopRolePlan(ps,before);
        (ps._botCoopMarketHistory||=[]).push({round:m.round,kind:'restore-mature-roster',precision:goal.precision,skillful:goal.skillful});
      }
    },
  });
}
