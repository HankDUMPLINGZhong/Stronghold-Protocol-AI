// [ASSUMED] Speed-three comparison: speed-two opening plus an R3-4 level-three readiness exception.
// Purchases, key-card vetoes, actual upgrade cost and all level-four-plus decisions remain27/14.
import { withLateranoEarlyTwo } from './lateranoEarlyTwo.js';

export function lateranoEarlyThree(m, ps) {
  if (m.mode !== 'solo' || ps.bandId !== 'band_paganini' || ps._botFocusId !== 'lateranoShip'
    || ps.shop.level !== 2 || m.round < 3 || m.round > 4 || ps.lp < 16) return false;
  const gd = ps.gd || m.gd, all = ps.allChess(), records = all.map(p => gd.chess(p.id));
  return new Set(all.map(p => gd.baseIdOf(p.id))).size >= 4
    && records.some(r => r.position !== 'RANGED' && (r.stats?.blockCnt || 0) >= 1)
    && records.some(r => r.position === 'RANGED' && !['heal', 'none'].includes(r.attackKind))
    && records.filter(r => !['heal', 'none'].includes(r.attackKind)).length >= 2;
}

export function withLateranoEarlyThree(recipe) {
  const two = withLateranoEarlyTwo(recipe);
  return Object.freeze({ ...two,
    earlyThreeState: (m, ps) => ({ ready: lateranoEarlyThree(m, ps) }),
    readyForUpgrade: (m, ps) => lateranoEarlyThree(m, ps) || two.readyForUpgrade(m, ps),
    levelTarget: (m, ps, options) => lateranoEarlyThree(m, ps) ? 3 : two.levelTarget(m, ps, options),
    priorityLevel: (m, ps) => lateranoEarlyThree(m, ps) || two.priorityLevel(m, ps),
    spendReserve(m, ps) {
      if (!lateranoEarlyThree(m, ps)) return two.spendReserve(m, ps);
      return ps.funds >= ps.shop.upgradePrice + two.upgradeReserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
    },
  });
}
