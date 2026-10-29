// [ASSUMED] Player-taught Laterano normal-wave lines on maps #04/#05/#08. Diagram row = 21 - board row.
// Only existing pieces are arranged. No acquisition goals, combat results, RNG draws or extra forecasts.
import { canPlace, placeClass } from '../../../../../board.js';
import { map02Front } from './lateranoMap02.js';
import { acceptsHealing } from '../botPositioning.js';

const BIG = 1e8, DIRS = ['RIGHT','DOWN','UP','LEFT'];
const baseOf = (gd,u) => gd.baseIdOf(u.id || u.rec.chessId);
const bulk = u => (u.rec.stats?.maxHp || 0)*(1+(u.rec.stats?.def || 0)/500);
const isChess = u => !!u.rec.chessId;
const tileOf = (m,r,c) => m.stage.tiles[m.stage.rows[r]?.[c]];

/** Incantation medics heal from damage, including themselves; they need an enemy in their actual firing window. */
export function mapLineHealingCover(u,target) {
  if(u.healCover?.size)return u.healCover;
  return u.rec.subProfessionId==='incantationmedic'&&u.cover.has(target)?u.cover:new Set();
}

// Rectangular Hungarian assignment, including forbidden edges; deterministic ties, at most a normal roster.
function assign(costs) {
  const n=costs.length,m=costs[0]?.length || 0;if(!n)return [];
  if(n>m)return null;
  const u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
    do{
      used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=m;j++)if(!used[j]){
        const cur=costs[i0-1][j-1]-u[i0]-v[j];
        if(cur<min[j]){min[j]=cur;way[j]=j0;}
        if(min[j]<delta){delta=min[j];j1=j;}
      }
      for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
      j0=j1;
    }while(p[j0]);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const out=Array(n).fill(-1);
  for(let j=1;j<=m;j++)if(p[j])out[p[j]-1]=j-1;
  return out.every((j,i)=>j>=0&&costs[i][j]<BIG/2)?out:null;
}

function tideStyle(gd,m,variant) {
  if(variant===1)return 'right';if(variant===2)return 'left';
  return m.wave?.spawns.some(s=>gd.enemy(s.enemyKey)?.applyWay==='RANGED')?'up':'pool';
}
function anchors(gd,ps,units,map,occupied,ids,kind,model,variant=0) {
  const result=new Map(),taken=new Set(occupied),chess=units.filter(isChess);
  const put=(u,r,c,dir)=>{
    if(!u||taken.has(`${r},${c}`)||!canPlace(map,placeClass(ps,u.rec),r,c))return;
    result.set(u.uid,{key:`${r},${c}`,r,c,dir});taken.add(`${r},${c}`);
  };
  const saint=chess.filter(u=>baseOf(gd,u)===ids.executorAlter)
    .sort((a,b)=>Number(gd.isGolden(b.id || b.rec.chessId))-Number(gd.isGolden(a.id || a.rec.chessId))||a.uid-b.uid)[0];
  const fronts=chess.filter(u=>map02Front(u.rec)).sort((a,b)=>
    Number(baseOf(gd,b)===ids.faith)-Number(baseOf(gd,a)===ids.faith)||bulk(b)-bulk(a)||a.uid-b.uid);
  if(kind==='blower') {
    put(saint,10,7,'DOWN'); // Diagram (11,7): own tile plus (12,6..8), with the tank at (12,7).
    put(fronts[0],9,7,'RIGHT');
    const donors=chess.filter(u=>u.rec.bonds?.includes('skillfulShip'));
    if(saint&&result.has(saint.uid)&&new Set(donors.map(u=>baseOf(gd,u))).size>=2){
      const donor=donors.sort((a,b)=>Number(b.rec.attackKind==='heal')-Number(a.rec.attackKind==='heal')
        ||Number(baseOf(gd,a)===ids.archetto)-Number(baseOf(gd,b)===ids.archetto)||a.uid-b.uid)[0];
      put(donor,11,7,donor.rec.attackKind==='heal'?'DOWN':'LEFT');
    }
  } else if(kind==='infection'&&chess.length<=4&&!saint) {
    const cells=[[10,5],[11,5]].sort((a,b)=>{
      const flow=p=>model.routes.filter(rt=>!rt.fly&&!rt.fallback&&rt.tiles.includes(p.join(','))).reduce((n,rt)=>n+rt.n,0);
      return flow(b)-flow(a);
    });
    put(fronts[0],...cells[0],'RIGHT');put(fronts[1],...cells[1],'RIGHT');
  } else if(kind==='infection') {
    put(saint,11,8,'DOWN'); // Conservative player choice: diagram (10,8), before trying the riskier (11,8).
    put(fronts[0],10,8,'RIGHT');
  } else {
    const style=tideStyle(gd,ps.m,variant),quiet=['up','left'].includes(style)&&!!saint;
    if(saint) {
      if(style==='pool')put(saint,11,7,'LEFT');
      if(style==='up')put(saint,10,5,'UP');
      if(style==='right')put(saint,10,5,'RIGHT');
      if(style==='left')put(saint,11,3,'RIGHT');
    }
    put(fronts[0],quiet?10:11,quiet?4:5,quiet?'UP':'RIGHT');
    if(quiet)put(fronts[1],9,4,'UP');
    else {
      const lord=chess.find(u=>u.rec.subProfessionId==='lord'&&!fronts.includes(u));
      if(lord&&fronts.length>1){put(lord,11,4,'RIGHT');put(fronts[1],12,4,'RIGHT');}
      else put(fronts[1],12,5,'RIGHT');
    }
  }
  return result;
}

export function withLateranoMapLines(baseline,enabled=['blower','infection','tide']) {
  const kindOf=m=>m.round<m.gd.bossRound
    ? ({act2autochess_m01:'blower',act1autochess_m04:'infection',act2autochess_m04:'tide'})[m.stageId] : null;
  const selected=m=>{const k=kindOf(m);return enabled.includes(k)?k:null;};
  return Object.freeze({...baseline,
    placementVariants(m) {return selected(m)==='tide';},
    placementPlan(gd,pieces,plan,ctx) {
      const m=plan.ps?.m,kind=m&&selected(m);
      if(!kind)return baseline.placementPlan?.(gd,pieces,plan,ctx);
      const units=pieces.map(p=>({uid:p.uid,id:p.id,rec:ctx.recOf(p)}));
      const starts=anchors(gd,plan.ps,units,ctx.map,ctx.occupied,baseline.ids,kind,ctx.model,plan.placementVariant);
      return {starts,fixed:new Set(starts.keys()),reserved:new Set()};
    },
    repairContact(m,ps,units,plan,model,helpers) {
      const kind=selected(m);
      if(!kind)return baseline.repairContact?.(m,ps,units,plan,model,helpers);
      const {unitOf,map,occupied,scoreLayout,allows}=helpers,gd=ps.gd || m.gd;
      const original=units.slice(),pins=anchors(gd,ps,units,map,occupied,baseline.ids,kind,model,plan.placementVariant);
      const tokens=units.filter(u=>!isChess(u));for(const u of tokens)pins.set(u.uid,u);
      const keys=[...map.keys()].filter(k=>!occupied.has(k)&&!plan.reserved?.has(k));
      const healing=units.some(u=>u.healCover?.size||u.rec.subProfessionId==='incantationmedic');
      const lemuen=units.find(u=>isChess(u)&&baseOf(gd,u)===baseline.ids.lemuen);
      const layersPossible=!!lemuen&&units.filter(isChess).length>=3;
      const saint=units.find(u=>isChess(u)&&baseOf(gd,u)===baseline.ids.executorAlter);
      const tank=units.find(u=>map02Front(u.rec)&&pins.has(u.uid));
      const target=tank&&pins.get(tank.uid).key || (kind==='blower'?'9,7':kind==='tide'?'11,5':units.length<=4?'10,5':'10,8');
      const quiet=kind==='tide'&&saint&&['up','left'].includes(tideStyle(gd,m,plan.placementVariant || 0));
      const quietKeys=new Set(['12,4','12,5','11,4','11,5']);
      const frontIds=new Set(units.filter(u=>map02Front(u.rec)).map(u=>u.uid));
      const options=units.map(u=>keys.map(key=>{
        const[r,c]=key.split(',').map(Number),pin=pins.get(u.uid),front=frontIds.has(u.uid);
        if(pin&&pin.key!==key||!canPlace(map,placeClass(ps,u.rec),r,c))return [];
        if(front&&!tileOf(m,r,c)?.groundPassable)return [];
        if(!pin&&c>(kind==='blower'?(front?7:6):kind==='tide'?5:units.length<=4?5:7))return [];
        if(quiet&&u.block>0&&quietKeys.has(key))return [];
        if(tileOf(m,r,c)?.special==='infection'&&!healing)return [];
        return DIRS.filter(dir=>(!pin||pin.dir===dir)&&allows(u.uid,r,c,dir)).flatMap(dir=>{
          const v=unitOf(u.rec,key,r,c,dir,model);v.uid=u.uid;
          // Healing is not an attack and does not steal the Saint's first target at column 8.
          if(kind==='blower'&&saint&&!pin&&!v.heal&&[...v.cover].some(k=>Number(k.split(',')[1])>7))return [];
          let rank=(v.cover.has(target)&&v.ground?40:0)+(mapLineHealingCover(v,target).has(target)?30:0);
          for(const rt of model.routes)if(rt.fly?v.air:v.ground)rank+=rt.n*rt.tiles.filter(k=>v.cover.has(k)).length*.03;
          if(front&&kind==='blower'&&c===7)rank+=12;
          if(front&&kind==='tide'&&c===5)rank+=12;
          if(saint&&baseOf(gd,u)===baseline.ids.mostima){
            const p=pins.get(saint.uid);if(p&&Math.abs(r-p.r)+Math.abs(c-p.c)<=1)rank+=20;
          }
          rank+=(v.atkMul-1)*2+(key===u.key ? .001 : 0);
          return [{v,rank}];
        }).sort((a,b)=>b.rank-a.rank);
      }));
      const sameRow=()=>!layersPossible||units.filter(u=>isChess(u)&&u.r===units.find(v=>v.uid===lemuen.uid).r).length>=3;
      const oreSafe=()=>units.every(u=>tileOf(m,u.r,u.c)?.special!=='infection'
        ||acceptsHealing(u.rec)&&units.some(h=>mapLineHealingCover(h,target).has(u.key)));
      let best=null,bestScore=-Infinity;
      // A row reward finds feasible >=3 rows; true whole-layout scoring chooses among them. No synthetic layers.
      for(const row of layersPossible?[9,10,11,12]:[null])for(const ore of kind==='infection'&&healing?[false,true]:[false]){
        const picks=units.map(()=>[]);
        const costs=units.map((u,i)=>keys.map((key,j)=>{
          const[r,c]=key.split(',').map(Number);
          if(u.uid===lemuen?.uid&&row!==null&&r!==row||!ore&&tileOf(m,r,c)?.special==='infection')return BIG;
          const pick=options[i][j][0];if(!pick)return BIG;picks[i][j]=pick.v;
          return -pick.rank-(row!==null&&isChess(u)&&r===row?10000:0);
        }));
        const match=assign(costs);if(!match)continue;
        for(let i=0;i<units.length;i++)units[i]=picks[i][match[i]];
        if(!sameRow()||!oreSafe())continue;
        const value=scoreLayout();if(value>bestScore){bestScore=value;best=units.slice();}
      }
      if(!best){for(let i=0;i<units.length;i++)units[i]=original[i];plan.contactUnresolved=true;return;}
      for(let i=0;i<units.length;i++)units[i]=best[i];
      // Refine free operators with the same team combat/layer objective. Pins and all hard conditions survive.
      const shortlist=options.map(row=>row.flat().sort((a,b)=>b.rank-a.rank).slice(0,16).map(o=>o.v));
      for(let pass=0;pass<2;pass++)for(let i=0;i<units.length;i++){
        if(pins.has(units[i].uid))continue;
        const initial=units[i];let preferred=initial,value=scoreLayout();
        const facing=options[i][keys.indexOf(initial.key)].map(o=>o.v);
        for(const next of [...facing,...shortlist[i]]){
          if(units.some((u,j)=>i!==j&&u.key===next.key))continue;
          units[i]=next;if(!sameRow()||!oreSafe())continue;
          const score=scoreLayout();if(score>value+1e-6){preferred=next;value=score;}
        }
        units[i]=preferred;
      }
      plan.contactUnresolved=false;
      for(const u of units){plan.set(u.uid,u.key);plan.dirs.set(u.uid,u.dir);}
    }
  });
}
