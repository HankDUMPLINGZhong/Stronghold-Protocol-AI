// [ASSUMED] Recheck healing after the inherited final roster AND all dealer moves.
// Read-only independent forecasts identify sustained injuries; proposals move medics only, never actual-seed search.
import {DIRS} from '../../../../../../../../../../../sim/dir.js';
import {COLS} from '../../../../../../../../../../../sim/constants.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';
import {createForecastSteps} from '../botForecast.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {swiftPrepGains} from './sargonSwift.js';
import {finalContact} from './sargonRound17.js';
import {ids} from './sargonPepe.js';

const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'healing-coverage-round19',...e});
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const pos=key=>key.split(',').map(Number);
const isMedic=r=>r.attackKind==='heal'||r.dmgType==='heal'||r.subProfessionId==='incantationmedic';
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const main=new Set([ids.passenger,ids.pepe,ids.titi]);

/** Two common samples must show time to heal. A dead or uninjured target is not a sustained coverage deficit. */
export function healingDemand(ps,lineup,paired){
  const targets=[],excluded=[];
  if(paired.length!==2||paired.some(r=>!r.valid))return {targets,excluded};
  const maxDamage=Math.max(1,...paired.flatMap(r=>r.unitStats.map(s=>s.dmg||0)));
  for(const p of lineup){
    const rec=ps.gd.chess(p.id);if(!acceptsHealing(rec))continue;
    const stats=paired.map(r=>r.unitStats.find(s=>s.uid===p.uid)),hurt=paired.map(r=>r.injuries?.[p.uid]?.hurtSeconds||0);
    const taken=stats.reduce((n,s)=>n+(s?.taken||0),0)/2;
    if(!taken||Math.min(...hurt)<1){
      excluded.push({uid:p.uid,id:p.id,taken,hurt,reason:taken?'no-sustained-healing-window':'no-damage'});continue;
    }
    const damage=stats.reduce((n,s)=>n+(s?.dmg||0),0)/2;
    const primary=main.has(ps.gd.baseIdOf(p.id)),tank=front(rec),dealer=damage>=maxDamage*.2;
    const priority=primary?3:tank?2.5:dealer?2:1;
    const weight=priority*(1+Math.min(4,taken/Math.max(1,rec.stats?.maxHp||1))+Math.min(3,Math.min(...hurt)/15));
    targets.push({uid:p.uid,id:p.id,weight,primary,tank,dealer,taken,hurt});
  }
  targets.sort((a,b)=>b.weight-a.weight||a.uid-b.uid);return {targets,excluded};
}

/** Keep all already covered injured main/front targets. Search legal free tiles and turns, not fixed coordinates. */
export function healingCoveragePlans(m,ps,h,original,paired){
  const demand=healingDemand(ps,original.lineup,paired),targets=demand.targets;
  const recs=new Map(original.lineup.map(p=>[p.uid,h.rangeRec(ps,ps.gd.chess(p.id))]));
  const medics=original.lineup.filter(p=>isMedic(recs.get(p.uid))&&recs.get(p.uid).position==='RANGED');
  const cover=(p,plan)=>{const [r,c]=pos(plan.get(p.uid));return healingTiles(recs.get(p.uid),r,c,plan.dirs.get(p.uid));};
  const score=(p,plan)=>targets.reduce((n,t)=>n+(t.uid!==p.uid&&cover(p,plan).has(plan.get(t.uid))?t.weight:0),0);
  const footprint=plan=>[...plan].map(([uid,k])=>`${uid}@${k}:${plan.dirs.get(uid)}`).sort().join('|');
  const clone=plan=>{const p=new h.LayoutPlan(plan);p.dirs=new Map(plan.dirs);p.reserved=new Set(plan.reserved);p.lineup=original.lineup;return p;};
  const model=h.fieldModel(m,ps),rows=[],weak=[];
  function alternatives(p,start){
    const occupied=new Set([...ps.board].filter(([,q])=>q.kind!=='chess').map(([k])=>k));
    for(const [uid,key]of start)if(uid!==p.uid)occupied.add(key);
    const before=score(p,start),from=start.get(p.uid),[r,c]=pos(from),rec=recs.get(p.uid),healed=cover(p,start);
    const protectedTargets=targets.filter(t=>t.uid!==p.uid&&(t.primary||t.tank)&&healed.has(start.get(t.uid)));
    const contact=(key,dir)=>{const [r,c]=pos(key);return finalContact(model,rec,new Set(h.rangeTiles(rec,r,c,dir)));};
    const beforeContact=rec.subProfessionId==='incantationmedic'?contact(from,start.dirs.get(p.uid)):0;
    const out=[];
    for(const [key]of ps.deployMap()){
      const [row,col]=pos(key);if(occupied.has(key)||!ps._legal(p,row,col))continue;
      for(const dir of DIRS){
        if(key===from&&dir===start.dirs.get(p.uid))continue;
        const plan=clone(start);plan.set(p.uid,key);plan.dirs.set(p.uid,dir);const coverage=cover(p,plan);
        if(protectedTargets.some(t=>!coverage.has(plan.get(t.uid))))continue;
        if(rec.subProfessionId==='incantationmedic'&&contact(key,dir)<Math.max(.01,beforeContact*.9))continue;
        const after=score(p,plan);if(after<=before+1e-6)continue;
        out.push({plan,uid:p.uid,from,to:key,dir,before,after,gain:after-before,
          distance:Math.abs(r-row)+Math.abs(c-col),covered:targets.filter(t=>t.uid!==p.uid&&coverage.has(plan.get(t.uid))).map(t=>t.uid)});
      }
    }
    out.sort((a,b)=>b.gain-a.gain||a.distance-b.distance||a.to.localeCompare(b.to)||a.dir.localeCompare(b.dir));
    // Equal recipient sets on different tiles are not equivalent: incoming boss damage and medic survival differ.
    const seen=new Set();return out.filter(r=>!seen.has(r.to)&&seen.add(r.to)).slice(0,2);
  }
  for(const p of medics){
    const alternativesFor=alternatives(p,original);rows.push(...alternativesFor);
    if(alternativesFor.length)weak.push({uid:p.uid,id:p.id,before:score(p,original),best:alternativesFor[0].after});
  }
  rows.sort((a,b)=>b.gain-a.gain||a.distance-b.distance||a.uid-b.uid||a.to.localeCompare(b.to));
  // At least the strongest alternative of a second medic survives before a second proposal for the first.
  const chosen=[],seenMedics=new Set();
  for(const row of rows)if(!seenMedics.has(row.uid)){chosen.push(row);seenMedics.add(row.uid);}
  for(const row of rows)if(!chosen.includes(row))chosen.push(row);
  const selected=chosen.slice(0,3);
  const first=selected[0],other=first&&medics.find(p=>p.uid!==first.uid);
  const linked=other&&alternatives(other,first.plan)[0];
  if(linked)selected.push({...linked,linkedWith:first.uid});
  else if(chosen[3])selected.push(chosen[3]);
  const seen=new Set(),unique=selected.filter(r=>!seen.has(footprint(r.plan))&&seen.add(footprint(r.plan)));
  return {plans:unique.map(r=>r.plan),proposals:unique.map(({plan,...r})=>r),weak,...demand};
}

export function createHealingCoveragePolicy(parent){
  return Object.freeze({...parent,name:'Sargon final medical coverage of observed injury',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(m.wave||!m.isSolo||m.round!==m.gd.bossRound||m.botRehearsal<2)return;
      const original=new h.LayoutPlan();original.lineup=field(ps);
      for(const [key,p]of ps.board)if(p.kind==='chess'){original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');}
      if(!original.lineup.some(p=>isMedic(ps.gd.chess(p.id))))return;
      function* input(plan){
        const snapshot=yield* h.bossInputSteps(m,ps,original.lineup,plan,{keepWithdrawn:true});
        const gains=swiftPrepGains(ps,original.lineup,plan,snapshot.bonds);plan.healingPrepGains=gains;
        for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;
        return snapshot;
      }
      const policy={singlePlanProbe:true,forecastContext:()=>({boss:true}),includeBossMetrics:true,
        selectForecast:selectPapyrusForecast,
        observeForecast(battle){
          const injuries={},firstDeaths={};
          battle.on('death',({unit,reason})=>{if(reason==='killed'&&unit?.ownerId===ps.playerId&&unit.kind==='op')firstDeaths[unit.uid]??=battle.time;});
          battle.on('tick',()=>{
            if(battle.tickCount%15)return;
            const units=battle.units.filter(u=>u.kind==='op'&&u.ownerId===ps.playerId&&u.alive&&u.deployed&&!u.hidden);
            const medics=units.filter(u=>isMedic(ps.gd.chess(u.defId)||{}));
            for(const u of units){
              const row=injuries[u.uid]||={aliveSeconds:0,hurtSeconds:0,uncoveredSeconds:0};row.aliveSeconds+=.5;
              if(u.hpRatio>=.99)continue;row.hurtSeconds+=.5;
              if(!medics.some(q=>q.rangeKeys?.includes(u.tileR*COLS+u.tileC)))row.uncoveredSeconds+=.5;
            }
          });
          return pp=>({unitStats:pp.unitStats,injuries,firstDeaths});
        }};
      const probe=yield* createForecastSteps(m,ps,original.lineup,[original],input,policy);
      if(!probe)return;while(!probe.run(4))yield;
      const reference=probe.outcomes;
      if(reference.length!==2||reference.some(r=>!r.valid))return;
      // Preserve every inherited predicted win. Repositioning is an extra rescue candidate, not mandatory churn.
      if(reference.some(r=>r.won)){note(ps,{round:m.round,phase:'gate',reason:'inherited-predicted-win',simulations:2});return;}
      const result=healingCoveragePlans(m,ps,h,original,reference),{plans,proposals,weak,targets,excluded}=result;
      if(!plans.length){note(ps,{round:m.round,phase:'gate',reason:'no-improving-legal-medical-coverage',simulations:2,targets,excluded});return;}
      const candidates=[original,...plans],outcomes=[...reference];
      for(let offset=0;offset<plans.length;offset+=2){
        const batch=[original,...plans.slice(offset,offset+2)],job=yield* createForecastSteps(m,ps,original.lineup,batch,input,
          {...policy,reuseForecastRows:p=>p===original?reference:null});
        if(!job)return;while(!job.run(4))yield;
        for(const row of job.outcomes.filter(r=>r.index===0))if(JSON.stringify(row)!==JSON.stringify(reference.find(r=>r.sample===row.sample)))throw Error('Medical incumbent drift');
        outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:r.index+offset})));
      }
      const {index}=selectPapyrusForecast(candidates,outcomes),best=candidates[index];
      if(index){
        yield* h.applyPlanSteps(m,ps,original.lineup,best);
        if([...best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==best.dirs.get(uid)))throw Error('Medical layout rejected');
      }
      note(ps,{round:m.round,phase:'comparison',index,simulations:outcomes.length,targets,excluded,weak,proposals,
        candidates:candidates.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],prepGains:p.healingPrepGains})),outcomes});
    }});
}
