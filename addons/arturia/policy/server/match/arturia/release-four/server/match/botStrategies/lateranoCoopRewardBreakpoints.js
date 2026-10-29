// [ASSUMED] Free fallback rewards value immediately usable support tiers and bench Miracle.
// This wraps the unchanged bridge policy; it grants no shop permission or future-draw knowledge.
import { computeBonds } from '../../../../../../../../../bondsMeta.js';
import { bridgeRewardNeeded, bridgeRewardValue, withCoopRewardBridge } from './lateranoCoopRewardBridge.js';

const COMBAT = ['lateranoShip', 'preciShip', 'skillfulShip', 'visiShip', 'steadShip', 'swiftShip'];
const MIRACLE = 'miraShip';
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const bondsFor = (ps, lineup, own) => {
  const chosen = new Set(lineup.map(p => p.uid));
  return computeBonds(ps.gd, { ...ps, board: new Map(lineup.map((p, i) => [String(i), p])),
    hand: own.filter(p => !chosen.has(p.uid)), temp: [] });
};

/** Only actual tier gains count: duplicate tags, inactive modes and an unreachable board do not. */
export function breakpointRewardValue(m, ps, rec, recipe, chosen = field(ps)) {
  const gains = (a, b) => COMBAT.reduce((n, id) => n + Math.max(0, (a[id]?.tier || 0) - (b[id]?.tier || 0)), 0);
  const result = bridgeRewardValue(m, ps, rec, recipe, chosen,
    (a, b) => a.value - b.value + gains(a.bonds, b.bonds) * 24);
  if (result.value <= -1000) return result;
  const own = ps.allChess(), before = bondsFor(ps, chosen, own), breakpoints = [];
  if (result.lineup) for (const id of COMBAT) {
    const gain = (result.bonds[id]?.tier || 0) - (before[id]?.tier || 0);
    if (gain > 0) breakpoints.push({ id, tiers: gain, placement: 'board' });
  }
  let best = { ...result, breakpoints };
  const extra = { kind: 'chess', uid: -1, id: rec.chessId, items: [] };
  const bench = bondsFor(ps, chosen, [...own, extra]);
  if (!before[MIRACLE]?.active && bench[MIRACLE]?.active) {
    // No board substitution is necessary. 24 proxy points represent the economic activation,
    // not a promised number of free rolls; the real refresh process remains probabilistic.
    const value = Math.max(0, result.value) + 24;
    best = { ...best, value, breakpoints: [...breakpoints, { id: MIRACLE, tiers: 1, placement: 'bench' }] };
  }
  return best;
}

function retainMiracle(_m, ps, p) {
  const own = ps.allChess(), chosen = field(ps);
  if (!bondsFor(ps, chosen, own)[MIRACLE]?.active) return false;
  return !bondsFor(ps, chosen.filter(q => q.uid !== p.uid), own.filter(q => q.uid !== p.uid))[MIRACLE]?.active;
}

/** A held final carry or actual stacking engine advances before an optional economy tag. */
export function breakpointRewardNeeded(m, ps, rec, recipe) {
  if (bridgeRewardNeeded(m, ps, rec, recipe)) return true;
  const own = ps.allChess(), base = ps.gd.baseIdOf(rec.chessId), same = own.filter(p => ps.gd.baseIdOf(p.id) === base);
  if (!same.length || same.some(p => ps.gd.isGolden(p.id))) return false;
  const engines = [recipe.ids.titi, recipe.ids.ptilopsis4, recipe.ids.ptilopsis5,
    recipe.ids.astgenne, recipe.ids.leonhardt, recipe.ids.kroosAlter, recipe.ids.ayerscarpe];
  if (rec.bonds.some(id => ['preciShip', 'skillfulShip'].includes(id)) && (rec.tier >= 5 || engines.includes(base))) return true;
  // [ASSUMED, user priority] Any held normal copy advances before optional Miracle.
  // This exception exists only in a real offer with an available economic activation;
  // it does not promote unrelated duplicates over every other combat reward or paid buy.
  const chosen = field(ps);
  if (bondsFor(ps, chosen, own)[MIRACLE]?.active) return false;
  return !!ps.offers[0]?.slots.some(s => s.kind === 'chess' && !s.sold
    && bondsFor(ps, chosen, [...own, { kind: 'chess', uid: -1, id: s.id, items: [] }])[MIRACLE]?.active);
}

export function withCoopRewardBreakpoints(parent) {
  return withCoopRewardBridge(parent, { rewardValue: breakpointRewardValue, rewardNeeded: breakpointRewardNeeded, retain: retainMiracle,
    factor: 'reward-bridge-breakpoints' });
}
