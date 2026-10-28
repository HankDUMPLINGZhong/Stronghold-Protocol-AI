// [ASSUMED] Final normal-wave protection on the two reported maps. Match the entire roster to legal cells;
// a succession of two-piece swaps can get stuck with a caster on an undefended branch.
// Reuses the planner's combat/layer objective and direction gates. No battle results, new units or RNG draws.
import { canPlace, placeClass } from '../../../../../board.js';
import { isFormationAnchor } from '../botPositioning.js';

const anchor = u => isFormationAnchor(u.rec) && u.rec.bonds?.includes('steadShip');
const protectedUnit = u => !anchor(u) && (u.heal || u.rec.position === 'RANGED'
  || u.rec.subProfessionId === 'lord' || u.rec.chessId?.startsWith('chess_char_5_01_'));
const BIG = 1e8;

// Rectangular minimum-cost assignment; deterministic reading-order ties, no RNG or battle outcomes.
function assignment(costs) {
  const n=costs.length,m=costs[0]?.length||0;
  if(n>m)return null;
  const u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
    do {
      used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=m;j++)if(!used[j]){
        const cur=costs[i0-1][j-1]-u[i0]-v[j];
        if(cur<min[j]){min[j]=cur;way[j]=j0;}
        if(min[j]<delta){delta=min[j];j1=j;}
      }
      for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
      j0=j1;
    }while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const out=Array(n).fill(-1);
  for(let j=1;j<=m;j++)if(p[j])out[p[j]-1]=j-1;
  return out.every((j,i)=>j>=0&&costs[i][j]<BIG/2)?out:null;
}

export function repairRouteProtection(m,ps,units,plan,model,{unitOf,map,occupied,scoreLayout,allows=()=>true}) {
  if(!['act1autochess_m02','act2autochess_m03'].includes(m.stageId)||m.round>=m.gd.bossRound)return;
  const original=units.slice(),anchors=original.map((u,i)=>anchor(u)?i:-1).filter(i=>i>=0);
  if(!anchors.length)return;
  const routes=model.routes.filter(rt=>!rt.fly&&!rt.fallback&&rt.n>0);
  const passable=key=>{const[r,c]=key.split(',').map(Number);return !!m.stage.tiles[m.stage.rows[r]?.[c]]?.groundPassable;};
  const fronts=fixed=>routes.map(rt=>({rt,index:Math.min(...[...fixed.values()].map(k=>rt.tiles.indexOf(k)).filter(i=>i>=0))}));
  const safe=(key,fs)=>fs.every(({rt,index})=>{const i=rt.tiles.indexOf(key);return i<0||i>index;});
  const current=new Map(anchors.map(i=>[i,original[i].key]));
  // Preserve every already safe plan, including its farming orientation and donor adjacency.
  if(anchors.every(i=>passable(original[i].key))&&original.every(u=>!protectedUnit(u)||safe(u.key,fronts(current))))return;
  const keys=[...map.keys()].filter(k=>!occupied.has(k)&&!plan.reserved?.has(k));
  const road=[...new Set(routes.flatMap(rt=>rt.tiles))].filter(k=>keys.includes(k)&&passable(k));
  if(!routes.length)road.push(...keys.filter(passable));
  const proposals=[current];
  for(const i of anchors)for(const key of road){
    const fixed=new Map(current),other=anchors.find(j=>j!==i&&current.get(j)===key);
    if(other!=null)fixed.set(other,current.get(i));
    fixed.set(i,key);proposals.push(fixed);
  }
  // Cache legal facings once; matching reserves tanks and places every other unit simultaneously.
  const options=original.map(u=>keys.map(key=>{
    const[r,c]=key.split(',').map(Number);
    if(!canPlace(map,placeClass(ps,u.rec),r,c))return [];
    return [...new Set([u.dir,'RIGHT','UP','DOWN','LEFT'])].filter(d=>allows(u.uid,r,c,d)).map(dir=>{
      const v=unitOf(u.rec,key,r,c,dir,model);v.uid=u.uid;return v;
    });
  }));
  let best=null,bestScore=-Infinity;
  for(const fixed of proposals){
    if([...fixed.values()].some(k=>!passable(k)))continue;
    const fs=fronts(fixed),chosen=original.map(()=>[]);
    const costs=original.map((u,i)=>keys.map((key,j)=>{
      if(fixed.has(i)&&fixed.get(i)!==key||!fixed.has(i)&&[...fixed.values()].includes(key)
        ||protectedUnit(u)&&!safe(key,fs)||!options[i][j].length)return BIG;
      let pick=null,score=-Infinity;
      for(const v of options[i][j]){
        let rank=0;
        for(const {rt,index}of fs){
          if(index<Infinity&&v.cover.has(rt.tiles[index]))rank+=rt.n*10;
          if(index>0&&index<Infinity&&v.cover.has(rt.tiles[index-1]))rank+=rt.n*3;
          rank+=rt.tiles.filter(k=>v.cover.has(k)).length*rt.n*0.05;
        }
        if(rank>score){score=rank;pick=v;}
      }
      chosen[i][j]=pick;
      return (key===u.key?0:10000)-score+(Math.abs(pick.r-u.r)+Math.abs(pick.c-u.c))*0.001;
    }));
    const match=assignment(costs);if(!match)continue;
    for(let i=0;i<units.length;i++)units[i]=chosen[i][match[i]];
    if(scoreLayout)for(let pass=0;pass<2;pass++)for(let i=0;i<units.length;i++){
      let preferred=units[i],score=scoreLayout();
      for(const option of options[i][match[i]]){
        units[i]=option;const next=scoreLayout();
        if(next>score+1e-6){score=next;preferred=option;}
      }
      units[i]=preferred;
    }
    const score=scoreLayout?scoreLayout():-costs.reduce((s,row,i)=>s+row[match[i]],0);
    if(score>bestScore+1e-6){bestScore=score;best=units.slice();}
  }
  for(let i=0;i<units.length;i++)units[i]=best?.[i]||original[i];
  plan.contactUnresolved=!best;
  if(best)for(const u of best){plan.set(u.uid,u.key);plan.dirs.set(u.uid,u.dir);}
}


