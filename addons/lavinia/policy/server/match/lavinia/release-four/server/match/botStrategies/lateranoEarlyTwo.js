// [ASSUMED] Single-factor27/14 ablation: opening frontage may block one rather than two.
// Retain the existing LP>=16/R2-3 window, upgrade cost/buffer and all key-purchase vetoes.
const CORE = 'lateranoShip';

export function lateranoEarlyTwo(m, ps) {
  if (m.mode !== 'solo' || ps.bandId !== 'band_paganini' || ps._botFocusId !== CORE
    || ps.shop.level !== 1 || m.round < 2 || m.round > 3 || ps.lp < 16) return false;
  const gd = ps.gd || m.gd, records = ps.allChess().map(p => gd.chess(p.id));
  return records.some(r => r.position !== 'RANGED' && (r.stats?.blockCnt || 0) >= 1)
    && records.some(r => r.position === 'RANGED' && !['heal', 'none'].includes(r.attackKind));
}

export function withLateranoEarlyTwo(recipe) {
  return Object.freeze({ ...recipe,
    earlyTwoState: (m, ps) => ({ ready: lateranoEarlyTwo(m, ps) }),
    readyForUpgrade: (m, ps) => lateranoEarlyTwo(m, ps) || recipe.readyForUpgrade(m, ps),
    levelTarget: (m, ps, options) => lateranoEarlyTwo(m, ps) ? 2 : recipe.levelTarget(m, ps, options),
    priorityLevel: (m, ps) => lateranoEarlyTwo(m, ps) || recipe.priorityLevel(m, ps),
    spendReserve(m, ps) {
      if (!lateranoEarlyTwo(m, ps)) return recipe.spendReserve(m, ps);
      return ps.funds >= ps.shop.upgradePrice + recipe.upgradeReserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
    },
  });
}
