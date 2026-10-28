// [ASSUMED] Acquisition caps and roster priorities are AI policy, not changes to bond mechanics.
// Repeatable sources: generated garrisons (Archetto, Ayerscarpe, Ptilopsis, Tippi, Astgenne).
import { pieceBonds } from '../../../../../bondsMeta.js';

const SKILL = 'skillfulShip', CORE = 'lateranoShip';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const distinct = (gd, pieces, bond) => new Set(pieces.filter(p => pieceBonds(gd, p).includes(bond)).map(p => base(gd, p))).size;

export function withLateranoSkillful(recipe, { roster = true } = {}) {
  const { ids } = recipe;
  const engines = new Set([ids.archetto, ids.ayerscarpe, ids.ptilopsis4, ids.ptilopsis5, ids.tippi, ids.astgenne]);
  const noPurchase = new Set(['chess_char_4_11_a', ids.gnosis, 'chess_char_5_06_a']);
  const passive = (gd, p) => gd.chess(p.id ?? p.chessId).bonds.includes(SKILL) && !engines.has(base(gd, p));
  const engineCount = (gd, pieces) => new Set(pieces.filter(p => engines.has(base(gd, p))).map(p => base(gd, p))).size;
  // An equipped transfer / a useful second role is never discarded just for having the Skillful tag.
  const otherRole = (gd, p) => pieceBonds(gd, p).some(b => [CORE, 'preciShip', 'visiShip', 'steadShip'].includes(b));

  function bridge(m, ps) {
    const gd = gdOf(m, ps), all = ps.allChess();
    if (gd.modeInactiveBonds.has(SKILL) || engineCount(gd, all) >= 2) return null;
    const candidates = all.filter(p => passive(gd, p));
    // Keep exactly one existing activation bridge; no speculative expensive acquisition is required.
    candidates.sort((a, b) => Number(!!b.items?.length) - Number(!!a.items?.length)
      || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id))
      || gd.chess(b.id).tier - gd.chess(a.id).tier || a.uid - b.uid);
    return candidates[0] || null;
  }

  function purchaseAllowed(m, ps, rec) {
    if (recipe.purchaseAllowed(m, ps, rec) === false) return false;
    const gd = gdOf(m, ps), id = base(gd, rec);
    if (!passive(gd, rec)) return true;
    if (noPurchase.has(id)) return false;
    const all = ps.allChess();
    if (all.some(p => base(gd, p) === id)) return false;
    // One cheap bridge before Archetto arrives; once two distinct members are owned, refresh for engines.
    return distinct(gd, all, SKILL) < 2 && !all.some(p => passive(gd, p));
  }

  function cleanupAcquisitions(m, ps) {
    recipe.cleanupAcquisitions?.(m, ps);
    const gd = gdOf(m, ps), retained = bridge(m, ps);
    // Only sell bench assets through the real API. Field members can first be replaced by the roster planner.
    for (const p of [...ps.hand, ...ps.temp]) if (p?.kind === 'chess' && passive(gd, p)
      && p.uid !== retained?.uid && !p.items?.length && !otherRole(gd, p)) ps.sell(p.uid);
  }

  function retain(m, ps, rec, method) {
    const gd = gdOf(m, ps);
    if (!passive(gd, rec)) return recipe[method](m, ps, rec);
    const all = ps.allChess().filter(p => base(gd, p) === base(gd, rec));
    const retained = bridge(m, ps);
    return !!retained && base(gd, retained) === base(gd, rec)
      || all.some(p => otherRole(gd, p)) && recipe[method](m, ps, rec);
  }

  function lineupBonus(gd, pieces, bonds, plan) {
    let value = recipe.lineupBonus(gd, pieces, bonds, plan);
    const ps = plan.ps, m = ps.m;
    if (!bonds[SKILL]?.active) return value;
    const available = engineCount(gd, ps.allChess()), field = engineCount(gd, pieces);
    // Normal waves invest the two activation slots in repeatable layers. Boss rounds value combat as before.
    if (m.round < gd.bossRound) {
      value += Math.min(2, field) * 18;
      if (available >= 2) value -= pieces.filter(p => passive(gd, p) && !otherRole(gd, p)).length * 24;
    }
    const extra = Math.max(0, distinct(gd, pieces, SKILL) - 2);
    if (!extra) return value;
    const owned = ps.allChess(), coreTarget = Math.min(6, distinct(gd, owned, CORE) + (ps.bondCountBonus?.[CORE] || 0));
    const matureTank = (ps.layers[CORE] || 0) >= 120 && pieces.some(p => base(gd, p) === ids.faith);
    const tankTarget = matureTank ? 1 : Math.min(2, distinct(gd, owned, 'steadShip'));
    const precisionTarget = distinct(gd, owned, 'preciShip') >= 3 ? 3 : 0;
    // A third Skillful body is a filler, not a reason to drop six Laterano, the tanks, or three Precision.
    const missing = Math.max(0, coreTarget - (bonds[CORE]?.count || 0))
      + Math.max(0, tankTarget - (bonds.steadShip?.count || 0))
      + Math.max(0, precisionTarget - (bonds.preciShip?.count || 0));
    return value - extra * (missing ? 48 : 0);
  }

  return Object.freeze({ ...recipe, purchaseAllowed, cleanupAcquisitions, lineupBonus: roster ? lineupBonus : recipe.lineupBonus,
    importantBuy: (m, ps, rec) => purchaseAllowed(m, ps, rec) && recipe.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec) => purchaseAllowed(m, ps, rec) && recipe.criticalBuy(m, ps, rec),
    keep: (m, ps, rec) => retain(m, ps, rec, 'keep'),
    preserve: (m, ps, rec) => retain(m, ps, rec, 'preserve') });
}
