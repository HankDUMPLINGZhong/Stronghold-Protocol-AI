// [ASSUMED] Independent formation experiments on selected 28/10. Never reads a case seed or real battle result.
import {DIRS} from '../../../../../../../../../../../sim/dir.js';
import {COLS} from '../../../../../../../../../../../sim/constants.js';
import {bodyKeys} from '../../../../../../../../../../../sim/body.js';
import {boardTileOf} from '../../../../../../../../../../board.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';
import {createForecastSteps} from '../botForecast.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {finalContact} from './sargonRound17.js';
import {swiftPrepGains} from './sargonSwift.js';
import {ids} from './sargonPepe.js';
import {safetyPlans} from './sargonVideoFactors.js';

const pos=key=>key.split(',').map(Number);
const ready=(m)=>m.difficulty==='ABYSS'&&!m.wave&&m.isSolo&&m.round===m.gd.bossRound&&m.botRehearsal>=2;
const complete=rs=>rs.length===2&&[0,1].every(s=>rs.some(r=>r.sample===s&&r.valid));
const rowsAt=(outcomes,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample);
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'formation-round30',...e});

/** Preserve predicted wins. A <=2-point single-sample cost needs >=3 points of worst-case and >=1 point mean gain. */
export function tolerantHealingIndex(candidates,outcomes,incumbent=0){
  const reference=rowsAt(outcomes,incumbent);if(!complete(reference)||reference.some(r=>r.won))return incumbent;
  const worst=rs=>Math.min(...rs.map(r=>r.damageShare)),mean=rs=>rs.reduce((n,r)=>n+r.damageShare,0)/2;
  let index=incumbent;
  for(let i=0;i<candidates.length;i++){
    const next=rowsAt(outcomes,i);if(i===incumbent||!complete(next))continue;
    if(next.some((r,s)=>r.won<reference[s].won||r.damageShare+0.02+1e-6<reference[s].damageShare))continue;
    if(worst(next)<worst(reference)+0.03||mean(next)<mean(reference)+0.01)continue;
    const best=rowsAt(outcomes,index);
    if(worst(next)>worst(best)+1e-6||Math.abs(worst(next)-worst(best))<=1e-6&&mean(next)>mean(best))index=i;
  }
  return index;
}

export function createTolerantHealingPolicy(parent){
  return Object.freeze({...parent,name:'28/10: bounded sample tolerance for final medical layouts',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);if(!ready(m))return;
      const row=ps._sargonFactorHistory?.findLast(e=>e.round===m.round&&e.factor==='healing-coverage-round19'&&e.phase==='comparison');
      if(!row)return;
      const current=row.candidates[row.index],tiles=new Map(current.tiles),dirs=new Map(current.dirs);
      if(current.roster.some(p=>ps.find(p.uid)?.key!==tiles.get(p.uid)||ps.find(p.uid)?.piece.dir!==dirs.get(p.uid)))return;
      const index=tolerantHealingIndex(row.candidates,row.outcomes,row.index);
      if(index!==row.index){
        const c=row.candidates[index],plan=new h.LayoutPlan(c.tiles);plan.dirs=new Map(c.dirs);
        plan.lineup=c.roster.map(u=>ps.find(u.uid)?.piece);if(plan.lineup.some(p=>!p))return;
        yield* h.applyPlanSteps(m,ps,plan.lineup,plan);
        if([...plan].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==plan.dirs.get(uid)))throw Error('Tolerant medical layout rejected');
      }
      note(ps,{mode:'medical-tolerance',round:m.round,index,before:row.index,candidates:row.candidates,outcomes:row.outcomes,simulations:0});
    }});
}

/** Melee carries were excluded from round17. Keep roster, items and existing medical coverage; move at most two tiles. */
export function meleeContactPlans(m,ps,h,original,paired){
  const model={...h.fieldModel(m,ps)};
  if(paired.length===2&&paired.every(r=>r.residence?.length))model.observedBoss=paired.map(r=>r.residence);
  const recs=new Map(original.lineup.map(p=>[p.uid,h.rangeRec(ps,ps.gd.chess(p.id))]));
  const medics=original.lineup.filter(p=>{const r=recs.get(p.uid);return r.attackKind==='heal'||r.subProfessionId==='incantationmedic';});
  const healed=(p,key)=>acceptsHealing(recs.get(p.uid))&&medics.some(q=>{
    const [r,c]=pos(original.get(q.uid));return healingTiles(recs.get(q.uid),r,c,original.dirs.get(q.uid)).has(key);
  });
  const occupied=new Set(ps.board.keys()),groups=[];
  for(const p of original.lineup){
    const rec=recs.get(p.uid),base=ps.gd.baseIdOf(p.id);
    if(rec.position!=='MELEE'||![ids.pepe,ids.gavial4,ids.gavial5].includes(base))continue;
    const from=original.get(p.uid),dir=original.dirs.get(p.uid),[r,c]=pos(from);
    const contact=(key,facing)=>{const [a,b]=pos(key);return finalContact(model,rec,new Set(h.rangeTiles(rec,a,b,facing)));};
    const before=contact(from,dir),rows=[];
    for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
      const distance=Math.abs(dr)+Math.abs(dc);if(distance>2)continue;
      const to=`${r+dr},${c+dc}`;
      if(to!==from&&occupied.has(to)||!ps._legal(p,r+dr,c+dc)||healed(p,from)&&!healed(p,to))continue;
      for(const facing of DIRS){
        if(to===from&&facing===dir)continue;
        const score=contact(to,facing);if(score<=before+1e-6)continue;
        rows.push({uid:p.uid,id:p.id,from,to,dir:facing,before,contact:score,distance});
      }
    }
    rows.sort((a,b)=>b.contact-a.contact||a.distance-b.distance||a.to.localeCompare(b.to)||a.dir.localeCompare(b.dir));
    if(!rows.length||before>=rows[0].contact*.65)continue;
    const cells=new Set(),top=rows.filter(r=>!cells.has(r.to)&&cells.add(r.to)).slice(0,2);
    groups.push(top);
  }
  // First give each deficient carry a candidate, then a second location. At most four extra plans.
  const proposals=[...groups.map(g=>g[0]),...groups.map(g=>g[1]).filter(Boolean)].slice(0,4);
  const plans=proposals.map(r=>{const p=new h.LayoutPlan(original);p.dirs=new Map(original.dirs);p.lineup=original.lineup;
    p.set(r.uid,r.to);p.dirs.set(r.uid,r.dir);return p;});
  return {plans,proposals};
}

export function createMeleeContactPolicy(parent){
  return Object.freeze({...parent,name:'28/10: melee carry contact alternatives after final healing',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);if(!ready(m))return;
      const original=new h.LayoutPlan();original.lineup=[];
      for(const [key,p]of ps.board)if(p.kind==='chess'){original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');original.lineup.push(p);}
      function* input(plan){const snapshot=yield* h.bossInputSteps(m,ps,original.lineup,plan,{keepWithdrawn:true});
        const gains=swiftPrepGains(ps,original.lineup,plan,snapshot.bonds);
        for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;return snapshot;}
      const observeForecast=battle=>{
        const residence=new Map(),field=battle.players.find(p=>p.playerId===ps.playerId)?.side==='R'?'bossR':'bossL';
        battle.on('tick',()=>{if(battle.tickCount%15)return;
          for(const e of battle.enemies)if(e.isBoss&&e.alive&&!e.hidden){
            const tiles=bodyKeys(e).map(k=>boardTileOf(field,Math.floor(k/COLS),k%COLS).join(','));if(!tiles.length)continue;
            const key=tiles.join('|'),r=residence.get(key)||{tiles,count:0};r.count++;residence.set(key,r);
          }});return pp=>({unitStats:pp.unitStats,residence:[...residence.values()]});
      };
      const policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),includeBossMetrics:true,selectForecast:selectPapyrusForecast,observeForecast};
      const probe=yield* createForecastSteps(m,ps,original.lineup,[original],input,policy);
      if(!probe)return;while(!probe.run(4))yield;
      const reference=probe.outcomes;if(!complete(reference)||reference.some(r=>r.won))return;
      const {plans,proposals}=meleeContactPlans(m,ps,h,original,reference);
      if(!plans.length){note(ps,{mode:'melee-contact',round:m.round,phase:'gate',simulations:2,reason:'no-deficient-legal-melee-carry'});return;}
      const candidates=[original,...plans],outcomes=[...reference];
      for(let offset=0;offset<plans.length;offset+=2){
        const batch=[original,...plans.slice(offset,offset+2)];
        const job=yield* createForecastSteps(m,ps,original.lineup,batch,input,{...policy,reuseForecastRows:p=>p===original?reference:null});
        if(!job)return;while(!job.run(4))yield;
        for(const row of job.outcomes.filter(r=>r.index===0))if(JSON.stringify(row)!==JSON.stringify(reference.find(r=>r.sample===row.sample)))throw Error('Melee incumbent drift');
        outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:r.index+offset})));
      }
      const {index}=selectPapyrusForecast(candidates,outcomes),best=candidates[index];
      if(index){yield* h.applyPlanSteps(m,ps,original.lineup,best);
        if([...best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==best.dirs.get(uid)))throw Error('Melee contact layout rejected');}
      note(ps,{mode:'melee-contact',round:m.round,phase:'comparison',index,proposals,simulations:outcomes.length,
        candidates:candidates.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
    }});
}

/** Re-evaluate public boss safety after the final roster and all inherited moves. Keep every predicted win per sample. */
export function createLateSafetyPolicy(parent){
  return Object.freeze({...parent,name:'28/10: safety comparison after final roster and medical moves',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);if(!ready(m))return;
      const original=new h.LayoutPlan();original.lineup=[];
      for(const [key,p]of ps.board)if(p.kind==='chess'){original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');original.lineup.push(p);}
      const plans=safetyPlans(m,ps,original,h);if(!plans.length)return;
      function* input(plan){const snapshot=yield* h.bossInputSteps(m,ps,original.lineup,plan,{keepWithdrawn:true});
        const gains=swiftPrepGains(ps,original.lineup,plan,snapshot.bonds);
        for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;return snapshot;}
      const policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),includeBossMetrics:true,selectForecast:selectPapyrusForecast,
        observeForecast:battle=>{const firstDeaths={};battle.on('death',({unit})=>{
          if(unit?.kind==='op'&&unit.ownerId===ps.playerId)firstDeaths[unit.uid]??=battle.time;});
          return pp=>({unitStats:pp.unitStats,firstDeaths});}};
      const probe=yield* createForecastSteps(m,ps,original.lineup,[original],input,policy);
      if(!probe)return;while(!probe.run(4))yield;
      const reference=probe.outcomes;if(!complete(reference))return;
      if(reference.every(r=>r.won)){note(ps,{mode:'late-safety',round:m.round,phase:'gate',reason:'both-inherited-wins',simulations:2});return;}
      const candidates=[original,...plans],job=yield* createForecastSteps(m,ps,original.lineup,candidates,input,
        {...policy,reuseForecastRows:p=>p===original?reference:null});
      if(!job)return;while(!job.run(4))yield;
      for(const row of job.outcomes.filter(r=>r.index===0))if(JSON.stringify(row)!==JSON.stringify(reference.find(r=>r.sample===row.sample)))throw Error('Late safety incumbent drift');
      const outcomes=job.outcomes,{index}=selectPapyrusForecast(candidates,outcomes),best=candidates[index];
      if(index){yield* h.applyPlanSteps(m,ps,original.lineup,best);
        if([...best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==best.dirs.get(uid)))throw Error('Late safety layout rejected');}
      note(ps,{mode:'late-safety',round:m.round,phase:'comparison',index,simulations:outcomes.length,
        candidates:candidates.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs]})),outcomes});
    }});
}
