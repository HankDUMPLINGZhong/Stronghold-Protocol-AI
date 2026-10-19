// Developer-only recipe objects over the original fixed-roster 19/2 forecast, not the growth-forecast experiment.
// [ASSUMED] Purchase caps and transfer priorities below are policy; all actions use the normal equipment API.
import { lateranoFocused } from './lateranoFocused.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { withLateranoRetention } from './lateranoRetention.js';
import { withLateranoOpening } from './lateranoOpening.js';
import { withLateranoMap02 } from './lateranoMap02.js';
import { withLateranoMapLines } from './lateranoMapLines.js';
import { observePaganiniSpend, paganiniMinimumMembers } from './lateranoGiftGate.js';
import { withLateranoSkillful } from './lateranoSkillful.js';
import { withLateranoFinale } from './lateranoFinale.js';
import { withLateranoTeam } from './lateranoTeam.js';
import { withLateranoPromotion } from './lateranoPromotion.js';
import { withLateranoArchettoBlade } from './lateranoArchettoBlade.js';
import { withLateranoSixReady } from './lateranoSixReady.js';
import { withLateranoMedicChain } from './lateranoMedicChain.js';
import { withLateranoSingleSkill } from './lateranoSingleSkill.js';
import { withLateranoFastFour } from './lateranoFastFour.js';
import { withLateranoEliteCap } from './lateranoEliteCap.js';
import { withLateranoFourDevelopment } from './lateranoFourDevelopment.js';
import { withLateranoProtection } from './lateranoProtection.js';
import { withLateranoReducedSwift } from './lateranoReducedSwift.js';
import { withLateranoLocalProtection } from './lateranoLocalProtection.js';
import { withLateranoFourLimit } from './lateranoFourLimit.js';
import { withLateranoApproach } from './lateranoApproach.js';
import { withLateranoContactTeam } from './lateranoContactTeam.js';
import { withLateranoUpgradeReserve } from './lateranoUpgradeReserve.js';
import { withLateranoNativePairs } from './lateranoNativePairs.js';
import { withLateranoR14EliteHold } from './lateranoR14EliteHold.js';
import { withLateranoR14PairHold } from './lateranoR14PairHold.js';
import { withLateranoVisionTrade } from './lateranoVisionTrade.js';
import { withLateranoSupportSingles } from './lateranoSupportSingles.js';

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
export function lateranoTransferTarget(m, ps, bond = 'preciShip', prospective = null, roleFirst = false) {
  const gd = gdOf(m, ps), sphere = items(ps).filter(i => gd.baseIdOf(i.id) === I.sphere);
  if (!sphere.length) return null;
  if (bond === 'preciShip' && ((ps.bonds.preciShip?.count || 0) >= 3 || memberCount(m, ps, 'preciShip') < 2)) return null;
  const sigs = items(ps).filter(i => signature(gd.item(i.id)) === bond);
  if (prospective?.giveBondId === bond) sigs.push({ uid: -1, id: prospective.chessId || prospective.id });
  if (!sigs.length) return null;
  const on = (p, group) => p.items?.some(i => group.some(t => t.uid === i.uid));
  const available = group => group.some(i => i.uid === -1 || ['hand','temp'].includes(ps.find(i.uid)?.area));
  const related = p => roleFirst && bond === CORE && gd.chess(p.id).bonds.some(b => ['skillfulShip','preciShip','steadShip'].includes(b));
  return ps.allChess().filter(p => {
    const rec = gd.chess(p.id);
    if ((!related(p) && (rec.tier < 4 || ['TANK','MEDIC'].includes(rec.profession) || ['heal','none'].includes(rec.attackKind)))
      || pieceBonds(gd, p).includes(bond)) return false;
    const n = Number(!on(p, sphere)) + Number(!on(p, sigs));
    return (p.items?.length || 0) + n <= gd.equipPerChess && (on(p, sphere) || available(sphere)) && (on(p, sigs) || available(sigs));
  }).sort((a, b) => Number(on(b, sphere) || on(b, sigs)) - Number(on(a, sphere) || on(a, sigs))
    || Number(related(b)) - Number(related(a))
    || Number(gd.baseIdOf(b.id) === ids.exusiaiAlter) - Number(gd.baseIdOf(a.id) === ids.exusiaiAlter)
    || gd.chess(b.id).tier - gd.chess(a.id).tier || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid)[0] || null;
}

/** Related off-core carriers compress support slots; finish any already committed pair before opening a new one. */
function withRelatedTransfer(recipe) {
  const targets = (m, ps) => ({ precision: lateranoTransferTarget(m, ps, 'preciShip'), core: lateranoTransferTarget(m, ps, CORE, null, true) });
  return Object.freeze({ ...recipe,
    ownedItemTarget(m, ps, rec, owned) {
      const gd = gdOf(m, ps), id = base(gd, rec);
      if ([I.sphere,I.clip].includes(id)) {
        const {precision,core} = targets(m, ps);
        if (id === I.sphere) return precision || core;
        if (!precision && core && !core.items?.some(i => signature(gd.item(i.id)) === CORE)) return core;
      }
      return recipe.ownedItemTarget(m, ps, rec, owned);
    },
    itemTargetAllowed(m, ps, rec, p) {
      const gd = gdOf(m, ps), id = base(gd, rec);
      if (id === I.sphere) { const {precision,core} = targets(m, ps); return (precision || core)?.uid === p.uid; }
      if (id === I.clip && !p.items?.some(i => gd.baseIdOf(i.id) === I.clip)) {
        const {precision,core} = targets(m, ps);
        if (!precision && core?.uid === p.uid) return true;
      }
      return recipe.itemTargetAllowed(m, ps, rec, p);
    },
    holdItem(m, ps, rec) {
      if (base(gdOf(m, ps), rec) === I.sphere) { const {precision,core} = targets(m, ps); return !precision && !core; }
      return recipe.holdItem(m, ps, rec);
    }
  });
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

function gated(levels, requireMostima, base = lateranoWhitelist, minimumMembers = () => 6) {
  const relaxed = (m, ps) => minimumMembers(m, ps) === 5;
  const blocked = (m, ps) => {
    const state = lateranoMilestones(m, ps);
    const members = Math.max(ps.bonds[CORE]?.count || 0, memberCount(m, ps, CORE) + Math.max(0, ps.bondCountBonus?.[CORE] || 0));
    return levels.includes(ps.shop.level + 1) && (members < minimumMembers(m, ps) || requireMostima && !state.mostima);
  };
  return Object.freeze({ ...base,
    levelTarget(m, ps, options) {
      const target = base.levelTarget(m, ps, options);
      return blocked(m, ps) ? Math.min(target, ps.shop.level) : relaxed(m, ps) ? Math.max(target, 5) : target;
    },
    beforeUpgrade(m, ps, plan) { return !blocked(m, ps) && base.beforeUpgrade(m, ps, plan); },
    priorityLevel(m, ps) { return !blocked(m, ps) && (relaxed(m, ps) || base.priorityLevel(m, ps)); },
    // A blocked upgrade releases its funds to shopping; no LP/deadline/free-upgrade exceptions in this ablation.
    spendReserve(m, ps) {
      if (blocked(m, ps)) return 0;
      if (relaxed(m, ps)) return ps.funds >= ps.shop.upgradePrice + base.upgradeReserve(m, ps) ? Math.max(0, ps.shop.upgradePrice) : 0;
      return base.spendReserve(m, ps);
    }
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
const retained21 = gated([5], false, repairWhite19);
const retention21 = withLateranoRetention(retained21);
const vision21 = Object.freeze({ ...retained21, keep: retention21.keep, preserve: retention21.preserve });
const visionOpening = withLateranoOpening(vision21);
const map02 = withLateranoMap02(visionOpening);
function giftedFour(fromRound) {
  const gate = gated([5], false, repairWhite19, paganiniMinimumMembers(fromRound));
  const retention = withLateranoRetention(gate);
  const vision = Object.freeze({ ...gate, keep: retention.keep, preserve: retention.preserve, observeSpend: observePaganiniSpend });
  return withLateranoMapLines(withLateranoMap02(withLateranoOpening(vision)), ['infection','tide']);
}
const giftR11 = giftedFour(11);
const finalR11 = withLateranoFinale(giftR11);
const buy26 = withLateranoFinale(withLateranoSkillful(giftR11, { roster: false }), { allProtectedWithdrawals: true });
const team27 = withLateranoTeam(buy26, { roster: true });
const promotionDeadline = withLateranoPromotion(team27, { deadlineFallback: true });
const bladeSixReady = withLateranoSixReady(withLateranoArchettoBlade(promotionDeadline));
const approach25 = withLateranoApproach(bladeSixReady);
const contactTeamLower = withRelatedTransfer(withLateranoContactTeam(approach25, { lower: true }));
const contactTeamLateSix = withLateranoUpgradeReserve(contactTeamLower);
const medicPromotion = withLateranoPromotion(team27, { deadlineFallback: true,
  eligibleTarget: rec => !(rec.bonds.includes('visiShip') && !rec.bonds.includes(CORE) && !rec.bonds.includes('preciShip')) });
const medicBase = withLateranoSixReady(withLateranoArchettoBlade(medicPromotion));
const medicChain = withLateranoMedicChain(medicBase);
const medicSingle = withLateranoSingleSkill(medicChain);
const medicFour = withLateranoFastFour(medicSingle);
const medicFourR11 = withLateranoFourDevelopment(medicFour, { releaseRound: 11 });
export const LATERANO_EXPERIMENTS = Object.freeze({ forecast19: lateranoForecast19, whitelist: lateranoWhitelist,
  'six-before-five': gated([5], false), 'six-before-six': gated([6], false),
  'six-mostima-before-five': gated([5], true), 'six-mostima-before-five-six': gated([5,6], true),
  repair17: lateranoRepair17, repair19: lateranoRepair19,
  'repair17-white': repairWhite17, 'repair19-white': repairWhite19,
  'repair17-five': gated([5], false, lateranoRepair17), 'repair19-five': gated([5], false, lateranoRepair19),
  'repair17-white-five': gated([5], false, repairWhite17), 'repair19-white-five': retained21,
  retention21, 'retention21-opening': withLateranoOpening(retention21),
  opening21: withLateranoOpening(retained21),
  'vision21-opening': visionOpening,
  'vision21-opening-map02': map02,
  'vision21-map05': withLateranoMapLines(map02,['blower']),
  'vision21-map04': withLateranoMapLines(map02,['infection']),
  'vision21-map04-05': withLateranoMapLines(map02,['blower','infection']),
  'vision21-map08': withLateranoMapLines(map02,['tide']),
  'vision21-map04-08': withLateranoMapLines(map02,['infection','tide']),
  'gift4-five-r10': giftedFour(10), 'gift4-five-r11': giftR11,
  'gift4-five-r12': giftedFour(12),
  'gift4-five-r11-skillful': withLateranoSkillful(giftR11),
  'gift4-five-r11-finale': finalR11,
  'gift4-five-r11-finale-buy': withLateranoFinale(withLateranoSkillful(giftR11, { roster: false })),
  'gift4-five-r11-finale-skillful': withLateranoFinale(withLateranoSkillful(giftR11)),
  'gift4-five-r11-buy26': buy26,
  'gift4-five-r11-team26': withLateranoTeam(buy26),
  'gift4-five-r11-team26-roster': team27,
  'team27-promotion': withLateranoPromotion(team27),
  'team27-promotion-deadline': promotionDeadline,
  'team27-archetto-blade': withLateranoArchettoBlade(promotionDeadline),
  'team27-six-ready': withLateranoSixReady(promotionDeadline),
  'team27-blade-six-ready': bladeSixReady,
  'team27-vision-star-trade': withLateranoVisionTrade(bladeSixReady),
  'team27-r14-native-elite': withLateranoR14EliteHold(bladeSixReady),
  'team27-r14-all-pairs': withLateranoR14PairHold(bladeSixReady),
  'team27-native-pairs-r14-elite': withLateranoR14EliteHold(withLateranoNativePairs(contactTeamLateSix)),
  'team27-support-singles': withLateranoSupportSingles(bladeSixReady),
  'team27-approach': approach25,
  'team27-contact-team': withRelatedTransfer(withLateranoContactTeam(approach25)),
  'team27-contact-team-lower': contactTeamLower,
  'team27-contact-team-lower-late-six': contactTeamLateSix,
  'team27-contact-team-lower-native-pairs': withLateranoNativePairs(contactTeamLateSix),
  'team27-contact-team-lower-no-reserve': withLateranoUpgradeReserve(contactTeamLower, { lateSixOnly: false }),
  'team27-reduced-swift': withLateranoReducedSwift(bladeSixReady),
  'team27-elite-cap': withLateranoEliteCap(bladeSixReady),
  'team27-medic-chain': medicChain,
  'team27-medic-single': medicSingle,
  'team27-medic-four': medicFour,
  'team27-medic-four-stay': withLateranoFourDevelopment(medicFour),
  'team27-medic-four-stay-r11': medicFourR11,
  'team27-medic-four-stay-r11-protection': withLateranoProtection(medicFourR11),
  'team27-medic-four-stay-r11-local-protection': withLateranoLocalProtection(medicFourR11),
  'team27-medic-four-limit3-local-protection': withLateranoFourLimit(withLateranoLocalProtection(medicFourR11)),
  'vision21-map-lines': withLateranoMapLines(map02),
  'repair19-white-six': gated([6], false, repairWhite19),
  'repair19-white-mostima-five': gated([5], true, repairWhite19),
  'repair19-white-mostima-five-six': gated([5,6], true, repairWhite19) });
