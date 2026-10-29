// [ASSUMED] Conservative marginal Foresight utility, using public readiness and income milestones only.
// A Reaper is a damage carry, never a substitute for the defender used by this readiness measure.
import { developmentValue } from '../botLateranoDevelopment.js';

export function mostimaVisionContext(m, ps, recipe) {
  const units=[...ps.board.values()].filter(p=>p.kind==='chess');
  const rec=p=>ps.gd.chess(p.id), base=p=>ps.gd.baseIdOf(p.id);
  const front=units.some(p=>rec(p).profession==='TANK'&&(rec(p).stats?.blockCnt||0)>=2);
  const healer=units.some(p=>rec(p).dmgType==='heal'||rec(p).attackKind==='heal'
    ||['guardian','incantationmedic'].includes(rec(p).subProfessionId));
  const carries=[recipe.ids.exusiaiAlter,recipe.ids.lemuen,recipe.ids.archetto,recipe.ids.executorAlter];
  const eliteCarry=units.some(p=>carries.includes(base(p))&&ps.gd.isGolden(p.id));
  const six=(ps.bonds.lateranoShip?.count||0)>=6;
  const readiness=(.25+.25*Number(front)+.25*Number(healer)+.25*Number(eliteCarry))*(six?1:.5)*(ps.lp<12?.5:1);
  return Object.freeze({ core:ps.layers.lateranoShip||0, vision:ps.layers.visiShip||0,
    remaining:Math.max(0,m.gd.bossRound-m.round), readiness, front, healer, eliteCarry, six,
    lemuen:units.some(p=>base(p)===recipe.ids.lemuen) });
}

/** Same-wave money, bounded remaining-Saint-wave milestone proximity, and future shop rounds.
 * Raw low Vision is deliberately cheap; near 80/150 or crossing them is worth more on an already sound team.
 */
export function mostimaVisionUtility(row, ctx) {
  if(!ctx||!Number.isFinite(row.visionGain)||!Number.isFinite(row.coreGain))return null;
  const gain=Math.max(0,row.visionGain),before=ctx.vision,after=before+gain;
  const coins=2*(Math.floor(after/10)-Math.floor(before/10));
  const target=[80,150].find(n=>before<n);
  const near=target!=null&&target-after<=21*Math.max(0,ctx.remaining-1);
  const useful=Math.min(gain,Math.max(0,150-before));
  let vision=coins*.8+useful*(near?.85:.05);
  if(before<80&&after>=80)vision+=Math.min(4,ctx.remaining*2);
  if(before<150&&after>=150)vision+=Math.min(12,ctx.remaining*4);
  const core=developmentValue({lateranoShip:ctx.core},{lateranoShip:row.coreGain},1,
    {remaining:ctx.remaining,lemuen:ctx.lemuen});
  return core+ctx.readiness*vision;
}
