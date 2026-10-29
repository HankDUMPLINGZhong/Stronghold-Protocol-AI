import {protectedHealingPlans,observeEffectiveHealing} from './sargonProtectedHealing.js';
import {completeForecastRows,selectOwnBossDamage} from '../botCoopForecast.js';
import {sargonPlanning} from '../botCoopForecast.js';
// [ASSUMED] Recheck healing after the inherited final roster AND all dealer moves.
// Read-only independent forecasts identify sustained injuries; proposals move medics only, never actual-seed search.
import {DIRS} from '../../../../../../../../../../../../../../../sim/dir.js';
import {COLS} from '../../../../../../../../../../../../../../../sim/constants.js';
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
  if(!completeForecastRows(paired))return {targets,excluded};
  const maxDamage=Math.max(1,...paired.flatMap(r=>r.unitStats.map(s=>s.dmg||0)));
  for(const p of lineup){
    const rec=ps.gd.chess(p.id);if(!acceptsHealing(rec))continue;
    const stats=paired.map(r=>r.unitStats.find(s=>s.uid===p.uid)),hurt=paired.map(r=>r.injuries?.[p.uid]?.hurtSeconds||0);
    const taken=stats.reduce((n,s)=>n+(s?.taken||0),0)/paired.length;
    if(!taken||Math.min(...hurt)<1){
      excluded.push({uid:p.uid,id:p.id,taken,hurt,reason:taken?'no-sustained-healing-window':'no-damage'});continue;
    }
    const damage=stats.reduce((n,s)=>n+(s?.dmg||0),0)/paired.length;
    const primary=main.has(ps.gd.baseIdOf(p.id)),tank=front(rec),dealer=damage>=maxDamage*.2;
    const priority=primary?3:tank?2.5:dealer?2:1;
    const weight=priority*(1+Math.min(4,taken/Math.max(1,rec.stats?.maxHp||1))+Math.min(3,Math.min(...hurt)/15));
    targets.push({uid:p.uid,id:p.id,weight,primary,tank,dealer,taken,hurt});
  }
  targets.sort((a,b)=>b.weight-a.weight||a.uid-b.uid);return {targets,excluded};
}

// Keep existing effective recipients, then consider bounded legal joint moves.
export function healingCoveragePlans(m,ps,h,original,paired){
  return protectedHealingPlans(m,ps,h,original,paired,{DIRS,healingTiles,acceptsHealing,finalContact,demand:healingDemand(ps,original.lineup,paired)});
}

export function createHealingCoveragePolicy(parent){
  return Object.freeze({...parent,name:'Sargon final medical coverage of observed injury',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(m.wave||!sargonPlanning(m,ps)||m.round!==m.gd.bossRound||m.botRehearsal<2)return;
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
          const injuries={},firstDeaths={},healingReceived=observeEffectiveHealing(battle,ps.playerId);
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
          return pp=>({unitStats:pp.unitStats,injuries,firstDeaths,healingReceived});
        }};
      const probe=yield* createForecastSteps(m,ps,original.lineup,[original],input,policy);
      if(!probe)return;while(!probe.run(4))yield;
      const reference=probe.outcomes;
      if(!completeForecastRows(reference))return;
      // Preserve every inherited predicted win. Repositioning is an extra rescue candidate, not mandatory churn.
      if(reference.some(r=>r.won)){note(ps,{round:m.round,phase:'gate',reason:'inherited-predicted-win',simulations:reference.length});return;}
      const result=healingCoveragePlans(m,ps,h,original,reference),{plans,proposals,weak,targets,excluded,protectedTargets,generated}=result;
      if(!plans.length){note(ps,{round:m.round,phase:'gate',reason:'no-improving-legal-medical-coverage',simulations:reference.length,targets,excluded});return;}
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
      note(ps,{round:m.round,phase:'comparison',index,simulations:outcomes.length,targets,excluded,weak,proposals,protectedTargets,generated,
        candidates:candidates.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],prepGains:p.healingPrepGains})),outcomes});
    }});
}
