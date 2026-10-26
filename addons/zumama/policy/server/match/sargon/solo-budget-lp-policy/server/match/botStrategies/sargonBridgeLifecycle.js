// [ASSUMED] User-requested engine-for-bridge candidates, paired with the incumbent before any bridge sale.
import {computeBonds} from '../../../../../../../../../../bondsMeta.js';
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {createForecastSteps} from '../botForecast.js';
import {swiftForecastPolicy,selectSwiftForecast} from './sargonSwift.js';
import {foreignEngineRank} from './sargonRound22.js';
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const tracked=(ps,p)=>ps._sargonRound21Bridge?.base===ps.gd.baseIdOf(p.id??p.chessId);
const role=(gd,lineup,key)=>lineup.some(p=>{const r=gd.chess(p.id);return key==='front'
  ?r.position==='MELEE'&&(r.stats.blockCnt||0)>=2:r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);});
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'swift-bridge-round22',...e});

export function bridgeNeeded(ps){
  if(!ps.bonds.swiftShip?.active||!ps._sargonRound21Bridge)return false;
  const shadow=Object.assign(Object.create(ps),{board:new Map([...ps.board].filter(([,p])=>p.kind!=='chess'||!tracked(ps,p)))});
  return !computeBonds(ps.gd,shadow).swiftShip?.active;
}

export function sellReleasedBridge(m,ps){
  if(!ps.bonds.swiftShip?.active||bridgeNeeded(ps)||!field(ps).some(p=>foreignEngineRank(ps.gd,ps.gd.chess(p.id))>=2))return false;
  const p=ps.allChess().find(p=>tracked(ps,p)&&ps.find(p.uid)?.area!=='board');if(!p)return false;
  const before={...ps.bonds.swiftShip},funds=ps.funds,result=ps.sell(p.uid);
  if(!result?.ok)return false;
  if(!ps.bonds.swiftShip?.active)throw Error('Bridge sale broke active Swift');
  note(ps,{round:m.round,phase:'sell-released-bridge',id:p.id,uid:p.uid,fundsBefore:funds,fundsAfter:ps.funds,
    before,after:{...ps.bonds.swiftShip},engines:field(ps).filter(p=>foreignEngineRank(ps.gd,ps.gd.chess(p.id))>=2).map(p=>p.id)});
  return true;
}

export function bridgeEngineRosters(ps,api){
  const original=field(ps),bridge=original.find(p=>tracked(ps,p));if(!bridge)return [];
  const before=ps.bonds,owned=ps.allChess().filter(p=>ps.find(p.uid)?.area!=='board'
    &&foreignEngineRank(ps.gd,ps.gd.chess(p.id))>0).sort((a,b)=>foreignEngineRank(ps.gd,ps.gd.chess(b.id))
      -foreignEngineRank(ps.gd,ps.gd.chess(a.id))||Number(ps.gd.isGolden(b.id))-Number(ps.gd.isGolden(a.id))||a.uid-b.uid);
  return owned.flatMap(added=>{
    const lineup=original.map(p=>p===bridge?added:p),after=api.shadow(ps,lineup).bonds;
    if(!after.swiftShip?.active||(after.sargonShip?.count||0)<Math.min(6,before.sargonShip?.count||0)
      ||(after.preciShip?.tier||0)<(before.preciShip?.tier||0)||!api.transition(ps,original,lineup)
      ||['front','heal'].some(k=>role(ps.gd,original,k)&&!role(ps.gd,lineup,k)))return [];
    return [{lineup,added,bridge,rank:foreignEngineRank(ps.gd,ps.gd.chess(added.id)),bonds:after}];
  }).slice(0,2);
}

export function selectBridgeEngine(plans,outcomes,context){
  return selectSwiftForecast(plans,outcomes.map(r=>({...r,growth:(plans[r.index].engineRank||0)*1000
    +(r.gains?.swiftShip||0)+(r.gains?.preciShip||0)*.01})),context);
}

export function createBridgeLifecyclePolicy(parent,api){
  const farming=(m)=>!!m.wave&&m.round<m.gd.bossRound;
  return Object.freeze({...parent,name:parent.name+'; replace and release cheap bridges',
    keep:(m,ps,r)=>parent.keep(m,ps,r)||farming(m)&&tracked(ps,r)&&bridgeNeeded(ps),
    preserve:(m,ps,r)=>parent.preserve(m,ps,r)||farming(m)&&tracked(ps,r)&&bridgeNeeded(ps),
    preparePurchases(m,ps,h){sellReleasedBridge(m,ps);parent.preparePurchases?.(m,ps,h);},
    cleanupAcquisitions(m,ps){parent.cleanupAcquisitions?.(m,ps);sellReleasedBridge(m,ps);},
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(!m.isSolo||m.botRehearsal<2||!m.wave||m.round>=m.gd.bossRound||!ps._sargonRound21Bridge)return;
      const rows=bridgeEngineRosters(ps,api);if(!rows.length)return;
      const original=new h.LayoutPlan();original.lineup=field(ps);original.engineRank=0;
      for(const [key,p]of ps.board)if(p.kind==='chess'){original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');}
      const plans=[original];
      for(const [i,row]of rows.entries()){
        const plan=yield* h.planLayoutSteps(api.shadow(ps,row.lineup),row.lineup,{formationRoles:true,fireControl:true,
          rng:createRng(deriveSeed(m.seed,`sargon-bridge-engine:${m.round}:${ps.seat}:${i}`))});
        if(plan.size!==row.lineup.length||new Set(plan.values()).size!==row.lineup.length)continue;
        plan.lineup=row.lineup;plan.engineRank=row.rank;plans.push(plan);
      }
      if(plans.length<2)return;
      const policy={...swiftForecastPolicy(m,ps,plans,lineup=>api.shadow(ps,lineup).bonds),selectForecast:selectBridgeEngine};
      const job=yield* createForecastSteps(m,ps,original.lineup,plans,
        plan=>h.bossInputSteps(m,ps,plan.lineup,plan,{keepWithdrawn:true}),policy);
      if(!job)return;while(!job.run(4))yield;
      if(job.bestIndex){
        const transition=api.transition(ps,original.lineup,job.chosen);if(!transition)throw Error('Unreachable bridge replacement');
        for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);
          if(!ps.move(added.uid,{area:'board',row,col},job.best.dirs.get(added.uid))?.ok)throw Error('Bridge replacement rejected');}
        yield* h.applyPlanSteps(m,ps,job.chosen,job.best);
        if(!ps.bonds.swiftShip?.active||[...job.best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==job.best.dirs.get(uid)))
          throw Error('Bridge replacement broke its plan or Swift');
      }
      note(ps,{round:m.round,phase:'engine-replacement',index:job.bestIndex,simulations:job.outcomes.length,
        candidates:job.plans.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],
          engineRank:p.engineRank,bonds:api.shadow(ps,p.lineup).bonds,prepGains:p.swiftGains})),outcomes:job.outcomes});
      // Sale is deferred to the next shopping/offer hook, where its coin and any Pinecone reward can still be used.
    }});
}
