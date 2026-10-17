// Developer-only recipe objects over the original fixed-roster 19/2 forecast, not the growth-forecast experiment.
// [ASSUMED] Purchase caps and transfer priorities below are policy; all actions use the normal equipment API.
import { lateranoFocused } from './lateranoFocused.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

const CORE = lateranoFocused.core, { ids } = lateranoFocused;
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, rec) => gd.baseIdOf(rec.chessId || rec.id);
const own = (m, ps, id) => ps.allChess().filter(p => gdOf(m, ps).baseIdOf(p.id) === id);
const items = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item')
  .concat(ps.allChess().flatMap(p => p.items || []));
const hasItem = (m, ps, id) => items(ps).some(i => gdOf(m, ps).baseIdOf(i.id) === id);
const spareItem = (m, ps, id) => [...ps.hand,...ps.temp].some(i => i?.kind === 'item' && gdOf(m, ps).baseIdOf(i.id) === id);
export const LATERANO_ITEMS = Object.freeze({ speed: 'chess_item_4_03_e_a', offspring: 'chess_item_4_06_e_a',
  clip: 'chess_item_4_08_e_a', salt: 'chess_item_4_10_e_a', cavalry: 'chess_item_6_02_e_a',
  mimic: 'chess_item_5_05_e_a', document: 'chess_item_6_08_e_a', sphere: 'chess_item_6_09_e_a',
  precision: 'chess_item_3_02_e_a', coin: 'chess_item_1_03_e_a', incomeDoll: 'chess_item_2_05_e_a',
  oneFundDoll: 'chess_item_2_07_e_a', savings: 'chess_item_3_12_e_a' });
const I = LATERANO_ITEMS;
const signature = rec => rec?.giveBondId;
const copiesNeeded = (m, ps, id) => !own(m, ps, id).some(p => gdOf(m, ps).isGolden(p.id));
const memberCount = (m, ps, bond) => new Set(ps.allChess().filter(p => pieceBonds(gdOf(m, ps), p).includes(bond))
  .map(p => gdOf(m, ps).baseIdOf(p.id))).size;

/** Actual pairs only. Mostima develops before the boss; then the highest-tier real Laterano carry takes precedence. */
export function lateranoMimicTarget(m, ps) {
  const gd = gdOf(m, ps);
  return ps.allChess().filter(p => !gd.isGolden(p.id) && (gd.baseIdOf(p.id) === ids.mostima
    || gd.chess(p.id).tier >= 5 && gd.chess(p.id).bonds.includes(CORE))
    && ps.completesChessMerge(p.id) && copiesNeeded(m, ps, gd.baseIdOf(p.id))
    && (!(ps.poolOf?.(gd.baseIdOf(p.id)) || m.pool).has(gd.baseIdOf(p.id))
      || (ps.poolOf?.(gd.baseIdOf(p.id)) || m.pool).left(gd.baseIdOf(p.id)) > 0))
    .sort((a, b) => (m.round < gd.bossRound ? Number(gd.baseIdOf(b.id) === ids.mostima) - Number(gd.baseIdOf(a.id) === ids.mostima) : 0)
      || gd.chess(b.id).tier - gd.chess(a.id).tier || a.uid - b.uid)[0] || null;
}

/** Match an owned sphere/signature to ONE output carrier; never split the two halves or convert a native member again. */
export function lateranoTransferTarget(m, ps, bond = 'preciShip', prospective = null) {
  const gd = gdOf(m, ps), sphere = items(ps).filter(i => gd.baseIdOf(i.id) === I.sphere);
  if (!sphere.length) return null;
  if (bond === 'preciShip' && ((ps.bonds.preciShip?.count || 0) >= 3 || memberCount(m, ps, 'preciShip') < 2)) return null;
  const sigs = items(ps).filter(i => signature(gd.item(i.id)) === bond);
  if (prospective?.giveBondId === bond) sigs.push({ uid: -1, id: prospective.chessId || prospective.id });
  if (!sigs.length) return null;
  const on = (p, group) => p.items?.some(i => group.some(t => t.uid === i.uid));
  const available = group => group.some(i => i.uid === -1 || ['hand','temp'].includes(ps.find(i.uid)?.area));
  return ps.allChess().filter(p => {
    const rec = gd.chess(p.id);
    if (rec.tier < 4 || ['TANK','MEDIC'].includes(rec.profession) || ['heal','none'].includes(rec.attackKind)
      || pieceBonds(gd, p).includes(bond)) return false;
    const n = Number(!on(p, sphere)) + Number(!on(p, sigs));
    return (p.items?.length || 0) + n <= gd.equipPerChess && (on(p, sphere) || available(sphere)) && (on(p, sigs) || available(sigs));
  }).sort((a, b) => Number(on(b, sphere) || on(b, sigs)) - Number(on(a, sphere) || on(a, sigs))
    || Number(gd.baseIdOf(b.id) === ids.exusiaiAlter) - Number(gd.baseIdOf(a.id) === ids.exusiaiAlter)
    || gd.chess(b.id).tier - gd.chess(a.id).tier || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid)[0] || null;
}

function purchaseItemAllowed(m, ps, rec) {
  const gd = gdOf(m, ps), id = base(gd, rec);
  if (id === I.oneFundDoll) return false;
  if (id === I.incomeDoll) return rec.price === 3 && m.round <= 8;
  if (id === I.coin) return true;
  if (id === I.savings) return true; // Previously authorised economic consumable; not a combat equipment project.
  if ([I.speed,I.offspring].includes(id)) return own(m, ps, ids.executorAlter).length > 0
    && !hasItem(m, ps, id);
  if (id === I.salt) return m.bossId === 'boss_4';
  if (id === I.mimic) return !!lateranoMimicTarget(m, ps);
  if (id === I.document) return ps.deployCap < 9 && !hasItem(m, ps, id);
  if (id === I.sphere) return !hasItem(m, ps, id);
  if (id === I.precision) return hasItem(m, ps, I.sphere) && (ps.bonds.preciShip?.count || 0) < 3
    && memberCount(m, ps, 'preciShip') >= 2 && !hasItem(m, ps, id) && !!lateranoTransferTarget(m, ps, 'preciShip', rec);
  return [I.clip,I.cavalry].includes(id) && !spareItem(m, ps, id);
}

function itemTargetAllowed(m, ps, rec, target) {
  const gd = gdOf(m, ps), id = base(gd, rec);
  if ([I.speed,I.offspring].includes(id)) return gd.baseIdOf(target.id) === ids.executorAlter;
  if (id === I.mimic) return lateranoMimicTarget(m, ps)?.uid === target.uid;
  if (id === I.sphere || id === I.precision) {
    if (id === I.precision && !hasItem(m, ps, I.sphere)) return true;
    const t = lateranoTransferTarget(m, ps, 'preciShip') || (id === I.sphere && lateranoTransferTarget(m, ps, CORE));
    return t?.uid === target.uid;
  }
  if ([I.clip,I.cavalry].includes(id) && target.items?.some(i => gd.baseIdOf(i.id) === id)) return false;
  if (id === I.clip) return lateranoFocused.ammoWeight(gd.chess(target.id)) > 0
    || lateranoTransferTarget(m, ps, CORE)?.uid === target.uid;
  return true;
}
function ownedItemTarget(m, ps, rec, owned) {
  const gd = gdOf(m, ps), id = base(gd, rec);
  if ([I.speed,I.offspring].includes(id)) return lateranoFocused.itemTarget(m, ps, rec, owned);
  if (id === I.mimic) return lateranoMimicTarget(m, ps);
  if (id === I.sphere || id === I.precision || id === I.clip) {
    const precision = lateranoTransferTarget(m, ps, 'preciShip'), core = lateranoTransferTarget(m, ps, CORE);
    if (id === I.sphere) return precision || core;
    if (id === I.precision && hasItem(m, ps, I.sphere)) return precision;
    if (id === I.clip && !precision && core && !core.items?.some(i => signature(gd.item(i.id)) === CORE)) return core;
  }
  return undefined;
}
function holdItem(m, ps, rec) {
  const gd = gdOf(m, ps), id = base(gd, rec);
  if ([I.speed,I.offspring].includes(id)) return !own(m, ps, ids.executorAlter).length;
  if (id === I.mimic) return !lateranoMimicTarget(m, ps);
  if (id === I.sphere) return !lateranoTransferTarget(m, ps, 'preciShip') && !lateranoTransferTarget(m, ps, CORE);
  if (id === I.precision && hasItem(m, ps, I.sphere)) return !lateranoTransferTarget(m, ps, 'preciShip');
  return lateranoFocused.holdItem(m, ps, rec);
}

export const lateranoForecast19 = Object.freeze({ ...lateranoFocused, forecast: true });
export const lateranoWhitelist = Object.freeze({ ...lateranoForecast19, purchaseItemAllowed, itemTargetAllowed, ownedItemTarget, holdItem });

/** Distinct owned/equipped members: an elite duplicate is not a seventh member, an unused sphere is not a transfer. */
export function lateranoMilestones(m, ps) {
  const gd = gdOf(m, ps);
  return { six: Math.max(ps.bonds[CORE]?.count || 0, memberCount(m, ps, CORE)
      + Math.max(0, ps.bondCountBonus?.[CORE] || 0)) >= 6,
    mostima: own(m, ps, ids.mostima).some(p => gd.isGolden(p.id)) };
}

function gated(levels, requireMostima, base = lateranoWhitelist) {
  const blocked = (m, ps) => {
    const state = lateranoMilestones(m, ps);
    return levels.includes(ps.shop.level + 1) && (!state.six || requireMostima && !state.mostima);
  };
  return Object.freeze({ ...base,
    levelTarget(m, ps, options) {
      const target = base.levelTarget(m, ps, options);
      return blocked(m, ps) ? Math.min(target, ps.shop.level) : target;
    },
    beforeUpgrade(m, ps, plan) { return !blocked(m, ps) && base.beforeUpgrade(m, ps, plan); },
    priorityLevel(m, ps) { return !blocked(m, ps) && base.priorityLevel(m, ps); },
    // A blocked upgrade releases its funds to shopping; no LP/deadline/free-upgrade exceptions in this ablation.
    spendReserve(m, ps) { return blocked(m, ps) ? 0 : base.spendReserve(m, ps); }
  });
}

/** Shopping repairs are independent of the equipment list, forecast algorithm and upgrade gate. */
function repaired(recipe) {
  const unfinished = (m, ps, rec) => m.round <= gdOf(m, ps).bossRound
    && base(gdOf(m, ps), rec) === ids.mostima && copiesNeeded(m, ps, ids.mostima);
  const corePair = (m, ps, rec) => !rec.isGolden && rec.bonds.includes(CORE)
    && own(m, ps, base(gdOf(m, ps), rec)).filter(p => !gdOf(m, ps).isGolden(p.id)).length >= 2;
  const routePair = (m, ps, rec) => recipe.purchaseAllowed(m, ps, rec) !== false
    && rec.bonds.some(b => [CORE,'preciShip','skillfulShip','visiShip'].includes(b))
    && own(m, ps, base(gdOf(m, ps), rec)).filter(p => !gdOf(m, ps).isGolden(p.id)).length >= 2
    && copiesNeeded(m, ps, base(gdOf(m, ps), rec));
  const importantBuy = (m, ps, rec) => recipe.purchaseAllowed(m, ps, rec) !== false
    && (unfinished(m, ps, rec) || recipe.criticalBuy(m, ps, rec)
      || rec.bonds.includes(CORE) && !own(m, ps, base(gdOf(m, ps), rec)).length
        && (lateranoMilestones(m, ps).six === false || rec.tier >= 5)
      || corePair(m, ps, rec) || routePair(m, ps, rec));
  return Object.freeze({ ...recipe, shoppingRepair: true, importantBuy,
    criticalBuy: importantBuy,
    keep(m, ps, rec) { return unfinished(m, ps, rec) || corePair(m, ps, rec) || routePair(m, ps, rec) || recipe.keep(m, ps, rec); },
    preserve(m, ps, rec) { return unfinished(m, ps, rec) || corePair(m, ps, rec) || routePair(m, ps, rec) || recipe.preserve(m, ps, rec); },
    beforeUpgrade(m, ps, plan) {
      return !ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds
        && importantBuy(m, ps, gdOf(m, ps).chess(s.id))) && recipe.beforeUpgrade(m, ps, plan);
    },
    protectItem(m, ps, rec) {
      const id = base(gdOf(m, ps), rec);
      return [I.sphere,I.document].includes(id) || id === I.mimic && !!lateranoMimicTarget(m, ps)
        || [I.speed,I.offspring].includes(id) && own(m, ps, ids.executorAlter).length > 0
        || id === I.salt && m.bossId === 'boss_4'
        || id === I.precision && hasItem(m, ps, I.sphere);
    } });
}

export const lateranoRepair17 = repaired(lateranoFocused);
export const lateranoRepair19 = repaired(lateranoForecast19);
const repairWhite17 = repaired(Object.freeze({ ...lateranoWhitelist, forecast: false }));
const repairWhite19 = repaired(lateranoWhitelist);
export const LATERANO_EXPERIMENTS = Object.freeze({ forecast19: lateranoForecast19, whitelist: lateranoWhitelist,
  'six-before-five': gated([5], false), 'six-before-six': gated([6], false),
  'six-mostima-before-five': gated([5], true), 'six-mostima-before-five-six': gated([5,6], true),
  repair17: lateranoRepair17, repair19: lateranoRepair19,
  'repair17-white': repairWhite17, 'repair19-white': repairWhite19,
  'repair17-five': gated([5], false, lateranoRepair17), 'repair19-five': gated([5], false, lateranoRepair19),
  'repair17-white-five': gated([5], false, repairWhite17), 'repair19-white-five': gated([5], false, repairWhite19),
  'repair19-white-six': gated([6], false, repairWhite19),
  'repair19-white-mostima-five': gated([5], true, repairWhite19),
  'repair19-white-mostima-five-six': gated([5,6], true, repairWhite19) });
