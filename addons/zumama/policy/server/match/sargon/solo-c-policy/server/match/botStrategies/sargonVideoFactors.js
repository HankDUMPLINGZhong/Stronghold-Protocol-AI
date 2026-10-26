// [ASSUMED] Four independent video-derived proposals on frozen B 25/6. No gameplay or actual-seed lookahead.
import { canPlace,placeClass } from '../../../../../../../../../../board.js';
import { healingTiles,acceptsHealing } from '../botPositioning.js';
import { ids } from './sargonPepe.js';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const healer=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const carry=new Set([ids.passenger,ids.pepe,ids.titi]);
const final=(m)=>!m.wave&&m.round===m.gd.bossRound;

export function canSkipFreshTiti(parent,m,ps){
  if(ps.shop.level!==5||m.opts.botSargonVersion!=='tempo'||(ps.bonds.sargonShip?.count||0)<6
    ||ps.lp<=m.gd.lpCapPerRound+4||ps.funds<ps.shop.upgradePrice+parent.upgradeReserve(m,ps)
    ||ps.allChess().some(p=>base(ps,p)===ids.titi)
    ||(m.lastResults?.get(ps.playerId)?.leaked||[]).some(l=>l.counted!==false))return false;
  const skip=s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)===ids.titi&&ps.priceOf(s)<=ps.funds;
  if(!ps.shop.slots.some(skip))return false;
  const shadow=Object.assign(Object.create(ps),{shop:{...ps.shop,slots:ps.shop.slots.filter(s=>!skip(s))}});
  return parent.beforeUpgrade(m,shadow);
}
export function createTitiSixPolicy(parent){
  const beforeUpgrade=(m,ps)=>{
    if(parent.beforeUpgrade(m,ps))return true;
    if(!canSkipFreshTiti(parent,m,ps))return false;
    const key=JSON.stringify([m.round,ps.funds,ps.shop.upgradePrice,ps.shop.slots]);
    const seen=ps._sargonVideoTitiChecks||=new Set();
    if(!seen.has(key)){seen.add(key);(ps._sargonFactorHistory||=[]).push({factor:'video-titi-six',phase:'upgrade-release',
      round:m.round,funds:ps.funds,price:ps.shop.upgradePrice,reserve:parent.upgradeReserve(m,ps)});}
    return true;
  };
  const priorityLevel=(m,ps)=>ps.shop.level<parent.levelTarget(m,ps)&&beforeUpgrade(m,ps);
  return Object.freeze({...parent,name:'B25/6: fresh Titi cannot unnecessarily block six',beforeUpgrade,priorityLevel,
    spendReserve:(m,ps)=>priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+parent.upgradeReserve(m,ps)?ps.shop.upgradePrice:0});
}
export function cycleReady(ps){
  return ps.bonds.swiftShip?.active&&(ps.layers.swiftShip||0)>=40
    &&ps.allChess().some(p=>base(ps,p)===ids.minimalist);
}
export function createVideoSearchPolicy(parent,kind){
  return Object.freeze({...parent,name:`B25/6 independent video ${kind}`,
    searchVariant:(m,ps)=>kind==='cycle'?(cycleReady(ps)?kind:null):final(m)?kind:null});
}
// [ASSUMED] Use a vacant proposal slot before discarding the inherited layout; never exceed three plans.
export function safetyProposalIndex(count,preserveSpare=false){
  return count===1||preserveSpare&&count<3?count:count-1;
}

/** Proposal ranking only. True items, kits, threat and healing are evaluated by the unchanged battle simulator. */
export function frontlineAdjustment(ps,lineup){
  let value=0;
  for(const p of lineup){const r=ps.gd.chess(p.id);if(!front(r))continue;
    const s=r.stats;value+=12*Math.min(3,(s.maxHp||1000)/1800*(1+(s.def||0)/800)*(s.blockCnt||2)/2);
    if(base(ps,p)===ids.philae)value-=20; // retire the fixed development premium at the final assault only
  }
  return value;
}
export function cycleProposals(ps,rows,chosen,original){
  const contains=row=>row.lineup.some(p=>base(ps,p)===ids.minimalist);
  if(original.some(p=>base(ps,p)===ids.minimalist)||chosen.some(contains))return chosen;
  const candidate=rows.find(contains);if(!candidate)return chosen;
  return [chosen[0],candidate].filter(Boolean).slice(0,2);
}

function unitsOf(ps,plan,h){
  return plan.lineup.map(p=>{
    const [r,c]=plan.get(p.uid).split(',').map(Number),rec=h.rangeRec(ps,ps.gd.chess(p.id)),dir=plan.dirs.get(p.uid)||'RIGHT';
    return {p,rec,r,c,cover:new Set(h.rangeTiles(rec,r,c,dir)),heals:healingTiles(rec,r,c,dir)};
  });
}
function reach(u,model){
  const bodies=model.bossBodies?.flatMap(b=>b.tiles||[])||[];
  if(bodies.length)return bodies.some(k=>u.cover.has(k))?1:0;
  const routes=model.routes.filter(r=>!r.fallback),total=routes.reduce((n,r)=>n+r.n,0)||1;
  return routes.reduce((n,r)=>n+r.n*Math.min(1,r.tiles.filter(k=>u.cover.has(k)).length/3),0)/total;
}
function sharedDanger(m,a,b){
  if(m.bossId==='boss_7')return a.c===b.c;
  if(m.bossId==='boss_6')return a.r===b.r||a.c===b.c;
  // [ASSUMED] Local splash proxy for other public leader kits; actual trials decide, including global AoE.
  return (a.r-b.r)*(a.r-b.r)+(a.c-b.c)*(a.c-b.c)<=4;
}
export function safetyLayoutValue(m,ps,plan,h){
  const model=h.fieldModel(m,ps),units=unitsOf(ps,plan,h),healers=units.filter(u=>healer(u.rec));
  const mains=units.filter(u=>carry.has(base(ps,u.p))),tanks=units.filter(u=>front(u.rec));
  let score=mains.reduce((n,u)=>n+12*reach(u,model),0);
  for(const u of healers){
    const live=u.rec.subProfessionId!=='incantationmedic'||reach(u,model)>0;
    for(const v of [...mains,...tanks])if(v!==u&&acceptsHealing(v.rec))
      score+=live&&u.heals.has(`${v.r},${v.c}`)?4:-1;
    for(const v of mains)if(v!==u&&sharedDanger(m,u,v))score-=3;
  }
  for(let i=0;i<healers.length;i++)for(let j=i+1;j<healers.length;j++)if(sharedDanger(m,healers[i],healers[j]))score-=8;
  return score;
}
/** Same owned roster, one move or terrain-compatible swap, all directions; no economy actions. */
export function safetyPlans(m,ps,original,h){
  const model=h.fieldModel(m,ps),map=ps.deployMap(),units=unitsOf(ps,original,h);
  if(!units.some(u=>healer(u.rec))||!units.some(u=>carry.has(base(ps,u.p))))return [];
  const occupied=new Map([...original].map(([uid,key])=>[key,uid])),rows=[],before=safetyLayoutValue(m,ps,original,h);
  for(const u of units.filter(u=>healer(u.rec)||carry.has(base(ps,u.p))))for(const [key]of map){
    const [r,c]=key.split(',').map(Number);if(!canPlace(map,placeClass(ps,u.rec),r,c))continue;
    const other=occupied.get(key),start=original.get(u.p.uid),[sr,sc]=start.split(',').map(Number);
    if(other&&other!==u.p.uid){const v=units.find(v=>v.p.uid===other);if(!canPlace(map,placeClass(ps,v.rec),sr,sc))continue;}
    for(const dir of ['RIGHT','UP','DOWN','LEFT']){
      const plan=new h.LayoutPlan(original);plan.dirs=new Map(original.dirs);plan.reserved=new Set(original.reserved);plan.lineup=original.lineup;
      plan.set(u.p.uid,key);plan.dirs.set(u.p.uid,dir);if(other&&other!==u.p.uid)plan.set(other,start);
      const next=unitsOf(ps,plan,h);
      if(units.some(v=>carry.has(base(ps,v.p))&&reach(v,model)>0&&reach(next.find(w=>w.p.uid===v.p.uid),model)<=0))continue;
      const score=safetyLayoutValue(m,ps,plan,h);if(score<=before+.01)continue;
      const signature=[...plan].map(([uid,k])=>`${uid}@${k}:${plan.dirs.get(uid)}`).sort().join('|');
      rows.push({plan,score,signature});
    }
  }
  rows.sort((a,b)=>b.score-a.score||a.signature.localeCompare(b.signature));
  const seen=new Set();return rows.filter(r=>!seen.has(r.signature)&&seen.add(r.signature)).slice(0,2).map(r=>r.plan);
}

/** Read observers only. Include boss metrics opt-in so retained forecast records remain unchanged. */
export function videoForecastMetrics(policy,ps){
  return {...policy,includeBossMetrics:true,
    observeForecast(battle,context,plan){
      const observe=policy.observeForecast(battle,context,plan),casts={};
      battle.on('skillStart',({unit})=>{if(unit?.ownerId===ps.playerId&&unit.kind==='op'){
        const id=ps.gd.baseIdOf(unit.defId);casts[id]=(casts[id]||0)+1;}});
      return pp=>({...observe(pp),casts,unitStats:(pp.unitStats||[]).map(u=>({uid:u.uid,id:u.defId,dmg:u.dmg,taken:u.taken,heal:u.heal,attacks:u.attacks}))});
    }};
}
