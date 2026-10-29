// [ASSUMED] User-specified normal-map Saint/frontline pairs; a separate fixed-roster experiment over17/56.
// Keep the other path cells in Saint's range reachable before TANK/WARRIOR bodies; tokens never screen cells.
import {Grid,segmentTiles} from '../../../../../../sim/grid.js';
import {COLS} from '../../../../../../sim/constants.js';
import {HOVER_KEYS} from '../../../../../../sim/content/enemies/archetypes.js';
import {playerDeviceOverrides} from '../../../../../../sim/content/devices.js';
import {enemyTypeInfo} from './lateranoEnemyTypes.js';
import {coopContactContext,contactChange,contactPlan,contactLineValue,contactForecastSteps} from './lateranoCoopContact.js';
import {selectCoopSafety} from './lateranoCoopSafety.js';

const spot=(r,c,dir)=>Object.freeze({key:`${r},${c}`,r,c,dir});
const rule=(saint,fronts,noRanged=null)=>Object.freeze({saint,fronts:Object.freeze(fronts.map(([r,c])=>spot(r,c))),noRanged});
export const COOP_SAINT_MAPS=Object.freeze({
  act1autochess_m02:Object.freeze([rule(spot(11,5,'RIGHT'),[[12,5],[10,6]])]),
  act1autochess_m03:Object.freeze([rule(spot(10,5,'RIGHT'),[[9,5]])]),
  act1autochess_m04:Object.freeze([rule(spot(11,8,'RIGHT'),[[10,8]]),rule(spot(10,8,'RIGHT'),[[11,8]])]),
  act2autochess_m01:Object.freeze([rule(spot(12,6,'RIGHT'),[[12,7]]),rule(spot(10,7,'DOWN'),[[9,7]])]),
  act2autochess_m02:Object.freeze([rule(spot(10,6,'RIGHT'),[[9,6]])]),
  act2autochess_m03:Object.freeze([rule(spot(11,7,'RIGHT'),[[12,7],[10,7]])]),
  act2autochess_m04:Object.freeze([rule(spot(11,7,'LEFT'),[[11,5],[12,5]],true),rule(spot(12,3,'RIGHT'),[[10,4]],false)]),
});

/** Initial obstacles and the current owner's visible map-card overrides use the same activation rules as combat. */
export function saintRouteGrid(m,ps){
  const grid=new Grid(m.stage,{r0:9,r1:12,c0:0,c1:10}),input=ps.battleInput();
  const overrides=playerDeviceOverrides({input,playerEffects:input.playerEffects});
  for(const d of m.stage.devices||[]){
    if(!['crate','platform','mound'].includes(d.role)||!Array.isArray(d.pos)||!grid.inRect(...d.pos))continue;
    const active=overrides.has(d.alias)?overrides.get(d.alias):typeof d.active==='boolean'?d.active:!d.hidden;
    if(active)grid.setObstacle(...d.pos,true,d.role==='crate'?'crate':'block');
  }
  return grid;
}

/** Exact tile interiors crossed by this public wave's ground routes, including its checkpoints. */
export function saintGroundRoutes(m,gd,grid){
  const grouped=new Map();
  for(const s of m.wave?.spawns||[]){
    const rt=m.wave.routes?.[s.routeIndex],e=gd.enemy(s.enemyKey);
    if(!rt||!e||rt.motion==='FLY'||e.isFlyEnemy||HOVER_KEYS.includes(s.enemyKey))continue;
    const key=JSON.stringify(rt),v=grouped.get(key)||{rt,n:0};v.n+=s.count||1;grouped.set(key,v);
  }
  const routes=[];
  for(const {rt,n} of grouped.values()){
    const nodes=[rt.start];let complete=true;
    for(const dest of [...(rt.checkpoints||[]).filter(Array.isArray),rt.end]){
      const flow=grid.flowField(...dest),seen=new Set();let key=nodes.at(-1)[0]*COLS+nodes.at(-1)[1];
      while(key!==flow.dest&&!seen.has(key)){seen.add(key);key=flow.next[key];if(key<0)break;nodes.push([Math.floor(key/COLS),key%COLS]);}
      if(key!==flow.dest){complete=false;break;}
    }
    if(!complete)continue;
    const tiles=[nodes[0].join(',')];
    for(let i=1;i<nodes.length;i++)for(const tile of segmentTiles(nodes[i-1],nodes[i])){
      const key=tile.join(',');if(tiles.at(-1)!==key)tiles.push(key);
    }
    routes.push({n,fly:false,tiles});
  }
  return routes;
}

/** Deduplicate grid cells; at a route merge, any still-unintercepted incoming route suffices. */
export function saintBlockedCells(layout,professions,routes,cells){
  const bodies=new Set(layout.filter((p,i)=>p&&['TANK','WARRIOR'].includes(professions[i])).map(p=>p.key));
  return [...cells].filter(key=>bodies.has(key)||!routes.some(rt=>{
    for(let i=0;i<rt.tiles.length;i++)if(rt.tiles[i]===key&&!rt.tiles.slice(0,i+1).some(k=>bodies.has(k)))return true;
    return false;
  }));
}

const signature=p=>p.map(o=>`${o.key}:${o.dir}`).join('|');
const distance=(a,b)=>Math.abs(a.r-b.r)+Math.abs(a.c-b.c);

/** Fill a legal simultaneous assignment, retaining existing positions before using free legal tiles. */
function fill(state,forced){
  const layout=Array(state.chosen.length),used=new Set();
  for(const [i,next] of forced){if(used.has(next.key))return null;layout[i]=next;used.add(next.key);}
  const rest=state.chosen.map((_,i)=>i).filter(i=>!forced.has(i)).sort((a,b)=>
    Number(state.owners.has(state.chosen[b].uid))-Number(state.owners.has(state.chosen[a].uid))
    ||state.options[a].length-state.options[b].length||a-b);
  let visits=0;
  const assign=at=>{
    if(at===rest.length)return true;if(++visits>4096)return false;
    const i=rest[at],current=state.current[i],byKey=new Map();
    for(const p of state.options[i])if(!used.has(p.key)&&(!byKey.has(p.key)||p.dir===current.dir))byKey.set(p.key,p);
    const choices=[...byKey.values()].sort((a,b)=>Number(b.key===current.key)-Number(a.key===current.key)||distance(a,current)-distance(b,current)||a.key.localeCompare(b.key));
    for(const p of choices){layout[i]=p;used.add(p.key);if(assign(at+1))return true;used.delete(p.key);}
    return false;
  };
  return assign(0)?layout:null;
}

export function coopSaintMapPlans(m,ps,h,recipe){
  const rules=COOP_SAINT_MAPS[m.stageId];if(!rules)return {plans:[],reason:'unsupported-map'};
  const hasSaint=[...ps.board.values()].some(p=>p.kind==='chess'&&ps.gd.baseIdOf(p.id)===recipe.ids.executorAlter);
  if(!hasSaint)return {plans:[],reason:'no-deployed-saint'};
  const state=coopContactContext(m,ps,h,recipe),{chosen,current,options,ctx}=state;
  if(current.some(p=>!p))return {plans:[state.original],reason:'pinned-or-unavailable-original'};
  const routeGrid=saintRouteGrid(m,ps),routes=saintGroundRoutes(m,ps.gd,routeGrid);
  ctx.grid=routeGrid;
  if(!routes.length)return {plans:[state.original],reason:'no-ground-route'};
  const professions=chosen.map(p=>ps.gd.chess(p.id).profession),road=new Set(routes.flatMap(r=>r.tiles));
  const saint=chosen.map((p,i)=>({p,i})).filter(x=>ps.gd.baseIdOf(x.p.id)===recipe.ids.executorAlter)
    .sort((a,b)=>Number(ps.gd.isGolden(b.p.id))-Number(ps.gd.isGolden(a.p.id))||a.p.uid-b.p.uid)[0].i;
  const fronts=chosen.map((p,i)=>i).filter(i=>ctx.info[i].front&&ctx.info[i].base!==recipe.ids.executorAlter)
    .sort((a,b)=>Number(ctx.info[b].tank)-Number(ctx.info[a].tank)||ctx.info[b].strength-ctx.info[a].strength||a-b).slice(0,4);
  const ranged=enemyTypeInfo(m,ps.gd).ranged>0,proposals=[],audit=[];
  const rank=layout=>contactLineValue(layout,{...ctx,routes:[...routes,...ctx.routes.filter(r=>r.fly)]});
  for(let ri=0;ri<rules.length;ri++){
    const rule=rules[ri];if(rule.noRanged!==null&&rule.noRanged===ranged)continue;
    const saintAt=options[saint].find(p=>p.key===rule.saint.key&&p.dir===rule.saint.dir);
    if(!saintAt||fronts.length<rule.fronts.length){audit.push({rule:ri,reason:'insufficient-frontline-or-illegal-saint'});continue;}
    const exempt=new Set(rule.fronts.map(p=>p.key));
    const protectedCells=new Set([...saintAt.cover].filter(k=>k!==saintAt.key&&!exempt.has(k)&&road.has(k)));
    if(![...saintAt.cover].some(k=>k!==saintAt.key&&road.has(k))){audit.push({rule:ri,reason:'no-contact-path-cell'});continue;}
    const seeds=[];
    const force=(at,forced)=>{
      if(at===rule.fronts.length){const layout=fill(state,forced);if(layout)seeds.push({layout,forced:new Map(forced)});return;}
      const target=rule.fronts[at];if(!ctx.grid.groundPassable(target.r,target.c))return;
      for(const i of fronts){if(forced.has(i))continue;
        const pos=options[i].find(p=>p.key===target.key&&p.dir===current[i].dir)||options[i].find(p=>p.key===target.key);
        if(!pos)continue;forced.set(i,pos);force(at+1,forced);forced.delete(i);
      }
    };
    force(0,new Map([[saint,saintAt]]));
    const blocked=layout=>saintBlockedCells(layout,professions,routes,protectedCells).length;
    const score=layout=>rank(layout)-blocked(layout)*10000-layout.reduce((n,p,i)=>n+distance(p,current[i])*.1+Number(p.dir!==current[i].dir)*.01,0);
    seeds.sort((a,b)=>score(b.layout)-score(a.layout));let generated=0;
    for(const seed of seeds.slice(0,2)){
      let layout=seed.layout;
      const order=chosen.map((_,i)=>i).sort((a,b)=>Number(['TANK','WARRIOR'].includes(professions[b]))-Number(['TANK','WARRIOR'].includes(professions[a]))||ctx.info[b].weight-ctx.info[a].weight||a-b);
      for(let pass=0;pass<2;pass++)for(const i of order){
        if(i===saint)continue;let best=layout,value=score(layout);
        for(const next of options[i]){
          if(seed.forced.has(i)&&next.key!==seed.forced.get(i).key)continue;
          const trial=contactChange(state,layout,i,next);
          if(!trial||[...seed.forced].some(([j,p])=>trial[j].key!==p.key||j===saint&&trial[j].dir!==p.dir))continue;
          const s=score(trial);if(s>value+1e-6){best=trial;value=s;}
        }
        layout=best;
      }
      if(blocked(layout))continue;
      const plan=contactPlan(state,layout);plan.saintMap={rule:ri,protectedCells:[...protectedCells],saintUid:chosen[saint].uid,frontUids:[...seed.forced.keys()].filter(i=>i!==saint).map(i=>chosen[i].uid)};
      proposals.push({plan,layout,score:rank(layout)});generated++;
    }
    audit.push({rule:ri,reason:generated?'generated':'no-complete-legal-layout',protectedCells:[...protectedCells],assignments:seeds.length,generated});
  }
  const plans=[state.original],seen=new Set([signature(current)]);
  proposals.sort((a,b)=>b.score-a.score);
  // Keep one best complete layout per user alternative before spending the second candidate on another front assignment.
  const ordered=[...proposals.filter((p,i)=>!proposals.slice(0,i).some(q=>q.plan.saintMap.rule===p.plan.saintMap.rule)),...proposals];
  for(const p of ordered)if(!seen.has(signature(p.layout))){seen.add(signature(p.layout));plans.push(p.plan);if(plans.length===3)break;}
  return {plans,audit,reason:plans.length>1?'generated':'no-alternative'};
}

export function withLateranoCoopSaintMap(parent){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
    if(m.mode!=='coop'||m.isSolo||!m.wave||m.round>=m.gd.bossRound||m.botRehearsal<3
      ||ps.bandId!=='band_paganini'||ps._botFocusId!=='lateranoShip')return;
    const report=coopSaintMapPlans(m,ps,h,parent);
    (ps._botCoopSaintMapHistory||=[]).push({round:m.round,reason:report.reason,audit:report.audit,
      candidates:report.plans.slice(1).map(p=>({...p.saintMap,layout:[...p].map(([uid,key])=>({uid,key,dir:p.dirs.get(uid)}))}))});
    yield* contactForecastSteps(m,ps,h,report.plans,selectCoopSafety,'saint-map');
  }});
}
