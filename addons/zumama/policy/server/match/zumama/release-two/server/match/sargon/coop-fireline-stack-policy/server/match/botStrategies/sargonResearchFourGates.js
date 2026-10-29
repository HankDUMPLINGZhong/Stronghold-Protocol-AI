// [ASSUMED] Research gates only; operates on owned inventory and immutable opening LP.
// This template is copied into the measured policy directory before importing it.
import {pieceBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
import {ids} from './sargonPepe.js';

const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
const heal=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const precisionEngines=new Set([ids.kroos,ids.leonhardt,'chess_char_4_20_a',ids.titi,'chess_char_6_01_a']);
const mainIds=new Set([ids.pepe,ids.passenger,ids.titi]);
export const growthCore=(ps,p)=>base(ps,p)===ids.minimalist?ps.gd.isGolden(p.id)
  :ps.gd.chess(p.id).tier>=4&&ps.gd.chess(p.id).bonds.includes('sargonShip');
export const precisionEngine=(ps,p)=>precisionEngines.has(base(ps,p));
export function lpHeadroom(openingLP,rows,cap){
  return cap>0&&rows.length===2&&rows.every((r,i)=>r.valid&&r.sample===i)
    &&openingLP-Math.max(...rows.map(r=>r.lost))>cap;
}

// Force each held core/engine pair into the current or normal preview roster.
// At most two replacements, using ALL held pieces (no top-ten bench truncation).
// No real moves, purchases, reward draws, battle seeds or teammate state are read.
export function growthPackage(m,ps,preview,api,legalPlan){
  const own=ps.allChess(),cores=own.filter(p=>growthCore(ps,p)),engines=own.filter(p=>precisionEngine(ps,p));
  if(!cores.length||!engines.length)return {protected:false,reason:'missing-held-growth-package'};
  const original=field(ps),before=api.shadow(ps,original).bonds;
  const required=original.filter(p=>mainIds.has(base(ps,p))).map(p=>base(ps,p));
  const needFront=own.some(p=>front(ps.gd.chess(p.id))),needHeal=own.some(p=>heal(ps.gd.chess(p.id)));
  const seen=new Set();
  for(const core of cores)for(const engine of engines){
    if(core.uid===engine.uid)continue;
    for(const initial of [original,preview]){
      const missing=[core,engine].filter(p=>!initial.some(q=>q.uid===p.uid));
      const removable=initial.filter(p=>p.uid!==core.uid&&p.uid!==engine.uid);
      const proposals=[];
      if(!missing.length)proposals.push(initial);
      if(missing.length===1)for(const a of removable)proposals.push(initial.filter(p=>p!==a).concat(missing));
      if(missing.length===2)for(let i=0;i<removable.length;i++)for(let j=i+1;j<removable.length;j++)
        proposals.push(initial.filter(p=>p!==removable[i]&&p!==removable[j]).concat(missing));
      for(const lineup of proposals){
        const signature=lineup.map(p=>p.uid).sort((a,b)=>a-b).join(',');if(seen.has(signature))continue;seen.add(signature);
        if(lineup.length!==original.length||!api.transition(ps,original,lineup))continue;
        if(required.some(id=>!lineup.some(p=>base(ps,p)===id)))continue;
        const bonds=api.shadow(ps,lineup).bonds;
        if(!bonds.sargonShip?.active||!bonds.preciShip?.active
          ||(bonds.sargonShip?.count||0)<Math.min(6,before.sargonShip?.count||0))continue;
        if(needFront&&!lineup.some(p=>front(ps.gd.chess(p.id)))||needHeal&&!lineup.some(p=>heal(ps.gd.chess(p.id))))continue;
        const plan=legalPlan(lineup);
        if(plan.size!==lineup.length||new Set(plan.values()).size!==lineup.length)continue;
        return {protected:true,reason:'deployable-held-growth-package',core:{uid:core.uid,id:core.id},
          engine:{uid:engine.uid,id:engine.id},roster:lineup.map(p=>({uid:p.uid,id:p.id})),
          tiles:[...plan],dirs:[...plan.dirs],coreCount:bonds.sargonShip.count,precisionCount:bonds.preciShip.count};
      }
    }
  }
  return {protected:false,reason:'no-legal-joint-growth-roster'};
}
