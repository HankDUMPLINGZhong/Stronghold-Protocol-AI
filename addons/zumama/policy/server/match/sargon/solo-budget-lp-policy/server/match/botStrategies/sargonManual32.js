// [ASSUMED] Three independent children of frozen 28/13. No future shops or actual-combat seed access.
import {computeBonds,pieceBonds} from '../../../../../../../../../../bondsMeta.js';
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {layerGainRoom} from '../../../../../../../../../../../../shared/constants.js';
import {createForecastSteps} from '../botForecast.js';
import {swiftPrepGains,swiftGrowthValue} from './sargonSwift.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {leanSixLockTargets} from './sargonLeanSix.js';
import {ids} from './sargonPepe.js';

const CORE='sargonShip',field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const note=(ps,mode,e)=>(ps._sargonFactorHistory||=[]).push({factor:'manual-round32',mode,...e});
const finish=gen=>{let r;do{r=gen.next();}while(!r.done);return r.value;};
const valid=rs=>rs.length===2&&rs.every((r,i)=>r.valid&&r.sample===i);
const rowsAt=(rows,i)=>rows.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const current=(ps,Plan=Map)=>{const p=new Plan();p.dirs=new Map();p.reserved=new Set();p.lineup=field(ps);
  for(const [key,u]of ps.board)if(u.kind==='chess'){p.set(u.uid,key);p.dirs.set(u.uid,u.dir||'RIGHT');}return p;};
const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]>b[i];return false;};

/** Compare measured gains by their own bond formula; Sargon extends each independent stack's lifetime. */
export function actualGrowthValue(gd,layers,gains){
  const n=layerGainRoom(layers[CORE]||0,gains[CORE]||0),bb=gd.bond(CORE).bb;
  const duration=bb.base_time+bb.time_per_stack*(layers[CORE]||0);
  return swiftGrowthValue(layers,gains)-Math.min(4,(gains[CORE]||0)*.2)
    +100*bb.time_per_stack*n/Math.max(1,duration);
}
export function selectActualGrowth(plans,outcomes){
  return selectGrowth(plans,outcomes,false);
}
export function selectSwiftFirstGrowth(plans,outcomes){
  return selectGrowth(plans,outcomes,true);
}
function selectGrowth(plans,outcomes,swiftFirst){
  const reference=rowsAt(outcomes,0);if(!valid(reference))return {index:0};
  const rank=(rs,i)=>[-Math.max(...rs.map(r=>r.lost)),-rs.reduce((n,r)=>n+r.lost,0),
    ...(swiftFirst?[Number(!!plans[i].growthBonds?.swiftShip?.active),Number(!!plans[i].growthBonds?.preciShip?.active)]:[]),
    Math.min(...rs.map(r=>r.growth)),rs.reduce((n,r)=>n+r.growth,0)];
  let index=0;
  for(let i=1;i<plans.length;i++){
    const rs=rowsAt(outcomes,i);if(!valid(rs)||rs.some((r,s)=>r.lost>reference[s].lost||r.leaks>reference[s].leaks
      ||r.killed<reference[s].killed||r.deaths>reference[s].deaths
      ||Object.entries(r.protectedDeaths||{}).some(([uid,n])=>n>(reference[s].protectedDeaths?.[uid]||0))))continue;
    if(better(rank(rs,i),rank(rowsAt(outcomes,index),index)))index=i;
  }
  return {index};
}
function potential(ps,lineup){
  return lineup.reduce((n,p)=>n+(ps.gd.chess(p.id).garrisonIds||[]).reduce((s,id)=>{
    const g=ps.gd.garrison(id);
    return s+(g?.eventType==='IN_BATTLE'&&g.bbStr?.bond_id?.split(',').includes(CORE)?g.bb?.bond_add_count||0:0);
  },0),0);
}
export function createActualGrowthPolicy(parent,api){
  return Object.freeze({...parent,name:'28/13: measured Sargon development value',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(!m.isSolo||!m.wave||m.round>=m.gd.bossRound||m.botRehearsal<2)return;
      const original=current(ps,h.LayoutPlan),rows=api.rosters(m,ps);
      rows.sort((a,b)=>potential(ps,b.lineup)-potential(ps,a.lineup)||b.score-a.score||a.signature.localeCompare(b.signature));
      let proposals=rows.slice(0,2);
      if(api.swiftFirst){
        const joint=rows.find(r=>r.swift>=2&&r.precision>=2),swift=rows.find(r=>r.swift>=2&&r!==joint);
        proposals=[joint,swift,...rows].filter((r,i,a)=>r&&a.indexOf(r)===i).slice(0,2);
      }
      const plans=[original];
      for(const [i,row]of proposals.entries()){
        const plan=yield* h.planLayoutSteps(api.shadow(ps,row.lineup),row.lineup,{formationRoles:true,fireControl:true,
          rng:createRng(deriveSeed(m.seed,`sargon-actual-growth:${m.round}:${ps.seat}:${i}`))});
        if(plan.size!==row.lineup.length||new Set(plan.values()).size!==row.lineup.length)continue;
        plan.lineup=row.lineup;plans.push(plan);
      }
      if(plans.length<2)return;
      const protectedUids=new Set(original.lineup.filter(p=>[ids.pepe,ids.passenger,ids.titi].includes(base(ps,p))).map(p=>p.uid));
      const job=yield* createForecastSteps(m,ps,original.lineup,plans,plan=>h.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true}),{
        forecastContext:()=>({}),selectForecast:api.swiftFirst?selectSwiftFirstGrowth:selectActualGrowth,
        prepareForecastInput(m,ps,chosen,plan,input){
          plan.growthBonds=structuredClone(input.bonds);
          const gains=swiftPrepGains(ps,plan.lineup,plan,input.bonds);plan.prepGains=gains;
          for(const [id,n]of Object.entries(gains))if(input.bonds[id])input.bonds[id].layers+=n;return input;
        },
        observeForecast(battle,context,plan){
          const deaths={},casts={};
          battle.on('death',({unit,reason})=>{if(reason==='killed'&&unit?.ownerId===ps.playerId&&protectedUids.has(unit.uid))deaths[unit.uid]=(deaths[unit.uid]||0)+1;});
          battle.on('skillStart',({unit})=>{if(unit?.ownerId===ps.playerId&&unit.kind==='op')casts[unit.uid]=(casts[unit.uid]||0)+1;});
          return pp=>{const gains={...pp.layerGains};for(const [id,n]of Object.entries(plan.prepGains||{}))gains[id]=(gains[id]||0)+n;
            return {growth:actualGrowthValue(ps.gd,ps.layers,gains),gains,protectedDeaths:deaths,casts};};
        }});
      if(!job)return;while(!job.run(4))yield;
      if(job.bestIndex){
        const transition=api.transition(ps,original.lineup,job.chosen);if(!transition)throw Error('Unreachable growth roster');
        for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);
          if(!ps.move(added.uid,{area:'board',row,col},job.best.dirs.get(added.uid))?.ok)throw Error('Growth swap rejected');}
        yield* h.applyPlanSteps(m,ps,job.chosen,job.best);
        if([...job.best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==job.best.dirs.get(uid)))throw Error('Growth plan rejected');
      }
      note(ps,api.swiftFirst?'growth-swift-first':'growth',{round:m.round,index:job.bestIndex,simulations:job.outcomes.length,
        candidates:job.plans.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],
          ...(api.swiftFirst?{swift:p.growthBonds?.swiftShip,precision:p.growthBonds?.preciShip}:{})})),outcomes:job.outcomes});
    }});
}

const stateKey=(m,ps)=>JSON.stringify([m.round,ps.layers,[...ps.board].map(([k,p])=>[k,p.uid,p.id,p.dir,p.items])]);
export function nonTitiStructure(m,ps){
  if(m.difficulty!=='ABYSS'||!m.isSolo||!m.wave||ps.shop.level!==5||m.round>=m.gd.bossRound||ps.lp<12)return false;
  const board=field(ps),has=id=>board.some(p=>base(ps,p)===id);
  const last=m.lastResults?.get(ps.playerId);
  return !has(ids.titi)&&[ids.pepe,ids.passenger].some(has)
    &&new Set(board.filter(p=>ps.gd.chess(p.id).bonds.includes(CORE)).map(p=>base(ps,p))).size>=6
    &&board.some(p=>[ids.minimalist,ids.gavial4,ids.gavial5].includes(base(ps,p))&&ps.gd.isGolden(p.id))
    &&!!last&&!(last.leaked||[]).some(p=>p.counted!==false)&&(last.deaths||0)<=1;
}
export function createNonTitiSixPolicy(parent){
  const ready=(m,ps)=>ps.shop.level===5&&ps._sargonNonTiti32?.key===stateKey(m,ps)&&ps._sargonNonTiti32.accepted;
  const lock=(m,ps)=>{
    const targets=leanSixLockTargets(parent,m,ps);if(!targets.length)return false;
    if(!ps.shop.frozen)ps.freeze();return true;
  };
  return Object.freeze({...parent,name:'28/13: verified non-Titi resident conversion',
    preparePurchases(m,ps,h={}){
      parent.preparePurchases?.(m,ps,h);
      if(m.difficulty!=='ABYSS')return;
      lock(m,ps);
      if(!nonTitiStructure(m,ps)||ps.funds<ps.shop.upgradePrice+1||ps.funds>=ps.shop.upgradePrice+parent.upgradeReserve(m,ps))return;
      const key=stateKey(m,ps);if(ps._sargonNonTiti32?.key===key)return;
      const plan=current(ps),lineup=plan.lineup;
      const recipe={singlePlanProbe:true,forecastContext:()=>({}),selectForecast:()=>({index:0}),
        observeForecast(battle){const casts={};battle.on('skillStart',({unit})=>{
          if(unit?.ownerId===ps.playerId&&unit.kind==='op')casts[unit.uid]=(casts[unit.uid]||0)+1;});return ()=>({casts});}};
      const job=finish(createForecastSteps(m,ps,lineup,[plan],function*(){
        yield;
        const input=ps.battleInput(),gains=swiftPrepGains(ps,lineup,plan,input.bonds);
        for(const [id,n]of Object.entries(gains))if(input.bonds[id])input.bonds[id].layers+=n;return input;
      },recipe));
      if(job)job.run(Infinity);
      const outcomes=job?.outcomes||[],accepted=valid(outcomes)&&outcomes.every(r=>r.lost===0&&r.leaks===0&&r.deaths===0
        &&lineup.some(p=>ps.gd.isGolden(p.id)&&([ids.minimalist].includes(base(ps,p))?(r.casts[p.uid]||0)>=3:
          [ids.gavial4,ids.gavial5].includes(base(ps,p))&&(r.casts[p.uid]||0)>=1)));
      ps._sargonNonTiti32={key,accepted,round:m.round};
      note(ps,'non-titi-six',{round:m.round,phase:'probe',accepted,funds:ps.funds,price:ps.shop.upgradePrice,
        roster:lineup.map(p=>({uid:p.uid,id:p.id})),simulations:outcomes.length,outcomes});
    },
    upgradeReserve:(m,ps)=>ready(m,ps)?1:parent.upgradeReserve(m,ps),
    spendReserve:(m,ps)=>ready(m,ps)&&parent.priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+1
      ?Math.max(0,ps.shop.upgradePrice):parent.spendReserve(m,ps),
    onLevelUp(m,ps,h={}){
      const released=m.difficulty==='ABYSS'&&ps.shop.level===6&&ps._sargonNonTiti32?.accepted&&ps._sargonNonTiti32.round===m.round;
      const special=ps.counters['band:pepe:special']||0;
      parent.onLevelUp(m,ps,h);
      if(!released)return;
      ps._sargonLeanSix={upgradedAt:m.round,pending:false,rolledAt:(ps.counters['band:pepe:special']||0)<special?m.round:null,slots:ps.shop.slots};
      lock(m,ps);note(ps,'non-titi-six',{round:m.round,phase:'upgrade',funds:ps.funds,frozen:ps.shop.frozen});
    },
    beforeShopRefresh:(m,ps,h)=>m.difficulty==='ABYSS'&&lock(m,ps)?false:parent.beforeShopRefresh?.(m,ps,h)
  });
}

function equipmentShadow(ps,assignments){
  const used=new Set(assignments.map(a=>a.item.uid)),byUid=new Map();
  const clone=p=>{if(!p)return p;if(!byUid.has(p.uid))byUid.set(p.uid,{...p,items:p.items?.slice()});return byUid.get(p.uid);};
  const shadow=Object.assign(Object.create(Object.getPrototypeOf(ps)),ps,{board:new Map([...ps.board].map(([k,p])=>[k,clone(p)])),
    hand:ps.hand.map(p=>used.has(p?.uid)?null:clone(p)),temp:ps.temp.filter(p=>!used.has(p?.uid)).map(clone)});
  for(const a of assignments){const p=shadow.find(a.target.uid)?.piece;if(!p)throw Error('Missing equipment carrier');p.items=[...(p.items||[]),a.item];}
  shadow.bonds=computeBonds(ps.gd,shadow);return shadow;
}
export function orbDealerCandidates(ps){
  return field(ps).filter(p=>{const r=ps.gd.chess(p.id);return r.tier>=4&&!pieceBonds(ps.gd,p).includes(CORE)
    &&r.attackKind!=='none'&&r.attackKind!=='heal'&&r.subProfessionId!=='incantationmedic';})
    .sort((a,b)=>{const value=p=>{const r=ps.gd.chess(p.id);return (r.stats?.atk||0)/Math.max(.1,r.stats?.bat||1)*(ps.gd.isGolden(p.id)?1.25:1);};
      return value(b)-value(a)||a.uid-b.uid;});
}
export function createOrbDealerPolicy(parent){
  return Object.freeze({...parent,name:'28/13: include real Sargon-transfer damage carries',
    compareItemTargets(m,ps,item,inherited,h){
      if(!m.isSolo||m.round>m.gd.bossRound||m.botRehearsal<2||!ps.gd.item(item.id)?.canGiveBond)return inherited;
      const loose=[...ps.hand,...ps.temp].filter(p=>p?.kind==='item'&&p.uid!==item.uid);
      const signatures=loose.filter(p=>ps.gd.item(p.id)?.giveBondId===CORE&&!ps.completesItemMerge(p.id));
      const rows=orbDealerCandidates(ps).flatMap(target=>{
        const worn=(target.items||[]).find(i=>ps.gd.item(i.id)?.giveBondId===CORE),signature=worn?null:signatures[0];
        if(!worn&&!signature||(target.items?.length||0)+(signature?2:1)>ps.gd.equipPerChess)return [];
        return [{target,signature}];
      }).filter(r=>r.target.uid!==inherited?.uid).slice(0,2);
      if(!rows.length)return inherited;
      const original=current(ps),baselineAssignments=inherited?[{item,target:inherited}]:[];
      // Include the parent's normal allocation of the same loose companion in the unchanged control.
      for(const signature of signatures.slice(0,1)){
        const shadow=equipmentShadow(ps,baselineAssignments),target=h.targetFor(shadow,signature);
        if(target&&(target.items?.length||0)<ps.gd.equipPerChess)baselineAssignments.push({item:signature,target});
      }
      const assignments=[baselineAssignments,...rows.map(r=>[{item,target:r.target},...(r.signature?[{item:r.signature,target:r.target}]:[])])];
      const plans=assignments.map(a=>{const plan=current(ps);plan.assignments=a;plan.shadow=equipmentShadow(ps,a);return plan;});
      const recipe={equipmentAlternatives:true,forecastContext:()=>({boss:!m.wave}),includeBossMetrics:true,
        observeForecast:()=>pp=>({damage:pp.damageDealt||0}),
        selectForecast(plans,outcomes,context){
          if(context.boss)return selectPapyrusForecast(plans,outcomes);
          const ref=rowsAt(outcomes,0);if(!valid(ref))return {index:0};let index=0;
          const rank=rs=>[-rs.reduce((n,r)=>n+r.lost,0),-rs.reduce((n,r)=>n+r.deaths,0),rs.reduce((n,r)=>n+r.damage,0)];
          for(let i=1;i<plans.length;i++){const rs=rowsAt(outcomes,i);
            if(valid(rs)&&rs.every((r,s)=>r.lost<=ref[s].lost&&r.leaks<=ref[s].leaks&&r.killed>=ref[s].killed&&r.deaths<=ref[s].deaths)
              &&better(rank(rs),rank(rowsAt(outcomes,index))))index=i;}
          return {index};
        }};
      const job=finish(createForecastSteps(m,ps,original.lineup,plans,function*(plan){
        yield;
        const input=plan.shadow.battleInput(),gains=swiftPrepGains(plan.shadow,field(plan.shadow),plan,input.bonds);
        for(const [id,n]of Object.entries(gains))if(input.bonds[id])input.bonds[id].layers+=n;return input;
      },recipe));
      if(!job)return inherited;job.run(Infinity);
      note(ps,'orb-dealer',{round:m.round,index:job.bestIndex,simulations:job.outcomes.length,
        candidates:assignments.map(a=>a.map(q=>({itemUid:q.item.uid,itemId:q.item.id,targetUid:q.target.uid,targetId:q.target.id}))),outcomes:job.outcomes});
      if(!job.bestIndex)return inherited;
      const selected=rows[job.bestIndex-1];
      if(selected.signature&&!ps.equip(selected.signature.uid,selected.target.uid)?.ok)throw Error('Orb companion equip rejected');
      return selected.target;
    }});
}
