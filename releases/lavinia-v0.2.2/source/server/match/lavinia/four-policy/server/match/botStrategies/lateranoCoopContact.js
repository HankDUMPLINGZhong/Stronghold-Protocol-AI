// [ASSUMED] Independent normal-wave, fixed-roster contact-line proposals. Public routes, own assets only.
// Set blocking lines before scoring the incoming firing window; forecasts retain the original safe farming board.
import {Grid} from '../../../../../../sim/grid.js';
import {COLS} from '../../../../../../sim/constants.js';
import {rotateOffset} from '../../../../../../sim/dir.js';
import {HOVER_KEYS} from '../../../../../../sim/content/enemies/archetypes.js';
import {createForecastSteps} from '../botForecast.js';
import {prepareDevelopmentInput} from '../botLateranoDevelopment.js';
import {acceptsHealing,healingTiles} from '../botPositioning.js';
import {bossFormationSnapshot} from './lateranoBossFormation.js';
import {applyControlPositions} from './lateranoControlBoss.js';
import {stealthBattleInput} from './lateranoStealthWave.js';
import {coopEntryState,selectCoopSafety} from './lateranoCoopSafety.js';
import {contactSkillGrid} from './lateranoContactTeam.js';

const DIRS=['RIGHT','UP','DOWN','LEFT'];
const healer=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const signature=layout=>layout.map(p=>`${p.key}:${p.dir}`).join('|');
const mean=(rows,key)=>rows.reduce((n,r)=>n+r[key],0)/rows.length;

/** Trace only the public current wave, with its checkpoints and actual passable cells. No battle is run here. */
export function contactWaveRoutes(m,gd,grid){
  const grouped=new Map();
  for(const s of m.wave?.spawns||[]){
    const rt=m.wave.routes?.[s.routeIndex],enemy=gd.enemy(s.enemyKey);if(!rt||!enemy||!Number.isFinite(s.time??0))continue;
    const fly=rt.motion==='FLY'||enemy.isFlyEnemy||HOVER_KEYS.includes(s.enemyKey);
    const key=JSON.stringify([rt,!!fly]),row=grouped.get(key)||{route:rt,fly:!!fly,n:0};row.n+=s.count||1;grouped.set(key,row);
  }
  return [...grouped.values()].map(row=>{
    const way=[row.route.start,...(row.route.checkpoints||[]),row.route.end],points=[way[0]];
    for(let i=1;i<way.length;i++){
      if(row.route.motion==='FLY'){points.push(way[i]);continue;}
      const flow=grid.flowField(...way[i]),seen=new Set();let[r,c]=points.at(-1),key=r*COLS+c;
      while(key!==flow.dest&&!seen.has(key)){seen.add(key);key=flow.next[key];if(key<0)break;points.push([Math.floor(key/COLS),key%COLS]);}
    }
    const tiles=[];
    for(let i=1;i<points.length;i++){
      const[a,b]=points[i-1],[r,c]=points[i],steps=Math.max(Math.abs(r-a),Math.abs(c-b))*8;
      for(let k=0;k<=steps;k++){const key=`${Math.round(a+(r-a)*k/Math.max(1,steps))},${Math.round(b+(c-b)*k/Math.max(1,steps))}`;
        if(tiles.at(-1)!==key)tiles.push(key);}
    }
    return {n:row.n,fly:row.fly,tiles:tiles.slice(0,-1)};
  }).filter(r=>r.tiles.length);
}

/** Position scoring is a proposal heuristic, not a prediction of a win. No seed/stage/operator coordinates. */
export function contactLineValue(layout,ctx){
  const {info,routes,grid,ids,skillActive,diagonal}=ctx,total=routes.reduce((n,r)=>n+r.n,0)||1;
  const army=info.reduce((n,u)=>n+(u.dealer?u.weight:0),0)||1;let score=0;
  const hasHealer=info.some(u=>u.healer);
  for(const rt of routes){
    const share=rt.n/total,blocking=layout.map((p,i)=>({p,i,at:rt.tiles.indexOf(p.key)}))
      .filter(v=>!rt.fly&&info[v.i].front&&v.at>=0&&grid.groundPassable(v.p.r,v.p.c));
    const front=blocking.sort((a,b)=>a.at-b.at)[0],end=front?.at??rt.tiles.length-1,ahead=front&&rt.tiles[Math.max(0,end-1)];
    if(!rt.fly){score+=share*(front?20:-20);
      if(front){const u=info[front.i],supported=layout.reduce((n,p,i)=>n+(info[i].dealer&&p.cover.has(ahead)?info[i].weight:0),0)/army;
        score+=share*(Math.min(6,u.strength)+supported*24+(front.p.cover.has(ahead)?5:-5));
        if(end<rt.tiles.length*.3&&supported<.5)score-=share*18;
      }
    }
    for(let i=0;i<layout.length;i++){
      const p=layout[i],u=info[i],at=rt.tiles.indexOf(p.key);
      if(front&&!u.front&&at>=0&&at<front.at)score-=share*(u.dealer?u.weight:3)*5;
      if(!u.dealer||rt.fly&&!u.air)continue;
      let covered=0;for(let j=0;j<=end;j++)covered+=p.cover.has(rt.tiles[j])?1:p.skillCover.has(rt.tiles[j])?.35:0;
      score+=share*u.weight*(Math.min(7,covered)*.7+(ahead?(p.cover.has(ahead)?5:p.skillCover.has(ahead)?2:-3):0));
      if(ahead&&u.scatter&&p.frontRow.has(ahead))score+=share*u.weight*3;
    }
  }
  for(let i=0;i<layout.length;i++){
    const p=layout[i],u=info[i];
    if(hasHealer&&u.healable&&(u.primary||u.front))score+=(layout.some((q,j)=>j!==i&&info[j].healer&&q.heal.has(p.key))?4:-6)*u.weight;
    if(skillActive&&u.primary){const covered=layout.some((q,j)=>info[j].skill&&(diagonal?Math.max(Math.abs(p.r-q.r),Math.abs(p.c-q.c))<=1:Math.abs(p.r-q.r)+Math.abs(p.c-q.c)<=1));score+=covered?4:-4;}
    if(u.base===ids.mostima)for(let j=0;j<layout.length;j++)if(info[j].ammo&&Math.abs(p.r-layout[j].r)+Math.abs(p.c-layout[j].c)===1)score+=3;
  }
  return score;
}

export function coopContactContext(m,ps,h,recipe){
  const original=bossFormationSnapshot(ps,h),chosen=original.lineup,grid=new Grid(m.stage,{r0:9,r1:12,c0:0,c1:10});
  const owners=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  const reserved=new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([k])=>k));
  const records=chosen.map(p=>h.rangeRec(ps,ps.gd.chess(p.id))),ids=recipe.ids;
  const info=records.map((r,i)=>{
    const base=ps.gd.baseIdOf(chosen[i].id),s=r.stats||{},front=r.position==='MELEE'&&(s.blockCnt||0)>0&&base!==ids.executorAlter;
    return {base,front,tank:r.profession==='TANK',healer:healer(r),healable:acceptsHealing(r),dealer:!['heal','none'].includes(r.attackKind)&&r.subProfessionId!=='bard',
      primary:[ids.archetto,ids.exusiaiAlter,ids.lemuen,ids.executorAlter].includes(base),air:!!r.canHitFly,
      weight:r.profession==='TANK'?1:Math.max(1,Math.min(12,(s.atk||0)*(s.aspd||100)/(100*Math.max(.4,s.bat||1))/100))*(r.isGolden?1.3:1),
      strength:(s.maxHp||0)*(1+(s.def||0)/500)*Math.max(1,s.blockCnt||0)/5000,
      skill:r.bonds?.includes('skillfulShip'),scatter:r.subProfessionId==='reaperrange',ammo:(r.skill?.bb?.ammo||r.skill?.bb?.['attack@trigger_time']||0)>0};
  });
  const options=chosen.map((p,i)=>{const out=[],rec=records[i],skillGrid=contactSkillGrid(rec,ids);
    for(let r=9;r<=12;r++)for(let c=2;c<=10;c++){
      const key=`${r},${c}`;if(reserved.has(key)||!ps._legal(p,r,c))continue;
      for(const dir of DIRS){if(owners.has(p.uid)&&(key!==original.get(p.uid)||dir!==p.dir))continue;
        out.push({key,r,c,dir,cover:new Set(h.rangeTiles(rec,r,c,dir)),skillCover:new Set(h.rangeTiles({...rec,rangeGrid:skillGrid},r,c,dir)),
          heal:healingTiles(rec,r,c,dir),frontRow:new Set([-1,0,1].map(dr=>{const[a,b]=rotateOffset(dr,1,dir);return `${r+a},${c+b}`;}))});
      }
    }return out;
  });
  const current=chosen.map((p,i)=>options[i].find(o=>o.key===original.get(p.uid)&&o.dir===p.dir));
  const ctx={info,routes:contactWaveRoutes(m,ps.gd,grid),grid,ids,skillActive:!!ps.bonds.skillfulShip?.active,diagonal:(ps.layers.skillfulShip||0)>=40};
  return {original,chosen,options,current,ctx,owners,h};
}

/** Reciprocal swaps preserve legal terrain and every summoned owner's original position. */
export function contactChange(state,layout,i,next){
  const out=layout.slice(),j=layout.findIndex((p,k)=>k!==i&&p.key===next.key);out[i]=next;
  if(j>=0){const swap=state.options[j].find(p=>p.key===layout[i].key&&p.dir===layout[j].dir);if(!swap)return null;out[j]=swap;}
  return out;
}
export function contactPlan(state,layout){
  const plan=new state.h.LayoutPlan();plan.lineup=state.chosen;
  layout.forEach((p,i)=>{plan.set(state.chosen[i].uid,p.key);plan.dirs.set(state.chosen[i].uid,p.dir);});return plan;
}

export function coopContactPlans(m,ps,h,recipe){
  const state=coopContactContext(m,ps,h,recipe),{current,options,ctx,chosen}=state;
  if(current.some(p=>!p)||!ctx.routes.length)return [state.original];
  const rank=layout=>contactLineValue(layout,ctx),order=chosen.map((_,i)=>i).sort((a,b)=>Number(ctx.info[b].front)-Number(ctx.info[a].front)||ctx.info[b].weight-ctx.info[a].weight);
  const refine=(start,faces)=>{let layout=start.slice();
    for(let pass=0;pass<2;pass++)for(const i of order){let best=layout,value=rank(layout);
      for(const next of options[i]){if(faces&&next.key!==layout[i].key)continue;const trial=contactChange(state,layout,i,next);if(!trial)continue;
        const score=rank(trial);if(score>value+1e-6){best=trial;value=score;}}
      layout=best;
    }return layout;
  };
  const faces=refine(current,true);let linked=current.slice();
  const fronts=order.filter(i=>ctx.info[i].front).sort((a,b)=>Number(ctx.info[b].tank)-Number(ctx.info[a].tank)
    ||ctx.info[b].strength-ctx.info[a].strength).slice(0,2),routes=ctx.routes.filter(r=>!r.fly).sort((a,b)=>b.n-a.n);
  // First provide one intercept for each major lane, then jointly repair its surrounding ranged positions.
  for(let n=0;n<fronts.length&&n<routes.length;n++){
    const i=fronts[n],route=routes[n];let best=null,value=-Infinity;
    for(const next of options[i]){if(!ctx.grid.groundPassable(next.r,next.c)||!route.tiles.includes(next.key))continue;
      const trial=contactChange(state,linked,i,next);if(!trial)continue;const score=rank(trial);
      if(score>value){best=trial;value=score;}}
    if(best)linked=best;
  }
  linked=refine(linked,false);const proposals=[faces,linked],seen=new Set([signature(current)]),plans=[state.original];
  for(const p of proposals)if(!seen.has(signature(p))){seen.add(signature(p));plans.push(contactPlan(state,p));}
  return plans;
}

export function selectCoopContact(plans,outcomes){
  const rows=outcomes.filter(r=>r.index===0);
  if(rows.length!==2||rows.some(r=>!r.valid)||rows.every(r=>r.leaks===0))return {index:0};
  return selectCoopSafety(plans,outcomes);
}

export function* contactForecastSteps(m,ps,h,plans,select,tag){
  if(plans.length<2)return;const before=JSON.stringify(ps.battleInput()),started=performance.now();
  function* inputs(plan){yield;return stealthBattleInput(ps,plan);}
  const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,inputs,{
    prepareForecastInput:(m,ps,_chosen,p,input)=>prepareDevelopmentInput(m,ps,p.lineup,p,input),forecastContext:()=>({}),
    observeForecast:(_b,_ctx,p)=>pp=>coopEntryState(ps,p,pp),selectForecast:select});
  if(!job)return;while(!job.run(4))yield;
  const stale=JSON.stringify(ps.battleInput())!==before;
  if(job.bestIndex&&!stale){const expected=stealthBattleInput(ps,job.best);applyControlPositions(ps,job.best);
    if(JSON.stringify(ps.battleInput())!==JSON.stringify(expected))throw Error('Co-op contact differs from forecast');}
  (ps._botCoopContactHistory||=[]).push({round:m.round,tag,index:job.bestIndex,stale,outcomes:job.outcomes,
    meanLeaks:mean(job.outcomes.filter(o=>o.index===job.bestIndex),'leaks'),ms:performance.now()-started,
    candidates:plans.map(p=>[...p].map(([uid,key])=>({uid,key,dir:p.dirs.get(uid)})))});
}

export function withLateranoCoopContact(parent){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);
    if(m.mode!=='coop'||m.isSolo||!m.wave||m.round<4||m.round>=m.gd.bossRound||m.botRehearsal<3)return;
    yield* contactForecastSteps(m,ps,h,coopContactPlans(m,ps,h,parent),selectCoopContact,'contact');
  }});
}
