// [ASSUMED] Bounded independent policy experiments; not changes to game rules.
export const fourReview=(m,ps,arm)=>!m.isSolo&&m.difficulty==='ABYSS'&&m.order.length===4
  &&m.opts.botSargonCoopSeat===ps.playerId&&m.opts.botSargonFourReview===arm;
export function precisionCrisisPermission(candidate,reference,lp){
  return Number.isFinite(lp)&&reference.length===2&&candidate.length===2
    &&lp-Math.max(...reference.map(r=>r.lost))<=8
    &&candidate.every((r,i)=>reference[i].lost-r.lost>=2
      &&(r.growth?.preciShip||0)+3>=(reference[i].growth?.preciShip||0));
}
export function swiftDefensePermission(candidate,reference,context,plan){
  if(!context.protect||context.active(plan))return true;
  return candidate.some((r,i)=>r.lost<reference[i].lost||(r.mainDeaths||0)<(reference[i].mainDeaths||0));
}
