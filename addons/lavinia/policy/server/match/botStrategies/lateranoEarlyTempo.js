// [ASSUMED] Independent27/14 economic factor: accept an opening block-one frontline, spend less on bridges
// through shop four, and reach native shop tiers sooner. No future shops, actual results or extra forecast is used.
import { economyChessBonus } from '../botEconomy.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip', PRECI = 'preciShip', VISION = 'visiShip', STEAD = 'steadShip';
const gdOf = (m, ps) => ps.gd || m.gd;
const scoped = (m, ps) => m.mode === 'solo' && ps.bandId === 'band_paganini' && ps._botFocusId === CORE
  && m.round >= 2 && ps.shop.level < 4;
const transitionScope = (m, ps) => m.mode === 'solo' && ps.bandId === 'band_paganini' && ps._botFocusId === CORE
  && m.round >= 2 && ps.shop.level <= 4;

export function lateranoEarlyTempo(m, ps) {
  const gd = gdOf(m, ps), units = ps.allChess(), records = units.map(p => gd.chess(p.id));
  const members = new Set(units.map(p => gd.baseIdOf(p.id))).size;
  const fronts = records.filter(r => r.position !== 'RANGED' && r.stats.blockCnt >= 1).length;
  const blockers = records.filter(r => r.position !== 'RANGED' && r.stats.blockCnt >= 2).length;
  const damage = records.filter(r => !['heal', 'none'].includes(r.attackKind)).length;
  const ranged = records.filter(r => r.position === 'RANGED' && !['heal', 'none'].includes(r.attackKind)).length;
  const healers = records.filter(r => r.attackKind === 'heal' || r.dmgType === 'heal'
    || ['guardian', 'incantationmedic'].includes(r.subProfessionId)).length;
  const inScope = scoped(m, ps);
  const ready = inScope && (ps.shop.level === 1 ? ps.lp >= 12 && fronts >= 1 && ranged >= 1 && members >= 2
    : ps.shop.level === 2 ? m.round >= 4 && ps.lp >= 10 && members >= 4 && fronts >= 1 && damage >= 2 && ranged >= 1
      : m.round >= 6 && ps.lp >= 10 && members >= 5 && blockers >= 1 && damage >= 3 && ranged >= 2
        && (healers >= 1 || blockers >= 2));
  return { inScope, ready, members, fronts, blockers, damage, ranged, healers };
}

export function withLateranoEarlyTempo(recipe) {
  const base = (gd, p) => gd.baseIdOf(p.id || p.chessId);
  const engines = new Set([recipe.ids.ptilopsis4, recipe.ids.ptilopsis5, recipe.ids.titi, recipe.ids.astgenne,
    recipe.ids.leonhardt, recipe.ids.kroosAlter]);
  function transitionAllowed(m, ps, rec) {
    if (!transitionScope(m, ps) || rec.bonds.includes(CORE)) return true;
    if (engines.has(base(gdOf(m, ps), rec))) return true;
    if (m.bossId === 'boss_4' && rec.subProfessionId === 'wandermedic') return true;
    if (economyChessBonus(m, ps, rec, { purchase: true }) > 0) return true;
    const gd = gdOf(m, ps), all = ps.allChess(), id = base(gd, rec);
    const copies = all.filter(p => base(gd, p) === id);
    // Do not open another paid support pair; a third copy for an already-gifted ordinary pair remains useful.
    if (copies.length) return copies.length >= 2 && !copies.some(p => gd.isGolden(p.id));
    const count = bond => new Set(all.filter(p => pieceBonds(gd, p).includes(bond)).map(p => base(gd, p))).size;
    const state = lateranoEarlyTempo(m, ps);
    const healer = rec.attackKind === 'heal' || rec.dmgType === 'heal'
      || ['guardian', 'incantationmedic'].includes(rec.subProfessionId);
    if (healer && state.healers === 0) return true;
    if (rec.bonds.includes(STEAD) && count(STEAD) < 2) return true;
    if (rec.bonds.includes(SKILL) && !all.some(p => !pieceBonds(gd, p).includes(CORE) && pieceBonds(gd, p).includes(SKILL))) return true;
    // Precision bridges pay off on activation; do not buy a lone early off-core Precision project.
    if (rec.bonds.includes(PRECI) && count(PRECI) === 2) return true;
    if (rec.bonds.includes(VISION) && all.some(p => base(gd, p) === recipe.ids.executorAlter) && count(VISION) < 2) return true;
    // Preserve emergency opening bodies, without buying a second pure Swift member or another generic front.
    return state.fronts === 0 && rec.position !== 'RANGED' && rec.stats.blockCnt >= 1
      || state.ranged === 0 && rec.position === 'RANGED' && !['heal', 'none'].includes(rec.attackKind);
  }
  const purchaseAllowed = (m, ps, rec) => recipe.purchaseAllowed(m, ps, rec) !== false && transitionAllowed(m, ps, rec);
  const ready = (m, ps) => lateranoEarlyTempo(m, ps).ready;
  const priority = (m, ps) => ready(m, ps) || recipe.priorityLevel(m, ps);
  const reserve = (m, ps) => ready(m, ps) ? 0 : recipe.upgradeReserve(m, ps);
  return Object.freeze({ ...recipe,
    earlyTempoState: lateranoEarlyTempo,
    purchaseAllowed,
    rewardScoreAllowed: recipe.rewardScoreAllowed || recipe.purchaseAllowed,
    importantBuy: (m, ps, rec) => purchaseAllowed(m, ps, rec) && recipe.importantBuy(m, ps, rec),
    criticalBuy: (m, ps, rec, ...args) => purchaseAllowed(m, ps, rec) && recipe.criticalBuy(m, ps, rec, ...args),
    readyForUpgrade: (m, ps) => ready(m, ps) || recipe.readyForUpgrade(m, ps),
    levelTarget: (m, ps, options) => ready(m, ps) ? ps.shop.level + 1 : recipe.levelTarget(m, ps, options),
    priorityLevel: priority,
    upgradeReserve: reserve,
    spendReserve(m, ps) {
      if (!scoped(m, ps)) return recipe.spendReserve(m, ps);
      return priority(m, ps) && ps.funds >= ps.shop.upgradePrice + reserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
    },
    beforeUpgrade(m, ps, plan) {
      if (!transitionScope(m, ps)) return recipe.beforeUpgrade(m, ps, plan);
      const gd = gdOf(m, ps), slots = ps.shop.slots.map(s => s?.kind === 'chess' && !s.sold
        && !transitionAllowed(m, ps, gd.chess(s.id)) ? null : s);
      if (slots.every((s, i) => s === ps.shop.slots[i])) return recipe.beforeUpgrade(m, ps, plan);
      const view = Object.create(ps); view.shop = { ...ps.shop, slots };
      return recipe.beforeUpgrade(m, view, plan);
    },
  });
}
