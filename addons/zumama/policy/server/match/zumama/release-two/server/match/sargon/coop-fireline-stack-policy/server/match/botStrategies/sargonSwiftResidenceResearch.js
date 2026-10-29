// Frozen research helper: normal-turn residence by real own layer yield, no shopping changes.
import {pieceBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
import {createRng,deriveSeed} from '../../../../../../../../../../../../../../../sim/rng.js';
import {createForecastSteps} from '../botForecast.js';
import {swiftForecastPolicy,selectSwiftForecast,isSwiftEngine} from './sargonSwift.js';
import {recordSwiftLpTrade} from './sargonSwiftLpTrade.js';
import {projectBossPrepFinish} from '../../../../residencePrepProjection.js';
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const base=(ps,p)=>ps.gd.baseIdOf(p.id);
const engine=(ps,p)=>isSwiftEngine(ps.gd,p)||base(ps,p)==='chess_char_6_19_a';
const has=(ps,p)=>pieceBonds(ps.gd,p).includes('swiftShip');
const stamp=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs.get(u)}`).join('|');
const eligible=(m,ps)=>!m.isSolo&&m.opts.botSargonCoopSeat===ps.playerId&&m.wave&&m.round<m.gd.bossRound;
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'swift-residence',...e});
const copy=(p,h)=>{const q=new h.LayoutPlan(p);q.lineup=p.lineup;q.dirs=new Map(p.dirs);q.reserved=new Set(p.reserved||[]);return q;};

/** Only a shortlist bound. Final ranking uses native prep effects on the actual legal plan and battle gains. */
export function residenceBound(ps,lineup,bonds){
  if(!bonds.swiftShip?.active)return 0;
  const selected=new Set(lineup.map(p=>p.uid));
  const hand=ps.hand.filter(p=>p?.kind==='chess'&&!selected.has(p.uid)).length+field(ps).filter(p=>!selected.has(p.uid)).length;
  let rate=0;
  for(const p of lineup)for(const id of ps.gd.chess(p.id).garrisonIds||[]){
    const g=ps.gd.garrison(id);
    if(g.eventType==='SERVER_PREP_FIN'){
      if(g.effectKey==='SERVER_ADD_BOND_CHESS_ALL'&&has(ps,p))rate+=g.bb.count;
      if(g.effectKey==='SERVER_ADD_BOND_METHOD'&&g.bbStr.add_method==='hand_count'&&g.bbStr.bond==='swiftShip')rate+=hand*g.bb.multi;
      if(g.effectKey==='SERVER_ADD_BOND_POSITION')rate+=g.bb.count*(Number(has(ps,p))+Number(lineup.some(q=>q!==p&&has(ps,q))));
    }
    if(g.eventType==='IN_BATTLE'&&g.effectKey==='act2autochess_gar_event_onstart'&&has(ps,p))rate+=g.bb.bond_add_count||0;
  }
  return rate;
}
export function residenceProjection(ps,plan,bonds){
  const result=projectBossPrepFinish(ps.gd,ps,plan,{bonds});
  let deployment=0;
  if(bonds.swiftShip?.active)for(const p of plan.lineup)if(has(ps,p))for(const id of ps.gd.chess(p.id).garrisonIds||[]){
    const g=ps.gd.garrison(id);
    if(g.eventType==='IN_BATTLE'&&g.effectKey==='act2autochess_gar_event_onstart')deployment+=g.bb.bond_add_count||0;
  }
  return {...result,deployment,rate:(result.gains.swiftShip||0)+deployment};
}
/** Keep all inherited paired safety / LP limits; growth ordering uses inherited marginal utility across bonds. */
export function selectResidence(plans,outcomes,context){
  const chosen=selectSwiftForecast(plans,outcomes,context);
  if(!chosen.index)return chosen;
  const ref=outcomes.filter(r=>r.index===0).sort((a,b)=>a.sample-b.sample);
  const rows=outcomes.filter(r=>r.index===chosen.index).sort((a,b)=>a.sample-b.sample);
  // Ties do not justify residence churn, and incomplete samples never win.
  if(rows.length!==2||ref.length!==2||rows.some((r,i)=>!r.valid||!ref[i].valid||r.sample!==i||ref[i].sample!==i
    ||(r.gains?.swiftShip||0)<=(ref[i].gains?.swiftShip||0)))return {index:0};
  return chosen;
}
function improveFacing(m,ps,plan,h,bonds){
  let best=copy(plan,h),rate=residenceProjection(ps,best,bonds).rate;
  const model=h.fieldModel(m,ps);
  for(const p of plan.lineup){
    if(!(ps.gd.chess(p.id).garrisonIds||[]).some(id=>ps.gd.garrison(id).effectKey==='SERVER_ADD_BOND_POSITION'))continue;
    // Do not turn a real damage dealer away from every accessible enemy route merely to farm.
    const rec=h.rangeRec(ps,ps.gd.chess(p.id)),[r,c]=best.get(p.uid).split(',').map(Number);
    for(const dir of ['RIGHT','UP','DOWN','LEFT']){
      const cover=new Set(h.rangeTiles(rec,r,c,dir));
      if(!model.routes.some(rt=>!rt.fallback&&rt.n>0&&(!rt.fly||rec.canHitFly)&&rt.tiles.some(k=>cover.has(k))))continue;
      const q=copy(best,h);q.dirs.set(p.uid,dir);const gain=residenceProjection(ps,q,bonds).rate;
      if(gain>rate){best=q;rate=gain;}
    }
  }
  return best;
}
export function withActualResidence(parent,api){return Object.freeze({...parent,
  *finalBoardSteps(m,ps,h){
    yield* parent.finalBoardSteps(m,ps,h);
    if(!eligible(m,ps)||m.botRehearsal<2||!ps.allChess().some(p=>engine(ps,p)))return;
    if(new Set(ps.allChess().filter(p=>has(ps,p)).map(p=>base(ps,p))).size+(ps.bondCountBonus?.swiftShip||0)<2)return;
    const original=new h.LayoutPlan();original.lineup=field(ps);
    for(const [key,p]of ps.board)if(p.kind==='chess'){original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');}
    const bondsFor=lineup=>api.shadow(ps,lineup).bonds;
    const originalProjection=residenceProjection(ps,original,bondsFor(original.lineup));
    const extras=[improveFacing(m,ps,original,h,bondsFor(original.lineup))];
    const rows=api.rosters(m,ps,{allCandidates:true,swiftPortfolio:true,allowSinglePrecision:true})
      .filter(r=>r.swift>=2&&r.lineup.some(p=>engine(ps,p)))
      .map(r=>({...r,bound:residenceBound(ps,r.lineup,bondsFor(r.lineup))}))
      .filter(r=>r.bound>originalProjection.rate)
      .sort((a,b)=>b.bound-a.bound||b.score-a.score||a.signature.localeCompare(b.signature));
    const types=new Set();let planned=0;
    for(const row of rows){
      const family=row.lineup.filter(p=>engine(ps,p)).map(p=>p.id).sort().join('|');
      if(types.has(family))continue;types.add(family);
      const plan=yield* h.planLayoutSteps(api.shadow(ps,row.lineup),row.lineup,{formationRoles:true,fireControl:true,
        rng:createRng(deriveSeed(m.seed,`actual-residence:${m.round}:${ps.seat}:${planned}`))});
      planned++;
      if(plan.size===row.lineup.length&&new Set(plan.values()).size===row.lineup.length){
        plan.lineup=row.lineup;extras.push(improveFacing(m,ps,plan,h,bondsFor(row.lineup)));
      }
      if(planned===2)break;
    }
    const seen=new Set([stamp(original)]);
    const proposals=extras.filter(p=>!seen.has(stamp(p))&&seen.add(stamp(p)))
      .map(p=>({plan:p,...residenceProjection(ps,p,bondsFor(p.lineup))})).filter(p=>p.rate>originalProjection.rate)
      .sort((a,b)=>b.rate-a.rate||stamp(a.plan).localeCompare(stamp(b.plan))).slice(0,2);
    if(!proposals.length)return;
    const plans=[original,...proposals.map(p=>p.plan)],inherited=swiftForecastPolicy(m,ps,plans,bondsFor);
    const projections=new Map(plans.map(p=>[p,residenceProjection(ps,p,bondsFor(p.lineup)).rate]));
    const policy={...inherited,selectForecast:selectResidence,
      prepareForecastInput(m,ps,chosen,plan,input){
        // Build once from unmodified current layers. Never add deployment layers here: the battle does that.
        const projected=projectBossPrepFinish(ps.gd,ps,plan,input);plan.swiftGains=projected.gains;return projected.input;
      }};
    const job=yield* createForecastSteps(m,ps,original.lineup,plans,p=>h.bossInputSteps(m,ps,p.lineup,p,{keepWithdrawn:true}),policy);
    if(!job)return;while(!job.run(4))yield;
    if(job.bestIndex){
      const transition=api.transition(ps,original.lineup,job.chosen);if(!transition)throw Error('Unreachable actual residence');
      for(const {added,key}of transition.pairs){const [row,col]=key.split(',').map(Number);
        if(!ps.move(added.uid,{area:'board',row,col},job.best.dirs.get(added.uid))?.ok)throw Error('Residence swap rejected');}
      yield* h.applyPlanSteps(m,ps,job.chosen,job.best);
      if([...job.best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==job.best.dirs.get(uid)))throw Error('Residence plan rejected');
    }
    recordSwiftLpTrade(m,ps,job,'actual-residence');
    note(ps,{phase:'comparison',round:m.round,index:job.bestIndex,beforeRate:originalProjection.rate,
      candidates:job.plans.map(p=>({roster:p.lineup.map(q=>({uid:q.uid,id:q.id})),tiles:[...p],dirs:[...p.dirs],prepGains:p.swiftGains,
        projection:projections.get(p)})),outcomes:job.outcomes});
  }});}
