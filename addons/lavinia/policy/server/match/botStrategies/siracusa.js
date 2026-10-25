// 叙拉古: shared core development, then Swift or Arcane/Raid. DESIGN §6.6, META §1.6.
// Sources: existing generated records; user-supplied sub-routes. Community opening reference:
// https://www.bilibili.com/video/BV1YTX5BbEGW (not a verified frame-by-frame script).
// [ASSUMED] All round targets, scores, forecasts and switch margins below are AI policy, not game rules.
// The recipe never picks an opening band, reads future rolls or awards resources itself.
// Chiave's fixed Siracusa commitment is enforced by botStrategy.js before recipe lookup.
import { rotateOffset } from '../../../../../../sim/dir.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { reserveRaidPositions } from '../botRaidPositioning.js';
import { savingsCash, releaseSavings, preserveSavings, bankRemainder } from '../botSavings.js';
import { botSell } from '../botSiracusaSales.js';
import { siracusaAdjustment, investorWindow, investorPurchaseAllowed, trimInvestorCopies, investorCycleValue, afterInvestorPurchase, tradeInvestorGift, useInvestorLiquidity } from '../botInvestorEconomy.js';

const CORE = 'siracusaShip';
const ids = Object.freeze({ provence: 'chess_char_1_07_a', texas: 'chess_char_1_08_a', lappland: 'chess_char_2_16_a',
  tin: 'chess_char_2_19_a', swire: 'chess_char_3_04_a', honeysuckle: 'chess_char_3_18_a', vigil: 'chess_char_3_19_a',
  aroma: 'chess_char_4_10_a', texasAlter: 'chess_char_4_16_a', surtr: 'chess_char_5_07_a', suzuran: 'chess_char_5_10_a',
  angelina: 'chess_char_5_20_a', lapplandAlter: 'chess_char_6_18_a',
  nymph: 'chess_char_5_22_a', degenbrecher: 'chess_char_6_19_a', passenger: 'chess_char_6_05_a', muelsyse: 'chess_char_6_11_a' });
const route = (id, name, supports) => Object.freeze({ id: `${CORE}:${id}`, name, strategyName: '叙拉古', core: CORE,
  coreMembers: 6, support: supports[0], supports: Object.freeze(supports), supportMembers: 2 });
const swift = route('swift', '迅捷', ['swiftShip']);
const arcaneRaid = route('arcane-raid', '奥术突袭', ['arcaneShip', 'raidShip']);
const routes = Object.freeze([swift, arcaneRaid]);
// [ASSUMED] Start with Swift; Arcane/Raid is a pivot after actually acquiring Surtr.
// Match option exists for controlled botbench comparisons, not as a gameplay setting.
const arcaneWeight = (m) => m.opts?.botSiracusaArcaneWeight ?? 0.65;
const gdOf = (m, ps) => ps.gd || m.gd;
const baseOf = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const owned = (gd, ps, id) => ps.allChess().filter((p) => baseOf(gd, p) === id);
const has = (gd, ps, id) => owned(gd, ps, id).length > 0;
const enginePolicy = (m, part) => m.opts?.botSiracusaEngines === true
  || Array.isArray(m.opts?.botSiracusaEngines) && m.opts.botSiracusaEngines.includes(part);
const traits = (gd, rec) => (rec?.garrisonIds || []).map((id) => gd.garrison(id)).filter(Boolean);
const active = (gd, id) => !!gd.bond(id) && !gd.modeInactiveBonds.has(id);
const nativeMiraclePair = (gd, ps) => has(gd, ps, ids.vigil) && has(gd, ps, ids.angelina);
const miracleHelpers = (gd, ps) => [...new Set(ps.allChess().filter((p) => {
  const rec = gd.chess(p.id);
  return rec?.bonds.includes('miraShip') && !rec.bonds.includes(CORE);
}).map((p) => baseOf(gd, p)))].sort((a, b) => gd.chess(a).tier - gd.chess(b).tier || a.localeCompare(b));

function routeScores(m, ps, counts) {
  const gd = gdOf(m, ps), present = (id) => has(gd, ps, ids[id]);
  const investors = investorWindow(m, ps) ? counts.get('investShip') || 0 : 0;
  const swiftLayers = ps.layers.swiftShip || 0;
  const arcaneLayers = ps.layers.arcaneShip || 0, raidLayers = ps.layers.raidShip || 0;
  // Incomplete investment is not an engine. Below Swift's actual 40-layer milestone at R9 is a development warning.
  const stalled = m.round >= 9 && investors < 3 && swiftLayers < 40;
  return {
    [swift.id]: Number(present('honeysuckle')) * 15 + Number(present('suzuran') && present('honeysuckle')) * 12
      + Math.min(3, investors) * 6 + Number(investors >= 3) * 12 + Math.min(32, swiftLayers / 5) - Number(stalled) * 12,
    [arcaneRaid.id]: Number(present('aroma')) * 14 + Number(present('texasAlter')) * 8 + Number(present('surtr')) * 18
      + Number((counts.get('arcaneShip') || 0) >= 2) * 5 + Number((counts.get('raidShip') || 0) >= 2) * 5
      + Math.min(32, (arcaneLayers + raidLayers) / 7),
  };
}

/** No random draws after initialisation; a switch needs a 12-point lead on two rounds, and a 3-round cooldown. */
function selectRoute(m, ps, counts) {
  const gd = gdOf(m, ps), available = routes.filter((r) => (r !== arcaneRaid || arcaneWeight(m) > 0)
    && r.supports.every((id) => active(gd, id)));
  if (!available.length) return null;
  const scores = routeScores(m, ps, counts);
  let current = available.find((r) => r.id === ps._botRoute?.id);
  const state = ps._botSiracusa ||= { since: m.round, observed: -1, challenger: null, aheadSince: null };
  if (!current) {
    // Preserve the existing single RNG draw without gambling the low-tier opening on a future five-tier engine.
    current = available.find((r) => r === swift)
      ?? (has(gd, ps, ids.surtr) ? available.find((r) => r === arcaneRaid) : null);
    if (!current) return null;
    m.rngBots();
    state.since = m.round; state.challenger = null; state.aheadSince = null;
  } else if (state.observed !== m.round) {
    const alternative = available.find((r) => r !== current && (r !== arcaneRaid || has(gd, ps, ids.surtr))
      && scores[r.id] * (r === arcaneRaid ? arcaneWeight(m) : 1) >= scores[current.id] + 12);
    if (!alternative) { state.challenger = null; state.aheadSince = null; }
    else {
      if (state.challenger !== alternative.id) { state.challenger = alternative.id; state.aheadSince = m.round; }
      if (m.round - state.since >= 3 && m.round > state.aheadSince) {
        current = alternative; state.since = m.round; state.challenger = null; state.aheadSince = null;
      }
    }
  }
  state.observed = m.round;
  return current;
}

/** Only 贾维 can farm low-tier guaranteed gifts. Other bands must not be trapped at level two. */
function isChiave(m, ps) {
  const gd = gdOf(m, ps);
  return gd.band(ps.bandId)?.buffs?.some((b) => b.key === 'refresh_shop_count_gain_coin_bond_char_chess' && b.bbStr?.bond === CORE);
}

function coreCount(gd, ps) {
  return new Set(ps.allChess().filter((p) => pieceBonds(gd, p).includes(CORE)).map((p) => baseOf(gd, p))).size;
}

const isDress = (rec) => rec?.giveBondId === CORE;
const hasAttunement = (gd, ps) => ps.allChess().some((p) => !gd.chess(p.id)?.bonds.includes(CORE) && pieceBonds(gd, p).includes(CORE));
const developedSwift = (gd, ps) => (ps.layers.swiftShip || 0) >= 40 && has(gd, ps, ids.honeysuckle);
const hybridReady = (gd, ps) => developedSwift(gd, ps) && has(gd, ps, ids.surtr) && (ps.deployCap >= 9 || hasAttunement(gd, ps));
const wantsThirdArcane = (gd, ps, plan) => plan.route?.id === arcaneRaid.id || hybridReady(gd, ps);
const storedItems = (ps) => [...ps.hand, ...ps.temp].filter((p) => p?.kind === 'item');
const sameBondRecruit = (rec) => rec?.buffs?.some((b) => b.key === 'use_equip_reward_char_chess_with_same_bond');
const pureCoreCarrier = (gd, ps) => ps.allChess().filter((p) => {
  const bonds = pieceBonds(gd, p); return bonds.length === 1 && bonds[0] === CORE;
}).sort((a, b) => (a.items?.length || 0) - (b.items?.length || 0)
  || Number(baseOf(gd, b) === ids.lappland) - Number(baseOf(gd, a) === ids.lappland) || a.uid - b.uid)[0];
const attunementCarry = (gd, ps) => ps.allChess().filter((p) => [ids.surtr, ids.degenbrecher, ids.passenger, ids.nymph].includes(baseOf(gd, p))
  && !pieceBonds(gd, p).includes(CORE)).sort((a, b) => {
  const score = (p) => gd.chess(p.id).tier * 10 + (gd.isGolden(p.id) ? 18 : 0)
    + ((p.items || []).some((it) => isDress(gd.item(it.id)) || gd.item(it.id)?.canGiveBond) ? 100 : 0)
    + (ps._botRoute?.id === arcaneRaid.id && baseOf(gd, p) === ids.surtr ? 30 : 0)
    + (ps._botRoute?.id === swift.id && baseOf(gd, p) === ids.degenbrecher ? 30 : 0);
  return score(b) - score(a) || a.uid - b.uid;
})[0];

/** Two real locked equipment slots; replace ordinary gear legally, never move an equipped item to another unit. */
function useAttunement(m, ps, itemAllowed = () => true) {
  const gd = gdOf(m, ps);
  if (hasAttunement(gd, ps)) return;
  const target = attunementCarry(gd, ps);
  if (!target) return;
  const worn = () => (target.items || []).map((it) => gd.item(it.id));
  if (![isDress, (rec) => rec?.canGiveBond].every((matches) => worn().some(rec => matches(rec) && itemAllowed(rec))
    || storedItems(ps).some((p) => matches(gd.item(p.id)) && itemAllowed(gd.item(p.id))))) return;
  for (const matches of [isDress, (rec) => rec?.canGiveBond]) {
    for (let guard = 0; guard < 3 && !worn().some(matches); guard++) {
      const item = storedItems(ps).find((p) => matches(gd.item(p.id)));
      if (!item) break;
      const replace = (target.items || []).filter((it) => !isDress(gd.item(it.id)) && !gd.item(it.id)?.canGiveBond)
        .sort((a, b) => (gd.item(a.id)?.tier || 0) - (gd.item(b.id)?.tier || 0) || a.uid - b.uid)[0];
      if (!ps.equip(item.uid, target.uid, replace?.uid ?? null)?.ok) break;
    }
  }
}

function availableThrough(m, ps, tier) {
  const gd = gdOf(m, ps);
  return gd.bond(CORE).members.filter((id) => gd.chess(id)?.tier <= tier && (m.pool.left(id) > 0 || has(gd, ps, id))).length;
}

function stagingRound(m, ps) { return ps.lp <= 12 || availableThrough(m, ps, 2) < 3 ? 5 : 7; }

function nextFunds(m, ps) {
  return gdOf(m, ps).income(m.round + 1) + ps.pendingFunds
    + ps.effects.filter((e) => e.key === 'effect:builtin_round_coin').reduce((sum, e) => sum + (e.params?.count || 0), 0);
}

function needsStagingUpgrade(m, ps) {
  const gd = gdOf(m, ps);
  return nextFunds(m, ps) < Math.max(0, ps.shop.upgradePrice - 1) + gd.upgradeBase(3) + gd.refreshPrice;
}

/** Bounded search for an acquired engine, never a prediction that a missing high-tier carry will arrive. */
function pendingEngine(m, ps) {
  const gd = gdOf(m, ps);
  const keys = has(gd, ps, ids.surtr) ? [ids.aroma] : ps._botRoute?.id === swift.id ? [ids.honeysuckle] : [];
  return keys.find((id) => {
    const copies = owned(gd, ps, id);
    return copies.length > 0 && !copies.some((p) => gd.isGolden(p.id)) && m.pool.left(id) > 0
      && (id === ids.aroma || copies.length >= 2 || ps.bonds.investShip?.active);
  });
}


/** [ASSUMED] Finish the current acquired engine, with explicit round deadlines; never wait for an unowned carry. */
function stageIncomplete(m, ps) {
  if (!isChiave(m, ps)) return false;
  const gd = gdOf(m, ps);
  if (ps.shop.level === 3 && m.round < 8 && coreCount(gd, ps) < 5
    && availableThrough(m, ps, 3) >= 5) return true;
  if (ps.shop.level !== 5 || m.round >= gd.bossRound) return false;
  const keys = ps._botRoute?.id === swift.id ? [ids.aroma, ids.honeysuckle] : [ids.aroma];
  return keys.some((id) => {
    const copies = owned(gd, ps, id);
    return copies.length > 0 && !copies.some((p) => gd.isGolden(p.id)) && m.pool.left(id) > 0;
  });
}

/** [ASSUMED] Owner's R14+ exception, evaluated on the existing policy's proposed fielded set. */
function lateSixMature(m, ps, fielded = null) {
  const gd = gdOf(m, ps);
  const units = fielded || [...ps.board.values()].filter((p) => p?.kind === 'chess');
  const core = units.filter((p) => pieceBonds(gd, p).includes(CORE));
  if (new Set(core.map((p) => baseOf(gd, p))).size < 6 || core.some((p) => !gd.isGolden(p.id))) return false;
  const supports = ps._botRoute?.id === swift.id ? swift.supports : arcaneRaid.supports;
  return units.filter((p) => gd.chess(p.id)?.tier === 5 && pieceBonds(gd, p).some((b) => supports.includes(b)))
    .every((p) => gd.isGolden(p.id));
}

function levelTarget(m, ps, { spare = false, fielded = null } = {}) {
  const gd = gdOf(m, ps);
  if (!isChiave(m, ps)) return null;
  // [ASSUMED] Owner's R14+ factor: reinforce five instead of purchasing six; earlier six remains legal.
  if (m.round >= gd.bossRound && ps.shop.level === 5 && !lateSixMature(m, ps, fielded)) return 5;
  if (stageIncomplete(m, ps)) return ps.shop.level;
  const r = m.round;
  // The R8 income cannot fund 2->3->4 plus a useful shop. Pay 2->3 at the END of R7, retaining the low-tier rolls.
  if (r < 2) return 1;
  const staging = stagingRound(m, ps);
  if (r < staging) return 2;
  if (r === staging) return spare && needsStagingUpgrade(m, ps) ? 3 : 2;
  if (r < 10) return 4;
  if (enginePolicy(m, 'tempo') && ps.shop.level === 4 && r <= 11 && ps.lp > 8 && pendingEngine(m, ps)) return 4;
  // Spend at least two preps actually searching level four; don't immediately pay the next upgrade with the money.
  if (ps.shop.level === 4 && m.round - (ps._botFourAt ?? 8) < 2) return 4;
  if (r === 10 && coreCount(gd, ps) < 6 && availableThrough(m, ps, 4) >= 6) return 4;
  if (r < 12) return 5;
  const swiftReady = has(gd, ps, ids.honeysuckle) && [ids.suzuran, ids.nymph, ids.degenbrecher].some((id) => has(gd, ps, id))
    && (ps.layers.swiftShip || 0) >= 40;
  const arcaneReady = has(gd, ps, ids.aroma) && has(gd, ps, ids.texasAlter) && has(gd, ps, ids.surtr);
  return coreCount(gd, ps) >= 6 && (ps._botRoute?.id === swift.id ? swiftReady : arcaneReady) ? 6 : 5;
}

function spendReserve(m, ps) {
  if (enginePolicy(m, 'tempo') && ps.shop.level === 1 && readyForUpgrade(m, ps)
    && ps.funds >= ps.shop.upgradePrice) return ps.shop.upgradePrice;
  if (!isChiave(m, ps) || ps.allChess().length < 6) return 0;
  const price = Math.max(0, ps.shop.upgradePrice);
  if (ps.shop.level === 2) return m.round === stagingRound(m, ps) && needsStagingUpgrade(m, ps) && ps.funds >= price ? price : 0;
  const budget = price + upgradeReserve(m, ps);
  return ps.shop.level < Math.min(5, levelTarget(m, ps)) && ps.funds >= budget ? budget : 0;
}

// [ASSUMED] Budget ablation of the same readiness condition.
function upgradeReserve() { return 0; }

function criticalBuy(m, ps, rec, plan) {
  const gd = gdOf(m, ps);
  if (enginePolicy(m, 'promotion') && rec && baseOf(gd, rec) === ids.lappland && ps.shop.level === 2
    && m.round >= stagingRound(m, ps) && needsStagingUpgrade(m, ps)
    && ps.funds < ps.shop.upgradePrice + gd.chessPrice(rec.chessId)) return false;
  if (enginePolicy(m, 'promotion') && rec && [ids.lappland, ids.aroma, ids.honeysuckle].includes(baseOf(gd, rec))
    && m.round < gd.bossRound && !owned(gd, ps, baseOf(gd, rec)).some((p) => gd.isGolden(p.id))
    && ps.completesChessMerge(rec.chessId)) return true;
  if (rec && baseOf(gd, rec) === ids.lappland && ps.shop.level === 2 && m.round <= stagingRound(m, ps)) return true;
  if (!rec || has(gd, ps, baseOf(gd, rec))) return false;
  if (rec.bonds.includes(CORE) && coreCount(gd, ps) < 3) return true;
  if (baseOf(gd, rec) === ids.angelina && ps.shop.level >= 4 && m.round < gd.bossRound) return true;
  if (m.round >= 8 && rec.bonds.includes(CORE) && coreCount(gd, ps) < 6) return true;
  if (wantsThirdArcane(gd, ps, plan) && rec.bonds.includes('arcaneShip')
    && new Set(ps.allChess().filter((p) => pieceBonds(gd, p).includes('arcaneShip')).map((p) => baseOf(gd, p))).size === 2) return true;
  if (hybridReady(gd, ps) && [ids.nymph, ids.degenbrecher].includes(baseOf(gd, rec))) return true;
  if (plan.route?.id === arcaneRaid.id) return [ids.aroma, ids.texasAlter, ids.surtr].includes(baseOf(gd, rec))
    || rec.bonds.includes('raidShip') && (ps.bonds.raidShip?.count || 0) === 1;
  return [ids.honeysuckle, ids.suzuran].includes(baseOf(gd, rec))
    || m.round >= 9 && [ids.nymph, ids.degenbrecher].includes(baseOf(gd, rec))
    || investorWindow(m, ps) && rec.bonds.includes('investShip') && (ps.bonds.investShip?.count || 0) === 2;
}

function beforeUpgrade(m, ps, plan) {
  const gd = gdOf(m, ps);
  if (isChiave(m, ps) && m.round >= gd.bossRound && ps.shop.level === 5 && !lateSixMature(m, ps, plan?.fielded)) return false;
  if (stageIncomplete(m, ps)) return false;
  return !ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds && criticalBuy(m, ps, gd.chess(s.id), plan));
}

function priorityLevel(m, ps) {
  return isChiave(m, ps) && (readyForUpgrade(m, ps) || m.round >= 6)
    && ps.shop.level < Math.min(5, levelTarget(m, ps));
}

/** A healthy two-unit opening may trade LP for earlier access to the two-tier core; not a universal clear claim. */
function readyForUpgrade(m, ps) {
  if (!enginePolicy(m, 'tempo') || !isChiave(m, ps) || ps.shop.level !== 1 || m.round < 2 || ps.lp < 16) return false;
  const recs = ps.allChess().map((p) => gdOf(m, ps).chess(p.id));
  return recs.some((r) => r.profession === 'TANK' && r.stats.blockCnt >= 2)
    && recs.some((r) => r.position === 'RANGED' && !['heal', 'none'].includes(r.attackKind));
}

function dollKind(gd, rec) {
  if (!rec || gd.baseIdOf(rec.id) == null) return null;
  if (rec.buffs?.some((b) => b.key === 'gain_coin_when_round_start')) return 'permanent';
  if (rec.buffs?.some((b) => b.key === 'use_equip_gain_coin_when_next_round_start')) return 'next';
  return null;
}

function itemBonus(m, ps, rec) {
  const gd = gdOf(m, ps), kind = dollKind(gd, rec);
  if (sameBondRecruit(rec) && ps.shop.level < 4 && pureCoreCarrier(gd, ps)
    && gd.bond(CORE).members.some((id) => gd.chess(id)?.tier <= ps.shop.level && m.pool.left(id) > 0)) return 65;
  if (developedSwift(gd, ps) && has(gd, ps, ids.surtr) && ps.deployCap < 9
    && rec?.buffs?.some((b) => b.key === 'equip_destory_deployment_cnt_change')) return 24;
  if (!hasAttunement(gd, ps)) {
    if (isDress(rec) && coreCount(gd, ps) >= 3 && !storedItems(ps).some((p) => isDress(gd.item(p.id)))) return 18;
    if (rec?.canGiveBond && !storedItems(ps).some((p) => gd.item(p.id)?.canGiveBond)) return 24;
  }
  return ps.shop.level <= 2 && kind ? kind === 'permanent' ? 70 : 55 : 0;
}

function holdItem(m, ps, rec) {
  if (sameBondRecruit(rec)) return true; // Dedicated useEconomy path accepts ONLY a pure Siracusa carrier, including bench.
  if (savingsCash(rec) && m.round < gdOf(m, ps).bossRound) return true;
  if ((isDress(rec) || rec?.canGiveBond) && !hasAttunement(gdOf(m, ps), ps)) return true;
  return dollKind(gdOf(m, ps), rec) === 'next' && ps.shop.level < 4 && m.round < stagingRound(m, ps);
}

function itemReplacement(m, ps, rec, target) {
  const gd = gdOf(m, ps);
  if (preserveSavings(m, ps, gd.chess(target.id))) return false;
  // Even consume-on-equip items destroy gear on a full carrier. Never accidentally dismantle the core membership.
  return !gd.chess(target.id)?.bonds.includes(CORE) && pieceBonds(gd, target).includes(CORE) ? false : null;
}

/** The 3-cost doll is consumed immediately; every retained 1-cost doll (including merged elites) funds the leap. */
function useEconomy(m, ps, options = {}) {
  releaseSavings(m, ps);
  useInvestorLiquidity(m, ps, (rec) => criticalBuy(m, ps, rec, { route: ps._botRoute }) || ps.completesChessMerge(rec.chessId));
  useAttunement(m, ps, options.itemAllowed);
  const gd = gdOf(m, ps);
  for (const item of storedItems(ps)) {
    if (!sameBondRecruit(gd.item(item.id)) || !ps.find(item.uid)) continue;
    const carrier = pureCoreCarrier(gd, ps);
    if (!carrier) continue;
    const replace = (carrier.items || []).slice().sort((a, b) => (gd.item(a.id)?.tier || 0) - (gd.item(b.id)?.tier || 0))[0];
    if (ps.equip(item.uid, carrier.uid, replace?.uid ?? null)?.ok) {
      const stats = ps._botRecipeStats ||= {}; stats.sameBondRecruits = (stats.sameBondRecruits || 0) + (gd.item(item.id)?.params?.count || 1);
    }
  }
  for (const item of [...ps.hand, ...ps.temp]) {
    if (!item || item.kind !== 'item' || !ps.find(item.uid)) continue;
    const rec = gd.item(item.id), kind = dollKind(gd, rec);
    if (!kind || holdItem(m, ps, rec)) continue;
    const carrier = ps.allChess().find((p) => (p.items?.length || 0) < gd.equipPerChess);
    if (!carrier) continue;
    const result = ps.equip(item.uid, carrier.uid);
    if (result?.ok) {
      const stats = ps._botRecipeStats ||= {};
      const key = kind === 'permanent' ? 'permanentDolls' : 'leapDolls';
      stats[key] = (stats[key] || 0) + (rec.params?.count || 0);
    }
  }
}

function liquidity(m, ps) {
  useInvestorLiquidity(m, ps, (rec) => criticalBuy(m, ps, rec, { route: ps._botRoute }) || ps.completesChessMerge(rec.chessId));
}

function buyBonus(m, ps, rec, plan, counts) {
  const gd = gdOf(m, ps), id = baseOf(gd, rec), isNew = !has(gd, ps, id);
  let value = investorCycleValue(m, ps, rec);
  if (enginePolicy(m, 'promotion') && !rec.isGolden && m.round < gd.bossRound) {
    const copies = owned(gd, ps, id);
    // Activate the three-member engine before spending the opening on duplicate promotion components.
    if (isNew && rec.bonds.includes(CORE) && coreCount(gd, ps) < 3) value += 30;
    if (!copies.some((p) => gd.isGolden(p.id))) {
      if (id === ids.lappland && coreCount(gd, ps) >= 3 && ps.shop.level <= 2 && m.round < stagingRound(m, ps)) value += copies.length ? 24 : 10;
      if (id === ids.aroma && has(gd, ps, ids.surtr)) value += copies.length ? 30 : 16;
      if (id === ids.honeysuckle && copies.length && ps.shop.level === 4 && ps._botRoute?.id === swift.id) value += 14;
    }
  }
  if (isNew && m.round >= 8 && rec.bonds.includes(CORE) && coreCount(gd, ps) < 6) value += 24;
  if (id === ids.lappland && m.round <= 10) value += 18;
  if ([ids.provence, ids.texas].includes(id) && ps.shop.level <= 2) value += 10;
  if ([ids.angelina, ids.lapplandAlter].includes(id)) value += 18;
  // The six-tier engine is available through level-five merges, not only a level-six shop.
  if (id === ids.lapplandAlter) value += isNew ? 60 : 24;
  if (id === ids.muelsyse && isNew && !hasAttunement(gd, ps)
    && storedItems(ps).some((p) => isDress(gd.item(p.id)))) value += 20;
  if ([ids.provence, ids.texas].includes(id) && owned(gd, ps, id).some((p) => gd.isGolden(p.id))) value += 14;
  // Four-tier merge offers can already contain Angelina. Secure the first refresh engine before Suzuran support.
  if (id === ids.angelina && isNew && ps.shop.level >= 4 && m.round < gd.bossRound) value += 36;
  // Elite ownership does not replace the first-refresh income of another Lappland on the bench.
  if (id === ids.lappland && ps.shop.level === 2 && m.round <= stagingRound(m, ps)) value += 24;
  // Acquire a visible bridge BEFORE requiring its presence for a route switch; otherwise the lineup gate can
  // reject the very Surtr that would complete Arcane/Raid while an unfinished investment route remains selected.
  if (id === ids.surtr && plan.route?.id === swift.id && !ps.bonds.investShip?.active
    && has(gd, ps, ids.aroma) && has(gd, ps, ids.texasAlter)) value += 20;
  if (isNew && rec.bonds.includes('arcaneShip') && counts.get('arcaneShip') === 2 && wantsThirdArcane(gd, ps, plan)) value += 26;
  if (plan.route?.id !== swift.id && (hybridReady(gd, ps) || enginePolicy(m, 'hybrid') && developedSwift(gd, ps))
    && m.round >= 9 && [ids.nymph, ids.degenbrecher].includes(id)) value += isNew ? 36 : 12;
  if (plan.route?.id === swift.id) {
    if (id === ids.honeysuckle) value += 22;
    if (id === ids.suzuran && has(gd, ps, ids.honeysuckle)) value += 22;
    if (isNew && investorWindow(m, ps) && rec.bonds.includes('investShip') && (counts.get('investShip') || 0) < 3) value += 20;
    if (m.round >= 9 && [ids.nymph, ids.degenbrecher].includes(id)) value += isNew ? 36 : 12;
  } else {
    if (id === ids.aroma) value += 24;
    if (id === ids.texasAlter) value += 16;
    if (id === ids.surtr) value += 30;
    // A functional secondary bond is better than waiting for one exact five-tier card to appear.
    if (isNew && rec.bonds.includes('raidShip') && (counts.get('raidShip') || 0) < 2) value += 20;
    if (isNew && rec.bonds.includes('arcaneShip') && (counts.get('arcaneShip') || 0) < 2) value += 14;
  }
  if (isNew && rec.bonds.includes('miraShip')) {
    if (rec.bonds.includes(CORE) && (counts.get('miraShip') || 0) === 1) value += 10;
    // One inexpensive bench bridge, usually Kazemaru. Both native members replace it without extra board slots.
    if (!rec.bonds.includes(CORE) && active(gd, 'miraShip') && m.round <= 9 && ps.shop.level <= 4
      && !nativeMiraclePair(gd, ps) && miracleHelpers(gd, ps).length === 0) {
      value += (counts.get('miraShip') || 0) === 1 ? 20 : 8;
    }
  }
  return value;
}

function unitBonus(m, ps, rec, plan) {
  const gd = gdOf(m, ps), id = baseOf(gd, rec);
  let value = 0;
  if (siracusaAdjustment(m, 'air') && plan.model?.flyTotal > 0 && !plan.model.ground.size && !plan.model.bossBodies.length
    && !rec.canHitFly && rec.attackKind !== 'heal' && rec.attackKind !== 'none') value -= 24;
  if (id === ids.lappland && m.round <= 9) value += rec.isGolden ? 20 : 10;
  if (id === ids.aroma && m.round < gd.bossRound) value += rec.isGolden ? 16 : 10;
  if (id === ids.angelina && m.round < gd.bossRound) value += rec.isGolden ? 24 : 18;
  if (id === ids.lapplandAlter) value += rec.isGolden ? 40 : 18;
  if (id === ids.texasAlter && m.round < gd.bossRound) value += rec.isGolden ? 8 : 4;
  if (plan.route?.id === swift.id || hybridReady(gd, ps) || enginePolicy(m, 'hybrid') && developedSwift(gd, ps)) {
    if (id === ids.honeysuckle) value += 10;
    if (id === ids.suzuran && has(gd, ps, ids.honeysuckle)) value += 16;
    if (m.round >= 9) {
      if ([ids.nymph, ids.degenbrecher].includes(id)) value += (ps.layers.swiftShip || 0) >= 40 ? 36 : 24;
      // A developed late carry takes the external Swift slot; Honeysuckle remains a core/layer engine.
      if (rec.bonds.includes('swiftShip') && !rec.bonds.includes(CORE) && rec.tier < 5
        && [ids.nymph, ids.degenbrecher].some((carry) => has(gd, ps, carry))) value -= 24;
    }
  }
  if (plan.route?.id === arcaneRaid.id && id === ids.surtr) value += 24;
  if (replacementCandidates(m, ps, plan).has(id)) value -= 35;
  return value;
}

/** Board replacement preference, separate from keeping Lappland's bench trigger alive until the leader prep. */
function replacementCandidates(m, ps, plan) {
  const gd = gdOf(m, ps);
  const bases = new Set(ps.allChess().filter((p) => pieceBonds(gd, p).includes(CORE)).map((p) => baseOf(gd, p)));
  const raidMembers = new Set(ps.allChess().filter((p) => gd.chess(p.id)?.bonds.includes('raidShip')).map((p) => baseOf(gd, p)));
  const preserveRaid = (ps.layers.raidShip || 0) >= 50 && raidMembers.size === 2 && raidMembers.has(ids.texasAlter);
  const order = [ids.provence, ids.texas, ids.vigil,
    ...(plan.route?.id === arcaneRaid.id || preserveRaid ? [ids.lappland] : [ids.texasAlter, ids.lappland])];
  return new Set(order.filter((id) => bases.has(id)).slice(0, Math.max(0, bases.size - 6)));
}

function keep(m, ps, rec, plan) {
  if (!rec) return false;
  if (preserveSavings(m, ps, rec)) return true;
  const gd = gdOf(m, ps);
  if (plan.route?.id === swift.id && investorWindow(m, ps) && rec.bonds.includes('investShip')) return true;
  if (!rec.bonds.includes('miraShip')) return false;
  return rec.bonds.includes(CORE) || !nativeMiraclePair(gd, ps) && miracleHelpers(gd, ps)[0] === baseOf(gd, rec);
}

/** Keep every Lappland (normal and elite) until the leader prep; each copy can stack from the bench. */
function preserve(m, ps, rec) {
  if (!rec) return false;
  if (preserveSavings(m, ps, rec)) return true;
  return baseOf(gdOf(m, ps), rec) === ids.lappland && m.round < gdOf(m, ps).bossRound;
}

function giftProgress(m, ps) {
  const gd = gdOf(m, ps);
  const gift = gd.band(ps.bandId)?.buffs?.find((b) => b.key === 'refresh_shop_count_gain_coin_bond_char_chess');
  if (!gift) return null;
  const granted = ps.counters['band:chiave:r'] === m.round ? ps.counters['band:chiave'] || 0 : 0;
  if (granted >= (gift.bb.max_count || 2)) return null;
  if (!gd.bond(CORE).members.some((id) => gd.chess(id)?.tier <= ps.shop.level && m.pool.left(id) > 0)) return null;
  const every = gift.bb.refresh_count || 6;
  return every - (ps.counters['band:chiave:refreshes'] || 0) % every;
}

/** Purchase-only budget: actual cumulative gift progress and an untriggered Lappland must survive item shopping. */
function purchaseReserve(m, ps) {
  const gd = gdOf(m, ps);
  if (ps.allChess().length < ps.deployCap && !ps.bonds[CORE]?.active) return 0;
  let rolls = 0;
  const nextGift = ps.shop.level === 2 ? giftProgress(m, ps) : null;
  // Do not replace early combat upgrades with six blind rerolls; protect only an immediately payable gift.
  if (nextGift === 1) rolls = 1;
  if (ps.bonds[CORE]?.active && owned(gd, ps, ids.lappland).some((p) =>
    ps.pieceRoundCount(p, 'garrison:SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT:refreshes') < 1)) rolls = Math.max(rolls, 1);
  const base = spendReserve(m, ps);
  const cost = Math.max(0, rolls - ps.shop.freeRefreshes) * gd.refreshPrice;
  return ps.funds >= base + cost ? base + cost : base;
}

/** Guaranteed gift progress and existing refresh traits justify spending the last otherwise-lost funds. */
function refreshValue(m, ps) {
  const gd = gdOf(m, ps);
  if (giftProgress(m, ps)) return 6;
  if (ps.round.refreshes < 3 && ps.bonds[CORE]?.active && [ids.aroma, ids.angelina].some((id) => owned(gd, ps, id).some((p) => ps.find(p.uid)?.area === 'board'))) return 4;
  return 0;
}

/** Sell redundant unequipped normals, preserving early merge opportunities and the sole core/engine representative. */
function trade(m, ps, plan) {
  const before = ps.allChess().length;
  trimInvestorCopies(m, ps);
  if (ps.allChess().length < before) return true;
  if (siracusaAdjustment(m, 'economy') && tradeInvestorGift(m, ps)) return true;
  const gd = gdOf(m, ps), candidates = [...ps.temp, ...ps.hand].filter((p) => p?.kind === 'chess' && !gd.isGolden(p.id) && !p.items?.length);
  for (const p of candidates) {
    const id = baseOf(gd, p), copies = owned(gd, ps, id);
    if (copies.length < 2) continue;
    const hasElite = copies.some((q) => gd.isGolden(q.id));
    const refreshNeeded = id === ids.texas && ps.funds === 0 && ps.shop.freeRefreshes === 0 && ps.bonds[CORE]?.active
      && (giftProgress(m, ps) === 1 || owned(gd, ps, ids.lappland).some((p) => ps.pieceRoundCount(p, 'garrison:SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT:refreshes') < 1));
    const freeCycle = [ids.provence, ids.texas].includes(id) && hasElite || refreshNeeded;
    const layerCycle = id === ids.honeysuckle && plan.route?.id === swift.id && ps.bonds.investShip?.active
      && (ps.layers.swiftShip || 0) < 229 && (hasElite || m.round >= 11);
    if (!freeCycle && !layerCycle) continue;
    const result = botSell(m, ps, p.uid);
    if (result && !result.error) {
      const stats = ps._botRecipeStats ||= { refreshTrades: 0, layerTrades: 0 };
      const key = freeCycle ? 'refreshTrades' : 'layerTrades';
      stats[key] = (stats[key] || 0) + 1;
      return true;
    }
  }
  return false;
}

function cycleValue(m, ps, rec, plan) {
  const gd = gdOf(m, ps), id = baseOf(gd, rec);
  if (rec.isGolden) return 0;
  const investment = investorCycleValue(m, ps, rec);
  if (investment) return investment;
  if (id === ids.lappland && ps.shop.level === 2 && m.round <= stagingRound(m, ps)) return 24;
  if ([ids.provence, ids.texas].includes(id) && owned(gd, ps, id).some((p) => gd.isGolden(p.id))) return 12;
  if (id !== ids.honeysuckle || plan.route?.id !== swift.id || !ps.bonds.investShip?.active || (ps.layers.swiftShip || 0) >= 229) return 0;
  return 22;
}

function lineupBonus(gd, pieces, bonds, plan) {
  let value = 0;
  if (bonds[CORE]?.active && plan.ps?.shop.level <= 2) value += 24;
  if (plan.route?.id === arcaneRaid.id) {
    if (bonds.arcaneShip?.active) value += 18;
    if (bonds.raidShip?.active) value += 18;
  } else if (bonds.swiftShip?.active) value += 12;
  // Three Arcane unlock the stronger low-HP amplification. A mature hybrid can retain Swift alongside it.
  if (bonds.arcaneShip?.count >= 3 && (plan.route?.id === arcaneRaid.id || bonds.swiftShip?.active && bonds.swiftShip.layers >= 40)) value += 30;
  // Keep the real team-wide milestones active even when they are outside the currently selected sub-route.
  if (bonds.raidShip?.active && bonds.raidShip.layers >= 50) value += 35;
  if (bonds.swiftShip?.active && bonds.swiftShip.layers >= 40) value += 25;
  if (plan.enginePolicy && bonds.swiftShip?.active) value += Math.min(50, (bonds.swiftShip.layers || 0) * 0.35);
  const bases = new Set(pieces.map((p) => baseOf(gd, p)));
  if (plan.route?.id === swift.id && bases.has(ids.suzuran) && bases.has(ids.honeysuckle)) value += 20;
  return value;
}

function layoutValue(gd, units, plan, bonds) {
  if (plan.route?.id !== swift.id && !(plan.enginePolicy && bonds.swiftShip?.active)) return 0;
  const at = new Map(units.map((u) => [u.key, u]));
  const repeats = bonds.investShip?.active ? (bonds.investShip.layers >= 100 ? 3 : 2) : 1;
  let layers = 0;
  for (const u of units) {
    if (baseOf(gd, u.rec) !== ids.suzuran) continue;
    for (let step = 1; step <= (u.rec.isGolden ? 2 : 1); step++) {
      const [dr, dc] = rotateOffset(0, step, u.dir), other = at.get(`${u.r + dr},${u.c + dc}`);
      if (other && baseOf(gd, other.rec) === ids.honeysuckle) {
        const gain = traits(gd, other.rec).find((g) => g.eventType === 'SERVER_GAIN' && g.effectKey === 'SERVER_ADD_BOND_CHESS_ALL');
        layers += (gain?.bb.count || 0) * repeats;
      }
    }
  }
  return Math.min(3, layers * 0.09);
}

export const siracusa = Object.freeze({ lateUpgradeLineup: true, lateSixMature, name: '叙拉古', core: CORE, spendAllFunds: true, routes, ids, selectRoute, routeScores, levelTarget,
  buyBonus, unitBonus, keep, refreshValue, trade, cycleValue, lineupBonus, layoutValue, spendReserve, upgradeReserve,
  criticalBuy, beforeUpgrade, priorityLevel, readyForUpgrade, itemBonus, holdItem, itemReplacement, useEconomy, preserve, purchaseReserve, replacementCandidates,
  visibleAirOnly: (m) => siracusaAdjustment(m, 'air'),
  purchaseAllowed: investorPurchaseAllowed, cleanupAcquisitions: trimInvestorCopies,
  liquidity, afterPurchase: afterInvestorPurchase, bankRemainder, placementPlan: reserveRaidPositions, pendingEngine });
