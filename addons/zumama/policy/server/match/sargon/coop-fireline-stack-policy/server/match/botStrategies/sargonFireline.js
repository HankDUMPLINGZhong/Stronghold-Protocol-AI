// [ASSUMED] Independent fixed-roster direction / joint fireline trials, adapted from local Laterano lessons.
// All blocking sections remain opportunities; geometry proposes, paired current-wave forecasts decide.
import {Grid} from '../../../../../../../../../../../sim/grid.js';
import {GEO} from '../../../../../../../../../../../../shared/constants.js';
import {COLS} from '../../../../../../../../../../../sim/constants.js';
import {HOVER_KEYS} from '../../../../../../../../../../../sim/content/enemies/archetypes.js';
import {canPlace,placeClass} from '../../../../../../../../../../board.js';
import {computeBonds} from '../../../../../../../../../../bondsMeta.js';
import {acceptsHealing,healingTiles} from '../botPositioning.js';
import {createForecastSteps} from '../botForecast.js';
import {swiftPrepGains} from './sargonSwift.js';
import {ids} from './sargonPepe.js';
const DIRS=['RIGHT','UP','DOWN','LEFT'],CORE=['sargonShip','preciShip','swiftShip'];
const medic=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const mains=new Set([ids.pepe,ids.passenger,ids.titi,ids.gavial4,ids.gavial5,ids.minimalist]);
const signature=p=>[...p].sort((a,b)=>a[0]-b[0]).map(([u,k])=>`${u}@${k}:${p.dirs.get(u)}`).join('|');
const complete=rs=>rs.length===2&&rs.every((r,i)=>r.valid&&r.sample===i);

/** Current public paths, including checkpoints; a deployable fence is not a road blocker. */
export function firelineRoutes(m,gd,grid){
  const grouped=new Map();
  for(const s of m.wave?.spawns||[]){const route=m.wave.routes?.[s.routeIndex],enemy=gd.enemy(s.enemyKey);if(!route||!enemy)continue;
    const fly=route.motion==='FLY'||enemy.isFlyEnemy||HOVER_KEYS.includes(s.enemyKey),key=JSON.stringify([route,!!fly]);
    const row=grouped.get(key)||{route,fly:!!fly,n:0};row.n+=s.count||1;grouped.set(key,row);
  }
  return [...grouped.values()].map(row=>{
    const way=[row.route.start,...(row.route.checkpoints||[]),row.route.end],points=[way[0]];
    for(let i=1;i<way.length;i++){
      if(row.route.motion==='FLY'){points.push(way[i]);continue;}
      const flow=grid.flowField(...way[i]),seen=new Set();let[r,c]=points.at(-1),key=r*COLS+c;
      while(key!==flow.dest&&!seen.has(key)){seen.add(key);key=flow.next[key];if(key<0)break;points.push([Math.floor(key/COLS),key%COLS]);}
    }
    const tiles=[];for(let i=1;i<points.length;i++){
      const[a,b]=points[i-1],[r,c]=points[i],steps=Math.max(Math.abs(r-a),Math.abs(c-b))*8;
      for(let k=0;k<=steps;k++){const key=`${Math.round(a+(r-a)*k/Math.max(1,steps))},${Math.round(b+(c-b)*k/Math.max(1,steps))}`;if(tiles.at(-1)!==key)tiles.push(key);}
    }return {n:row.n,fly:row.fly,tiles:tiles.slice(0,-1)};
  }).filter(r=>r.tiles.length);
}

/** Static opportunity score only: no promises about invisibility, enemy targeting or tank survival. */
export function firelineValue(layout,ctx){
  const {info,routes,grid}=ctx,total=routes.reduce((n,r)=>n+r.n,0)||1;let score=0;
  for(const rt of routes){const share=rt.n/total;
    const blocks=layout.map((p,i)=>({p,i,at:rt.tiles.indexOf(p.key)})).filter(v=>!rt.fly&&info[v.i].front&&v.at>=0&&grid.groundPassable(v.p.r,v.p.c));
    const anchor=[...blocks].sort((a,b)=>Number(info[b.i].tank)-Number(info[a.i].tank)||info[b.i].strength-info[a.i].strength||a.at-b.at)[0];
    if(!rt.fly)score+=share*(anchor?12+Math.min(6,info[anchor.i].strength):-12);
    for(let i=0;i<layout.length;i++){const p=layout[i],u=info[i],at=rt.tiles.indexOf(p.key);
      if(anchor&&!u.front&&at>=0&&at<anchor.at)score-=share*(u.dealer?u.weight:2)*3;
      if(!u.dealer||rt.fly&&!u.air)continue;
      const hits=rt.tiles.reduce((n,k)=>n+Number(p.cover.has(k)),0);score+=share*u.weight*Math.min(8,hits)*.65;
      // Include ALL intercepts, including those after the first blocker; no route truncation.
      for(const b of blocks){const weight=b===anchor?1.5:.4,ahead=rt.tiles[Math.max(0,b.at-1)];
        if(p.cover.has(b.p.key))score+=share*u.weight*weight;
        if(p.cover.has(ahead))score+=share*u.weight*weight*2;
      }
    }
  }
  const hasHealer=info.some(u=>u.healer);
  for(let i=0;i<layout.length;i++)if(hasHealer&&info[i].healable&&(info[i].primary||info[i].front)){
    const covered=layout.some((p,j)=>j!==i&&info[j].healer&&p.heal.has(layout[i].key));score+=(covered?3:-5)*(info[i].primary?2:1);
  }
  return score;
}

function originalPlan(ps,h){const p=new h.LayoutPlan();p.lineup=[...ps.board.values()].filter(p=>p.kind==='chess');
  for(const [key,q]of ps.board)if(q.kind==='chess'){p.set(q.uid,key);p.dirs.set(q.uid,q.dir||'RIGHT');}return p;}

/** Reciprocal legal changes remember their exact move sequence, so committing a cycle cannot use an illegal bridge. */
export function firelineChange(state,layout,i,next){
  if(state.pinned.has(i)&&(next.key!==layout[i].key||next.dir!==layout[i].dir))return null;
  const out=layout.slice(),j=layout.findIndex((p,k)=>k!==i&&p.key===next.key);out[i]=next;
  if(j>=0){if(state.pinned.has(j))return null;const swap=state.options[j].find(p=>p.key===layout[i].key&&p.dir===layout[j].dir);if(!swap)return null;out[j]=swap;}
  out.moves=[...(layout.moves||[]),{uid:state.chosen[i].uid,key:next.key,dir:next.dir}];return out;
}

export function firelinePlans(m,ps,h,mode){
  const original=originalPlan(ps,h),chosen=original.lineup,grid=new Grid(m.stage,{...GEO.NORMAL_RECT}),map=ps.deployMap();
  const reserved=new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([k])=>k)),owners=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  const records=chosen.map(p=>h.rangeRec(ps,ps.gd.chess(p.id))),info=records.map((r,i)=>{
    const s=r.stats||{},front=r.position==='MELEE'&&(s.blockCnt||0)>0,base=ps.gd.baseIdOf(chosen[i].id);
    return {front,tank:r.profession==='TANK'&&(s.blockCnt||0)>=2,healer:medic(r),healable:acceptsHealing(r),
      dealer:!['heal','none'].includes(r.attackKind)&&r.subProfessionId!=='bard',primary:mains.has(base)||r.tier>=4&&r.position==='RANGED',
      air:!!r.canHitFly,weight:r.profession==='TANK'?1:Math.max(1,Math.min(10,(s.atk||0)*(s.aspd||100)/(100*Math.max(.4,s.bat||1))/100)),
      strength:(s.maxHp||0)*(1+(s.def||0)/500)*Math.max(1,s.blockCnt||0)/5000};
  });
  const pinned=new Set(chosen.map((p,i)=>owners.has(p.uid)?i:-1).filter(i=>i>=0));
  const options=chosen.map((p,i)=>{const out=[];for(const [key]of map){if(reserved.has(key))continue;const[r,c]=key.split(',').map(Number);
    if(!canPlace(map,placeClass(ps,records[i]),r,c))continue;
    for(const dir of DIRS){if(pinned.has(i)&&(key!==original.get(p.uid)||dir!==original.dirs.get(p.uid)))continue;
      out.push({key,r,c,dir,cover:new Set(h.rangeTiles(records[i],r,c,dir)),heal:healingTiles(records[i],r,c,dir)});
    }
  }return out;});
  const current=chosen.map((p,i)=>options[i].find(p=>p.key===original.get(chosen[i].uid)&&p.dir===original.dirs.get(chosen[i].uid)));
  const ctx={info,routes:firelineRoutes(m,ps.gd,grid),grid},state={chosen,options,pinned};
  if(current.some(p=>!p)||!ctx.routes.length)return [original];
  const rank=p=>firelineValue(p,ctx),order=chosen.map((_,i)=>i).sort((a,b)=>Number(info[b].tank)-Number(info[a].tank)||Number(info[b].front)-Number(info[a].front)||info[b].weight-info[a].weight||chosen[a].uid-chosen[b].uid);
  function refine(start,faces,indices){let layout=start;for(let pass=0;pass<2;pass++)for(const i of indices){if(pinned.has(i))continue;let best=layout,value=rank(layout);
    for(const next of options[i]){if(faces&&next.key!==layout[i].key)continue;if(next.key===layout[i].key&&next.dir===layout[i].dir)continue;
      const trial=firelineChange(state,layout,i,next);if(!trial)continue;const score=rank(trial);if(score>value+1e-6){best=trial;value=score;}}
    layout=best;
  }return layout;}
  const proposals=[];
  if(mode==='faces'){proposals.push(refine(current,true,order),refine(current,true,[...order].reverse()));}
  else{
    proposals.push(refine(current,false,order));let linked=current;
    const fronts=order.filter(i=>info[i].front&&!pinned.has(i)).slice(0,2),routes=ctx.routes.filter(r=>!r.fly).sort((a,b)=>b.n-a.n);
    for(let n=0;n<fronts.length&&n<routes.length;n++){const i=fronts[n];let best=null,value=-Infinity;
      for(const next of options[i])if(grid.groundPassable(next.r,next.c)&&routes[n].tiles.includes(next.key)){
        const trial=firelineChange(state,linked,i,next);if(!trial)continue;const score=rank(trial);if(score>value){best=trial;value=score;}}
      if(best)linked=best;
    }proposals.push(refine(linked,false,order));
  }
  const seen=new Set([signature(original)]),plans=[original];
  for(const layout of proposals){const p=new h.LayoutPlan();p.lineup=chosen;p.moves=layout.moves||[];
    layout.forEach((q,i)=>{p.set(chosen[i].uid,q.key);p.dirs.set(chosen[i].uid,q.dir);});
    if(!seen.has(signature(p))){seen.add(signature(p));plans.push(p);}
  }return plans;
}

/** Pairwise safety and growth preservation; predicted all-clear keeps the original farming arrangement. */
export function selectFireline(plans,outcomes){
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  if(!complete(rows[0])||rows[0].every(r=>r.leaks===0))return {index:0};
  const sum=(rs,k)=>rs.reduce((n,r)=>n+(r[k]||0),0),rank=rs=>[-Math.max(...rs.map(r=>r.lost)),-sum(rs,'lost'),-sum(rs,'leaks'),-sum(rs,'deaths')];
  const better=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];return false;};let index=0;
  for(let i=1;i<rows.length;i++)if(complete(rows[i])&&rows[i].every((r,j)=>{
    const b=rows[0][j];return r.lost<=b.lost&&r.leaks<=b.leaks&&r.killed>=b.killed&&r.deaths<=b.deaths&&(r.mainDeaths||0)<=(b.mainDeaths||0)
      &&CORE.every(k=>(r.growth?.[k]||0)>=(b.growth?.[k]||0))&&(r.coins||0)>=(b.coins||0);
  })&&better(rank(rows[i]),rank(rows[index])))index=i;
  return {index};
}

function projectedInput(ps,p){const shadow=Object.assign(Object.create(Object.getPrototypeOf(ps)),ps,{board:new Map([...ps.board].filter(([,q])=>q.kind!=='chess')),hand:ps.hand.slice(),temp:ps.temp.slice()});
  for(const q of p.lineup)shadow.board.set(p.get(q.uid),{...q,dir:p.dirs.get(q.uid)});
  shadow.bonds=computeBonds(ps.gd,shadow);const input=shadow.battleInput();p.prepGains=swiftPrepGains(ps,p.lineup,p,input.bonds);
  for(const [id,n]of Object.entries(p.prepGains))if(input.bonds[id])input.bonds[id].layers+=n;return input;
}

function* refineFireline(m,ps,h,mode){
  if(!['faces','joint'].includes(mode)||m.isSolo||m.opts.botSargonCoopSeat!==ps.playerId||!m.wave||m.round<4||m.round>=m.gd.bossRound||m.botRehearsal<3)return;
  const plans=firelinePlans(m,ps,h,mode);if(plans.length<2)return;const before=JSON.stringify(ps.battleInput());
  const job=yield* createForecastSteps(m,ps,plans[0].lineup,plans,function*(p){yield;return projectedInput(ps,p);},{
    forecastContext:()=>({}),selectForecast:selectFireline,observeForecast:(b,c,p)=>{
      let mainDeaths=0;const important=new Set(p.lineup.filter(q=>mains.has(ps.gd.baseIdOf(q.id))).map(q=>q.uid));b.on('death',({unit:u,reason})=>{if(reason==='killed'&&u?.kind==='op'&&u.ownerId===ps.playerId&&important.has(u.uid))mainDeaths++;});
      return pp=>{const growth={...pp.layerGains};for(const [id,n]of Object.entries(p.prepGains||{}))growth[id]=(growth[id]||0)+n;return {growth,coins:pp.coins||0,mainDeaths};};
    }});
  if(!job)return;while(!job.run(4))yield;const stale=JSON.stringify(ps.battleInput())!==before;
  if(job.bestIndex&&!stale){for(const move of job.best.moves){const[row,col]=move.key.split(',').map(Number);if(!ps.move(move.uid,{area:'board',row,col},move.dir)?.ok)throw Error('Fireline legal change rejected');}
    if(job.best.lineup.some(p=>ps.find(p.uid)?.key!==job.best.get(p.uid)||ps.find(p.uid)?.piece.dir!==job.best.dirs.get(p.uid)))throw Error('Fireline layout drift');
  }
  (ps._sargonFactorHistory||=[]).push({factor:'fireline-two',phase:'comparison',mode,round:m.round,index:stale?0:job.bestIndex,stale,
    candidates:plans.map(p=>({tiles:[...p],dirs:[...p.dirs]})),outcomes:job.outcomes});
}

// Sequential stacking: run the exact adopted A first, then propose B against that resulting board.
export function createFirelinePolicy(parent){return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
  yield* parent.finalBoardSteps(m,ps,h);
  const modes=m.opts.botSargonFireline==='combined'?['faces','joint']:[m.opts.botSargonFireline];
  for(const mode of modes)yield* refineFireline(m,ps,h,mode);
}});}
