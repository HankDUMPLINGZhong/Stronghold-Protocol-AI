// [ASSUMED] Independent four-seat R1-13 Precision3 + Archetto versus Precision2 + Skillful2.
// Full owned rosters and own public-wave samples only. No market, upgrade, equipment or R14 changes.
import { computeBonds, pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { createRng, deriveSeed } from '../../../../../../../../../../sim/rng.js';
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { planLayoutSteps, LAYOUT_PARAMS } from '../botDevelopment.js';
import { developmentCarries, observeDevelopment, prepareDevelopmentInput, skillfulCoverage } from '../botLateranoDevelopment.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { controlBonds } from './lateranoControlBoss.js';
import { coopRoleEntryPlan, applyCoopRolePlan } from './lateranoCoopRoles.js';
import { coopEntryState } from './lateranoCoopSafety.js';

const CORE='lateranoShip',P='preciShip',S='skillfulShip',A='chess_char_3_21_a';
const MAIN=new Set([A,'chess_char_5_01_a','chess_char_6_01_a','chess_char_6_13_a']);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const base=(ps,p)=>ps.gd.baseIdOf(p.id);
const rec=(ps,p)=>ps.gd.chess(p.id);
const tank=r=>r.profession==='TANK'&&(r.stats?.blockCnt||0)>0;
const medic=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const regular=r=>r.attackKind==='heal';
const scoped=(m,ps,options)=>m.mode==='coop'&&!m.isSolo&&m.order.length===(options.seats??4)&&m.wave&&m.round>=1&&m.round<m.gd.bossRound
  &&m.botRehearsal>=3&&ps.bandId==='band_paganini'&&ps._botFocusId===CORE;
const avg=(rs,k)=>rs.reduce((n,r)=>n+r[k],0)/rs.length;
const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}:${k}:${p.dirs.get(u)}`).join('|');
const assets=ps=>JSON.stringify({funds:ps.funds,level:ps.shop.level,shop:ps.shop.slots,
  pieces:ps.allChess().map(p=>[p.uid,p.id,p.items]).sort((a,b)=>a[0]-b[0])});
function incumbent(ps,h){
  const p=new h.LayoutPlan();p.lineup=field(ps);p.secondaryFamily='original';
  for(const u of p.lineup){p.set(u.uid,ps.find(u.uid).key);p.dirs.set(u.uid,u.dir);}return p;
}
function family(ps,lineup,{allowArchettoCopies=false}={}){
  const skill=lineup.filter(p=>pieceBonds(ps.gd,p).includes(S));
  if(!skill.some(p=>base(ps,p)===A))return null;
  const b=controlBonds(ps,lineup);
  if(b[P]?.count===3&&b[S]?.count===1&&(allowArchettoCopies?skill.every(p=>base(ps,p)===A):skill.length===1&&base(ps,skill[0])===A))return 'precision3-archetto';
  if(b[P]?.count===2&&b[S]?.count===2&&b[S].active&&(allowArchettoCopies?skill.filter(p=>base(ps,p)!==A).length===1:skill.length===2&&skill.filter(p=>base(ps,p)===A).length===1))return 'precision2-skillful2';
  return null;
}

/** Preserve actual six/current native tier, all deployed named carries/tanks/Mostima and summoned owners.
 * Necessary healing is a role: an owned Ptilopsis may replace Titi, but cannot remove the last heal source.
 */
export function secondaryRosters(ps,h,recipe,options={}){
  const original=incumbent(ps,h),chosen=original.lineup,all=ps.allChess();
  const empty={original,families:{'precision3-archetto':[],'precision2-skillful2':[]}};
  if(!all.some(p=>base(ps,p)===A)||!all.some(p=>base(ps,p)!==A&&pieceBonds(ps.gd,p).includes(S)))return empty;
  const pinned=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  const mainUids=new Set([...MAIN].flatMap(id=>chosen.filter(p=>base(ps,p)===id)
    .sort((a,b)=>Number(ps.gd.isGolden(b.id))-Number(ps.gd.isGolden(a.id))||a.uid-b.uid).slice(0,1).map(p=>p.uid)));
  const fixed=new Set(chosen.filter(p=>mainUids.has(p.uid)||base(ps,p)===recipe.ids.mostima||tank(rec(ps,p))||pinned.has(p.uid)).map(p=>p.uid));
  const before=controlBonds(ps,chosen),hasHeal=chosen.some(p=>medic(rec(ps,p))),hasRegular=chosen.some(p=>regular(rec(ps,p)));
  const bench=all.filter(p=>!chosen.includes(p)),removable=chosen.filter(p=>!fixed.has(p.uid)),seen=new Set();
  const quality=lineup=>lineup.reduce((n,p)=>n+rec(ps,p).tier+(ps.gd.isGolden(p.id)?5:0)
    +([recipe.ids.ptilopsis4,recipe.ids.ptilopsis5,recipe.ids.astgenne,recipe.ids.ayerscarpe].includes(base(ps,p))?4:0),0);
  const offer=lineup=>{
    const f=family(ps,lineup,options);if(!f)return;
    // Do not turn the branch comparison into a new duplicate-stack or unrelated carry-upgrade policy.
    if(lineup.some(p=>!chosen.includes(p)&&!(options.allowArchettoCopies&&base(ps,p)===A)&&lineup.filter(q=>base(ps,q)===base(ps,p)).length
      >Math.max(1,chosen.filter(q=>base(ps,q)===base(ps,p)).length)))return;
    const key=lineup.map(p=>p.uid).sort((a,b)=>a-b).join();if(seen.has(key))return;seen.add(key);
    const bonds=controlBonds(ps,lineup);
    if((bonds[CORE]?.count||0)<Math.min(6,before[CORE]?.count||0)||before.visiShip?.active&&!bonds.visiShip?.active)return;
    if(hasHeal&&!lineup.some(p=>medic(rec(ps,p)))||hasRegular&&!lineup.some(p=>regular(rec(ps,p))))return;
    const entry=coopRoleEntryPlan(ps,h,original,lineup);if(!entry)return;
    entry.secondaryFamily=f;empty.families[f].push({lineup,entry,quality:quality(lineup),changes:lineup.filter(p=>!chosen.includes(p)).length});
  };
  offer(chosen);
  // At most two simultaneous substitutions; always a full board, never empty slots to lower damage.
  for(let n=1;n<=2;n++){
    const subsets=(xs,k)=>k===1?xs.map(x=>[x]):xs.flatMap((x,i)=>xs.slice(i+1).map(y=>[x,y]));
    for(const removed of subsets(removable,n))for(const added of subsets(bench,n)){
      const lineup=chosen.map(p=>removed.includes(p)?added[removed.indexOf(p)]:p);offer(lineup);
    }
  }
  for(const rows of Object.values(empty.families))rows.sort((a,b)=>a.changes-b.changes||b.quality-a.quality||a.lineup.map(p=>p.uid).join().localeCompare(b.lineup.map(p=>p.uid).join()));
  return empty;
}

function shadow(ps,plan){
  const chosen=new Set(plan.lineup.map(p=>p.uid));
  const view=Object.assign(Object.create(ps),{board:new Map([...ps.board].filter(([,p])=>p.kind!=='chess')),
    hand:[...ps.hand.map(p=>chosen.has(p?.uid)?null:p),...field(ps).filter(p=>!chosen.has(p.uid))],
    temp:ps.temp.filter(p=>!chosen.has(p?.uid)),_legalityStale:false,_botRouteHistory:(ps._botRouteHistory||[]).slice()});
  for(const p of plan.lineup)view.board.set(plan.get(p.uid),{...p,dir:plan.dirs.get(p.uid)});
  view.bonds=computeBonds(ps.gd,view);return view;
}

/** Static coverage only proposes; real attack-time aura and protected survival are measured below. */
export function secondaryGeometry(m,ps,h,plan){
  const input=stealthBattleInput(ps,plan),units=plan.lineup.map(p=>{
    const [r,c]=plan.get(p.uid).split(',').map(Number),record=h.rangeRec(ps,rec(ps,p)),dir=plan.dirs.get(p.uid);
    return {uid:p.uid,rec:record,bonds:pieceBonds(ps.gd,p),r,c,key:`${r},${c}`,dir,cover:new Set(h.rangeTiles(record,r,c,dir))};
  });
  const carries=units.filter(u=>MAIN.has(base(ps,plan.lineup.find(p=>p.uid===u.uid))));
  const weights=carries.map(u=>({uid:u.uid,weight:Math.max(1,u.rec.stats.atk)}));
  const aura=skillfulCoverage(units,input.bonds,weights),heal=units.filter(u=>medic(u.rec)).map(u=>healingTiles(u.rec,u.r,u.c,u.dir));
  const healed=new Set(units.filter(u=>acceptsHealing(u.rec)&&heal.some(s=>s.has(u.key))).map(u=>u.uid));
  const routes=h.fieldModel(m,ps).routes.filter(r=>!r.fallback&&r.n>0);
  const contact=carries.reduce((n,u)=>n+routes.reduce((v,rt)=>{
    if(rt.fly&&!u.rec.canHitFly)return v;
    return v+rt.n*rt.tiles.filter(k=>u.cover.has(k)).length/Math.max(1,rt.tiles.length);
  },0),0);
  return {healed,coverage:input.bonds[S]?.active?aura.weighted:0,
    score:contact+healed.size*3+(input.bonds[S]?.active?aura.weighted*12:0),bonds:input.bonds};
}

export function* secondaryPlans(m,ps,h,recipe,options={}){
  const {original,families}=secondaryRosters(ps,h,recipe,options);
  const familiesNames=Object.keys(families);
  if(familiesNames.some(k=>!families[k].length))return {plans:[original],reason:'missing-protected-family',available:Object.fromEntries(familiesNames.map(k=>[k,families[k].length]))};
  const baseline=secondaryGeometry(m,ps,h,original),pinned=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  const protect=original.lineup.filter(p=>MAIN.has(base(ps,p))||tank(rec(ps,p)));
  const plans=[original];
  for(const name of familiesNames){
    const proposals=[];
    for(const [index,row]of families[name].slice(0,2).entries()){
      const view=shadow(ps,row.entry),rng=createRng(deriveSeed(m.seed,`coop-secondary:${m.round}:${ps.seat}:${name}:${index}`));
      // A cold bond/route cache may use m.rngBots internally even when placement receives rng.
      // Match can itself be a seat-policy proxy: every planning assignment stays in a local overlay.
      const overlay=new Map([['rngBots',rng]]),planning=new Proxy(m,{
        get(target,key){return overlay.has(key)?overlay.get(key):Reflect.get(target,key,target);},
        set(_target,key,value){overlay.set(key,value);return true;},
      });
      const full=yield* planLayoutSteps(planning,view,row.lineup,LAYOUT_PARAMS,{fireControl:true,developmentPhase:'farm',rng});
      full.lineup=row.lineup;full.secondaryFamily=name;
      for(const plan of [row.entry,full]){
        if(plan.size!==row.lineup.length||new Set(plan.values()).size!==row.lineup.length
          ||row.lineup.some(p=>!ps._legal(p,...plan.get(p.uid).split(',').map(Number)))
          ||[...plan.values()].some(k=>ps.board.get(k)?.kind==='token')
          ||original.lineup.some(p=>pinned.has(p.uid)&&(plan.get(p.uid)!==original.get(p.uid)||plan.dirs.get(p.uid)!==original.dirs.get(p.uid))))continue;
        const geo=secondaryGeometry(m,ps,h,plan);
        if(protect.some(p=>baseline.healed.has(p.uid)&&!geo.healed.has(p.uid)))continue;
        if(name==='precision2-skillful2'&&(geo.coverage<.8||original.lineup.some(p=>base(ps,p)===recipe.ids.executorAlter)
          &&!skillfulCoverage(plan.lineup.map(p=>{const [r,c]=plan.get(p.uid).split(',').map(Number);return {uid:p.uid,rec:rec(ps,p),bonds:pieceBonds(ps.gd,p),r,c};}),geo.bonds,
            original.lineup.filter(p=>base(ps,p)===recipe.ids.executorAlter).map(p=>({uid:p.uid,weight:1}))).minimum))continue;
        proposals.push({plan,score:geo.score});
      }
    }
    proposals.sort((a,b)=>b.score-a.score||signature(a.plan).localeCompare(signature(b.plan)));
    if(!proposals.length)return {plans:[original],reason:'no-protected-complete-layout',family:name};
    plans.push(proposals[0].plan);
  }
  return {plans,reason:null};
}

/** No extra LP budget. Compare all complete families against the unchanged control in common samples.
 * Growth counts Precision normally; an inactive single Archetto aura contributes zero, not100% coverage.
 */
export function selectSecondaryBalance(plans,outcomes,ctx){
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  const valid=rs=>rs.length===FORECAST_SAMPLES&&rs.every((r,i)=>r.valid&&r.sample===i
    &&['lost','leaks','growth','coverage','entryReady','criticalDown','healersAlive','tanksAlive'].every(k=>Number.isFinite(r[k])));
  if(!valid(rows[0]))return {index:0};
  const score=rs=>avg(rs,'growth')+avg(rs,'coverage')*Math.min(8,2+(ctx.layers[S]||0)/20);
  // [ASSUMED] A buffered, nonlethal one-LP improvement must not automatically buy away
  // a quarter of development value, or a robust same-round Vision payout breakpoint.
  // This never permits extra forecast leaks, protected casualties or a last tank/healer loss.
  const minorSafetySacrifice=rs=>{
    if(!ctx.balanceSafetyGrowth||!Number.isFinite(ctx.openingLP)||!(ctx.remaining>0))return false;
    const original=rows[0],worst=Math.max(...original.map(r=>r.lost)),gain=worst-Math.max(...rs.map(r=>r.lost));
    if(worst>2||gain<=0||gain>1||ctx.openingLP-worst<6||original.some(r=>r.criticalDown>0
      ||[...ctx.protectedUids].some(uid=>(r.protectedDeaths?.[uid]||0)>0)))return false;
    const vision=ctx.layers.visiShip||0;
    const payoutLost=[80,150].some(n=>vision<n&&original.every(r=>vision+(r.gains?.visiShip||0)>=n)
      &&rs.some(r=>vision+(r.gains?.visiShip||0)<n));
    return payoutLost||score(original)>0&&score(rs)<score(original)*.75;
  };
  const rank=rs=>[-Math.max(...rs.map(r=>r.lost)),-avg(rs,'lost'),-avg(rs,'leaks'),score(rs),avg(rs,'coverage'),avg(rs,'entryReady')];
  const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]>b[i];return false;};
  let index=0;const growthSacrifices=[];
  for(let i=1;i<plans.length;i++){
    if(!valid(rows[i])||rows[i].some((r,s)=>{
      const b=rows[0][s];return r.lost>b.lost||r.leaks>b.leaks||r.criticalDown>b.criticalDown
        ||r.healersAlive<Math.min(1,b.healersAlive)||r.tanksAlive<Math.min(1,b.tanksAlive)
        ||[...ctx.protectedUids].some(uid=>(r.protectedDeaths?.[uid]||0)>(b.protectedDeaths?.[uid]||0)
          ||(r.protectedFirstDeaths?.[uid]??Infinity)+1<(b.protectedFirstDeaths?.[uid]??Infinity));
    }))continue;
    if(minorSafetySacrifice(rows[i])){growthSacrifices.push(i);continue;}
    if(better(rank(rows[i]),rank(rows[index])))index=i;
  }
  return {index,value:score(rows[index]),growthSacrifices};
}

export function* secondaryBalanceSteps(m,ps,h,recipe,options={}){
  if(!scoped(m,ps,options))return;
  const before=assets(ps),input=JSON.stringify(ps.battleInput()),start=performance.now();
  const proposed=yield* secondaryPlans(m,ps,h,recipe,options);
  if(proposed.reason){
    if(ps.allChess().some(p=>base(ps,p)===A))(ps._botCoopFactorHistory||=[]).push({factor:'secondary-balance',round:m.round,...proposed,plans:undefined});
    return;
  }
  const {plans}=proposed,common=plans[0].lineup.filter(p=>plans.every(q=>q.lineup.includes(p)));
  const protectedUids=new Set(common.filter(p=>MAIN.has(base(ps,p))||tank(rec(ps,p))).map(p=>p.uid));
  let carries=developmentCarries(common.filter(p=>MAIN.has(base(ps,p))).map(p=>({uid:p.uid,rec:rec(ps,p)})));
  for(const p of common.filter(p=>MAIN.has(base(ps,p))))if(!carries.some(c=>c.uid===p.uid))carries.push({uid:p.uid,weight:Math.max(1,rec(ps,p).stats.atk)});
  const ctx={carries,protectedUids,layers:{...ps.layers},remaining:m.gd.bossRound-m.round,
    lemuen:common.some(p=>base(ps,p)===recipe.ids.lemuen),skillful:true,
    openingLP:ps.lp,balanceSafetyGrowth:!!options.balanceSafetyGrowth};
  function* inputs(plan){yield;return stealthBattleInput(ps,plan);}
  const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,inputs,{
    prepareForecastInput:(m,ps,_chosen,plan,x)=>prepareDevelopmentInput(m,ps,plan.lineup,plan,x),forecastContext:()=>ctx,
    observeForecast(battle,context,plan){
      // A held Archetto may enter both full alternatives even when the control leaves her on the bench.
      const planCarries=plan.lineup.filter(p=>MAIN.has(base(ps,p))).map(p=>({uid:p.uid,
        weight:Math.max(1,(rec(ps,p).stats.atk||0)*(rec(ps,p).stats.aspd||100)/(100*Math.max(.2,rec(ps,p).stats.bat||1)))}));
      const bonds=controlBonds(ps,plan.lineup),total=planCarries.reduce((n,c)=>n+c.weight,0)||1;
      const precisionShare=planCarries.reduce((n,c)=>{const p=plan.lineup.find(p=>p.uid===c.uid);return n+(pieceBonds(ps.gd,p).includes(P)
        ||bonds[P]?.count>=3&&rec(ps,p).position==='RANGED'?c.weight:0);},0)/total;
      const observe=observeDevelopment(battle,{...context,carries:planCarries,precisionShare},plan);let attacks=0,buffed=0;
      battle.on('attack',({attacker:u})=>{if(planCarries.some(c=>c.uid===u?.uid)){attacks++;if(u.findBuff('bond:skillfulShip'))buffed++;}});
      return pp=>{const ends=new Map((pp.unitsEnd||[]).map(u=>[u.uid,u])),measured=observe(pp);
        return {...coopEntryState(ps,plan,pp),...measured,mainAttacks:attacks,mainBuffedAttacks:buffed,
          healersAlive:plan.lineup.filter(p=>medic(rec(ps,p))&&ends.get(p.uid)?.alive).length,
          tanksAlive:plan.lineup.filter(p=>tank(rec(ps,p))&&ends.get(p.uid)?.alive).length};};
    },selectForecast:selectSecondaryBalance,
  });
  if(!job)return;while(!job.run(4))yield;
  if(assets(ps)!==before||JSON.stringify(ps.battleInput())!==input)return;
  if(job.bestIndex)applyCoopRolePlan(ps,job.best);
  if(assets(ps)!==before)throw Error('Secondary roster factor changed funds, market or owned assets');
  (ps._botCoopFactorHistory||=[]).push({factor:'secondary-balance',round:m.round,index:job.bestIndex,
    allowArchettoCopies:!!options.allowArchettoCopies,
    balanceSafetyGrowth:!!options.balanceSafetyGrowth,openingLP:ctx.openingLP,
    decision:selectSecondaryBalance(job.plans,job.outcomes,ctx),
    family:job.best.secondaryFamily,outcomes:job.outcomes,ms:performance.now()-start,
    candidates:job.plans.map(p=>({family:p.secondaryFamily,bonds:controlBonds(ps,p.lineup),
      roster:p.lineup.map(u=>({uid:u.uid,id:u.id,key:p.get(u.uid),dir:p.dirs.get(u.uid)}))}))});
}

export function withCoopSecondaryBalance(parent,options={}){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
    yield* secondaryBalanceSteps(m,ps,h,parent,options);
  }});
}
