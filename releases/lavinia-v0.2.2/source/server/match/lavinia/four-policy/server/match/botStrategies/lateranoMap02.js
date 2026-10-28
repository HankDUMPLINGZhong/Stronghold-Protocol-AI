// [ASSUMED] Player-taught normal-wave layout for battlefield #02 only.
// The review diagram is vertically mirrored: diagram row = 21 - board row; columns are unchanged.
import { canPlace, placeClass } from '../../../../../board.js';
import { rotateOffset } from '../../../../../../sim/dir.js';

const DIRS = ['RIGHT', 'DOWN', 'UP', 'LEFT'];
export const map02DiagramRow = r => 21 - r;
export const map02Front = rec => (rec.stats?.blockCnt || 0) > 0
  && (rec.profession === 'TANK' || rec.position === 'MELEE' && rec.bonds?.includes('steadShip'));
export const map02FrontBand = (r, c, few = false) => few ? c >= 6 && c <= 8 : map02DiagramRow(r) === 9 || c >= 6;
const coverOf = (rec, r, c, dir) => new Set((rec.rangeGrid || [[0, 0]]).map(([a,b]) => {
  const [dr,dc] = rotateOffset(a,b,dir); return `${r+dr},${c+dc}`;
}));

function facingScore(rec, r, c, dir, routes, held) {
  const cover = coverOf(rec,r,c,dir), key = `${r},${c}`;
  let score = 0;
  for (const rt of routes) {
    const at = rt.tiles.indexOf(key), n = rt.n;
    score += n * rt.tiles.filter(k => cover.has(k)).length;
    if (at >= 0) {
      score += n * (3 + (held.has(rt) ? 0 : 3) + (1-at/rt.tiles.length)*0.1);
      if (at > 0 && cover.has(rt.tiles[at-1])) score += n * 2;
    }
  }
  return score;
}

export function withLateranoMap02(baseline) {
  return Object.freeze({ ...baseline,
    placementPlan(gd, pieces, plan, ctx) {
      const previous = baseline.placementPlan?.(gd,pieces,plan,ctx), ps=plan.ps, m=ps?.m;
      if (!m || m.stageId !== 'act1autochess_m02' || m.round >= m.gd.bossRound) return previous;
      const {map,occupied,model,recOf}=ctx, starts=new Map(previous?.starts || []);
      const fixed=new Set(previous?.fixed || []), reserved=new Set(previous?.reserved || []);
      const taken=new Set([...occupied,...reserved,...[...starts.values()].map(p=>p.key)]);
      const units=pieces.filter(p=>p.kind==='chess').map(p=>({p,rec:recOf(p)}));
      const fronts=units.filter(u=>map02Front(u.rec)).sort((a,b)=>
        Number(gd.baseIdOf(b.p.id)===baseline.ids.faith)-Number(gd.baseIdOf(a.p.id)===baseline.ids.faith)
        || (b.rec.stats?.maxHp||0)*(1+(b.rec.stats?.def||0)/500)-(a.rec.stats?.maxHp||0)*(1+(a.rec.stats?.def||0)/500)
        || a.p.uid-b.p.uid);
      const saint=units.filter(u=>gd.baseIdOf(u.p.id)===baseline.ids.executorAlter)
        .sort((a,b)=>Number(gd.isGolden(b.p.id))-Number(gd.isGolden(a.p.id))||a.p.uid-b.p.uid)[0];
      const routes=model.routes.filter(rt=>!rt.fly&&!rt.fallback&&rt.n>0), held=new Set();
      const legal=(u,r,c)=>!taken.has(`${r},${c}`)&&canPlace(map,placeClass(ps,u.rec),r,c);
      const put=(u,r,c,dir)=>{const key=`${r},${c}`;starts.set(u.p.uid,{key,r,c,dir});fixed.add(u.p.uid);taken.add(key);
        for(const rt of routes)if(rt.tiles.includes(key))held.add(rt);};
      // From diagram (10,5), Reaper facing RIGHT covers the approach (9,6) and the other front (11,6).
      if(saint&&legal(saint,11,5))put(saint,11,5,'RIGHT');
      const saintSeated=saint&&fixed.has(saint.p.uid), few=!saintSeated&&pieces.length<=4;
      for(let i=0;i<fronts.length;i++) {
        const u=fronts[i], preferred=saintSeated&&i<2?[[10,6],[12,5]][i]:null;
        let best=null,score=-Infinity;
        for(const key of map.keys()) {
          const [r,c]=key.split(',').map(Number);
          if(!legal(u,r,c)||!map02FrontBand(r,c,few)||!m.stage.tiles[m.stage.rows[r]?.[c]]?.groundPassable)continue;
          for(const dir of DIRS) {
            const value=facingScore(u.rec,r,c,dir,routes,held)+(preferred&&r===preferred[0]&&c===preferred[1]?100000:0);
            if(value>score){score=value;best={r,c,dir};}
          }
        }
        if(best)put(u,best.r,best.c,best.dir);
      }
      return fixed.size?{...previous,starts,fixed,reserved}:previous;
    }
  });
}
