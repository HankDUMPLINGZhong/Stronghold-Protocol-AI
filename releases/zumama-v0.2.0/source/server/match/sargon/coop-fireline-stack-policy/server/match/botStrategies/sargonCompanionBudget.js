// [ASSUMED] One budget factor: use actual discretionary reserves and protect executable upgrades.
// The caller retains the parent's one-bridge limit, visible-main gate and existing formation search.
export function visibleNativeSeconds(parent,m,ps){
  const owned=ps.allChess();return ps.shop.slots.flatMap((s,index)=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return [];
    const r=ps.gd.chess(s.id),base=ps.gd.baseIdOf(s.id),copies=owned.filter(p=>ps.gd.baseIdOf(p.id)===base);
    return r.bonds.includes('sargonShip')&&!copies.some(p=>ps.gd.isGolden(p.id))
      &&copies.filter(p=>!ps.gd.isGolden(p.id)).length===1&&parent.purchaseAllowed(m,ps,r)
      ?[{index,id:s.id,name:r.name,price:ps.priceOf(s)}]:[];
  });
}
export function companionSpendingReserve(m,ps,recipe,legacyReserve){
  const target=recipe.levelTarget(m,ps),price=Math.max(0,ps.shop.upgradePrice),extra=Math.max(0,recipe.upgradeReserve(m,ps));
  const spend=Math.max(0,recipe.spendReserve(m,ps)||0),purchase=Math.max(0,recipe.purchaseReserve?.(m,ps)||0);
  const boardReady=ps.allChess().length>=(m.round<=4?ps.deployCap:Math.min(ps.deployCap,6))||recipe.readyForUpgrade?.(m,ps)===true;
  const executable=ps.shop.level<target&&ps.funds>=price+extra&&(boardReady||m.round>=6)&&recipe.beforeUpgrade(m,ps);
  const upgrade=executable?price+extra:0;
  return {legacyReserve,target,price,extra,spend,purchase,executable,upgrade,reserve:Math.max(spend,purchase,upgrade)};
}
