// Shared growth-bot economy; legacy stays reproducible. [ASSUMED] Early-game purchase value is policy.
export function economyItemBonus(m, ps, rec) {
  const effect = rec?.buffs?.find((b) => b.key === 'gain_coin_when_round_start');
  if (!effect || m.round > 8 || !ps.allChess().length) return 0;
  const gain = effect.bb.count || 0;
  const futureIncome = Math.max(0, (ps.gd || m.gd).bossRound - m.round) * gain;
  return futureIncome > (rec.price || 0) ? Math.min(65, 20 + (futureIncome - (rec.price || 0)) * 4) : 0;
}

/** Early combat + next-prep income (Swire Alter); the actual board / bond condition still gates the real trait. */
export function economyChessBonus(m, ps, rec, { purchase = false } = {}) {
  if (!rec || m.round > 7) return 0;
  const gd = ps.gd || m.gd;
  if (!(rec.garrisonIds || []).some((id) => gd.garrison(id)?.effectKey === 'SERVER_ONCE_GOLD_WITH_BOND_CONDITION')) return 0;
  if (purchase && ps.allChess().some((p) => gd.baseIdOf(p.id) === gd.baseIdOf(rec.chessId))) return 0;
  return purchase ? 12 : 6;
}

/** Use the permanent-income doll immediately on a legal free carrier; do not sacrifice locked equipment. */
export function useEconomyItems(m, ps) {
  const gd = ps.gd || m.gd;
  for (const item of [...ps.hand, ...ps.temp]) {
    if (item?.kind !== 'item' || !ps.find(item.uid)) continue;
    const effect = gd.item(item.id)?.buffs?.find((b) => b.key === 'gain_coin_when_round_start');
    if (!effect) continue;
    const carrier = ps.allChess().find((p) => (p.items?.length || 0) < gd.equipPerChess);
    if (!carrier) continue;
    if (ps.equip(item.uid, carrier.uid)?.ok) {
      const stats = ps._botRecipeStats ||= {};
      stats.permanentDolls = (stats.permanentDolls || 0) + (effect.bb.count || 0);
    }
  }
}
