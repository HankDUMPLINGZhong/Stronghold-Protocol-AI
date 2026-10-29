// [ASSUMED] Independent tests of visible final-healer funding and a bounded no-healer level-five window.
// Retain the key-value control's ordinary shopping, sale guards, equipment and formation decisions.
import { LATERANO_KEY_VALUATION, withLateranoKeyValue } from './lateranoKeyValue.js';
import { withLateranoKeyLiquidity } from './lateranoKeyLiquidity.js';
import { ownedLateranoCount } from './lateranoSixReady.js';

const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
export function lateranoOwnsHealing(m, ps, recipe) {
  const gd = gdOf(m, ps);
  return ps.allChess().some(p => {
    const rec = gd.chess(p.id);
    return rec.attackKind === 'heal' || rec.dmgType === 'heal'
      || ['guardian', 'incantationmedic'].includes(rec.subProfessionId) || base(gd, p) === recipe.ids.titi;
  });
}

export function lateranoFirstWhite(m, ps, recipe, rec) {
  return m.round === gdOf(m, ps).bossRound && [recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].includes(base(gdOf(m, ps), rec))
    && recipe.purchaseAllowed(m, ps, rec) !== false && !lateranoOwnsHealing(m, ps, recipe)
    && ownedLateranoCount(m, ps) >= 6;
}

export function withLateranoKeyHealing(recipe, { funding = true, holdSix = false } = {}) {
  let parent = recipe;
  if (funding) parent = Object.freeze({ ...recipe,
    importantBuy: (m, ps, rec) => lateranoFirstWhite(m, ps, recipe, rec) || recipe.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec, ...args) => lateranoFirstWhite(m, ps, recipe, rec) || recipe.criticalBuy(m, ps, rec, ...args),
  });
  const valuation = Object.freeze({ ...LATERANO_KEY_VALUATION,
    targetRank(m, ps, r, slot, rank) {
      return lateranoFirstWhite(m, ps, r, gdOf(m, ps).chess(slot.id)) ? Math.max(1100, rank) : rank;
    },
    accept(m, ps, r, plan) {
      const accepted = LATERANO_KEY_VALUATION.accept(m, ps, r, plan);
      if (!lateranoFirstWhite(m, ps, r, gdOf(m, ps).chess(plan.slot.id))) return accepted;
      // The ordinary scorer supplies the same sequential donor cost; only the missing-healer utility changes.
      plan.valuation.value = 12;
      return plan.valuation.value >= plan.valuation.cost + 3;
    },
  });
  const out = funding ? withLateranoKeyLiquidity(parent, valuation) : withLateranoKeyValue(parent);
  if (!holdSix) return out;
  const hold = (m, ps) => ps.shop.level === 5 && m.round === 12 && !lateranoOwnsHealing(m, ps, recipe);
  return Object.freeze({ ...out,
    levelTarget(m, ps, options) { const target = out.levelTarget(m, ps, options); return hold(m, ps) ? Math.min(5, target) : target; },
    beforeUpgrade: (m, ps, plan) => !hold(m, ps) && out.beforeUpgrade(m, ps, plan),
    priorityLevel: (m, ps) => !hold(m, ps) && out.priorityLevel(m, ps),
    spendReserve: (m, ps) => hold(m, ps) ? 0 : out.spendReserve(m, ps),
  });
}
