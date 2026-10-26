// [ASSUMED] User-directed free reward ranking: Leo > foreign Swift engines > foreign Precision engines.
// Native core/main priorities stay above these ranks; low-tier bridges and on-gain stacks are not engines.
import {ids} from './sargonPepe.js';
import {isSwiftEngine} from './sargonSwift.js';

export function foreignEngineRank(gd,r){
  if(r.tier<4||r.bonds.includes('sargonShip'))return 0;
  const base=gd.baseIdOf(r.chessId);
  if(base===ids.leonhardt)return 3;
  if(isSwiftEngine(gd,r)||base==='chess_char_6_19_a')return 2;
  if(!r.bonds.includes('preciShip'))return 0;
  // A granted garrison belongs to the recipient: this deliberately includes Kroos's donated casting trigger.
  const gs=(r.garrisonIds||[]).map(id=>gd.garrison(id)).filter(Boolean);
  const triggers=gs.flatMap(g=>g.bbStr?.give_garrison_id?[g,gd.garrison(g.bbStr.give_garrison_id)]:[g]).filter(Boolean);
  return triggers.some(g=>g.eventType==='IN_BATTLE'&&g.bb?.bond_add_count>0
    &&g.bbStr?.bond_id?.split(',').includes('preciShip'))?1:0;
}

export function engineRewardPriority(parent,m,ps,s){
  const original=parent.rewardPriority(m,ps,s);
  if(s.kind!=='chess'||m.round>m.gd.bossRound||original>=3)return original;
  const r=ps.gd.chess(s.id),base=ps.gd.baseIdOf(s.id);
  if(ps.allChess().some(p=>ps.gd.baseIdOf(p.id)===base&&ps.gd.isGolden(p.id)))return original;
  // Native carries precede the foreign-only order, including their pair and third copy, without a mimic prerequisite.
  if([ids.passenger,ids.pepe,ids.titi].includes(base))return Math.max(original,4);
  const rank=foreignEngineRank(ps.gd,r);if(!rank)return original;
  return Math.max(original,2.6+rank/10);
}

export function createEngineRewardPolicy(parent){
  return Object.freeze({...parent,name:parent.name+'; persistent engine reward priority',
    rewardPriority:(m,ps,s)=>engineRewardPriority(parent,m,ps,s)});
}
