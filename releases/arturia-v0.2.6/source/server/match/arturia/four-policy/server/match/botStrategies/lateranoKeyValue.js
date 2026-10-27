// [ASSUMED] Compare visible acquisition utility with the opportunity cost of the complete sale plan.
// Scores express policy preferences, not expected battle wins; no future shop or battle is inspected.
import { pieceBonds } from '../../../../../bondsMeta.js';
import { ownedLateranoCount } from './lateranoSixReady.js';
import { withLateranoKeyLiquidity } from './lateranoKeyLiquidity.js';
import { isFormationAnchor } from '../botPositioning.js';

const base = (gd, p) => gd.baseIdOf(p.id);
const gdOf = (m, ps) => ps.gd || m.gd;

function saleCost(m, ps, recipe, p, remaining) {
  const gd = gdOf(m, ps), id = base(gd, p), bonds = pieceBonds(gd, p);
  const last = !remaining.some(x => x.uid !== p.uid && base(gd, x) === id);
  let cost = 1;
  // Keeping one copy preserves a future activation and avoids paying to reacquire it after a gift.
  if (last && bonds.includes('visiShip')) cost += 3;
  if (last && [recipe.ids.leonhardt, recipe.ids.kroosAlter, recipe.ids.ayerscarpe, recipe.ids.tippi].includes(id)) cost += 2;
  if (last && bonds.includes('skillfulShip') && (ps.layers.skillfulShip || 0) >= 40) cost += 2;
  if (last && bonds.includes('preciShip') && (ps.layers.preciShip || 0) >= 40) cost += 1;
  const rec = gd.chess(p.id);
  if (last && rec.tier >= 5) cost += 3;
  if (last && rec.tier >= 5 && isFormationAnchor(rec)) cost += 2;
  if (gd.isGolden(p.id)) cost += 1;
  return cost;
}

function targetValue(m, ps, recipe, slot) {
  const gd = gdOf(m, ps), id = base(gd, slot), { ids } = recipe;
  const own = ps.allChess(), same = own.filter(p => base(gd, p) === id);
  const merge = ps.completesChessMerge(slot.id), final = m.round === gd.bossRound;
  const sixth = !same.length && gd.chess(slot.id).bonds.includes('lateranoShip') && ownedLateranoCount(m, ps) === 5;
  if (sixth) return 12;
  if (id === ids.mostima) {
    if (ps._botCoopLateAcquisition && same.length) return merge ? 2 + Math.max(0, gd.bossRound - m.round) * 3 : 1;
    return merge ? 12 : same.length ? 4 : 8;
  }
  if ([ids.executorAlter, ids.exusiaiAlter, ids.lemuen].includes(id)) {
    if (merge) return 10;
    // An ordinary Saint is an optional development means. Do not cash out a bench to gamble on promotion late.
    if (id === ids.executorAlter) return m.round <= 10 ? 5 : 2;
    return 6;
  }
  if (merge && gd.chess(slot.id).bonds.includes('lateranoShip')) {
    if (final) return 2;
    // Do not consume all early liquidity on ordinary promotions before acquiring the stacking engine.
    return own.some(p => base(gd, p) === ids.mostima) ? 6 : 2;
  }
  if (merge && [ids.ptilopsis4, ids.ptilopsis5, ids.titi, ids.astgenne].includes(id)) return final ? 3 : 6;
  // A fifth low-tier native is not yet a six-member power spike.
  return 0;
}

export const LATERANO_KEY_VALUATION = Object.freeze({ saleCost,
  accept(m, ps, recipe, plan) {
    let remaining = ps.allChess(), cost = 0;
    for (const sale of plan.sales) {
      const p = remaining.find(x => x.uid === sale.uid);
      cost += saleCost(m, ps, recipe, p, remaining);
      remaining = remaining.filter(x => x.uid !== p.uid);
    }
    // Splitting an existing pair sacrifices an option to obtain a higher-tier reward.
    const gd = gdOf(m, ps), sold = new Set(plan.sales.map(x => base(gd, x)));
    for (const id of sold) {
      if (ps.allChess().filter(p => base(gd, p) === id && !gd.isGolden(p.id)).length >= 2
        && remaining.filter(p => base(gd, p) === id && !gd.isGolden(p.id)).length < 2) cost += 1;
    }
    const value = targetValue(m, ps, recipe, plan.slot);
    plan.valuation = { value, cost };
    // Require a clear advantage: the reward card is visible, but promotion rewards and later replacements are not.
    return value >= cost + 3;
  },
});

export const withLateranoKeyValue = recipe => withLateranoKeyLiquidity(recipe, LATERANO_KEY_VALUATION);
