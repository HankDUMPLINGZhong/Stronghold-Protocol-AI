// [ASSUMED] Player-taught support progression over the retained 27/10 recipe; not new game rules.
// Shop-only caps leave the real gifts, merges, pools, prices and original opening picker unchanged.
import { pieceBonds } from '../../../../../bondsMeta.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip', VISION = 'visiShip', STEAD = 'steadShip';
export const LATERANO_SUPPORT_IDS = Object.freeze({ grey: 'chess_char_1_14_a', silence: 'chess_char_2_02_a',
  perfumer: 'chess_char_2_14_a' });
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const chess = ps => ps.allChess();
const owns = (gd, ps, id) => chess(ps).some(p => base(gd, p) === id);
const best = (gd, pieces) => pieces.slice().sort((a, b) => Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id))
  || gd.tierOf(b.id) - gd.tierOf(a.id) || a.uid - b.uid)[0] || null;
const precise = ps => ps._botRoute?.support === 'preciShip';

/** Actual active aura geometry, including real transfers; no attack range or treatment is implied. */
export function saintSkillfulCovered(gd, units, ps, bonds, saintId) {
  if (!bonds[SKILL]?.active) return false;
  const members = new Map(chess(ps).map(p => [p.uid, pieceBonds(gd, p)]));
  const hasSkill = u => (members.get(u.uid) || u.rec.bonds || []).includes(SKILL);
  const saint = units.find(u => base(gd, u.rec) === saintId);
  if (!saint) return false;
  if (hasSkill(saint)) return true;
  const diagonal = (bonds[SKILL].layers || 0) >= gd.bond(SKILL).bb.power_bond_stack_cnt;
  return units.some(u => hasSkill(u) && (diagonal
    ? Math.max(Math.abs(u.r - saint.r), Math.abs(u.c - saint.c)) <= 1
    : Math.abs(u.r - saint.r) + Math.abs(u.c - saint.c) <= 1));
}

export function withLateranoMedicChain(recipe) {
  const { ids } = recipe, S = LATERANO_SUPPORT_IDS;
  const whites = new Set([ids.ptilopsis4, ids.ptilopsis5]);
  const white = (gd, p) => whites.has(base(gd, p));
  const primaryWhite = (gd, ps) => best(gd, chess(ps).filter(p => white(gd, p)));
  const visionHelper = rec => rec.bonds.includes(VISION) && !rec.bonds.includes(CORE) && !rec.bonds.includes('preciShip');
  const tankHelper = rec => rec.bonds.includes(STEAD) && !rec.bonds.includes(CORE);
  const bought = (ps, id) => ps._botMedicChainBuys?.[id] || 0;
  const single = (gd, ps, id) => !owns(gd, ps, id) && !bought(ps, id);
  const preBoss = m => m.round < m.gd.bossRound;
  const partner = (gd, ps) => best(gd, chess(ps).filter(p => base(gd, p) === S.silence))
    || best(gd, chess(ps).filter(p => base(gd, p) !== ids.executorAlter && pieceBonds(gd, p).includes(VISION)));
  const nonArchettoSkill = (gd, ps) => chess(ps).some(p => base(gd, p) !== ids.archetto && pieceBonds(gd, p).includes(SKILL));

  function allowed(m, ps, rec) {
    const gd = gdOf(m, ps), id = base(gd, rec), all = chess(ps);
    if (tankHelper(rec)) {
      if (id === ids.fold && owns(gd, ps, id)) return !all.some(p => base(gd, p) === id && gd.isGolden(p.id))
        && bought(ps, id) < 3 && all.filter(p => base(gd, p) === id).length < 3;
      if (!single(gd, ps, id) || m.round > 8) return false;
      const n = new Set(all.filter(p => pieceBonds(gd, p).includes(STEAD)).map(p => base(gd, p))).size;
      return n < 3;
    }
    if (id === S.grey) return single(gd, ps, id) && m.round <= 5 && !gd.modeInactiveBonds.has(SKILL)
      && !owns(gd, ps, ids.ayerscarpe) && !primaryWhite(gd, ps) && !nonArchettoSkill(gd, ps);
    if (id === ids.gnosis) return single(gd, ps, id) && preBoss(m) && !gd.modeInactiveBonds.has(SKILL)
      && !nonArchettoSkill(gd, ps);
    if (id === S.perfumer) return single(gd, ps, id) && ps.shop.level <= 3 && preBoss(m)
      && !owns(gd, ps, S.silence) && !primaryWhite(gd, ps) && !(precise(ps) && owns(gd, ps, ids.titi));
    if (id === S.silence) return single(gd, ps, id) && preBoss(m) && !gd.modeInactiveBonds.has(VISION)
      && !partner(gd, ps);
    if (visionHelper(rec)) return single(gd, ps, id) && ps.shop.level >= 4 && preBoss(m)
      && !gd.modeInactiveBonds.has(VISION) && !partner(gd, ps);
    if (white(gd, rec)) {
      if (!preBoss(m) && precise(ps) && owns(gd, ps, ids.titi) && !owns(gd, ps, ids.lemuen)) return false;
      const current = primaryWhite(gd, ps);
      if (current && base(gd, current) !== id && gd.tierOf(current.id) >= rec.tier) return false;
      return !all.some(p => base(gd, p) === id && gd.isGolden(p.id));
    }
    return recipe.purchaseAllowed(m, ps, rec) !== false;
  }

  // A Fold pair is useful, but must not spend the funds of an affordable first role or native merge.
  function purchaseAllowed(m, ps, rec) {
    if (!allowed(m, ps, rec)) return false;
    const gd = gdOf(m, ps), id = base(gd, rec);
    if (id !== ids.fold || !owns(gd, ps, id)) return true;
    return !ps.shop.slots.some(slot => {
      if (!slot || slot.sold || slot.kind !== 'chess' || ps.priceOf(slot) > ps.funds) return false;
      const other = gd.chess(slot.id), otherId = base(gd, other);
      if (otherId === id || !allowed(m, ps, other)) return false;
      return other.bonds.includes(CORE) && !chess(ps).some(p => base(gd, p) === otherId && gd.isGolden(p.id))
        || !owns(gd, ps, otherId) && (white(gd, other) || otherId === S.perfumer
          || other.bonds.some(b => [CORE, SKILL, VISION, STEAD, 'preciShip'].includes(b)));
    });
  }

  function bridgeBuy(m, ps, rec) {
    const gd = gdOf(m, ps), id = base(gd, rec);
    return single(gd, ps, id) && (white(gd, rec) || [S.grey, S.silence, S.perfumer, ids.gnosis, ids.ayerscarpe].includes(id)
      || visionHelper(rec) && !partner(gd, ps));
  }

  function importantBuy(m, ps, rec) {
    if (!purchaseAllowed(m, ps, rec)) return false;
    const gd = gdOf(m, ps), id = base(gd, rec);
    if (id === ids.fold && owns(gd, ps, id)) return false;
    return bridgeBuy(m, ps, rec) || recipe.importantBuy(m, ps, rec);
  }

  function buyBonus(m, ps, rec, plan, counts) {
    let value = recipe.buyBonus(m, ps, rec, plan, counts);
    const gd = gdOf(m, ps), id = base(gd, rec), fresh = !owns(gd, ps, id);
    if (fresh && white(gd, rec)) value += 28;
    if (fresh && id === S.silence) value += 16;
    if (fresh && id === S.perfumer) value += 10;
    if (fresh && [S.grey, ids.gnosis].includes(id)) value += 10;
    if (fresh && id === ids.ayerscarpe && owns(gd, ps, S.grey)) value += 16;
    if (fresh && visionHelper(rec) && !partner(gd, ps)) value += 10;
    return value;
  }

  function obsolete(m, ps, rec) {
    const gd = gdOf(m, ps), id = base(gd, rec);
    if (id === S.grey) return owns(gd, ps, ids.ayerscarpe) || !!primaryWhite(gd, ps);
    if (id === S.perfumer) return owns(gd, ps, S.silence) || !!primaryWhite(gd, ps)
      || precise(ps) && owns(gd, ps, ids.titi);
    return false;
  }

  function keep(m, ps, rec, method) {
    const gd = gdOf(m, ps), id = base(gd, rec), all = chess(ps);
    if (obsolete(m, ps, rec)) return false;
    if (id === S.grey || id === ids.gnosis) return !primaryWhite(gd, ps)
      && !owns(gd, ps, ids.ayerscarpe) && !gd.modeInactiveBonds.has(SKILL);
    if (id === S.perfumer) return !primaryWhite(gd, ps);
    if (visionHelper(rec)) return m.round <= gd.bossRound && base(gd, partner(gd, ps) || {}) === id;
    if (white(gd, rec)) return !!primaryWhite(gd, ps) && base(gd, primaryWhite(gd, ps)) === id;
    if (tankHelper(rec) && id !== ids.fold) {
      // Single-copy bridges remain usable; do not keep an accidental pair solely for its merge.
      return all.filter(p => base(gd, p) === id).length === 1 && recipe[method](m, ps, rec);
    }
    return recipe[method](m, ps, rec);
  }

  function cleanupAcquisitions(m, ps) {
    recipe.cleanupAcquisitions?.(m, ps);
    const gd = gdOf(m, ps);
    for (const p of [...ps.hand, ...ps.temp]) if (p?.kind === 'chess' && !p.items?.length && obsolete(m, ps, gd.chess(p.id))) ps.sell(p.uid);
  }

  function lineupBonus(gd, pieces, bonds, plan) {
    let value = recipe.lineupBonus(gd, pieces, bonds, plan);
    const ps = plan.ps, m = ps.m, primary = primaryWhite(gd, ps);
    const field = new Set(pieces.map(p => base(gd, p))), titi = owns(gd, ps, ids.titi), lemuen = owns(gd, ps, ids.lemuen);
    const useTiti = precise(ps) && titi;
    if (useTiti && !field.has(ids.titi)) value -= 160;
    if (primary) {
      if (useTiti && !lemuen) value -= pieces.filter(p => white(gd, p) && !pieceBonds(gd, p).includes(CORE)).length * 160;
      else if (!field.has(base(gd, primary))) value -= m.round >= gd.bossRound ? 160 : 60;
    } else if (!useTiti && owns(gd, ps, S.silence) && !field.has(S.silence)) value -= 35;
    else if (!useTiti && !owns(gd, ps, S.silence) && owns(gd, ps, S.perfumer) && !field.has(S.perfumer)) value -= 25;
    if (useTiti && lemuen && m.round >= gd.bossRound && ps.deployCap >= 8
      && owns(gd, ps, ids.executor) && (bonds.preciShip?.count || 0) < 3) value -= 240;
    // First-rank core retention in the inherited finale always outweighs these support preferences.
    return value;
  }

  function unitBonus(m, ps, rec, plan) {
    let value = recipe.unitBonus(m, ps, rec, plan);
    if (obsolete(m, ps, rec)) value -= 30;
    return value;
  }

  function layoutValue(gd, units, plan, bonds, model) {
    const value = recipe.layoutValue(gd, units, plan, bonds, model), ps = plan.ps;
    if (!bonds[SKILL]?.active || !units.some(u => base(gd, u.rec) === ids.executorAlter)) return value;
    return value + (saintSkillfulCovered(gd, units, ps, bonds, ids.executorAlter) ? 4 : -4);
  }

  function layoutCandidates(gd, units, plan, bonds) {
    const out = recipe.layoutCandidates(gd, units, plan, bonds) || [];
    const saint = units.find(u => base(gd, u.rec) === ids.executorAlter);
    if (!saint || !bonds[SKILL]?.active) return out;
    const offsets = (bonds[SKILL].layers || 0) >= gd.bond(SKILL).bb.power_bond_stack_cnt
      ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] : [[1,0],[-1,0],[0,1],[0,-1]];
    const members = new Map(chess(plan.ps).map(p => [p.uid, pieceBonds(gd, p)]));
    for (const u of units) if (u !== saint && (members.get(u.uid) || u.rec.bonds).includes(SKILL)) {
      for (const [dr,dc] of offsets) out.push({ uid:u.uid, r:saint.r+dr, c:saint.c+dc });
    }
    return out;
  }

  return Object.freeze({ ...recipe, purchaseAllowed, importantBuy, criticalBuy: importantBuy, buyBonus,
    keep: (m, ps, rec) => keep(m, ps, rec, 'keep'), preserve: (m, ps, rec) => keep(m, ps, rec, 'preserve'),
    cleanupAcquisitions, lineupBonus, unitBonus, layoutValue, layoutCandidates,
    beforeUpgrade(m, ps, plan) {
      return !ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds
        && bridgeBuy(m, ps, gdOf(m, ps).chess(s.id)) && purchaseAllowed(m, ps, gdOf(m, ps).chess(s.id)))
        && recipe.beforeUpgrade(m, ps, plan);
    },
    afterPurchase(m, ps, slot, before) {
      recipe.afterPurchase?.(m, ps, slot, before);
      if (slot.kind !== 'chess') return;
      const id = gdOf(m, ps).baseIdOf(slot.id), counts = ps._botMedicChainBuys ||= {};
      counts[id] = (counts[id] || 0) + 1;
    } });
}
