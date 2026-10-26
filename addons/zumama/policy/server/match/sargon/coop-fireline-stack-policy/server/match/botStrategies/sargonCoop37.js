// [ASSUMED] Independent co-op experiments on 4-2; policy heuristics, never game rules.
// Only owned pieces, visible offers, public routes and independent common forecast samples are used.
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {canPlace,placeClass} from '../../../../../../../../../../board.js';
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {createForecastSteps} from '../botForecast.js';
import {swiftPrepGains} from './sargonSwift.js';
import {visibleUpgradePriority} from './sargonEconomy34.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {ids} from './sargonPepe.js';

const CORE='sargonShip',base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const heal=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const mains=new Set([ids.pepe,ids.passenger,ids.titi]);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const enabled=(m,ps)=>!m.isSolo&&m.opts.botSargonCoopSeat===ps.playerId;
const note=(ps,factor,e)=>(ps._sargonFactorHistory||=[]).push({factor,round:ps.m?.round,...e});
const paired=(rows,index)=>rows.filter(r=>r.index===index).sort((a,b)=>a.sample-b.sample);
const valid=rows=>rows.length===2&&rows.every((r,i)=>r.valid&&r.sample===i);
const fingerprint=lineup=>JSON.stringify(lineup.map(p=>[p.uid,p.id,(p.items||[]).map(i=>[i.uid,i.id])]).sort((a,b)=>a[0]-b[0]));
const signature=p=>JSON.stringify([...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>[u,k,p.dirs.get(u)]));

export function coopOpeningSnapshot(m,ps){
  const own=ps.allChess(),native=own.filter(p=>pieceBonds(ps.gd,p).includes(CORE)),counts=new Map();
  for(const p of native)if(!ps.gd.isGolden(p.id))counts.set(base(ps,p),(counts.get(base(ps,p))||0)+1);
  const kinds=new Set(native.map(p=>base(ps,p))).size,realPair=[...counts.values()].some(n=>n>=2);
  const roles=own.map(p=>ps.gd.chess(p.id));
  return {round:m.round,level:ps.shop.level,lp:ps.lp,funds:ps.funds,price:ps.shop.upgradePrice,
    kinds,realPair,owned:own.length,front:roles.some(front),heal:roles.some(heal),
    eligible:ps.shop.level===3&&m.round>=6&&m.round<=8&&ps.lp>=5&&own.length>=6
      &&roles.some(front)&&roles.some(heal)&&(kinds>=4||kinds>=3&&realPair)};
}
export function createCoopFourPolicy(parent){
  const ready=(m,ps)=>enabled(m,ps)&&ps.shop.level===3&&ps._coop37Opening?.round===m.round
    &&ps._coop37Opening.eligible&&parent.beforeUpgrade(m,ps)&&!visibleUpgradePriority(parent,m,ps).length;
  const lock=(m,ps)=>{
    const s=ps._coop37Four;if(s?.round!==m.round||s.slots!==ps.shop.slots)return false;
    const targets=ps.shop.slots.filter(p=>p&&!p.sold&&p.kind==='chess'&&ps.priceOf(p)>ps.funds
      &&parent.purchaseAllowed(m,ps,ps.gd.chess(p.id))&&parent.importantBuy(m,ps,ps.gd.chess(p.id)));
    if(!targets.length)return false;if(!ps.shop.frozen)ps.freeze();return true;
  };
  return Object.freeze({...parent,name:'4-2 A: opening-qualified one-coin four',
    coopOpening(m,ps){if(!enabled(m,ps))return;ps._coop37Opening=coopOpeningSnapshot(m,ps);
      if(ps.shop.level===3)note(ps,'coop37-four',{phase:'opening',...ps._coop37Opening});},
    upgradeReserve:(m,ps)=>ready(m,ps)?1:parent.upgradeReserve(m,ps),
    spendReserve:(m,ps)=>ready(m,ps)&&parent.priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+1
      ?Math.max(0,ps.shop.upgradePrice):parent.spendReserve(m,ps),
    preparePurchases(m,ps,h){parent.preparePurchases?.(m,ps,h);lock(m,ps);},
    onLevelUp(m,ps,h){
      const released=ps.shop.level===4&&ps._coop37Opening?.eligible&&ps._coop37Opening.round===m.round;
      const funds=ps.funds,special=ps.counters['band:pepe:special']||0;parent.onLevelUp(m,ps,h);
      if(released){ps._coop37Four={round:m.round,slots:ps.shop.slots};lock(m,ps);
        note(ps,'coop37-four',{round:m.round,phase:'upgrade',fundsBeforeRefresh:funds,funds:ps.funds,
          specialBefore:special,specialAfter:ps.counters['band:pepe:special']||0,frozen:ps.shop.frozen});}
    },
    beforeShopRefresh:(m,ps,h)=>lock(m,ps)?false:parent.beforeShopRefresh?.(m,ps,h)});
}

function current(ps,h){const p=new h.LayoutPlan();p.lineup=field(ps);
  for(const [k,q]of ps.board)if(q.kind==='chess'){p.set(q.uid,k);p.dirs.set(q.uid,q.dir||'RIGHT');}return p;}
function* input(m,ps,h,plan){
  const snapshot=yield* h.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true});
  for(const [id,n]of Object.entries(swiftPrepGains(ps,plan.lineup,plan,snapshot.bonds)))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;
  return snapshot;
}
function observer(ps,battle){
  const casts={},deaths={};
  battle.on('skillStart',({unit:u})=>{if(u?.kind==='op'&&u.ownerId===ps.playerId)casts[u.uid]=(casts[u.uid]||0)+1;});
  battle.on('death',({unit:u,reason})=>{if(reason==='killed'&&u?.kind==='op'&&u.ownerId===ps.playerId)deaths[u.uid]=(deaths[u.uid]||0)+1;});
  return pp=>({unitStats:pp.unitStats,casts,unitDeaths:deaths,mainDeaths:Object.entries(deaths)
    .reduce((n,[uid,v])=>n+(mains.has(base(ps,ps.allChess().find(p=>String(p.uid)===uid)||{id:''}))?v:0),0)});
}
export function selectCoopDefense(plans,outcomes){
  const rows=plans.map((_,i)=>paired(outcomes,i));if(!valid(rows[0]))return {index:0};
  const sum=(a,k)=>a.reduce((n,r)=>n+(r[k]||0),0);
  const rank=a=>[-Math.max(...a.map(r=>r.lost)),-sum(a,'lost'),-sum(a,'leaks'),-sum(a,'mainDeaths'),-sum(a,'deaths'),sum(a,'killed')];
  const better=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];return false;};
  let index=0;
  for(let i=1;i<rows.length;i++)if(valid(rows[i])&&rows[i].every((r,j)=>r.lost<=rows[0][j].lost
    &&r.leaks<=rows[0][j].leaks&&r.deaths<=rows[0][j].deaths&&(r.mainDeaths||0)<=(rows[0][j].mainDeaths||0))
    &&better(rank(rows[i]),rank(rows[index])))index=i;
  return {index};
}
export function createCoopDefensePolicy(parent,api){
  return Object.freeze({...parent,name:'4-2 B: final danger role and occupied-swap candidates',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(!enabled(m,ps)||!m.wave||m.round<5||m.botRehearsal<2)return;
      const original=current(ps,h),policy={singlePlanProbe:true,forecastContext:()=>({}),selectForecast:selectCoopDefense,
        observeForecast:b=>observer(ps,b)};
      const probe=yield* createForecastSteps(m,ps,original.lineup,[original],p=>input(m,ps,h,p),policy);
      if(!probe)return;while(!probe.run(4))yield;
      if(!valid(probe.outcomes)||!probe.outcomes.some(r=>r.lost>0||r.mainDeaths>0)){
        note(ps,'coop37-defense',{round:m.round,phase:'gate',reason:'safe-or-invalid',outcomes:probe.outcomes});return;}
      const rows=api.rosters(m,ps,{allowEquivalent:true,allCandidates:true}),roleScore=row=>row.lineup.reduce((n,p)=>{
        const r=ps.gd.chess(p.id);return n+(front(r)?3+Math.min(4,(r.stats?.maxHp||0)/2000):0)+(heal(r)?4:0);
      },0);
      const ranked=[...rows].sort((a,b)=>roleScore(b)-roleScore(a)||b.score-a.score||a.signature.localeCompare(b.signature));
      const selected=[ranked[0],rows.find(r=>r!==ranked[0])].filter(Boolean),plans=[original,...api.geometry(m,ps,original,h)];
      for(const [i,row]of selected.entries()){
        const plan=yield* h.planLayoutSteps(api.shadow(ps,row.lineup),row.lineup,{formationRoles:true,fireControl:true,
          rng:createRng(deriveSeed(m.seed,`coop37-roles:${m.round}:${ps.seat}:${i}`))});plan.lineup=row.lineup;
        if(plan.size===row.lineup.length&&new Set(plan.values()).size===row.lineup.length)plans.push(plan);
      }
      const last=plans.at(-1);if(last!==original&&plans.length<6)plans.push(...api.geometry(m,ps,last,h).slice(0,6-plans.length));
      const outcomes=[...probe.outcomes],candidates=[original],seen=new Set([signature(original)]);
      for(const p of plans.slice(1))if(!seen.has(signature(p))){seen.add(signature(p));candidates.push(p);}
      for(let i=1;i<candidates.length;i+=2){
        const batch=[original,...candidates.slice(i,i+2)],job=yield* createForecastSteps(m,ps,original.lineup,batch,p=>input(m,ps,h,p),
          {...policy,reuseForecastRows:p=>p===original?probe.outcomes:null});
        if(!job)return;while(!job.run(4))yield;
        // Deduplicated plans are remapped by identity, never by an assumed batch offset.
        outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:candidates.indexOf(job.plans[r.index])})));
      }
      const {index}=selectCoopDefense(candidates,outcomes),best=candidates[index];
      if(index){const transition=api.transition(ps,original.lineup,best.lineup);if(!transition)throw Error('Coop defense unreachable roster');
        for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);
          if(!ps.move(added.uid,{area:'board',row,col},best.dirs.get(added.uid))?.ok)throw Error('Coop defense swap rejected');}
        yield* h.applyPlanSteps(m,ps,best.lineup,best);
        if([...best].some(([u,k])=>ps.find(u)?.key!==k||ps.find(u)?.piece.dir!==best.dirs.get(u)))throw Error('Coop defense layout rejected');}
      note(ps,'coop37-defense',{round:m.round,phase:'comparison',index,availableRosters:rows.length,
        candidates:candidates.map(p=>({roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
    }});
}

export function captureCoopBranches(m,ps,plans,recipe){
  if(!enabled(m,ps)||m.opts.botSargonFactor!=='coop37-branches'||m.wave||m.round!==m.gd.bossRound||recipe?.coopBranchCompare)return;
  const state=ps._coop37Branches?.round===m.round?ps._coop37Branches:(ps._coop37Branches={round:m.round,stage:0,plans:[]});
  const stage=state.stage++;
  for(const plan of plans){if(!plan.lineup?.length||state.plans.length>=48)continue;
    const key=signature(plan),roster=fingerprint(plan.lineup);if(state.plans.some(p=>p.key===key&&p.roster===roster))continue;
    state.plans.push({stage,key,roster,tiles:[...plan],dirs:[...plan.dirs]});}
}
export function retainedCoopBranches(ps,h,original){
  const roster=fingerprint(original.lineup),occupied=new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([k])=>k)),map=ps.deployMap();
  const rows=[];
  for(const row of ps._coop37Branches?.plans||[]){
    if(row.roster!==roster||row.key===signature(original))continue;
    const p=new h.LayoutPlan(row.tiles);p.dirs=new Map(row.dirs);p.lineup=original.lineup;
    if(p.size!==original.lineup.length||new Set(p.values()).size!==p.size)continue;
    if(original.lineup.some(q=>{const k=p.get(q.uid);if(!k||occupied.has(k))return true;const [r,c]=k.split(',').map(Number);
      return !canPlace(map,placeClass(ps,ps.gd.chess(q.id)),r,c);}))continue;
    rows.push({plan:p,stage:row.stage});
  }
  const selected=[],stages=new Set();
  for(const row of rows)if(!stages.has(row.stage)){selected.push(row.plan);stages.add(row.stage);}
  for(const row of rows)if(!selected.includes(row.plan))selected.push(row.plan);
  return {plans:selected.slice(0,5),compatible:rows.length,captured:ps._coop37Branches?.plans.length||0};
}
export function createCoopBranchesPolicy(parent){
  return Object.freeze({...parent,name:'4-2 C: retain complete early final branches',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(!enabled(m,ps)||m.wave||m.round!==m.gd.bossRound||m.botRehearsal<2)return;
      const original=current(ps,h),retained=retainedCoopBranches(ps,h,original),plans=[original,...retained.plans];
      if(plans.length<2){note(ps,'coop37-branches',{round:m.round,phase:'gate',captured:retained.captured,compatible:retained.compatible});return;}
      const job=yield* createForecastSteps(m,ps,original.lineup,plans,p=>input(m,ps,h,p),{
        finalProtectionPlans:true,forecastPlanLimit:6,coopBranchCompare:true,forecastContext:()=>({boss:true}),selectForecast:selectPapyrusForecast,
        includeBossMetrics:true,observeForecast:b=>observer(ps,b)});
      if(!job)return;while(!job.run(4))yield;
      if(job.bestIndex){yield* h.applyPlanSteps(m,ps,original.lineup,job.best);
        if([...job.best].some(([u,k])=>ps.find(u)?.key!==k||ps.find(u)?.piece.dir!==job.best.dirs.get(u)))throw Error('Coop branch layout rejected');}
      note(ps,'coop37-branches',{round:m.round,phase:'comparison',captured:retained.captured,compatible:retained.compatible,index:job.bestIndex,
        candidates:job.plans.map(p=>({roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes:job.outcomes});
    }});
}
