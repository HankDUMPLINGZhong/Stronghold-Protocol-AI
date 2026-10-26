// [ASSUMED] After inherited roster selection, compare bounded local repairs against the unchanged final formation.
import {DIRS} from '../../../../../../../../../../../sim/dir.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';
import {createForecastSteps} from '../botForecast.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {bodyKeys} from '../../../../../../../../../../../sim/body.js';
import {boardTileOf} from '../../../../../../../../../../board.js';
import {COLS} from '../../../../../../../../../../../sim/constants.js';
import {swiftPrepGains} from './sargonSwift.js';

const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'final-contact-round17',...e});
const position=key=>key.split(',').map(Number);
const eligible=rec=>rec.position==='RANGED'&&rec.attackKind!=='heal'&&rec.dmgType!=='heal'
  &&rec.attackKind!=='none'&&!['incantationmedic','guardian'].includes(rec.subProfessionId);

/** Public route residence / fixed hit-body coverage; never reads a battle seed or a battle result. */
export function finalContact(model,rec,cover){
  if(model.observedBoss?.length)return Math.min(...model.observedBoss.map(rows=>{
    const total=rows.reduce((n,r)=>n+r.count,0),hit=rows.reduce((n,r)=>n+(r.tiles.some(k=>cover.has(k))?r.count:0),0);
    return total?hit/total:0;
  }));
  let hit=0,total=0;
  for(const body of model.bossBodies||[]){total+=100;if(body.tiles.some(k=>cover.has(k)))hit+=100;}
  for(const rt of model.routes){
    if(rt.fallback||!(rt.n>0)||rt.fly&&!rec.canHitFly)continue;
    for(const [i,key]of rt.tiles.entries()){
      const w=rt.n*(Math.max(.4,rt.tileTime||1)+(i<2?rt.dwell||0:0));
      total+=w;if(cover.has(key))hit+=w;
    }
  }
  return total?hit/total:0;
}
/** Each proposal changes exactly one chess, with no swaps, withdrawals, equipment or bond changes. */
export function localFinalPlans(m,ps,h,original,paired=[]){
  const model={...h.fieldModel(m,ps)},lineup=original.lineup,occupied=new Set(ps.board.keys());
  if(paired.length===2&&paired.every(r=>r.residence?.length))model.observedBoss=paired.map(r=>r.residence);
  const recs=new Map(lineup.map(p=>[p.uid,h.rangeRec(ps,ps.gd.chess(p.id))]));
  const cover=(p,key,dir)=>{const [r,c]=position(key);return new Set(h.rangeTiles(recs.get(p.uid),r,c,dir));};
  const healers=lineup.filter(p=>{
    const r=recs.get(p.uid);return r.attackKind==='heal'||['incantationmedic','guardian'].includes(r.subProfessionId);
  });
  const healed=(p,key)=>acceptsHealing(recs.get(p.uid))&&healers.some(q=>{
    const [r,c]=position(original.get(q.uid));return healingTiles(recs.get(q.uid),r,c,original.dirs.get(q.uid)).has(key);
  });
  // The exact unchanged incumbent's independent forecasts, never actual combat, can also flag sparse attack use.
  const sparse=new Map();
  if(paired.length===2)for(const p of lineup){
    const rec=recs.get(p.uid),interval=Math.max(.2,(rec.stats?.bat||1)*100/Math.max(1,rec.stats?.aspd||100));
    const ratios=paired.map(r=>{
      const stat=r.unitStats.find(u=>u.uid===p.uid);if(!stat)return 1;
      const others=r.unitStats.filter(u=>eligible(recs.get(u.uid)||{}));
      const maximum=Math.max(1,...others.map(u=>{const st=recs.get(u.uid).stats||{};
        return u.attacks*Math.max(.2,(st.bat||1)*100/Math.max(1,st.aspd||100));}));
      const maxDamage=Math.max(1,...others.map(u=>u.dmg));
      return stat.dmg<maxDamage*.15?stat.attacks*interval/maximum:1;
    });
    if(ratios.every(r=>r<.25))sparse.set(p.uid,Math.max(...ratios));
  }
  const proposals=[],weak=[];
  for(const p of lineup){
    const rec=recs.get(p.uid);if(!eligible(rec))continue;
    const key=original.get(p.uid),dir=original.dirs.get(p.uid),[r,c]=position(key);
    const before=finalContact(model,rec,cover(p,key,dir)),rows=[];
    for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
      if(Math.abs(dr)+Math.abs(dc)>2)continue;
      const row=r+dr,col=c+dc,to=`${row},${col}`;
      if(to!==key&&occupied.has(to)||!ps._legal(p,row,col))continue;
      if(healed(p,key)&&!healed(p,to))continue;
      for(const facing of DIRS){
        if(to===key&&facing===dir)continue;
        const coverage=cover(p,to,facing),score=finalContact(model,rec,coverage);
        if(sparse.has(p.uid)?score+1e-6<before*.7:score<=before+1e-6)continue;
        rows.push({uid:p.uid,from:key,fromDir:dir,to,dir:facing,before,contact:score,
          sparse:sparse.get(p.uid)??null,distance:Math.abs(dr)+Math.abs(dc),coverage:[...coverage].sort().join('|')});
      }
    }
    const best=Math.max(before,...rows.map(r=>r.contact));
    if(!(best>0)||before>=best*.65&&!sparse.has(p.uid))continue;
    weak.push({uid:p.uid,id:p.id,before,best,sparse:sparse.get(p.uid)??null});
    rows.sort((a,b)=>b.contact-a.contact||a.distance-b.distance||a.to.localeCompare(b.to)||a.dir.localeCompare(b.dir));
    const cells=new Set();
    // At most one facing per moved cell, plus the strongest improving in-place turn.
    // Equal range footprints on different cells are not interchangeable: boss targets and healing can differ.
    const moves=rows.filter(r=>r.distance>0&&!cells.has(r.to)&&cells.add(r.to)).slice(0,3);
    const turn=rows.find(r=>r.distance===0);
    proposals.push(...moves,...(turn?[turn]:[]));
  }
  proposals.sort((a,b)=>Number(b.sparse!==null)-Number(a.sparse!==null)
    ||(a.sparse??1)-(b.sparse??1)||(b.contact-b.before)-(a.contact-a.before)||b.contact-a.contact
    ||a.distance-b.distance||a.uid-b.uid||a.to.localeCompare(b.to)||a.dir.localeCompare(b.dir));
  const selected=proposals.slice(0,4),plans=selected.map(row=>{
    const plan=new h.LayoutPlan(original);plan.dirs=new Map(original.dirs);plan.lineup=lineup;
    plan.set(row.uid,row.to);plan.dirs.set(row.uid,row.dir);return plan;
  });
  return {plans,proposals:selected.map(({coverage,...row})=>row),weak};
}
export function createLocalFinalPolicy(parent){
  return Object.freeze({...parent,name:'Sargon final roster with bounded local contact alternatives',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(m.wave||!m.isSolo||m.round!==m.gd.bossRound||m.botRehearsal<2)return;
      const original=new h.LayoutPlan();original.lineup=[];
      for(const [key,p]of ps.board)if(p.kind==='chess'){
        original.lineup.push(p);original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');
      }
      function* input(plan){
        const snapshot=yield* h.bossInputSteps(m,ps,original.lineup,plan,{keepWithdrawn:true});
        // Same pure SERVER_PREP_FIN projection as the inherited Swift comparison; no real grants or dispatch.
        const gains=swiftPrepGains(ps,original.lineup,plan,snapshot.bonds);
        plan.localPrepGains=gains;
        for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;
        return snapshot;
      }
      const probe=yield* createForecastSteps(m,ps,original.lineup,[original],input,{
        singlePlanProbe:true,forecastContext:()=>({boss:true}),includeBossMetrics:true,
        selectForecast:selectPapyrusForecast,
        observeForecast(battle){
          const residence=new Map(),field=battle.players.find(p=>p.playerId===ps.playerId)?.side==='R'?'bossR':'bossL';
          battle.on('tick',()=>{
            if(battle.tickCount%15)return;
            for(const e of battle.enemies)if(e.isBoss&&e.alive&&!e.hidden){
              const tiles=bodyKeys(e).map(k=>boardTileOf(field,Math.floor(k/COLS),k%COLS).join(','));
              if(!tiles.length)continue;const key=tiles.join('|'),r=residence.get(key)||{tiles,count:0};
              r.count++;residence.set(key,r);
            }
          });
          return pp=>({unitStats:pp.unitStats,residence:[...residence.values()]});
        }});
      if(!probe)return;while(!probe.run(4))yield;
      const reference=probe.outcomes;
      if(reference.length!==2||reference.some(r=>!r.valid))return;
      const {plans,proposals,weak}=localFinalPlans(m,ps,h,original,reference);
      if(!plans.length){note(ps,{round:m.round,phase:'gate',reason:'no-deficient-legal-alternative',weak,simulations:2});return;}
      const candidates=[original,...plans],outcomes=[...reference];
      for(let offset=0;offset<plans.length;offset+=2){
        const batch=[original,...plans.slice(offset,offset+2)];
        const policy={forecastContext:()=>({boss:true}),includeBossMetrics:true,
          observeForecast:()=>pp=>({unitStats:pp.unitStats}),selectForecast:selectPapyrusForecast,
          reuseForecastRows:plan=>plan===original?reference:null};
        const job=yield* createForecastSteps(m,ps,original.lineup,batch,input,policy);
        if(!job)return;while(!job.run(4))yield;
        for(const row of job.outcomes.filter(r=>r.index===0)){
          if(JSON.stringify(row)!==JSON.stringify(reference.find(r=>r.sample===row.sample)))throw Error('Final contact incumbent drift');
        }
        outcomes.push(...job.outcomes.filter(r=>r.index>0).map(r=>({...r,index:r.index+offset})));
      }
      const {index}=selectPapyrusForecast(candidates,outcomes),best=candidates[index];
      if(index){
        yield* h.applyPlanSteps(m,ps,original.lineup,best);
        if([...best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==best.dirs.get(uid)))throw Error('Final contact application rejected');
      }
      note(ps,{round:m.round,phase:'comparison',index,weak,proposals,
        simulations:outcomes.length,reusedSamples:Math.ceil(plans.length/2)*2,
        candidates:candidates.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],
          prepGains:p.localPrepGains})),outcomes});
    }});
}
