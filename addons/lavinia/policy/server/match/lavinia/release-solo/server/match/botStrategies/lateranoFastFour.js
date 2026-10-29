// [ASSUMED] Reach level four on an already usable early roster, without weakening inherited level-five/six gates.
const gdOf = (m, ps) => ps.gd || m.gd;

export function lateranoFourReadiness(m, ps) {
  const gd = gdOf(m, ps), records = ps.allChess().map(p => gd.chess(p.id));
  const fronts = records.filter(r => r.position !== 'RANGED' && (r.stats?.blockCnt || 0) >= 2);
  const damage = records.filter(r => !['heal','none'].includes(r.attackKind));
  const ranged = damage.filter(r => r.position === 'RANGED');
  const healers = records.filter(r => r.attackKind === 'heal' || r.subProfessionId === 'guardian');
  const tanks = records.filter(r => r.position !== 'RANGED' && (r.stats?.blockCnt || 0) > 0);
  const sturdy = fronts.some(r => r.isGolden && r.bonds.includes('lateranoShip'));
  const early = ps.shop.level < 4 && m.round >= 2 && ps.lp > 8;
  const ready = early && (ps.shop.level === 1 ? fronts.length >= 1 && ranged.length >= 1
    : ps.shop.level === 2 ? records.length >= 4 && fronts.length >= 1 && damage.length >= 2 && ranged.length >= 1
      : records.length >= 5 && fronts.length >= 1 && damage.length >= 3 && ranged.length >= 1
        && (tanks.length >= 2 || sturdy) && (healers.length >= 1 || sturdy && records.length >= 6));
  return { ready, members:records.length, fronts:fronts.length, damage:damage.length, ranged:ranged.length,
    healers:healers.length, tanks:tanks.length, sturdy };
}

export function withLateranoFastFour(recipe) {
  const ready = (m, ps) => lateranoFourReadiness(m, ps).ready;
  const reserve = (m, ps) => ps.shop.level < 4 && ready(m, ps) ? 0 : recipe.upgradeReserve(m, ps);
  const target = (m, ps, options) => ps.shop.level < 4 && ready(m, ps) ? 4 : recipe.levelTarget(m, ps, options);
  const priority = (m, ps) => ps.shop.level < 4 && ready(m, ps) || recipe.priorityLevel(m, ps);
  return Object.freeze({ ...recipe,
    readyForUpgrade: (m, ps) => ready(m, ps) || recipe.readyForUpgrade(m, ps),
    levelTarget: target, upgradeReserve: reserve, priorityLevel: priority,
    spendReserve(m, ps) {
      if (ps.shop.level >= 4) return recipe.spendReserve(m, ps);
      return priority(m, ps) && ps.funds >= ps.shop.upgradePrice + reserve(m, ps) ? Math.max(0,ps.shop.upgradePrice) : 0;
    },
    // The inherited beforeUpgrade still buys visible required first copies and core pairs before upgrading.
  });
}
