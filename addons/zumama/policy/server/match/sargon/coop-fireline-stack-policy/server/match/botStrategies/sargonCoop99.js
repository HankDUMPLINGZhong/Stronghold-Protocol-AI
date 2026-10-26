// [ASSUMED] Three independent experiments on 9-9. Swift rules and acquisition weights stay inherited.
// Only owned assets, visible offers, public routes and common independent forecast samples are used.
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {bodyKeys} from '../../../../../../../../../../../sim/body.js';
import {COLS} from '../../../../../../../../../../../sim/constants.js';
import {DIRS} from '../../../../../../../../../../../sim/dir.js';
import {boardTileOf,canPlace,placeClass} from '../../../../../../../../../../board.js';
import {pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {createForecastSteps} from '../botForecast.js';
import {previewLineupOf,planLayoutSteps,bossInputSteps,LAYOUT_PARAMS} from '../botDevelopment.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';
import {swiftPrepGains} from './sargonSwift.js';
import {visibleUpgradePriority} from './sargonEconomy34.js';
import {finalContact} from './sargonRound17.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {ids} from './sargonPepe.js';
import {keyThirdOffers} from './sargonRound24.js';
import {foreignEngineRank} from './sargonRound22.js';
const CORE='sargonShip',field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess'),base=(ps,p)=>ps.gd.baseIdOf(p.id);
const enabled=(m,ps)=>!m.isSolo&&m.opts.botSargonCoopSeat===ps.playerId&&m.difficulty==='ABYSS';
const coreEngines=new Set([ids.minimalist,ids.gavial4,ids.gavial5,ids.pepe,ids.passenger,ids.titi]);
const meleeCarries=new Set([ids.pepe,ids.gavial4,ids.gavial5,ids.philae]);
const medic=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const rowsAt=(rows,i)=>rows.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const complete=rows=>rows.length===2&&rows.every((r,i)=>r.valid&&r.sample===i);
const note=(ps,mode,e)=>(ps._sargonFactorHistory||=[]).push({factor:'coop99-'+mode,...e});
const finish=g=>{let r;do{r=g.next();}while(!r.done);return r.value;};
const sig=p=>JSON.stringify([...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>[u,k,p.dirs.get(u)]));
const assetKey=ps=>JSON.stringify(ps.allChess().map(p=>[p.uid,p.id,p.items]).sort((a,b)=>a[0]-b[0]));
function current(ps,h){const p=new h.LayoutPlan();p.lineup=field(ps);
  for(const [key,q]of ps.board)if(q.kind==='chess'){p.set(q.uid,key);p.dirs.set(q.uid,q.dir||'RIGHT');}return p;}
function clone(p,h){const q=new h.LayoutPlan(p);q.dirs=new Map(p.dirs);q.reserved=new Set(p.reserved||[]);q.lineup=p.lineup;return q;}
function* input(m,ps,h,p){const q=yield* h.bossInputSteps(m,ps,p.lineup,p,{keepWithdrawn:true});
  for(const [id,n]of Object.entries(swiftPrepGains(ps,p.lineup,p,q.bonds)))if(q.bonds[id])q.bonds[id].layers+=n;return q;}
function observe(ps,battle){
  const casts={},deaths={},alive={},residence=new Map(),f=battle.players.find(p=>p.playerId===ps.playerId)?.side==='R'?'bossR':'bossL';
  battle.on('skillStart',({unit:u})=>{if(u?.kind==='op'&&u.ownerId===ps.playerId)casts[u.uid]=(casts[u.uid]||0)+1;});
  battle.on('death',({unit:u,reason})=>{if(reason==='killed'&&u?.kind==='op'&&u.ownerId===ps.playerId)deaths[u.uid]=(deaths[u.uid]||0)+1;});
  battle.on('tick',()=>{if(battle.tickCount%30)return;
    for(const u of battle.units)if(u.kind==='op'&&u.ownerId===ps.playerId&&u.alive&&u.deployed&&!u.hidden)alive[u.uid]=(alive[u.uid]||0)+1;
    for(const e of battle.enemies)if(e.isBoss&&e.alive&&!e.hidden){
      const tiles=bodyKeys(e).map(k=>boardTileOf(f,Math.floor(k/COLS),k%COLS).join(',')),key=tiles.join('|');if(!tiles.length)continue;
      const row=residence.get(key)||{tiles,count:0};row.count++;residence.set(key,row);
    }
  });return pp=>({unitStats:pp.unitStats,casts,unitDeaths:deaths,aliveSeconds:alive,residence:[...residence.values()]});
}
export function acceptSix99(rows,lp,engines){return complete(rows)&&rows.every(r=>r.lost<lp&&r.deaths<=2
  &&engines.some(e=>(r.casts?.[e.uid]||0)>=(e.minimalist?3:1)));}
export function createCoopSix99(parent){
  const key=(m,ps)=>JSON.stringify([m.round,ps.funds,ps.shop,ps.layers,[...ps.board],assetKey(ps)]);
  const ready=(m,ps)=>enabled(m,ps)&&ps.shop.level===5&&ps._coop99Six?.key===key(m,ps)&&ps._coop99Six.accepted;
  const lock=(m,ps)=>{const s=ps._coop99Six;
    if(!s?.upgraded||s.round!==m.round||s.slots!==ps.shop.slots||m.round>=m.gd.bossRound)return false;
    const targets=ps.shop.slots.filter(p=>p&&!p.sold&&p.kind==='chess'&&ps.priceOf(p)>ps.funds).filter(p=>{
      const rich=Object.assign(Object.create(ps),{funds:ps.priceOf(p)+10}),r=ps.gd.chess(p.id);
      return parent.purchaseAllowed(m,rich,r)&&parent.importantBuy(m,rich,r);
    });if(!targets.length)return false;if(!ps.shop.frozen)ps.freeze();return true;
  };
  return Object.freeze({...parent,name:'9-9 independent non-Titi six permission',
    preparePurchases(m,ps,h){parent.preparePurchases?.(m,ps,h);lock(m,ps);
      if(!enabled(m,ps)||!m.wave||m.round<10||m.round>=m.gd.bossRound||ps.shop.level!==5||m.botRehearsal<2
        ||ps.funds<ps.shop.upgradePrice+1||ps.funds>=ps.shop.upgradePrice+parent.upgradeReserve(m,ps)
        ||!parent.beforeUpgrade(m,ps)||visibleUpgradePriority(parent,m,ps).length
        ||new Set(ps.allChess().filter(p=>pieceBonds(ps.gd,p).includes(CORE)).map(p=>base(ps,p))).size+(ps.bondCountBonus?.[CORE]||0)<6)return;
      const k=key(m,ps);if(ps._coop99Six?.key===k)return;
      if(ps._coop99SixCount?.round!==m.round)ps._coop99SixCount={round:m.round,n:0};if(ps._coop99SixCount.n++>=4)return;
      const lineup=previewLineupOf(m,ps),plan=finish(planLayoutSteps(m,ps,lineup,LAYOUT_PARAMS,{formationRoles:true,fireControl:true,
        rng:createRng(deriveSeed(m.seed,`coop99-six:${m.round}:${ps.seat}`))}));plan.lineup=lineup;
      const engines=lineup.filter(p=>coreEngines.has(base(ps,p))).map(p=>({uid:p.uid,minimalist:base(ps,p)===ids.minimalist}));let six=false;
      const job=finish(createForecastSteps(m,ps,lineup,[plan],function*(){const q=yield* bossInputSteps(m,ps,lineup,plan,{keepWithdrawn:true});six=q.bonds[CORE]?.count>=6;
        for(const [id,n]of Object.entries(swiftPrepGains(ps,lineup,plan,q.bonds)))if(q.bonds[id])q.bonds[id].layers+=n;return q;
      },{singlePlanProbe:true,forecastContext:()=>({}),selectForecast:()=>({index:0}),observeForecast:b=>observe(ps,b)}));
      if(job)job.run(Infinity);const outcomes=job?.outcomes||[],accepted=six&&acceptSix99(outcomes,ps.lp,engines);ps._coop99Six={key:k,round:m.round,accepted};
      note(ps,'six',{phase:'probe',round:m.round,accepted,six,funds:ps.funds,price:ps.shop.upgradePrice,roster:lineup.map(p=>({uid:p.uid,id:p.id})),outcomes});
    },
    upgradeReserve:(m,ps)=>ready(m,ps)?1:parent.upgradeReserve(m,ps),
    spendReserve:(m,ps)=>ready(m,ps)&&parent.priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+1?Math.max(0,ps.shop.upgradePrice):parent.spendReserve(m,ps),
    onLevelUp(m,ps,h){const used=ps.shop.level===6&&ps._coop99Six?.round===m.round&&ps._coop99Six.accepted,funds=ps.funds;parent.onLevelUp(m,ps,h);
      if(used){Object.assign(ps._coop99Six,{upgraded:true,slots:ps.shop.slots});lock(m,ps);note(ps,'six',{phase:'upgrade',round:m.round,fundsBeforeRefresh:funds,funds:ps.funds,frozen:ps.shop.frozen});}},
    beforeShopRefresh:(m,ps,h)=>lock(m,ps)?false:parent.beforeShopRefresh?.(m,ps,h)});
}
/** All occupied swaps validate BOTH terrain classes. No fixture coordinates or forced roster changes. */
export function localMoves99(ps,h,start,p){
  const map=ps.deployMap(),occupied=new Map([...start].map(([u,k])=>[k,u])),tokens=new Set([...ps.board].filter(([,q])=>q.kind!=='chess').map(([k])=>k));
  const from=start.get(p.uid),[fr,fc]=from.split(',').map(Number),out=[];
  for(const [to]of map){if(tokens.has(to))continue;const [r,c]=to.split(',').map(Number);if(!canPlace(map,placeClass(ps,ps.gd.chess(p.id)),r,c))continue;
    const other=occupied.get(to),piece=other&&start.lineup.find(q=>q.uid===other);
    if(other&&other!==p.uid&&!canPlace(map,placeClass(ps,ps.gd.chess(piece.id)),fr,fc))continue;
    for(const dir of DIRS){if(to===from&&dir===start.dirs.get(p.uid))continue;const plan=clone(start,h);plan.set(p.uid,to);plan.dirs.set(p.uid,dir);
      if(other&&other!==p.uid)plan.set(other,from);out.push(plan);}
  }return out;
}
function geometry99(m,ps,h,original,reference,targets,mode){
  const model={...h.fieldModel(m,ps)};if(!m.wave&&reference.every(r=>r.residence?.length))model.observedBoss=reference.map(r=>r.residence);
  const recs=new Map(original.lineup.map(p=>[p.uid,h.rangeRec(ps,ps.gd.chess(p.id))])),cache=new Map();
  const feature=(p,plan)=>{const key=plan.get(p.uid),dir=plan.dirs.get(p.uid),id=p.uid+'@'+key+':'+dir;if(cache.has(id))return cache.get(id);
    const [r,c]=key.split(',').map(Number),rec=recs.get(p.uid),cover=new Set(h.rangeTiles(rec,r,c,dir));
    const q={contact:finalContact(model,rec,cover),heal:healingTiles(rec,r,c,dir)};cache.set(id,q);return q;};
  const medics=original.lineup.filter(p=>medic(recs.get(p.uid))),allTargets=original.lineup.filter(p=>targets.has(p.uid)||front(recs.get(p.uid)));
  const covered=(p,plan)=>acceptsHealing(recs.get(p.uid))&&medics.some(q=>q.uid!==p.uid&&feature(q,plan).heal.has(plan.get(p.uid))
    &&(recs.get(q.uid).subProfessionId!=='incantationmedic'||feature(q,plan).contact>0));
  const protectedHeals=allTargets.filter(p=>covered(p,original)),preserve=p=>protectedHeals.every(q=>covered(q,p)),weight=p=>targets.get(p.uid)||1;
  const score=p=>original.lineup.reduce((n,q)=>n+(targets.has(q.uid)?weight(q)*feature(q,p).contact*10:0)+(allTargets.includes(q)&&covered(q,p)?weight(q)*3:0),0);
  const originalScore=score(original),rows=[];
  const movers=mode==='melee'?original.lineup.filter(p=>targets.has(p.uid)):original.lineup.filter(p=>targets.has(p.uid)||medics.includes(p));
  for(const p of movers){const before=feature(p,original).contact;
    const candidates=localMoves99(ps,h,original,p).map(plan=>({plan,uid:p.uid,score:score(plan),contact:feature(p,plan).contact}));
    candidates.sort((a,b)=>b.score-a.score||sig(a.plan).localeCompare(sig(b.plan)));
    const usable=candidates.filter(r=>r.score>originalScore+.01&&(mode!=='melee'||r.contact>before+.05));
    const direct=usable.find(r=>preserve(r.plan));if(direct)rows.push(direct);
    const seed=usable[0];if(seed){let linked=null;
      for(const q of medics.filter(q=>q.uid!==p.uid))for(const plan of localMoves99(ps,h,seed.plan,q)){
        if(!preserve(plan))continue;const value=score(plan);if(value<=originalScore+.01)continue;if(!linked||value>linked.score+.01)linked={plan,uid:p.uid,linked:q.uid,score:value};}
      if(linked)rows.push(linked);}
  }
  rows.sort((a,b)=>b.score-a.score||sig(a.plan).localeCompare(sig(b.plan)));
  const seen=new Set(),units=new Set(),selected=[];
  for(const r of rows)if(!units.has(r.uid)&&!seen.has(sig(r.plan))){selected.push(r);units.add(r.uid);seen.add(sig(r.plan));}
  for(const r of rows)if(!seen.has(sig(r.plan))){selected.push(r);seen.add(sig(r.plan));}
  const chosen=selected.slice(0,mode==='melee'?5:4);
  return {plans:chosen.map(r=>r.plan),proposals:chosen.map(r=>({uid:r.uid,linked:r.linked,score:r.score,before:originalScore}))};
}
export function createCoopMelee99(parent){return Object.freeze({...parent,name:'9-9 independent melee boss contact and linked medical layout',
  *finalBoardSteps(m,ps,h){yield* parent.finalBoardSteps(m,ps,h);if(!enabled(m,ps)||m.wave||m.round!==m.gd.bossRound||m.botRehearsal<2)return;
    const original=current(ps,h),policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),selectForecast:selectPapyrusForecast,includeBossMetrics:true,observeForecast:b=>observe(ps,b)};
    const probe=yield* createForecastSteps(m,ps,original.lineup,[original],p=>input(m,ps,h,p),policy);if(!probe)return;while(!probe.run(4))yield;const ref=probe.outcomes;
    if(!complete(ref)||ref.some(r=>r.won)){note(ps,'melee',{round:m.round,phase:'gate',reason:'invalid-or-predicted-win'});return;}
    const targets=new Map(original.lineup.filter(p=>ps.gd.chess(p.id).position==='MELEE'&&meleeCarries.has(base(ps,p)))
      .map(p=>[p.uid,base(ps,p)===ids.pepe?4:base(ps,p)===ids.philae?1.5:3]));if(!targets.size)return;
    const {plans,proposals}=geometry99(m,ps,h,original,ref,targets,'melee'),candidates=[original,...plans],outcomes=[...ref];
    for(let i=1;i<candidates.length;i+=2){const job=yield* createForecastSteps(m,ps,original.lineup,[original,...candidates.slice(i,i+2)],p=>input(m,ps,h,p),
      {...policy,reuseForecastRows:p=>p===original?ref:null});if(!job)return;while(!job.run(4))yield;
      outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:candidates.indexOf(job.plans[r.index])})));}
    const {index}=selectPapyrusForecast(candidates,outcomes);if(index)yield* h.applyPlanSteps(m,ps,original.lineup,candidates[index]);
    note(ps,'melee',{round:m.round,phase:'comparison',index,proposals,candidates:candidates.map(p=>({roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
  }});}
// [ASSUMED] Independent C refinements: retain genuine LP benefit and/or current-wave growth.
export function outputGuard100(candidate,reference,options={}){
  if(options.lp&&!(candidate.reduce((n,r)=>n+r.lost,0)<reference.reduce((n,r)=>n+r.lost,0)))return false;
  return !options.growth||candidate.every((r,i)=>['sargonShip','preciShip','swiftShip'].every(id=>(r.growth?.[id]||0)>=(reference[i].growth?.[id]||0))
    &&(r.coins||0)>=(reference[i].coins||0));
}
function* growthInput100(m,ps,h,p){
  const q=yield* h.bossInputSteps(m,ps,p.lineup,p,{keepWithdrawn:true});p.prepGrowth100=swiftPrepGains(ps,p.lineup,p,q.bonds);
  for(const [id,n]of Object.entries(p.prepGrowth100))if(q.bonds[id])q.bonds[id].layers+=n;return q;
}
function growthObserve100(ps,b,p){const metrics=observe(ps,b);return pp=>{
  const growth={...pp.layerGains};for(const [id,n]of Object.entries(p.prepGrowth100||{}))growth[id]=(growth[id]||0)+n;
  return {...metrics(pp),growth,coins:pp.coins||0};
};}
export function selectOutputs99(plans,outcomes,keys,options={}){
  const rows=plans.map((_,i)=>rowsAt(outcomes,i));if(!complete(rows[0]))return {index:0};
  const total=(r,key)=>keys.reduce((n,uid)=>n+(r[key]?.[uid]||0),0),damage=r=>(r.unitStats||[]).filter(p=>keys.includes(p.uid)).reduce((n,p)=>n+p.dmg,0);
  const sum=(a,fn)=>a.reduce((n,r)=>n+fn(r),0),rank=a=>[-Math.max(...a.map(r=>r.lost)),-sum(a,r=>r.lost),-sum(a,r=>r.leaks),-sum(a,r=>total(r,'unitDeaths')),sum(a,damage),sum(a,r=>total(r,'casts'))];
  const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]>b[i];return false;};let index=0;
  for(let i=1;i<rows.length;i++)if(complete(rows[i])&&outputGuard100(rows[i],rows[0],options)&&rows[i].every((r,j)=>r.lost<=rows[0][j].lost&&r.leaks<=rows[0][j].leaks&&r.deaths<=rows[0][j].deaths
    &&r.killed>=rows[0][j].killed&&damage(r)+1e-6>=damage(rows[0][j])*.95&&keys.every(uid=>(r.unitDeaths?.[uid]||0)<=(rows[0][j].unitDeaths?.[uid]||0)))
    &&better(rank(rows[i]),rank(rows[index])))index=i;return {index};
}
export function createCoopOutputs99(parent,api,options={}){return Object.freeze({...parent,name:'9-9 independent normal-wave important output protection',
  beforeUpgrade(m,ps,...args){
    if(options.third&&enabled(m,ps)&&ps.shop.level===5&&m.round<m.gd.bossRound){
      const thirds=keyThirdOffers(m,ps).filter(p=>p.price<=ps.funds&&parent.purchaseAllowed(m,ps,ps.gd.chess(p.id)))
        .filter(p=>!options.nativeSwiftThird||ps.gd.chess(p.id).bonds.includes(CORE)||foreignEngineRank(ps.gd,ps.gd.chess(p.id))>=2);
      if(thirds.length){note(ps,'c-third',{phase:'upgrade-hold',round:m.round,funds:ps.funds,price:ps.shop.upgradePrice,targets:thirds});return false;}
    }
    return parent.beforeUpgrade(m,ps,...args);
  },
  *finalBoardSteps(m,ps,h){const before=enabled(m,ps)&&m.wave&&m.round>=5?current(ps,h):null,assets=before&&assetKey(ps);
    yield* parent.finalBoardSteps(m,ps,h);if(!before||!m.wave||m.round>=m.gd.bossRound||m.botRehearsal<2)return;
    const original=current(ps,h),prepare=p=>options.growth?growthInput100(m,ps,h,p):input(m,ps,h,p),
      policy={singlePlanProbe:true,forecastContext:()=>({}),selectForecast:()=>({index:0}),observeForecast:(b,c,p)=>options.growth?growthObserve100(ps,b,p):observe(ps,b)};
    const probe=yield* createForecastSteps(m,ps,original.lineup,[original],prepare,policy);if(!probe)return;while(!probe.run(4))yield;const ref=probe.outcomes;if(!complete(ref))return;
    const maxDamage=Math.max(1,...ref.flatMap(r=>r.unitStats||[]).map(p=>p.dmg)),keys=original.lineup.filter(p=>!medic(ps.gd.chess(p.id))&&(coreEngines.has(base(ps,p))
      ||ref.some(r=>(r.unitStats||[]).find(q=>q.uid===p.uid)?.dmg>=maxDamage*.25))).map(p=>p.uid);
    if(!keys.length||!ref.some(r=>r.lost>0||keys.some(uid=>r.unitDeaths?.[uid]>0))){note(ps,'outputs',{round:m.round,phase:'gate',reason:'safe-or-no-important-output'});return;}
    const targets=new Map(keys.map(uid=>[uid,coreEngines.has(base(ps,original.lineup.find(p=>p.uid===uid)))?4:2]));
    const result=geometry99(m,ps,h,original,ref,targets,'outputs'),candidates=[original],seen=new Set([sig(original)]),finalBonds=api.shadow(ps,original.lineup).bonds;
    if(assets===assetKey(ps)&&sig(before)!==sig(original)&&api.transition(ps,original.lineup,before.lineup)){
      const bonds=api.shadow(ps,before.lineup).bonds,keepsMains=original.lineup.filter(p=>[ids.pepe,ids.passenger,ids.titi].includes(base(ps,p))).every(p=>before.lineup.some(q=>base(ps,q)===base(ps,p)));
      if(keepsMains&&(bonds[CORE]?.count||0)>=Math.min(6,finalBonds[CORE]?.count||0)&&(bonds.preciShip?.tier||0)>=(finalBonds.preciShip?.tier||0)){candidates.push(before);seen.add(sig(before));}}
    for(const p of result.plans)if(!seen.has(sig(p))){candidates.push(p);seen.add(sig(p));}const outcomes=[...ref];
    for(let i=1;i<candidates.length;i+=2){const job=yield* createForecastSteps(m,ps,original.lineup,[original,...candidates.slice(i,i+2)],prepare,
      {...policy,reuseForecastRows:p=>p===original?ref:null});if(!job)return;while(!job.run(4))yield;
      outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:candidates.indexOf(job.plans[r.index])})));}
    const {index}=selectOutputs99(candidates,outcomes,keys,options),best=candidates[index];if(index){const transition=api.transition(ps,original.lineup,best.lineup);if(!transition)throw Error('Output protection unreachable');
      for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);if(!ps.move(added.uid,{area:'board',row,col},best.dirs.get(added.uid))?.ok)throw Error('Output protection swap rejected');}
      yield* h.applyPlanSteps(m,ps,best.lineup,best);}
    if(index&&[...best].some(([u,k])=>ps.find(u)?.key!==k||ps.find(u)?.piece.dir!==best.dirs.get(u)))throw Error('Output protection layout rejected');
    note(ps,'outputs',{round:m.round,phase:'comparison',index,keys,proposals:result.proposals,candidates:candidates.map(p=>({roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
  }});}
