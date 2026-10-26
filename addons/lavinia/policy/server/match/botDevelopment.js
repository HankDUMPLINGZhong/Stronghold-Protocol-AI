import { largeBodyCoveragePlan } from './botStrategies/siracusaLargeBodyCoverage.js';
import { coopLucienRightPlan } from './botStrategies/siracusaCoopLucienRight.js';
import { applyControlPositions } from './botStrategies/lateranoControlBoss.js';
import { lucienRightPlan } from './botStrategies/siracusaLucienRight.js';
// server/match/botDevelopment.js — opt-in growth AI (DESIGN §6.6, META §1.6).
// The original bot.js remains the independently selectable legacy implementation.
// Growth commits to a viable core, selects a seeded damage sub-route, and keeps a shared economy objective.
// Buying, lineup seeds, elite promotion and positional planning value repeatable layers from record blackboards.
// All actions still use PlayerState validation; randomness uses the match bot RNG or an isolated derived stream.
// [ASSUMED] Valuation weights, trigger forecasts, opening bias and switch guards are AI heuristics.
// This version inherits the legacy exposure model and bounded layout rehearsal, including its documented limits.

import { GEO } from '../../../../../../shared/constants.js';
import { createRng, deriveSeed } from '../../../../../sim/rng.js';
import { ASPD_MIN } from '../../../../../sim/constants.js';
import { freeSlot, countFree, legalTiles, canPlace, positionClass, placeClass, basePositionClass, parseKey, tileKey, FIELD, pieceDir, boardTileOf, BOSS_MIRROR_COL } from '../../../../board.js';
import { rotateOffset, normDir, mirrorDir, oppositeDir } from '../../../../../sim/dir.js';
import { itemKey } from '../../../../gamedata.js';
import { computeBonds, pieceBonds } from '../../../../bondsMeta.js';
import { botSaleAllowed, botSell, freeSiracusaProtectedSlot } from './botSiracusaSales.js';
import { withBounties, isFlyKey } from '../../../../waves.js';
import { mitigate } from '../../../compat/settlement.js';
import { HOVER_KEYS } from '../../../../../sim/content/enemies.js';
import { attackRangeGrid, loadoutRecord, resolveRecordLoadout } from '../../../../../../shared/loadoutRecord.js';
import { coreTarget, fixedBandCore, openingCore, selectRoute, growthValue, developmentBuy, refreshGrowth, layoutGrowth, promotionGrowth } from './botStrategy.js';
import { coreStrategy, readsTeammateRoster } from './botCoreStrategies.js';
import { economyItemBonus, economyChessBonus, useEconomyItems } from './botEconomy.js';
import { isLineCaster, linePlacementGate, engagementFronts, frontlineCoverage, isFormationAnchor, formationValue, healingTiles, acceptsHealing } from './botPositioning.js';
import { bodyKeys } from '../../../../../sim/body.js';
import { COLS } from '../../../../../sim/constants.js';
import { lateranoLesson, lateranoHealing } from './botStrategies/lateranoTactics.js';
import { createBossRehearsalSteps } from './botBossRehearsal.js';
import { fireControlValue, routeFront } from './botFireControl.js';
import { createForecastSteps } from './botForecast.js';
import { draftSafetyKey, evaluateDraftSafety } from './botStrategies/siracusaDraftSafety.js';

/**
 * Drive a step generator (planLayoutSteps, createRehearsalSteps, arrangeSteps, botPrepBeginSteps …) to its end in one
 * go and return its value — the synchronous form every step generator also has (tools, tests, botPrep).
 */
export function runSteps(gen) {
  let r;
  do r = gen.next(); while (!r.done);
  return r.value;
}

/** Lineup value of each deployed member of the focus bond (up to its top threshold). */
const FOCUS_MEMBER = 8;
/** Value per unit of armour fit (the share of a dealer's damage the round's DEF / RES lets through, armorFit). */
const ARMOR_WEIGHT = 10;
/** Least buy score of a purchase once the board is full (below it the bot refreshes instead). */
const BUY_FULL_MIN = 8;
/**
 * Value of completing an elite (+25 % stats, skill level 7, and the merge's free pick of three tier min(level + 1, 6)
 * chess — worth having for any pair, a cheap one included) and of making a keeper's pair; refreshValue weighs them by
 * the shop odds.
 */
const MERGE_HIT = 36;
const PAIR_HIT = 8;
/** Pairs the bench holds at once while refreshes hunt their third copies (each takes a hand slot or two). */
const MAX_PAIRS = 4;
/** Refreshes per prep at most (funds bound them first). */
const MAX_REFRESHES = 16;
/** Spare bench units kept beyond the lineup at the prep start (pairs first). */
const BENCH_BUDGET = 6;
/** Shop level the bot aims for at the start of round r (index = round). */
const LEVEL_TARGET = [1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 6];
/**
 * AI 托管 of a human with 自选 picks (0.2.0; bots field none): the buy score of one of the player's own slotted pieces —
 * the operator the player chose to field (follow-up #13: under AI 托管 they were rarely bought) — and the 调度中心 is
 * levelled one round earlier for the step that opens a slotted tier (levelUp).
 */
export const DIY_PIECE_BONUS = 12;
const TIER_POWER = [0, 10, 12.5, 15, 18, 21.5, 25];
/** Prep-side 特质 that keep adding bond layers every round / every refresh (a player's main layer engine). */
const RECURRING_TRAIT_EVENTS = new Set(['SERVER_PREP_START', 'SERVER_PREP_FIN', 'SERVER_REFRESH_SHOP']);
const LAYER_TRAIT_RE = /BOND|LAYER/;
const ECON_TRAIT_RE = /GOLD|REFRESH|COIN/;
const DEFAULT_MELEE_RANGE = [[0, 0], [0, 1]];

/**
 * Band pick among the strategies the mode offers (gd.bandIds): weighted by starting LP (sturdier strategies are
 * preferred). Alone, a band that withholds the first rounds' funds (老鲤 "资金暂存": no operator in R1–R2, every enemy
 * leaks) is avoided — only 联防 teammates cover that. A band whose mechanic rides on a bond the mode switches off
 * (gd.bandBondIds ∩ gd.modeInactiveBonds — 标准: 潘格尼尼 <拉特兰>, 克莱门莎 <阿戈尔>, 玛恩纳 <卡西米尔>) weighs 0, never taken
 * (DESIGN §21.26); with every band excluded, the default band. One rng draw per call (deterministic per seed); modes
 * without inactive bonds keep exactly the earlier picks.
 */
export function botPickBand(m, ps) {
  const gd = ps?.gd || m.gd;
  const ids = gd.bandIds();
  if (!ids.length) return gd.defaultBandId;
  const lateFunds = (id) => /暂存/.test(String(gd.band(id)?.desc || ''));
  const offBond = (id) => gd.bandBondIds(id).some((b) => gd.modeInactiveBonds.has(b));
  const pairs = ids.map((id) => [id, offBond(id) ? 0 : Math.max(1, (gd.startLp(id) - 18) ** 2) * (m.isSolo && lateFunds(id) ? 0.02 : 1)]);
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = m.rngBots() * total;
  if (!(total > 0)) return gd.defaultBandId;
  let last = null;
  for (const [id, w] of pairs) {
    if (!(w > 0)) continue;
    last = id;
    r -= w;
    if (r < 0) return id;
  }
  return last;
}

/**
 * 机变 card pick among the untaken indexes (a draft is one family: generateDraft). Bounties (extra enemies in the own
 * next battles) score their expected payout minus the expected LP lost (bountyScore: the enemy against the own board —
 * an expected-value comparison, so a card the board is unlikely to beat is taken only when no better one is offered or
 * its pay outweighs the expected leaks); items by tier and use (an item the bot cannot use is worth little); tactic
 * cards by what they act on (tacticScore: a 盟誓 / 驰援 card on the own bonds, 升华 …). Across families items and team
 * buffs come before bounties.
 */
export function botPickCard(m, ps, cards, available) {
  let best = available[0];
  let bestScore = -Infinity;
  for (const i of available) {
    const c = cards[i];
    if (!c) continue;
    let s = 0;
    if (c.kind === 'item') s = 8 + (c.tier || 1) * 4 + (canUseItem(m, ps, { id: c.id }) ? 0 : -8)
      + Math.max(economyItemBonus(m, ps, (ps.gd || m.gd).item(c.id)), coreStrategy(m, ps._botFocusId)?.itemBonus(m, ps, (ps.gd || m.gd).item(c.id)) || 0);
    else if (c.kind === 'bounty') s = bountyScore(m, ps, c);
    else if (c.kind === 'tactic') s = tacticScore(m, ps, c);
    if (c.kind === 'item' && coreStrategy(m, ps._botFocusId)?.itemAllowed?.((ps.gd || m.gd).item(c.id)) === false) s = -1e6;
    s += m.rngBots() * 0.5;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

/**
 * Chance that the own board as it stands (the 机变 draft comes before the prep) kills one enemy of a bounty card: the
 * planner's exposure model (Layout) for that single enemy — its HP × the round's multiplier against Σ over the tiles of
 * its route (the busiest route of its kind: flyers the flying routes, else the ground ones) of the time it spends there
 * × the DPS of every deployed unit covering the tile against its DEF / RES (dpsVs; flyers anti-air only), plus the
 * first blocker's hold on the ground. 0.5 without data.
 */
export function bountyKillChance(m, ps, card) {
  const gd = ps?.gd || m.gd;
  const e = card && gd.enemy(card.enemyKey);
  if (!e || !e.stats) return 0.5;
  const model = fieldModel(m, ps);
  const sc = gd.enemyScale(m.round);
  const hp = Math.max(1, (e.stats.maxHp || 1000) * sc.hpMul);
  const def = e.stats.def || 0;
  const res = e.stats.res || 0;
  const fly = isFlyKey(gd, card.enemyKey) || HOVER.has(card.enemyKey);
  const same = model.routes.filter((r) => !!r.fly === fly);
  const pool = same.length ? same : model.routes;
  if (!pool.length) return 0.5;
  const route = pool.reduce((a, b) => (b.n > a.n ? b : a));
  const speed = Math.max(0.05, (e.stats.moveSpeed || 1) * sc.speedMul);
  const tileTime = Math.max(0.4, Math.min(6, 1 / (speed * 0.5)));
  const units = [];
  for (const [k, p] of ps.board) {
    const rec = p.kind === 'token' ? gd.token(p.id) : rangeRec(ps, gd.chess(p.id));
    if (!rec) continue;
    const [r, c] = parseKey(k);
    const u = unitOf(rec, k, r, c, pieceDir(p), model);
    u.vs = dpsVs(rec, def, res) * u.atkMul;
    units.push(u);
  }
  let exp = 0;
  let held = false;
  for (const k of route.tiles) {
    let t = tileTime;
    if (!fly && !held && units.some((u) => u.block > 0 && u.key === k)) { t += LAYOUT_PARAMS.hold; held = true; }
    let dps = 0;
    for (const u of units) if (u.cover.has(k) && (fly ? u.air : u.ground)) dps += u.vs;
    exp += t * dps;
  }
  return 1 - Math.exp(-exp / (BOUNTY_KILL * hp));
}

/** Exposure (× HP) a bounty enemy needs for a 63 % kill chance (conservative: it fights beside the wave). */
const BOUNTY_KILL = 2;

/**
 * Expected value of a bounty card: per battle it lasts, P(kill) × coin (kill payout) or P(kill)^n × coin (perfect
 * payout) minus the expected leaks × the value of an LP (2 + 20 / LP: dearer when low).
 */
function bountyScore(m, ps, card) {
  const p = bountyKillChance(m, ps, card);
  const n = Math.max(1, card.count || 1);
  const battles = Math.max(1, Math.min(3, card.rounds || 1));
  const lpCost = 2 + 20 / Math.max(1, ps.lp);
  const coin = Math.max(0, card.coin || 0);
  const gain = card.payout === 'perfect' ? p ** n * coin : p * n * coin;
  return battles * (gain - (1 - p) * n * lpCost);
}

/** 机变 tactic card value by its effect (data/effects.json buffs), team cards a little more (teammates get it too). */
function tacticScore(m, ps, card) {
  const eff = m.gd.effect(card.id);
  const buffs = eff && Array.isArray(eff.buffs) ? eff.buffs.filter(Boolean) : [];
  const owned = ownedBonds(m, ps);
  const plan = bondPlan(m, ps, owned);
  const rel = (b) => (b === plan.focus ? 1 : b === plan.second ? 0.7 : (ps.bonds[b] && ps.bonds[b].active) ? 0.5 : owned.counts.get(b) ? 0.25 : 0.05);
  let s = 8;
  for (const b of buffs) {
    const bb = b.bb || {};
    const bs = b.bbStr || {};
    const count = Number.isFinite(bb.count) ? bb.count : 1;
    switch (b.key) {
      case 'global_special_choice_bond_addlayer': {
        let r = 0;
        for (const id of String(bs.bond_list || '').split(',').map((x) => x.trim()).filter(Boolean)) r = Math.max(r, rel(id));
        s = 4 + r * count * 1.2;
        break;
      }
      case 'single_special_choice_gain_bond_chess': s = 5 + rel(bs.bond) * 10; break;
      case 'single_special_choice_gloden_char_chess': s = 16; break;
      case 'single_special_choice_gloden_equip_chess': s = 9; break;
      case 'global_special_choice_gain_equip': s = 10; break;
      case 'global_special_choice_refresh_free': s = 7 + count * 0.5; break;
      case 'global_special_choice_gain_coin': s = 4 + count; break;
      // 锐利 needs an empty hand at the prep end — the bot keeps a bench
      case 'global_special_choice_prep_finish_bench_at_most': s = 3; break;
      default: break;
    }
  }
  return s + (card.team ? 3 : 0);
}

// ---------------------------------------------------------------------------------------------------
// evaluation helpers

// a player's record of a chess id (its data view: a human's slotted 自选 slots are its operators, 0.2.0 player/diy.js)
const chessRec = (m, id, ps = null) => (ps?.gd || m.gd).chess(id);
const isHealer = (c) => !!c && (c.dmgType === 'heal' || c.attackKind === 'heal');
// the record's own position: a 钩索师 / 推击手 is a MELEE blocker like any other (a 高台 does not block)
const isBlocker = (c) => !!c && basePositionClass(c) === 'melee' && (c.stats?.blockCnt ?? 1) > 0 && c.attackKind !== 'none';
/** 近地悬浮 enemies walk a ground route but are air units (no block, anti-air only — DESIGN §19). */
const HOVER = new Set(HOVER_KEYS);
const hitsFly = (c) => !!c && !!c.canHitFly && !isHealer(c) && c.attackKind !== 'none';

/** Distinct owned members per bond (board + hand + temp), and per-bond member sets. */
function ownedBonds(m, ps, exclude = null) {
  const counts = new Map();
  const seen = new Set();
  for (const p of ps.allChess()) {
    if (exclude && p.uid === exclude) continue;
    const base = m.gd.baseIdOf(p.id);
    if (seen.has(base)) continue;
    seen.add(base);
    const c = chessRec(m, p.id, ps);
    for (const b of (c && c.bonds) || []) counts.set(b, (counts.get(b) || 0) + 1);
  }
  return { counts, bases: seen };
}

/**
 * Per bond, from one pass over the shared pool: `reach` = distinct unowned members of tier ≤ shop level + 1 with copies
 * left (what the shop can still bring soon — a teammate draining a bond, or a bond of high-tier members only, makes it
 * a poor target), `supply` = the copies left of all its members.
 */
function bondPoolStats(m, ps, owned) {
  const reach = new Map();
  const supply = new Map();
  const maxTier = Math.min(6, ps.shop.level + 1);
  for (const [id, e] of m.pool.entries) {
    if (!(e.left > 0)) continue;
    const c = m.gd.chess(id);
    if (!c || !Array.isArray(c.bonds)) continue;
    const reachable = c.tier <= maxTier && !owned.bases.has(m.gd.baseIdOf(id));
    for (const b of c.bonds) {
      supply.set(b, (supply.get(b) || 0) + e.left);
      if (reachable) reach.set(b, (reach.get(b) || 0) + 1);
    }
  }
  return { reach, supply };
}

/**
 * A teammate's main core bond as every player sees it (its public bond strip, ps.bonds): the core bond with the most
 * counted members, ≥ 2 (ties: data order); null when it builds none yet. Humans and bots alike.
 */
function mainCoreBond(m, p) {
  let top = null;
  let topN = 1;
  for (const id of m.gd.bondIds) {
    const b = p.bonds && p.bonds[id];
    const n = b ? b.count || 0 : 0;
    if (n > topN && m.gd.bond(id)?.isCore) { topN = n; top = id; }
  }
  return top;
}

/**
 * The bonds the bot builds around (cached per round and owned set): `focus` = the core bond with the best
 * owned members × 10 + reachable members (bondPoolStats, ≤ 4) + layers already banked (≤ 6) + 6 for last round's focus
 * (commit instead of flip-flopping between equal bonds) − 6 when a teammate already builds it (its main core bond on
 * its public bond strip, mainCoreBond — the shop pool is shared); `second` = the other live bond (core or add-on) with
 * the most owned members whose next threshold is within reach (≥ 1 owned member). `ps._botFocusId` keeps the focus
 * across rounds.
 */
export function bondPlan(m, ps, owned = ownedBonds(m, ps)) {
  const publicMates = readsTeammateRoster(m, ps) ? m.alivePlayers() : [];
  const key = `${ps.bandId}|${m.round}|${ps.shop.level}|${[...owned.counts.entries()].map(([k, v]) => k + v).join()}|${Object.values(ps.layers).join()}|${publicMates.map((p) => mainCoreBond(m, p)).join()}`;
  if (ps._botFocus && ps._botFocus.key === key) return ps._botFocus;
  const prev = ps._botFocusId ?? null;
  const mates = new Set();
  for (const p of publicMates) {
    if (p === ps) continue;
    const b = mainCoreBond(m, p);
    if (b) mates.add(b);
  }
  let focus = null;
  let bestS = 0;
  const pool = bondPoolStats(m, ps, owned);
  for (const id of m.gd.bondIds) {
    const b = m.gd.bond(id);
    if (!b || !b.isCore || m.gd.modeInactiveBonds.has(id)) continue;
    const k = owned.counts.get(id) || 0;
    if (!k) continue;
    const s = k * 10 + Math.min(4, pool.reach.get(id) || 0) + Math.sqrt(ps.layers[id] || 0)
      + (id === prev ? 12 : 0) - (mates.has(id) ? 6 : 0) + Math.min(0.9, (pool.supply.get(id) || 0) / 100);
    if (s > bestS) { bestS = s; focus = id; }
  }
  // Keep the opening core stable. Only an invalid/banned plan falls back to another available core.
  const bestOwned = focus;
  focus = prev && !m.gd.modeInactiveBonds.has(prev) ? prev : openingCore(m, ps, owned) ?? focus;
  const fixed = fixedBandCore(m, ps);
  if (fixed) { focus = fixed; ps._botCoreCommitted = true; }
  // Before the first activation only, a clear two-member opening advantage can correct the tentative core.
  if (!ps._botCoreCommitted && bestOwned && (owned.counts.get(bestOwned) || 0) >= (owned.counts.get(focus) || 0) + 2) focus = bestOwned;
  if ((owned.counts.get(focus) || 0) >= (m.gd.bond(focus)?.thresholds?.[0] ?? 3)) ps._botCoreCommitted = true;
  const route = selectRoute(m, ps, focus, owned.counts);
  const second = route?.support ?? null;
  if (focus) ps._botFocusId = focus;
  ps._botFocus = { key, focus, second, route, strategy: coreStrategy(m, focus), enginePolicy: m.opts.botSiracusaEngines === true
    || Array.isArray(m.opts.botSiracusaEngines) && m.opts.botSiracusaEngines.includes('hybrid') };
  return ps._botFocus;
}

/** Copies a merge takes (3; 风丸 2). */
const mergeNeed = (m, base) => m.gd.mergeCount(base) || 3;

/**
 * Bases worth merging ("keepers"): the deployed operators, the owned members of the focus / second bond, and owned
 * chess of a tier ≥ shop level − 1. A pair of anything else only clutters the bench and is sold later at a loss
 * (every sale returns 1).
 */
function keeperBases(m, ps, plan) {
  const out = new Set();
  for (const p of ps.board.values()) if (p.kind === 'chess') out.add(m.gd.baseIdOf(p.id));
  for (const p of ps.allChess()) {
    const c = chessRec(m, p.id, ps);
    if (!c) continue;
    const bonds = c.bonds || [];
    if ((plan.focus && bonds.includes(plan.focus)) || (plan.second && bonds.includes(plan.second)) || plan.route?.supports?.some((b) => bonds.includes(b)) || plan.strategy?.keep(m, ps, c, plan) || c.tier >= ps.shop.level - 1) out.add(m.gd.baseIdOf(p.id));
  }
  return out;
}

/** Role census of the owned chess. */
function roles(m, ps) {
  const r = { blockers: 0, antiAir: 0, healers: 0, total: 0 };
  for (const p of ps.allChess()) {
    const c = chessRec(m, p.id, ps);
    if (!c) continue;
    r.total++;
    if (isBlocker(c)) r.blockers++;
    if (hitsFly(c)) r.antiAir++;
    if (isHealer(c) || (m.opts.botHumanLessons || lateranoHealing(m, ps)) && c.subProfessionId === 'guardian') r.healers++;
  }
  return r;
}

/**
 * Bond value of adding chess `c` to what is owned (owned counts exclude it). `second`: the second bond (bondPlan);
 * once the focus has 3 owned members a member of another core bond is worth less unless it reaches a threshold (the
 * deploy cap holds about 6 members of one core bond + 2 others).
 */
function bondValue(m, c, owned, focus, second = null) {
  let v = 0;
  const committed = focus && (owned.counts.get(focus) || 0) >= 3;
  for (const b of (c && c.bonds) || []) {
    if (coreStrategy(m, focus)?.valuesBond?.(b) === false) continue;
    const bond = m.gd.bond(b);
    if (!bond || m.gd.modeInactiveBonds.has(b)) continue;
    const n = owned.counts.get(b) || 0;
    const th = Array.isArray(bond.thresholds) && bond.thresholds.length ? bond.thresholds : [bond.activeCount || 2];
    const w = bond.isCore ? 1.4 : 1;
    v += (2 + n * 2) * w;
    const hits = th.includes(n + 1);
    if (hits) v += 10 * w;
    else if (th.some((t) => t > n + 1 && t - (n + 1) <= 1)) v += 3 * w;
    if (bond.thresholdTemplate === 'count_threshold_downward') v -= n > 0 ? 12 : 0; // 独行 breaks with a second member
    if (b === focus) v += 10;
    else if (b === second) v += 4;
    else if (committed && bond.isCore && !hits) v -= 4;
  }
  return v;
}

/**
 * Power of a chess record. Base stats barely grow with the tier (research 03: T1 E1 Lv55 … T6 E2 Lv1); higher tiers
 * bring better skills and talents, elites (精锐) +25 % stats and skill level 7 — so the tier weight is modest and the
 * elite weight large.
 */
function power(c) {
  if (!c) return 0;
  const p = TIER_POWER[Math.max(1, Math.min(6, c.tier || 1))];
  return c.isGolden ? p * 1.9 : p;
}

/**
 * 特质 census of a chess (cached per match): recurring layer traits (every prep / refresh), one-shot layer traits
 * (获得时) and economy traits (funds / free refreshes). Humans build around the layer engines — so does the bot.
 */
function traitsOf(m, c) {
  const cache = m._botTraits || (m._botTraits = new Map());
  if (cache.has(c.chessId)) return cache.get(c.chessId);
  const t = { recurring: 0, gain: 0, econ: 0 };
  for (const gid of Array.isArray(c.garrisonIds) ? c.garrisonIds : []) {
    const g = m.gd.garrison(gid);
    if (!g || typeof g.effectKey !== 'string') continue;
    if (LAYER_TRAIT_RE.test(g.effectKey) && RECURRING_TRAIT_EVENTS.has(g.eventType)) t.recurring++;
    else if (LAYER_TRAIT_RE.test(g.effectKey) && g.eventType === 'SERVER_GAIN') t.gain++;
    else if (ECON_TRAIT_RE.test(g.effectKey) && g.eventType !== 'IN_BATTLE') t.econ++;
  }
  cache.set(c.chessId, t);
  return t;
}

/** Stand-alone value of an owned piece (no bond context): power, items, role fit, layer engines. */
function unitBase(m, piece, ctx) {
  const c = chessRec(m, piece.id, ctx.ps);
  if (!c) return 0;
  let v = power(c) + (piece.items ? piece.items.length * 5 : 0);
  if (!ctx.growth.has(c.chessId)) ctx.growth.set(c.chessId, growthValue(m, ctx.ps, c, ctx));
  v += ctx.growth.get(c.chessId);
  v += ctx.strategy?.unitBonus(m, ctx.ps, c, ctx) || 0;
  v += economyChessBonus(m, ctx.ps, c);
  if (c.attackKind === 'none' && !isHealer(c)) v -= 6;
  if (ctx.fly > 0 && hitsFly(c)) v += 2;
  if (ctx.model && !isHealer(c)) v += ARMOR_WEIGHT * (armorFit(ctx.model, c) - 0.6);
  return v;
}

/** Value of an owned piece for bench / sell decisions (its bonds counted against the other owned chess). */
function pieceValue(m, ps, piece, ctx) {
  const c = chessRec(m, piece.id, ps);
  if (!c) return 0;
  return unitBase(m, piece, ctx) + bondValue(m, c, ownedBonds(m, ps, piece.uid), ctx.focus, ctx.second) * 0.8;
}

/**
 * Score of a deployed set: unit values + the bonds it activates (exact tiers via bondsMeta.computeBonds, hand
 * members still count for BOARD_AND_DECK bonds) + composition (blockers, anti-air when the wave flies, ≤ 2 healers).
 */
function lineupScore(m, ps, set, ctx) {
  const gd = ps?.gd || m.gd;
  const board = new Map();
  set.forEach((p, i) => board.set(`x${i}`, p));
  const inSet = new Set(set.map((p) => p.uid));
  // A withdrawn board member joins the hypothetical hand; temp members still never count as deck members.
  const hand = ctx.deck.filter((p) => !inSet.has(p.uid));
  const bonds = computeBonds(gd, { board, hand, layers: ps.layers, bondCountBonus: ps.bondCountBonus });
  // Owner strategy constraints precede soft unit/support scores, including every hill-climb swap.
  const required = ctx.strategy?.requiredCoreMembers?.(m, ps) || 0;
  if (required && (bonds[ctx.focus]?.count || 0) < required) return -Infinity;
  let v = 0;
  for (const p of set) v += unitBase(m, p, ctx);
  for (const [id, b] of Object.entries(bonds)) {
    if (ctx.strategy?.valuesBond?.(id) === false) continue;
    // every deployed focus member counts on the way to the next threshold (a swap alone never reaches the 6-member tier)
    if (id === ctx.focus) {
      const bond = gd.bond(id);
      const top = bond && Array.isArray(bond.thresholds) && bond.thresholds.length ? bond.thresholds[bond.thresholds.length - 1] : 3;
      v += FOCUS_MEMBER * Math.min(b.count || 0, top);
    }
    if (!b.tier) continue;
    const bond = gd.bond(id);
    const w = bond && bond.isCore ? 14 : 9;
    v += b.tier * w + Math.sqrt(b.layers || 0) * 1.3 + (id === ctx.focus ? 6 : 0);
    if (id === ctx.focus && b.count >= coreTarget(gd, id, ps.deployCap)) v += 38;
    if (id === ctx.second) v += b.tier * 5 + Math.sqrt(b.layers || 0) * 0.5;
  }
  let blockers = 0;
  let air = 0;
  let healers = 0;
  for (const p of set) { const c = chessRec(m, p.id, ps); if (isBlocker(c)) blockers++; if (hitsFly(c)) air++; if (isHealer(c)) healers++; }
  v -= Math.max(0, Math.min(2, ctx.roles.blockers) - blockers) * 15;
  if (ctx.fly > 0 && ctx.roles.antiAir > 0 && air === 0) v -= 12;
  v -= Math.max(0, healers - 2) * 10;
  v += ctx.strategy?.lineupBonus(gd, set, bonds, ctx) || 0;
  return v;
}

/** Best deployable set of at most `cap` owned chess: greedy seed + swap hill-climbing on lineupScore. */
function chooseLineup(m, ps, ctx) {
  const all = ps.allChess();
  const cap = Math.min(ps.deployCap, all.length);
  const value = new Map(all.map((p) => [p.uid, pieceValue(m, ps, p, ctx)]));
  const seed = all.slice().sort((a, b) => value.get(b.uid) - value.get(a.uid) || a.uid - b.uid);
  let set = seed.slice(0, cap);
  let bench = seed.slice(cap);
  let score = lineupScore(m, ps, set, ctx);
  // Cross a multi-member threshold directly; a single-swap hill climb cannot always reach a powered core.
  const distinct = (id) => {
    const seen = new Set();
    return seed.filter((p) => {
      const base = (ps.gd || m.gd).baseIdOf(p.id);
      const memberships = id === ctx.focus && ctx.strategy?.requiredCoreMembers?.(m, ps)
        ? pieceBonds(ps.gd || m.gd, p) : chessRec(m, p.id, ps)?.bonds;
      if (!memberships?.includes(id) || seen.has(base)) return false;
      seen.add(base); return true;
    });
  };
  for (const withSupport of [false, true]) {
    const core = distinct(ctx.focus).slice(0, coreTarget(ps.gd || m.gd, ctx.focus, ps.deployCap));
    if (!core.length) continue;
    const candidate = core.slice();
    if (withSupport && ctx.second) for (const p of distinct(ctx.second)) {
      if (candidate.filter((q) => chessRec(m, q.id, ps)?.bonds?.includes(ctx.second)).length >= (ctx.route?.supportMembers ?? 2)) break;
      if (candidate.length < cap && !candidate.includes(p)) candidate.push(p);
    }
    for (const p of seed) if (candidate.length < cap && !candidate.includes(p)) candidate.push(p);
    const s = lineupScore(m, ps, candidate, ctx);
    if (s > score + 0.5) { set = candidate; bench = seed.filter((p) => !set.includes(p)); score = s; }
  }
  // identical pieces (same chess, same items — a bond can hang on an item pair) score alike: only the first is tried
  const sig = (p) => `${p.id}|${(p.items || []).map((it) => it.id).sort().join('+')}`;
  for (let iter = 0; iter < 12 && bench.length; iter++) {
    let best = null;
    const tried = new Set();
    for (let j = 0; j < bench.length; j++) {
      const sj = sig(bench[j]);
      if (tried.has(sj)) continue;
      tried.add(sj);
      for (let i = 0; i < set.length; i++) {
        if (sig(set[i]) === sj) continue;
        const trial = set.slice();
        trial[i] = bench[j];
        const s = lineupScore(m, ps, trial, ctx);
        if (s > score + 0.5 && (!best || s > best.s || (s === best.s && (i < best.i || (i === best.i && j < best.j))))) best = { i, j, s };
      }
    }
    if (!best) break;
    const out = set[best.i];
    set[best.i] = bench[best.j];
    bench[best.j] = out;
    score = best.s;
  }
  return { set, bench, score };
}

/** buyScore with a fresh context (tests). */
export function buyScoreOf(m, ps, id) {
  return buyScore(m, ps, id, context(m, ps));
}

/** Evaluate a proposed lineup without moving its pieces (diagnostics and counterfactual regression checks). */
export function lineupScoreOf(m, ps, pieces) {
  return lineupScore(m, ps, pieces, context(m, ps));
}

/** Shop / reward score of acquiring one copy of chess `id` (0 = not worth it). */
function buyScore(m, ps, id, ctx, reward = false) {
  const gd = ps?.gd || m.gd;
  const c = chessRec(m, id, ps);
  if (!c) return 0;
  const rewardGate = ctx.strategy?.rewardAllowed || ctx.strategy?.rewardScoreAllowed;
  if ((reward && rewardGate ? rewardGate(m, ps, c)
    : ctx.strategy?.purchaseAllowed?.(m, ps, c)) === false) return -1000;
  let s = power(c) * 0.6;
  const tr = traitsOf(m, c);
  s += growthValue(m, ps, c, ctx) * 0.8 + tr.gain * 2 + tr.econ * (m.round <= 7 ? 2 : 0);
  s += developmentBuy(m, ps, c, ctx);
  s += ctx.strategy?.buyBonus(m, ps, c, ctx, ctx.owned.counts) || 0;
  s += economyChessBonus(m, ps, c, { purchase: true });
  const base = gd.baseIdOf(id);
  if (!c.isGolden) {
    const copies = ctx.copies.get(base) || 0;
    if (copies > 0) {
      // merge progress: an elite plus the merge's free next-tier reward (MERGE_HIT) — for any pair; a new pair of a
      // non-keeper only while the bench has room for it (cheap tiers: the third copy is hunted with refreshes)
      const keep = ctx.keep.has(base);
      if (copies + 1 >= mergeNeed(m, base)) s += keep ? 40 : 30;
      else s += keep ? 14 : ctx.pairs < MAX_PAIRS && c.tier <= 3 ? 6 : 1;
    }
  }
  if (!ctx.owned.bases.has(base)) s += bondValue(m, c, ctx.owned, ctx.focus, ctx.second);
  // role needs
  if (isBlocker(c) && ctx.roles.blockers < 2) s += 10;
  if (hitsFly(c) && ctx.fly > 0 && ctx.roles.antiAir < 2) s += 8;
  if (isHealer(c)) s += ctx.roles.healers === 0 && m.round >= 3 ? 6 : ctx.roles.healers >= 2 ? -14 : -3;
  if (c.attackKind === 'none' && !isHealer(c)) s -= 4;
  if (ctx.model && !isHealer(c)) s += ARMOR_WEIGHT * 0.6 * (armorFit(ctx.model, c) - 0.6);
  // the player's own 自选 piece (a slotted slot: its composed record carries diyFor) — AI 托管 of a human with picks
  if (c.diyFor) s += DIY_PIECE_BONUS;
  // [ASSUMED] A soft 18-point cooperation weight (PR #407), not an official rule or a reserved card.
  // Leave high-tier shared chess to living teammates whose opening strategy needs its faction.
  // Humans and bots count equally; a single soft penalty still allows valuable own merges.
  if (readsTeammateRoster(m, ps) && c.tier >= 5 && !c.isGolden && !c.diyFor && m.pool.has(base) && m.alivePlayers().some((mate) =>
    mate !== ps && gd.bandBondIds(mate.bandId).some((b) => !gd.modeInactiveBonds.has(b) && c.bonds.includes(b)))) s -= 18;
  return s;
}

// ---------------------------------------------------------------------------------------------------
// field model: where the round's enemies walk / fly over the own board, and an exposure model of a layout

const inRect = (r, c) => r >= FIELD.r0 && r <= FIELD.r1 && c >= 0 && c <= FIELD.c1;

/** Integer tiles along a polyline of [row, col] points (inclusive, consecutive duplicates removed). */
function traceLine(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [r0, c0] = points[i];
    const [r1, c1] = points[i + 1];
    const n = Math.max(1, Math.abs(r1 - r0), Math.abs(c1 - c0));
    for (let k = 0; k <= n; k++) {
      const t = [Math.round(r0 + ((r1 - r0) * k) / n), Math.round(c0 + ((c1 - c0) * k) / n)];
      const last = out[out.length - 1];
      if (!last || last[0] !== t[0] || last[1] !== t[1]) out.push(t);
    }
  }
  return out;
}

/** Boss field → own board: board.js boardTileOf (board rows 9–12 are boss rows 2–5; the right side mirrored). */
const BOSS_MID_COL = 10;
/** Dwell (s) the planner assumes on a leader's first own tiles (several leaders fight from their spawn point). */
const BOSS_DWELL = 30;
/** A leader is modeled as LEADER_WEIGHT enemies of LEADER_HP each (its route draws the damage dealers). */
const LEADER_WEIGHT = 10;
const LEADER_HP = 40000;

/** The boss-round wave of a player's group and its side ('L' | 'R'), or null (Match.bossGroupOf). */
function bossWaveOf(m, ps) {
  const g = typeof m.bossGroupOf === 'function' ? m.bossGroupOf(ps) : null;
  return g && g.wave ? { wave: g.wave, side: g.side } : null;
}

/**
 * The round's routes over the own board (cached per round): [{ n, fly (air units: flyers, and the 近地悬浮 HOVER_KEYS
 * on their ground path), tiles: ['r,c'…] (gate → objective, own region only, objective tile excluded), tileTime (s per
 * tile), hp }], a tile → [[route, index]] index, and the
 * aggregated ground flow per tile. Built from the wave preview (spawn counts per route, enemy HP / speed with the
 * round's multipliers). Boss rounds (pass `ps`): the player's boss-field template mapped onto the own board (rows −7,
 * the right player's half mirrored; only the routes that end on the player's half), the leader weighted heavily with
 * a dwell on its first tiles so damage dealers reach it; missing data falls back to every ground path from the own
 * gates.
 */
export function fieldModel(m, ps = null) {
  const boss = m.wave ? null : bossWaveOf(m, ps);
  const wave = m.wave || (boss && boss.wave);
  const visibleAirOnly = coreStrategy(m, ps?._botFocusId)?.visibleAirOnly?.(m) || false;
  const cacheKey = `${m.round}|${m.stageId}|${wave ? wave.templateId : 'boss'}|${boss ? boss.side : ''}|${visibleAirOnly}`;
  if (m._botPath && m._botPath.key === cacheKey) return m._botPath;
  const gd = ps?.gd || m.gd;
  const st = m.stage;
  const gpaths = (st && (st.groundPathsWithDevices || st.groundPaths)) || {};
  const routesOut = [];
  const bossBodies = [];
  const toBoard = boss
    ? ([r, c]) => boardTileOf(boss.side === 'R' ? 'bossR' : 'bossL', r, c)
    : (p) => p;
  const pushRoute = (tilesRC, n, fly, hp, speed, dwell = 0, spawnTimes = []) => {
    const own = tilesRC.map(toBoard).filter(([r, c]) => inRect(r, c)).map(([r, c]) => tileKey(r, c));
    if (own.length > 1) own.pop(); // the objective / last tile: an enemy there has already leaked
    if (!own.length) return;
    const tileTime = Math.max(0.4, Math.min(6, 1 / Math.max(0.05, speed * 0.5)));
    routesOut.push({ n, fly, tiles: own, tileTime, hp: Math.max(100, hp), dwell, spawnTimes });
  };
  const routes = wave && Array.isArray(wave.routes) ? wave.routes : [];
  const spawns = wave && Array.isArray(wave.spawns) ? wave.spawns : [];
  // boss pair templates route to both goals: keep the routes ending on this player's half (mirrored for 'R')
  const ownRoute = (rt) => {
    if (!boss || !Array.isArray(rt.end)) return true;
    const endCol = rt.end[1];
    return boss.side === 'R' ? endCol > BOSS_MID_COL : endCol <= BOSS_MID_COL;
  };
  const mirrorRoute = (rt) => {
    // the right player fights the mirror image of the routes that end on the left goal (its own copy of the leader)
    if (!boss || boss.side !== 'R' || !Array.isArray(rt.end) || rt.end[1] > BOSS_MID_COL) return rt;
    const mc = ([r, c]) => [r, BOSS_MIRROR_COL - c];
    return { ...rt, start: mc(rt.start), end: mc(rt.end), checkpoints: Array.isArray(rt.checkpoints) ? rt.checkpoints.map(mc) : [] };
  };
  const foes = new Map(); // DEF|RES → HP share of the round's enemies (effDps)
  if (routes.length && spawns.length) {
    const per = new Map();
    for (const s of spawns) {
      const e = gd.enemy(s.enemyKey);
      const n = Math.max(1, s.count || 1);
      const isLeader = s.tag === 'boss';
      if (s.tag === 'part') continue;
      // Huge leaders are self-bound in content/bosses.js. Their hit body stays at spawn, never walks the preview route.
      if (boss && isLeader && e?.hitArea && routes[s.routeIndex]?.start) {
        const rt = mirrorRoute(routes[s.routeIndex]), [r, c] = rt.start;
        bossBodies.push({ center: toBoard([r, c]), tiles: bodyKeys({ x: c, y: r, hitArea: e.hitArea })
          .map((k) => toBoard([Math.floor(k / COLS), k % COLS])).map(([br, bc]) => tileKey(br, bc)) });
      }
      if (e && e.stats) {
        const k = `${e.stats.def || 0}|${e.stats.res || 0}`;
        foes.set(k, (foes.get(k) || 0) + (isLeader ? LEADER_HP * LEADER_WEIGHT : (e.stats.maxHp || 1000) * n));
      }
      // the leader counts like LEADER_WEIGHT tough enemies: its huge pool makes damage on it worth a lot everywhere
      const hp = isLeader ? LEADER_HP : ((e && e.stats && e.stats.maxHp) || 1000) * ((s.mods && s.mods.hpMul) || 1);
      const spd = ((e && e.stats && e.stats.moveSpeed) || 1) * ((s.mods && s.mods.speedMul) || 1);
      const air = HOVER.has(s.enemyKey);
      const key = `${s.routeIndex}|${isLeader ? 'boss' : ''}|${air ? 'air' : ''}`;
      const a = per.get(key) || { ri: s.routeIndex, boss: isLeader, air, n: 0, hp: 0, spd: 0, spawnTimes: [] };
      a.n += isLeader ? LEADER_WEIGHT : n; a.hp += hp * n; a.spd += spd * n;
      for (let i = 0; i < n; i++) a.spawnTimes.push(Math.max(0, Number(s.time) || 0) + i * Math.max(0, Number(s.interval) || 0));
      per.set(key, a);
    }
    for (const a of per.values()) {
      let rt = routes[a.ri];
      if (!rt || !Array.isArray(rt.start) || !Array.isArray(rt.end)) continue;
      if (a.boss && bossBodies.length) continue;
      if (boss && !a.boss && !ownRoute(rt)) continue;
      // in a pair each player fights its own copy of the leader (spawned on its side)
      rt = mirrorRoute(rt);
      const cnt = a.boss ? 1 : a.n;
      const dwell = a.boss ? BOSS_DWELL : 0;
      if (rt.motion === 'FLY') {
        pushRoute(traceLine([rt.start, ...(Array.isArray(rt.checkpoints) ? rt.checkpoints : []), rt.end]), a.n, true, a.hp / cnt, a.spd / cnt, dwell, a.spawnTimes);
      } else {
        const key = `${rt.start[0]},${rt.start[1]}->${rt.end[0]},${rt.end[1]}`;
        const path = Array.isArray(gpaths[key]) ? gpaths[key] : traceLine([rt.start, ...(boss && Array.isArray(rt.checkpoints) ? rt.checkpoints : []), rt.end]);
        pushRoute(path, a.n, a.air, a.hp / cnt, a.spd / cnt, dwell, a.spawnTimes); // a hovering enemy: ground tiles, air unit
      }
    }
  }
  if ((!visibleAirOnly ? !routesOut.some((r) => !r.fly) : !routesOut.length) && !bossBodies.length) {
    for (const [k, arr] of Object.entries(gpaths)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const [sr, sc] = String(k).split('->')[0].split(',').map(Number);
      if (!(sr >= FIELD.r0 && sr <= FIELD.r1 && sc <= FIELD.c1)) continue;
      // stage ground paths are in normal-field coordinates: no boss mapping
      const own = arr.filter(([r, c]) => inRect(r, c)).map(([r, c]) => tileKey(r, c));
      if (own.length > 1) own.pop();
      if (own.length) routesOut.push({ n: 3, fly: false, fallback: true, tiles: own, tileTime: 2, hp: 3000, dwell: 0 });
    }
  }
  const index = new Map();
  const ground = new Map();
  routesOut.forEach((rt, ri) => {
    rt.tiles.forEach((k, i) => {
      if (!index.has(k)) index.set(k, []);
      index.get(k).push([ri, i]);
      if (!rt.fly) {
        const e = ground.get(k) || { flow: 0, prog: 0 };
        e.flow += rt.n;
        e.prog = Math.max(e.prog, rt.tiles.length > 1 ? i / (rt.tiles.length - 1) : 1);
        ground.set(k, e);
      }
    });
  });
  const flyTotal = routesOut.filter((r) => r.fly).reduce((s, r) => s + r.n, 0);
  let wsum = 0;
  for (const w of foes.values()) wsum += w;
  const armor = [...foes.entries()].map(([k, w]) => { const [def, res] = k.split('|').map(Number); return { def, res, w: w / wsum }; });
  m._botPath = { key: cacheKey, routes: routesOut, bossBodies, index, ground, flyTotal, airflow: airflowOf(st, toBoard, boss && boss.side === 'R'), armor, dps: new Map() };
  return m._botPath;
}

/**
 * 气流 (act2 m01 blowers, sim content/devices.js): own-board tile → { dir, bb } for every tile a (data-)active blower
 * blows over, mapped like the routes (boss rounds: rows −7, the right side mirrored — RIGHT ↔ LEFT). An operator on
 * such a tile facing WITH the flow gets ATK × (1 + blower_s_character[equal].atk), against it [opposite], across it
 * [vertical] (DESIGN §3, research 09 §1.1): the planner scales its DPS accordingly when it picks a direction.
 */
function airflowOf(st, toBoard, mirrored) {
  const out = new Map();
  for (const d of (st && Array.isArray(st.devices) ? st.devices : [])) {
    if (!d || d.role !== 'blower' || d.active === false || d.hidden) continue;
    const bb = (d.skill && d.skill.bb) || {};
    const dir = mirrored ? mirrorDir(normDir(d.dir, 'UP')) : normDir(d.dir, 'UP');
    for (const p of Array.isArray(d.rangeTiles) ? d.rangeTiles : []) {
      if (!Array.isArray(p)) continue;
      const [r, c] = toBoard(p);
      if (inRect(r, c)) out.set(tileKey(r, c), { dir, bb });
    }
  }
  return out;
}

/** ATK factor of an operator standing on `key` facing `dir` in the model's airflow (1 off the flow). */
export function airflowAtkMul(model, key, dir) {
  const f = model && model.airflow instanceof Map ? model.airflow.get(key) : null;
  if (!f) return 1;
  const rel = dir === f.dir ? 'equal' : dir === oppositeDir(f.dir) ? 'opposite' : 'vertical';
  const v = Number(f.bb[`blower_s_character[${rel}].atk`]);
  return Number.isFinite(v) ? Math.max(0, 1 + v) : 1;
}

/** Direction candidates of the planner, in preference order (ties keep the earlier one: RIGHT = toward the gates). */
export const PLAN_DIRS = Object.freeze(['RIGHT', 'UP', 'DOWN', 'LEFT']);
const layoutDirs = (layout, uid) => layout.forcedFacings?.has(uid) ? [layout.forcedFacings.get(uid)] : PLAN_DIRS;

/** Board tile keys covered by a record's range grid standing on (r, c) facing `dir` (grid rotated, DESIGN §3). */
export function rangeTiles(rec, r, c, dir = 'RIGHT') {
  const grid = rec && Array.isArray(rec.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : DEFAULT_MELEE_RANGE;
  return grid.map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return tileKey(r + a, c + b); });
}

/**
 * Enemies an attack strikes at once, as a factor on a dealer's DPS (the exposure model gives every unit's DPS to each
 * enemy on a covered tile, so a single-target dealer is overrated in a crowd): 阵法术师 / 轰击术师 strike every enemy in
 * range (sim professions.js rangeAoe, community report E3 after 0.1.0 — the 阵法术师's skill-off pause is the 0.4 of a
 * non-attacker), splash and chain branches a few [ASSUMED values, botbench A/B in BALANCE.md].
 */
const CROWD = Object.freeze({ phalanx: 2, blastcaster: 2, splashcaster: 1.3, aoesniper: 1.3, bombarder: 1.3, chain: 1.4 });
const crowdOf = (rec) => CROWD[rec && rec.subProfessionId] ?? 1;

/** Damage per second of a record (attack / attack interval; healers and non-attackers 0). */
function dpsOf(rec) {
  const st = rec && rec.stats;
  if (!st || isHealer(rec)) return 0;
  const interval = Math.max(0.2, (st.bat || 1) * 100 / Math.max(ASPD_MIN, st.aspd || 100));
  const d = ((st.atk || 0) / interval) * crowdOf(rec);
  return rec.attackKind === 'none' ? d * 0.4 : d;
}

/** Damage per second of a record against one enemy's DEF / RES (one hit mitigated like the sim, damage.js mitigate). */
function dpsVs(rec, def, res) {
  const st = rec && rec.stats;
  if (!st || isHealer(rec)) return 0;
  const interval = Math.max(0.2, (st.bat || 1) * 100 / Math.max(ASPD_MIN, st.aspd || 100));
  const d = (mitigate(st.atk || 0, rec.dmgType === 'arts' ? 'arts' : 'phys', { def, res }) / interval) * crowdOf(rec);
  return rec.attackKind === 'none' ? d * 0.4 : d;
}

/**
 * The record a chess fights with for range purposes: its range grid replaced by the one it is deployed with under the
 * player's loadout — a passive 攻击范围扩大 skill, a module's range or 攻击距离 (shared/loadoutRecord.js attackRangeGrid:
 * what the server's summonRange, the deploy wheel and the card use since 0.1.1) — else the record itself. Cached per
 * player and loadout.
 */
export function rangeRec(ps, rec) {
  if (!rec || !rec.chessId || typeof ps.loadoutFor !== 'function') return rec;
  const lo = ps.loadoutFor(rec);
  const guardianHealing = !!(ps.m?.opts?.botHumanLessons || ps.m && lateranoHealing(ps.m, ps));
  const key = `${rec.chessId}|${lo ? `${lo.skill ?? ''}:${lo.module ?? ''}` : ''}|${guardianHealing}`;
  const cache = ps._botRangeRecs || (ps._botRangeRecs = new Map());
  if (cache.has(key)) return cache.get(key);
  let out = rec;
  try {
    // 0.2.0 补位: a human's not-owned chess (AI 托管) is deployed as its stand-in — that body's range
    const body = typeof ps.fieldRecord === 'function' ? ps.fieldRecord(rec) || rec : rec;
    const g = attackRangeGrid(loadoutRecord(body, resolveRecordLoadout(body, lo)));
    if (Array.isArray(g) && g.length && JSON.stringify(g) !== JSON.stringify(rec.rangeGrid)) out = Object.freeze({ ...rec, rangeGrid: g });
    if (guardianHealing && body.subProfessionId === 'guardian') {
      const selected = loadoutRecord(body, resolveRecordLoadout(body, lo));
      out = Object.freeze({ ...out, healingGrid: selected.skill?.rangeGrid || [] });
    }
  } catch { out = rec; }
  cache.set(key, out);
  return out;
}

/**
 * DPS of a record against the round's enemies: dpsVs averaged over their DEF / RES weighted by HP (the field model's
 * `armor`; cached per round) — physical dealers lose most of their damage on 重甲 waves, arts dealers on high-RES ones.
 * Without a model (or enemies) the raw dpsOf.
 */
export function effDps(model, rec) {
  if (!rec) return 0;
  if (!model || !Array.isArray(model.armor) || !model.armor.length) return dpsOf(rec);
  // (a 自选 record — one DIY slot id, each player's own operator — is cached per operator and skill)
  const id = rec.diyFor ? `${rec.chessId}@${rec.charId}#${rec.skill?.index ?? ''}` : rec.chessId || rec.tokenId || rec.id || rec.name;
  const cache = model.dps instanceof Map ? model.dps : null;
  if (cache && cache.has(id)) return cache.get(id);
  let v = 0;
  for (const a of model.armor) v += a.w * dpsVs(rec, a.def, a.res);
  if (cache) cache.set(id, v);
  return v;
}

/** Share of a dealer's raw DPS that gets through the round's armour (1 for healers / no enemies). */
function armorFit(model, rec) {
  const raw = dpsOf(rec);
  return raw > 0 ? effDps(model, rec) / raw : 1;
}

/** Tunables of the exposure model (tuned offline against the real simulation, tools/matchrun.mjs sweeps). */
export const LAYOUT_PARAMS = Object.freeze({ hold: 4, kill: 1.5, secondHold: 0.5, healHold: 0.5, roadPenalty: 0.15, spread: 99 });

/**
 * Exposure model of a layout: every enemy of route ρ spends tileTime on each tile of its route (plus the hold time
 * of blockers standing on it: hold × blockCnt, later blockers on the same route secondHold ×, healer-covered
 * blockers (1 + healHold) ×) and takes the DPS of every unit whose range covers that tile (flyers: anti-air only).
 * Value = Σρ n × (1 − e^(−exposure / (kill × hp))) — the expected enemies killed.
 */
class Layout {
  constructor(model, params, growth = null) {
    this.model = model;
    this.p = params;
    this.units = []; // { rec, key, dps, air, ground, block, heal, cover: Set }
    this.growth = growth;
    this.raidLandings = null;
    this.formationRoles = false;
    this.humanLessons = false;
    this.fireControl = false;
    this.fronts = null;
  }

  value() {
    const { routes } = this.model;
    const p = this.p;
    const cover = new Map(); // key → { g: dps on ground, a: dps on air }
    const healCover = new Map();
    for (const u of this.units) {
      for (const k of this.raidLandings?.get(u.uid)?.cover || u.cover) {
        const e = cover.get(k) || { g: 0, a: 0 };
        if (u.ground) e.g += u.dps;
        if (u.air) e.a += u.dps;
        cover.set(k, e);
        if (u.heal && !this.humanLessons) healCover.set(k, (healCover.get(k) || 0) + 1);
      }
      if (this.humanLessons) for (const k of u.healCover) healCover.set(k, (healCover.get(k) || 0) + (u.heal ? 1 : 0.6));
    }
    const blockAt = new Map();
    for (const u of this.units) if (u.block > 0 && this.model.ground.has(u.key)) blockAt.set(u.key, (blockAt.get(u.key) || 0) + u.block);
    let total = 0;
    if (this.fireControl) total = fireControlValue(this.model, this.units, p, this.fronts);
    else for (const rt of routes) {
      let exp = 0;
      let lastBlock = -Infinity;
      for (let i = 0; i < rt.tiles.length; i++) {
        const k = rt.tiles[i];
        let t = rt.tileTime + (i < 2 && rt.dwell ? rt.dwell : 0);
        if (!rt.fly && blockAt.has(k)) {
          // a blocker right behind another one mostly holds what slipped past; a separate line holds again
          const fresh = i - lastBlock >= p.spread;
          const healable = !this.humanLessons || this.units.some((u) => u.key === k && u.block > 0 && acceptsHealing(u.rec));
          t += p.hold * blockAt.get(k) * (fresh ? 1 : p.secondHold) * (1 + p.healHold * (healable ? Math.min(2, healCover.get(k) || 0) : 0));
          lastBlock = i;
        }
        const c = cover.get(k);
        if (c) exp += t * (rt.fly ? c.a : c.g);
      }
      total += rt.n * (1 - Math.exp(-exp / (p.kill * rt.hp)));
    }
    for (const body of this.model.bossBodies || []) {
      let dps = 0;
      for (const u of this.units) {
        const landing = this.raidLandings?.get(u.uid), cover = landing?.cover || u.cover;
        // [ASSUMED] Discount the initial jump delay. One enemy counts once even when several body tiles are covered.
        if (u.ground && body.tiles.some((k) => cover.has(k))) dps += u.dps * (landing ? 0.8 : 1);
      }
      total += LEADER_WEIGHT * (1 - Math.exp(-dps * BOSS_DWELL / (p.kill * LEADER_HP)));
    }
    // ranged units standing on a road block and get hit: a small penalty per road tile they occupy
    for (const u of this.units) if (!u.block && this.model.ground.has(u.key)) total -= p.roadPenalty * this.model.ground.get(u.key).flow;
    if (this.growth) total += layoutGrowth(this.growth.gd, this.units, this.growth.plan, this.growth.bonds, this.model);
    if (this.formationRoles && !this.fireControl) total += formationValue(this.model, this.units.filter((u) => !this.raidLandings?.has(u.uid)));
    if (this.growth?.plan.bossFocus) total += this.growth.plan.strategy.bossLayoutValue(this.growth.gd, this.units,
      { ...this.growth.plan, landings: this.raidLandings }, this.growth.bonds, this.model);
    return total;
  }
}

function unitOf(rec, key, r, c, dir = 'RIGHT', model = null) {
  const block = isBlocker(rec) ? Math.max(1, rec.stats?.blockCnt ?? 1) : 0;
  const atkMul = airflowAtkMul(model, key, dir);
  return {
    rec, key, r, c, dir, dps: effDps(model, rec) * atkMul, atkMul, air: hitsFly(rec), ground: rec.attackKind !== 'heal' && !isHealer(rec),
    block, heal: isHealer(rec), cover: new Set(rangeTiles(rec, r, c, dir)), healCover: healingTiles(rec, r, c, dir),
  };
}

/** A layout plan: Map uid → tile key, plus `dirs`: Map uid → direction (UP|RIGHT|DOWN|LEFT). */
export class LayoutPlan extends Map {
  constructor(entries) { super(entries); this.dirs = new Map(); this.reserved = new Set(); }
  /** The planned direction of a piece (RIGHT when unplanned). */
  dirOf(uid) { return this.dirs.get(uid) ?? 'RIGHT'; }
}

/**
 * Plan tiles and directions for `pieces` (chess or token pieces with `id`): blockers first, then damage dealers by
 * DPS, then healers and the rest; each takes the legal free (tile, direction) with the best marginal layout value
 * (directions in PLAN_DIRS order, a direction whose rotated range equals an earlier one's is skipped; one rng draw per
 * tile breaks ties between tiles). Returns a LayoutPlan (Map uid → key, `.dirs` uid → dir).
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 */
export function planLayout(m, ps, pieces, params = LAYOUT_PARAMS, opts = {}) {
  return runSteps(planLayoutSteps(m, ps, pieces, params, opts));
}

/** planLayout as a step generator: yields after each placed piece (Match slices a bot's prep, see botPrepBeginSteps). */
export function* planLayoutSteps(m, ps, pieces, params = LAYOUT_PARAMS, { occupied = new Set(), recOf = null,
  formationRoles = m.opts.botFormationRoles === true, rng = m.rngBots, bossFocus = false, facingPlan = null,
  fireControl = false, seedPlan = null, developmentPhase = null, placementVariant = 0 } = {}) {
  const model = fieldModel(m, ps);
  const map = ps.deployMap();
  const pgd = ps.gd || m.gd;
  const recCache = new Map();
  const rec = recOf || ((p) => {
    if (recCache.has(p.id)) return recCache.get(p.id);
    let r = p.kind === 'token' ? pgd.token(p.id) : rangeRec(ps, pgd.chess(p.id));
    if (fireControl && r?.subProfessionId === 'guardian') {
      const selected = loadoutRecord(r, resolveRecordLoadout(r, ps.loadoutFor(r)));
      r = { ...r, healingGrid: selected.skill?.rangeGrid || [] };
    }
    recCache.set(p.id, r); return r;
  });
  const corePlan = bondPlan(m, ps);
  // Optional recipe opt-in: apply the existing boss body repair to every final-assault proposal.
  bossFocus ||= !m.wave && m.round >= m.gd.bossRound && corePlan.strategy?.bossFocus === true;
  // The optional phase-aware recipe needs the current player; do not mutate the cached core-selection plan.
  const plan = developmentPhase ? { ...corePlan, ps, developmentPhase }
    : bossFocus ? { ...corePlan, ps, bossFocus, pieces: new Map(pieces.map((p) => [p.uid, p])) }
    : m.opts.botLateranoLessons && corePlan.focus === 'lateranoShip' ? { ...corePlan, ps } : corePlan;
  const placementContext=placementVariant ? {...plan,placementVariant} : plan;
  const placement = plan.strategy?.placementPlan?.(pgd, pieces, placementContext, { model, map, occupied, recOf: rec });
  if (placement) occupied = new Set([...occupied, ...placement.reserved]);
  const layout = new Layout(model, params, { gd: pgd, plan, bonds: ps.bonds });
  layout.raidLandings = placement?.landings;
  layout.fixed = placement?.fixed;
  // Final-assault positions must be scored with the directions the owner policy will actually emit.
  if (!m.wave && m.round >= m.gd.bossRound) layout.forcedFacings = new Map(pieces.flatMap((p) => {
    const dir = plan.strategy?.finalFacing?.(pgd, p, plan);
    return dir ? [[p.uid, dir]] : [];
  }));
  layout.formationRoles = formationRoles;
  layout.humanLessons = m.opts.botHumanLessons || lateranoHealing(m, ps);
  layout.fireControl = fireControl;
  const rank = (p) => {
    const r = rec(p);
    if (layout.formationRoles && isFormationAnchor(r)) return -2;
    if (layout.formationRoles && r?.subProfessionId === 'lord') return 1;
    return isLineCaster(r) ? -1 : isBlocker(r) ? 0 : isHealer(r) ? 2 : 1;
  };
  const order = pieces.slice().sort((a, b) => rank(a) - rank(b) || dpsOf(rec(b)) - dpsOf(rec(a)) || a.uid - b.uid);
  const taken = new Set([...occupied, ...[...(placement?.starts?.values() || [])].map((p) => p.key)]);
  const out = new LayoutPlan();
  const finish = () => {
    for (const p of pieces) {
      const facing = plan.strategy?.finalFacing?.(pgd, p, plan);
      if (facing && out.has(p.uid)) out.dirs.set(p.uid, facing);
    }
    if (layout.forcedFacings?.size && model.bossBodies.length) out.bossMissing = bossMissing(layout);
    return out;
  };
  if(placementVariant)out.placementVariant=placementVariant;
  out.reserved = placement?.reserved || new Set();
  const lineGates = new Map();
  const anchors = new Set(placement?.fixed || []);
  if (seedPlan) for (const p of order) {
    const start = placement?.fixed?.has(p.uid) ? placement.starts.get(p.uid) : null;
    const key = start?.key || seedPlan.get(p.uid), r0 = rec(p);
    if (!key || !r0) continue;
    const [r, c] = parseKey(key), u = unitOf(r0, key, r, c, start?.dir || layout.forcedFacings?.get(p.uid) || planDir(seedPlan, p.uid), model);
    u.uid = p.uid; layout.units.push(u); out.set(p.uid, key); out.dirs.set(p.uid, u.dir);
    const gate = linePlacementGate(model, r0, [...legalTiles(map, placeClass(ps, pgd.chess(p.id) || r0))], layoutDirs(layout, p.uid));
    if (gate) lineGates.set(p.uid, gate);
  }
  if (fireControl && seedPlan) {
    layout.fronts = new Map();
    for (const rt of model.routes) {
      const main = routeFront(rt, layout.units, params).main;
      if (main) { layout.fronts.set(rt, main.u.uid); anchors.add(main.u.uid); }
    }
  }
  if (facingPlan) {
    for (const p of order) {
      const fixedStart = placement?.fixed?.has(p.uid) ? placement.starts.get(p.uid) : null;
      const key = fixedStart?.key || facingPlan.get(p.uid), r0 = rec(p);
      if (!key || !r0) continue;
      const [r, c] = parseKey(key), u = unitOf(r0, key, r, c, fixedStart?.dir || layout.forcedFacings?.get(p.uid) || planDir(facingPlan, p.uid), model);
      u.uid = p.uid; layout.units.push(u); out.set(p.uid, key); out.dirs.set(p.uid, u.dir);
    }
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < layout.units.length; i++) {
      const initial = layout.units[i];
      if (placement?.starts?.has(initial.uid)) continue;
      const gate = linePlacementGate(model, initial.rec, [[initial.r, initial.c]], layoutDirs(layout, initial.uid));
      const valueOf = () => !model.bossBodies.length
        ? plan.strategy.bossSupportValue(pgd, layout.units, plan.pieces, ps.bonds) : layout.value();
      let best = initial, score = valueOf();
      for (const dir of layoutDirs(layout, initial.uid)) {
        if (gate && !gate.allows(initial.r, initial.c, dir)) continue;
        const u = unitOf(initial.rec, initial.key, initial.r, initial.c, dir, model); u.uid = initial.uid;
        layout.units[i] = u; const value = valueOf();
        if (value > score + 1e-6) { best = u; score = value; }
      }
      layout.units[i] = best; out.dirs.set(best.uid, best.dir); yield;
    }
    out.reserved = facingPlan.reserved;
    yield* repairBossBodySteps(layout, out, pgd, ps, map, occupied);
    return finish();
  }
  for (const p of seedPlan ? [] : order) {
    const r0 = rec(p);
    if (!r0) continue;
    const start = placement?.starts?.get(p.uid);
    if (start) {
      const unit = unitOf(r0, start.key, start.r, start.c, start.dir, model); unit.uid = p.uid;
      layout.units.push(unit); out.set(p.uid, start.key); out.dirs.set(p.uid, start.dir);
      yield; continue;
    }
    let best = null;
    let bestV = -Infinity;
    // a "只能部署在召唤者攻击范围内" summon (伺夜's 狼群, 缪尔赛思's 流形): only the tiles of its owner's range
    const within = p.kind === 'token' && typeof ps.summonRange === 'function' ? ps.summonRange(p) : null;
    // and an outside-bound one (凯尔希·思衡托's 战术锚点): never a tile of its owner's range
    const without = p.kind === 'token' && typeof ps.summonExcluded === 'function' ? ps.summonExcluded(p) : null;
    // ground tiles for a MELEE blocker. placeClass 'all' on a MELEE record is a chess whose trait reads 「可以放置于远程位」
    // (歌蕾蒂娅, 崖心, 见行者, any module): it may stand on a 高台, and when one of those tiles covers the enemy road it is
    // planned there even with the ground free (owner 2026-10-04: the bot uses the 高台; 2026-10-05: every such chess).
    const cls = p.kind === 'token' ? positionClass(r0) : placeClass(ps, pgd.chess(p.id) || r0);
    const lineGate = linePlacementGate(model, r0, [...legalTiles(map, cls)].filter(([r, c]) => !taken.has(tileKey(r, c))), layoutDirs(layout, p.uid));
    if (lineGate) lineGates.set(p.uid, lineGate);
    const preferHigh = cls === 'all' && basePositionClass(r0) === 'melee';
    let bestHigh = null;
    let bestHighV = -Infinity;
    // a blocker whose range is its own tile only (range 0-1: 角峰, 古米, 泡泡, 折桠, 菲莱, 蛇屠箱, 塞雷娅, 余) neither blocks nor
    // hits anything off the enemy road — the official range "0-1" (excel range_table) is the one grid (0,0) — so a free road tile
    // comes first (the kill estimate saturates in a full layout and then cannot tell the tiles apart)
    const actualGround = model.routes.some((rt) => !rt.fly && !rt.fallback && rt.n > 0);
    const preferRoad = isBlocker(r0) && (r0.rangeGrid?.length === 1 && r0.rangeGrid[0].every((v) => v === 0)
      || layout.formationRoles && isFormationAnchor(r0)) && (!layout.formationRoles || actualGround);
    let bestRoad = null;
    let bestRoadV = -Infinity;
    for (const [r, c] of legalTiles(map, cls)) {
      const k = tileKey(r, c);
      if (taken.has(k) || (within && !within.has(k)) || (without && without.has(k))) continue;
      const noise = rng() * 1e-6;
      const seen = new Set();
      for (const dir of layoutDirs(layout, p.uid)) {
        if (lineGate && !lineGate.allows(r, c, dir)) continue;
        const u = unitOf(r0, k, r, c, dir, model);
        // (the same covered tiles under a different airflow ATK factor are a different candidate)
        const sig = `${u.atkMul}|${[...u.cover].sort().join(' ')}${layout.humanLessons ? '|' + [...u.healCover].sort().join(' ') : ''}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        layout.units.push(u);
        const v = layout.value() + noise;
        layout.units.pop();
        if (v > bestV) { bestV = v; best = [k, r, c, dir]; }
        // (the best road tile by the same value)
        if (preferRoad && model.ground.has(k) && v > bestRoadV) { bestRoadV = v; bestRoad = [k, r, c, dir]; }
        if (preferHigh && map.get(k) === 'ranged' && [...u.cover].some((ck) => model.ground.has(ck)) && v > bestHighV) {
          bestHighV = v;
          bestHigh = [k, r, c, dir];
        }
      }
    }
    const pick = bestHigh || bestRoad || best;
    if (!pick) continue;
    taken.add(pick[0]);
    const unit = unitOf(r0, pick[0], pick[1], pick[2], pick[3], model);
    unit.uid = p.uid;
    layout.units.push(unit);
    out.set(p.uid, pick[0]);
    out.dirs.set(p.uid, pick[3]);
    yield;
  }
  // Revisit facing after neighbours exist: a positional layer engine may have been placed before its recipient.
  for (let i = 0; i < layout.units.length; i++) {
    const initial = layout.units[i];
    if (placement?.starts?.has(initial.uid)) continue;
    let best = initial, score = layout.value();
    for (const dir of layoutDirs(layout, initial.uid)) {
      if (dir === initial.dir) continue;
      if (lineGates.has(initial.uid) && !lineGates.get(initial.uid).allows(initial.r, initial.c, dir)) continue;
      const trial = unitOf(initial.rec, initial.key, initial.r, initial.c, dir, model);
      trial.uid = initial.uid;
      layout.units[i] = trial;
      const value = layout.value();
      if (value > score + 1e-6) { best = trial; score = value; }
    }
    layout.units[i] = best;
    out.dirs.set(initial.uid, best.dir);
    yield;
  }
  // A future prep trigger needs a real neighbour. Try empty legal tiles beside the intended recipient, comparing
  // the same combat + layer objective; this may keep the combat layout when the adjacency costs too much coverage.
  if (plan.strategy && (plan.route?.supports?.includes('swiftShip') || plan.enginePolicy && ps.bonds.swiftShip?.active)) {
    const bell = layout.units.findIndex((u) => pgd.baseIdOf(u.rec.chessId) === plan.strategy.ids.suzuran);
    const target = layout.units.find((u) => pgd.baseIdOf(u.rec.chessId) === plan.strategy.ids.honeysuckle);
    if (bell >= 0 && target) {
      const initial = layout.units[bell];
      let best = initial, score = layout.value();
      const blocked = new Set([...occupied, ...layout.units.filter((u, i) => i !== bell).map((u) => u.key)]);
      const cls = placeClass(ps, pgd.chess(initial.rec.chessId));
      for (const dir of layoutDirs(layout, initial.uid)) for (let step = 1; step <= (initial.rec.isGolden ? 2 : 1); step++) {
        const [dr, dc] = rotateOffset(0, step, dir), r = target.r - dr, c = target.c - dc, key = tileKey(r, c);
        if (blocked.has(key) || !canPlace(map, cls, r, c)) continue;
        const trial = unitOf(initial.rec, key, r, c, dir, model); trial.uid = initial.uid;
        layout.units[bell] = trial;
        const value = layout.value();
        if (value > score + 1e-6) { best = trial; score = value; }
      }
      layout.units[bell] = best;
      out.set(initial.uid, best.key); out.dirs.set(initial.uid, best.dir);
      yield;
    }
  }
  // Recipe-proposed local moves still obey terrain, occupancy, line-fire gates and the shared combat objective.
  for (const candidate of plan.strategy?.layoutCandidates?.(pgd, layout.units, plan, ps.bonds) || []) {
    const i = layout.units.findIndex((u) => u.uid === candidate.uid);
    if (i < 0) continue;
    const initial = layout.units[i], { r, c } = candidate, key = tileKey(r, c);
    if (anchors.has(initial.uid)) continue;
    if (placement?.starts?.has(initial.uid)) continue;
    if (occupied.has(key) || !canPlace(map, placeClass(ps, pgd.chess(initial.rec.chessId)), r, c)) continue;
    const j = layout.units.findIndex((u, n) => n !== i && u.key === key), displaced = j >= 0 ? layout.units[j] : null;
    if (displaced && anchors.has(displaced.uid)) continue;
    if (displaced && placement?.starts?.has(displaced.uid)) continue;
    if (displaced && (!canPlace(map, placeClass(ps, pgd.chess(displaced.rec.chessId)), initial.r, initial.c)
      || (lineGates.has(displaced.uid) && !lineGates.get(displaced.uid).allows(initial.r, initial.c, displaced.dir)))) continue;
    let best = initial, bestOther = displaced, score = layout.value();
    if (displaced) {
      const trial = unitOf(displaced.rec, initial.key, initial.r, initial.c, displaced.dir, model); trial.uid = displaced.uid;
      layout.units[j] = trial;
    }
    for (const dir of layoutDirs(layout, initial.uid)) {
      if (lineGates.has(initial.uid) && !lineGates.get(initial.uid).allows(r, c, dir)) continue;
      const trial = unitOf(initial.rec, key, r, c, dir, model); trial.uid = initial.uid;
      layout.units[i] = trial;
      const value = layout.value();
      if (value > score + 1e-6) { best = trial; bestOther = displaced ? layout.units[j] : null; score = value; }
    }
    layout.units[i] = best;
    out.set(initial.uid, best.key); out.dirs.set(initial.uid, best.dir);
    if (displaced) {
      layout.units[j] = bestOther;
      out.set(displaced.uid, bestOther.key); out.dirs.set(displaced.uid, bestOther.dir);
    }
    yield;
  }
  // All melee positions are now known. Repair ranged positions AND facings last, so adjacency / recipe moves cannot
  // rotate a dealer back toward the rear. This is shared by generic growth and every core recipe, never legacy.
  // Quiet Raid starts and not-yet-occupied projected landings are not a stable blocking line.
  // Opt-in until paired evaluations show consistent gains; a geometry fix is not automatically a stronger policy.
  if (fireControl) yield* refineSquadSteps(layout, out, ps, pgd, map, occupied, lineGates, anchors);
  const allFronts = !fireControl && m.opts.botFrontlineRepair === true
    ? engagementFronts(model, layout.units.filter((u) => !layout.raidLandings?.has(u.uid))) : [];
  if (allFronts.length) for (let i = 0; i < layout.units.length; i++) {
    const initial = layout.units[i];
    if (initial.rec.position !== 'RANGED' || initial.heal || !initial.ground || placement?.starts?.has(initial.uid)) continue;
    // This is a minimum support constraint, not a command to move an already useful layer/skill partner across
    // the map to cover more branches. Preserve its existing assignment when it already serves a real front.
    const served = allFronts.filter((f) => initial.cover.has(f.key));
    const fronts = served.length ? served : allFronts;
    const start = frontlineCoverage(fronts, initial.cover, initial.key);
    if (start.covered > 0 && start.protectedFlow >= start.covered && start.upstream > 0) continue;
    const piece = pieces.find((p) => p.uid === initial.uid);
    if (!piece || piece.kind !== 'chess') continue;
    const blocked = new Set([...occupied, ...layout.units.filter((_, j) => j !== i).map((u) => u.key)]);
    const cls = placeClass(ps, pgd.chess(piece.id) || initial.rec);
    let best = initial, rank = frontlineCoverage(fronts, initial.cover, initial.key), score = layout.value();
    for (const [r, c] of legalTiles(map, cls)) {
      const key = tileKey(r, c);
      if (blocked.has(key)) continue;
      for (const dir of layoutDirs(layout, initial.uid)) {
        if (lineGates.has(initial.uid) && !lineGates.get(initial.uid).allows(r, c, dir)) continue;
        const trial = unitOf(initial.rec, key, r, c, dir, model); trial.uid = initial.uid;
        const next = frontlineCoverage(fronts, trial.cover, key);
        const fields = ['covered', 'protectedFlow', 'upstream'];
        const difference = fields.map((f) => next[f] - rank[f]).find((d) => Math.abs(d) > 1e-6) || 0;
        if (difference < 0) continue;
        layout.units[i] = trial;
        const value = layout.value();
        if (difference > 0 || value > score + 1e-6) { best = trial; rank = next; score = value; }
      }
    }
    layout.units[i] = best;
    out.set(initial.uid, best.key); out.dirs.set(initial.uid, best.dir);
    yield;
  }
  if (m.wave && m.round < m.gd.bossRound && plan.strategy?.repairContact) {
    plan.strategy.repairContact(m, ps, layout.units, out, model, { unitOf, map, occupied,
      scoreLayout: () => layout.value(),
      allows: (uid, r, c, dir) => !lineGates.has(uid) || lineGates.get(uid).allows(r, c, dir) });
  }
  if (plan.strategy?.bossLayoutValue && model.bossBodies.length) {
    if (bossFocus) yield* repairBossBodySteps(layout, out, pgd, ps, map, occupied);
    out.bossMissing = bossMissing(layout);
  }
  return finish();
}

/** Whole-team coordinate search. Every trial, including a displaced neighbour, uses Layout.value(). */
function* refineSquadSteps(layout, out, ps, gd, map, occupied, lineGates, anchors) {
  const units = layout.units, pieces = layout.growth.plan.ps?.allChess() || ps.allChess();
  const byUid = new Map(pieces.map(p => [p.uid, p]));
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (let i = 0; i < units.length; i++) {
      const initial = units[i], piece = byUid.get(initial.uid);
      if (!piece || layout.raidLandings?.has(initial.uid) || layout.fixed?.has(initial.uid)) continue;
      let best = initial, otherBest = null, otherIndex = -1, score = layout.value();
      const cells = anchors.has(initial.uid) ? [[initial.r, initial.c]] : legalTiles(map, placeClass(ps, gd.chess(piece.id)));
      for (const [r, c] of cells) {
        const key = tileKey(r, c); if (occupied.has(key)) continue;
        const j = units.findIndex((u, n) => n !== i && u.key === key), other = j < 0 ? null : units[j];
        const otherPiece = other && byUid.get(other.uid);
        if (other && anchors.has(other.uid)) continue;
        if (other && (!otherPiece || layout.raidLandings?.has(other.uid)
          || !canPlace(map, placeClass(ps, gd.chess(otherPiece.id)), initial.r, initial.c)
          || lineGates.has(other.uid) && !lineGates.get(other.uid).allows(initial.r, initial.c, other.dir))) continue;
        if (other) {
          const v = unitOf(other.rec, initial.key, initial.r, initial.c, other.dir, layout.model); v.uid = other.uid;
          units[j] = v;
        }
        for (const dir of layoutDirs(layout, initial.uid)) {
          if (lineGates.has(initial.uid) && !lineGates.get(initial.uid).allows(r, c, dir)) continue;
          const u = unitOf(initial.rec, key, r, c, dir, layout.model); u.uid = initial.uid; units[i] = u;
          const value = layout.value();
          if (value > score + 1e-6) { best = u; otherBest = other ? units[j] : null; otherIndex = j; score = value; }
        }
        if (other) units[j] = other;
      }
      units[i] = best; out.set(best.uid, best.key); out.dirs.set(best.uid, best.dir);
      if (otherBest) { units[otherIndex] = otherBest; out.set(otherBest.uid, otherBest.key); out.dirs.set(otherBest.uid, otherBest.dir); }
      if (best !== initial) improved = true;
      yield;
    }
    if (!improved) break;
  }
}

function bossMissing(layout) {
  const bodies = layout.model.bossBodies || [];
  if (!bodies.length) return 0;
  return layout.units.filter((u) => u.ground && !u.heal && u.dps > 0
    && bossCoverageRequired(layout, u)
    && !bodies.some((b) => b.tiles.some((k) => (layout.raidLandings?.get(u.uid)?.cover || u.cover).has(k)))).length;
}

function bossCoverageRequired(layout, u) {
  const { gd, plan } = layout.growth;
  return plan.strategy?.bossCoverageRequired?.(gd, u, plan) !== false;
}

/** Final fixed-body check after adjacency/facing refinements. Never sacrifice another dealer's valid coverage. */
function* repairBossBodySteps(layout, out, gd, ps, map, occupied) {
  const pieces = layout.growth.plan.pieces;
  if (!layout.model.bossBodies?.length) return;
  for (let pass = 0; pass < layout.units.length && bossMissing(layout); pass++) {
    let improved = false;
    for (let i = 0; i < layout.units.length; i++) {
      const initial = layout.units[i];
      if (!initial.ground || initial.heal || initial.dps <= 0 || !bossCoverageRequired(layout, initial) || layout.raidLandings?.has(initial.uid)
        || layout.model.bossBodies.some((b) => b.tiles.some((k) => initial.cover.has(k)))) continue;
      let best = initial, otherBest = null, otherIndex = -1, missing = bossMissing(layout), score = layout.value();
      const cls = placeClass(ps, gd.chess(pieces.get(initial.uid).id));
      for (const [r, c] of legalTiles(map, cls)) {
        const key = tileKey(r, c); if (occupied.has(key)) continue;
        const j = layout.units.findIndex((u, n) => n !== i && u.key === key), displaced = j < 0 ? null : layout.units[j];
        if (displaced && (layout.raidLandings?.has(displaced.uid)
          || !canPlace(map, placeClass(ps, gd.chess(pieces.get(displaced.uid).id)), initial.r, initial.c))) continue;
        if (displaced) {
          const v = unitOf(displaced.rec, initial.key, initial.r, initial.c, displaced.dir, layout.model);
          v.uid = displaced.uid; layout.units[j] = v;
        }
        for (const dir of layoutDirs(layout, initial.uid)) {
          const u = unitOf(initial.rec, key, r, c, dir, layout.model); u.uid = initial.uid; layout.units[i] = u;
          const next = bossMissing(layout), value = layout.value();
          if (next < missing || next === missing && value > score + 1e-6) {
            best = u; otherBest = displaced ? layout.units[j] : null; otherIndex = j; missing = next; score = value;
          }
        }
        if (displaced) layout.units[j] = displaced;
      }
      layout.units[i] = best;
      if (otherBest) { layout.units[otherIndex] = otherBest; out.set(otherBest.uid, otherBest.key); out.dirs.set(otherBest.uid, otherBest.dir); }
      if (best !== initial) improved = true;
      out.set(best.uid, best.key); out.dirs.set(best.uid, best.dir); yield;
    }
    if (!improved) break;
  }
  out.bossMissing = bossMissing(layout);
}

/** A plan's direction for a piece (plans without directions ⇒ RIGHT). */
const planDir = (plan, uid) => (plan && plan.dirs instanceof Map ? plan.dirs.get(uid) : null) ?? 'RIGHT';

/** Layout-model variants the rehearsal compares (the first one is the default plan). */
export const REHEARSAL_VARIANTS = Object.freeze([
  {},
  { spread: 3, secondHold: 0.2 },
  { hold: 2 },
  { hold: 8 },
  { kill: 3 },
]);

/** Distinct plans (same unit → tile assignment ⇒ one candidate), in order. */
function distinctPlans(plans) {
  const out = [];
  const seen = new Set();
  for (const plan of plans) {
    const sig = [...plan.entries()].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}@${k}:${planDir(plan, u)}`).join(' ');
    if (!seen.has(sig)) { seen.add(sig); out.push(plan); }
  }
  return out;
}

/** Counted leaks of the bot's player in a (possibly still running) rehearsal battle. */
function countedLeaks(battle, playerId) {
  const r = battle.result();
  const pp = r && r.perPlayer && r.perPlayer[playerId];
  return pp ? (pp.leaked || []).filter((l) => l && l.counted !== false).length : 0;
}

/**
 * Rehearsal job: a player "tries out" candidate layouts — each distinct plan (up to m.botRehearsal) is simulated once
 * against the round's enemies with the real Battle (a rehearsal seed, never the real battle's; no onBattleStart meta
 * dispatch, so it has no side effect on the match) and the plan with the fewest counted leaks (then most kills) wins.
 * Every candidate's Battle is built right away (each layout is on the board only while its input is taken; the board
 * is restored exactly before this returns), so the job can be stepped later: `job.run(budgetMs)` simulates until the
 * wall-clock budget is used (checked every 4 ticks) and returns true once every candidate is done. A candidate whose
 * counted leaks already exceed the best finished one's stops early (it can no longer win).
 * A whole rehearsal is 0.2–1 s of CPU late in a 4-bot match: Match runs it in bounded slices between other callbacks.
 * @returns {null | { chosen: any[], plans: Array<Map<number, string>>, best: Map<number, string>, done: boolean, run: (budgetMs?: number) => boolean }}
 *   null when there is nothing to compare (no wave, < 2 distinct plans, rehearsal off)
 */
export function createRehearsal(m, ps, chosen, plans) {
  return runSteps(createRehearsalSteps(m, ps, chosen, plans));
}

/**
 * createRehearsal as a step generator: yields after each candidate's Battle is built. Each candidate puts its layout on
 * the board, takes the battle input and restores the board exactly before the next yield — a bot prep dropped between
 * two steps (the prep ended) never leaves a rehearsal layout on the board.
 */
export function* createRehearsalSteps(m, ps, chosen, plans) {
  const wave = m.wave;
  const distinct = distinctPlans(plans);
  if (!wave || distinct.length < 2 || !(m.botRehearsal > 0)) return null;
  const cands = distinct.slice(0, m.botRehearsal);
  const recipe = coreStrategy(m, ps._botFocusId);
  const layerRehearsal = (!!recipe?.rehearsalValue || recipe?.rehearsalInputSteps) && m.round < m.gd.bossRound;
  const byUid = new Map([...chosen, ...cands.flatMap((p) => p.lineup || [])].map((p) => [p.uid, p]));
  const battles = [];
  for (const plan of cands) {
    const saved = [...ps.board.entries()];
    // the candidate's directions are set on the pieces while its input is taken; restored exactly afterwards
    const savedDirs = new Map([...byUid.values(), ...saved.map(([, p]) => p)].map((p) => [p, Object.hasOwn(p, 'dir') ? { v: p.dir } : null]));
    let failed = false;
    try {
      let input;
      if (recipe?.rehearsalInputSteps) input = yield* recipe.rehearsalInputSteps(m, ps, plan.lineup || chosen, plan, { bossInputSteps });
      else {
        ps.board.clear();
        for (const [uid, k] of plan) { const p = byUid.get(uid); if (p) { p.dir = planDir(plan, uid); ps.board.set(k, p); } }
        ps.recompute();
        input = ps.battleInput({ side: 'L', colOffset: 0 });
      }
      const spawns = withBounties(m.gd, m.round, wave, ps.bounties, ps.playerId).map((sp) => ({ ...sp, ownerPlayerId: ps.playerId }));
      battles.push(m.newBattle({
        seed: deriveSeed(m.seed, `rehearse:${m.round}:${ps.seat}`), kind: 'normal', modeId: m.modeId, round: m.round,
        stageId: m.stageId, rect: { ...GEO.NORMAL_RECT }, timeLimit: wave.timeLimit, players: [input],
        spawns: m._sanitizeSpawns(spawns, ps.playerId), routes: wave.routes, sharedBoss: null,
        flags: { layerGainsEnabled: layerRehearsal, ...m.gd.dp }, fieldId: `r:${ps.playerId}`, enemyOverrides: wave.overrides, waveId: wave.templateId,
      }));
    } catch (e) {
      failed = true;
      m.log.warn?.(`[match ${m.roomCode}] bot rehearsal failed: ${e && e.message}`);
    } finally {
      if (!recipe?.rehearsalInputSteps) {
        ps.board.clear();
        for (const [p, d] of savedDirs) { if (d) p.dir = d.v; else delete p.dir; }
        for (const [k, p] of saved) ps.board.set(k, p);
        ps.recompute();
      }
    }
    if (failed) break;
    yield;
  }
  const cap = Math.ceil(((wave.timeLimit || 60) + 5) * 30);
  let i = 0;
  let t = 0;
  let bestScore = -Infinity;
  let bestLeaks = Infinity;
  const job = {
    chosen,
    plans: cands,
    best: cands[0],
    done: false,
    run(budgetMs = Infinity) {
      const timed = Number.isFinite(budgetMs);
      const t0 = timed ? performance.now() : 0;
      let n = 0;
      while (i < battles.length) {
        // a candidate that ended mid-slice (finished, cap, or beaten at a 64-tick check that skipped the budget test):
        // check the budget before stepping the next one, so a slice never exceeds 4 ticks past its budget
        if (timed && n > 0 && performance.now() - t0 >= budgetMs) return false;
        const battle = battles[i];
        try {
          let beaten = false;
          while (t < cap && !battle.finished) {
            battle.step();
            t++;
            n++;
            if ((t & 63) === 0 && bestLeaks < Infinity && countedLeaks(battle, ps.playerId) > bestLeaks) { beaten = true; break; }
            if (timed && (n & 3) === 0 && performance.now() - t0 >= budgetMs) return false;
          }
          if (!beaten) {
            if (!battle.finished) battle.forceEnd('timeout');
            const r = battle.result();
            const pp = r && !r.synthetic && r.perPlayer && r.perPlayer[ps.playerId];
            if (pp) {
              const leaks = (pp.leaked || []).filter((l) => l && l.counted !== false).length;
              // Layers are a tie-breaker only after exactly equal leak and kill outcomes. Never trade LP for farming.
              const score = -leaks * 1000 + (pp.killed || 0) - i * 0.01;
              const layerValue = recipe?.rehearsalValue?.(m, ps, pp) || 0;
              const tie = job.outcomes?.find((o) => o.index === job.bestIndex);
              (job.outcomes ||= []).push({ index: i, leaks, killed: pp.killed || 0, deaths: pp.deaths || 0, layers: layerValue });
              const control = job.outcomes[0];
              const safe = !cands[i].lineup || cands[i].combat || (leaks <= control.leaks && (pp.killed || 0) >= control.killed && (pp.deaths || 0) <= control.deaths);
              const preferLayers = tie && leaks === tie.leaks && (pp.killed || 0) === tie.killed && layerValue > tie.layers + 0.01;
              if (safe && ((score > bestScore && !(tie && leaks === tie.leaks && (pp.killed || 0) === tie.killed && layerValue < tie.layers)) || preferLayers)) {
                bestScore = score; bestLeaks = leaks; job.best = cands[i]; job.bestIndex = i;
                job.chosen = cands[i].lineup || chosen;
              }
            }
          }
        } catch (e) {
          m.log.warn?.(`[match ${m.roomCode}] bot rehearsal failed: ${e && e.message}`);
        }
        battles[i] = null;
        i++;
        t = 0;
      }
      job.done = true;
      return true;
    },
  };
  return job;
}

/**
 * Synchronous rehearsal (tools, tests): see createRehearsal. The board is restored exactly afterwards.
 * @returns {Map<number, string>} the chosen plan
 */
export function rehearse(m, ps, chosen, plans) {
  const job = createRehearsal(m, ps, chosen, plans);
  if (!job) return distinctPlans(plans)[0] || plans[0];
  job.run();
  return job.best;
}

// ---------------------------------------------------------------------------------------------------
// prep routine

function tryDo(fn) {
  try { const r = fn(); return !!(r && r.ok); } catch { return false; }
}

function canUseItem(m, ps, item) {
  const rec = m.gd.item(item.id);
  if (!rec) return false;
  if (coreStrategy(m, ps._botFocusId)?.itemAllowed?.(rec) === false) return false;
  if (rec.itemType === 'MAGIC') return m.registry.has('item:' + itemKey(item.id));
  const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
  if (consume) return m.registry.has('item:' + itemKey(item.id));
  return true;
}

function context(m, ps) {
  const owned = ownedBonds(m, ps);
  const model = fieldModel(m, ps);
  const plan = bondPlan(m, ps, owned);
  const copies = copyCounts(m, ps);
  let pairs = 0;
  for (const [b, k] of copies) if (k + 1 >= mergeNeed(m, b)) pairs++;
  return { ps, owned, focus: plan.focus, second: plan.second, route: plan.route, strategy: plan.strategy, enginePolicy: plan.enginePolicy, growth: new Map(), deck: [...ps.board.values(), ...ps.hand].filter((p) => p?.kind === 'chess'), keep: keeperBases(m, ps, plan), copies, pairs, roles: roles(m, ps), fly: model.flyTotal, model };
}

/** Optional policy bookkeeping around an actual economic action; the action and its RNG are unchanged. */
function spendAction(m, ps, action) {
  const settled = coreStrategy(m, ps._botFocusId)?.observeSpend?.(m, ps);
  const result = action();
  settled?.();
  return result;
}

/** Recipe-protected layer engines survive bench shedding, layout withdrawals and destructive item choices. */
function preserveChess(m, ps, p) {
  return p?.kind === 'chess' && (!botSaleAllowed(m, ps, p) || !!coreStrategy(m, ps._botFocusId)?.preserve?.(m, ps, chessRec(m, p.id, ps)));
}

function sellChess(m, ps, p) {
  return !preserveChess(m, ps, p) && tryDo(() => botSell(m, ps, p.uid));
}

/** Normal copies owned per base (board, hand, temp). */
function copyCounts(m, ps) {
  const out = new Map();
  for (const p of ps.allChess()) {
    if (m.gd.isGolden(p.id)) continue;
    const b = m.gd.baseIdOf(p.id);
    out.set(b, (out.get(b) || 0) + 1);
  }
  return out;
}

/**
 * Expected value of one shop refresh: Σ over the owned bases one copy short of an elite of P(the refresh shows a copy)
 * × MERGE_HIT, plus the keeper singles × PAIR_HIT. P = 1 − (1 − left / eligible copies)^chess slots — the shop's
 * copy-weighted roll over the shared pool's tiers ≤ shop level (PlayerState._rollChessSlot, pool.js roll).
 */
function refreshValue(m, ps, ctx) {
  const L = ps.shop.level;
  let total = 0;
  for (const e of m.pool.entries.values()) if (e.left > 0 && e.tier <= L) total += e.left;
  if (!(total > 0)) return 0;
  const slots = m.gd.shopSlots(L).chess;
  let v = 0;
  for (const [b, k] of ctx.copies) {
    const e = m.pool.entries.get(b);
    if (!e || e.left <= 0 || e.tier > L) continue;
    const pShop = 1 - (1 - e.left / total) ** slots;
    if (k + 1 >= mergeNeed(m, b)) v += pShop * MERGE_HIT;
    else if (ctx.keep.has(b)) v += pShop * PAIR_HIT;
  }
  return v;
}

/**
 * Sell the weakest bench chess (temp and hand; the hand only with `handOnly`) that is not part of a merge pair (or
 * anything when keepPairs is false) and does not carry a 突变细胞 (its transformation after the battle is the point).
 * `keepFresh`: never a piece that came this prep (`boughtRound`: bought for the lineup, an elite just merged, a reward)
 * nor one gained since the bot's last prep ended (unseen, see rememberOwned: the operator a 突变细胞 transformation
 * gains joins the bench while its carrier's deployment is free — the placement step decides about it, not the shed's
 * piece value).
 */
function sellWeakestHand(m, ps, { keepPairs = true, below = Infinity, handOnly = false, keepFresh = false } = {}) {
  const ctx = context(m, ps);
  let worst = null;
  let worstV = Infinity;
  for (const p of handOnly ? ps.hand : [...ps.temp, ...ps.hand]) {
    if (!p || p.kind !== 'chess' || (p.items || []).some((it) => isMutationCell(m.gd, it.id))) continue;
    if (preserveChess(m, ps, p)) continue;
    const base = m.gd.baseIdOf(p.id);
    if (ctx.strategy?.keep(m, ps, chessRec(m, p.id, ps), ctx)) continue;
    if (keepPairs && !m.gd.isGolden(p.id) && (ctx.copies.get(base) || 0) >= 2) continue;
    if (keepFresh && (p.boughtRound === m.round || unseen(ps, p))) continue;
    const v = pieceValue(m, ps, p, ctx);
    if (v < worstV) { worstV = v; worst = p; }
  }
  if (!worst || worstV >= below) return false;
  return sellChess(m, ps, worst);
}

/**
 * The chess the bot owned when its last prep ended (`ps._botSeenUids`, written by botPrepEndSteps before Ready). A
 * piece outside it was gained after that prep — at SETTLE (a 突变细胞 transformation's operator, battle-result grants),
 * at the round start or in 机变 — and has not been through a placement step yet. No memory yet (a bot's first prep, a
 * seat just put under AI 托管): nothing counts as unseen.
 */
function rememberOwned(ps) {
  ps._botSeenUids = new Set(ps.allChess().map((p) => p.uid));
}
const unseen = (ps, p) => !!ps._botSeenUids && !ps._botSeenUids.has(p.uid);

/** Lineup gain of one copy of chess `id` (full board): best single swap into the current best lineup `cur`. */
function lineupGain(m, ps, id, ctx, cur) {
  const probe = { uid: -1, kind: 'chess', id, items: [] };
  let best = cur.score;
  for (let i = 0; i < cur.set.length; i++) {
    const trial = cur.set.slice();
    trial[i] = probe;
    best = Math.max(best, lineupScore(m, ps, trial, ctx));
  }
  return best - cur.score;
}

/**
 * Prep start: sell bench chess that neither make the lineup nor build toward something (a pair that can still
 * merge, the focus bond, an elite) — they only block merges; the refund buys more. Keeps a few spare bench units.
 */
function sellJunk(m, ps) {
  const ctx = context(m, ps);
  const { bench } = chooseLineup(m, ps, ctx);
  const keep = [];
  const junk = [];
  for (const p of bench) {
    if (preserveChess(m, ps, p)) continue;
    const c = chessRec(m, p.id, ps);
    if (!c) continue;
    const base = m.gd.baseIdOf(p.id);
    const copies = c.isGolden ? 0 : ctx.copies.get(base) || 0;
    // a pair whose third copy can still come (the merge's reward is worth it for any pair)
    const pairLive = copies + 1 >= mergeNeed(m, base) && (m.pool.left(base) > 0 || !m.pool.has(base));
    const useful = c.isGolden || pairLive || ctx.keep.has(base) || (copies >= 2 && m.round <= 6);
    (useful ? keep : junk).push({ p, v: pieceValue(m, ps, p, ctx) + (pairLive ? 150 : useful ? 100 : 0) });
  }
  // bench budget: at most BENCH_BUDGET spare units beyond the lineup (pairs first)
  const all = keep.concat(junk).sort((a, b) => b.v - a.v);
  for (const { p } of all.slice(BENCH_BUDGET)) sellChess(m, ps, p);
  for (const { p } of junk.slice(0, 4)) if (m.round >= 5 && ps.find(p.uid)) sellChess(m, ps, p);
}

/** Take the queued pick-one offers (merge rewards, special refreshes — free; they expire at prep end). */
function takeOffers(m, ps) {
  const gd = ps?.gd || m.gd;
  coreStrategy(m, ps._botFocusId)?.cleanupAcquisitions?.(m, ps);
  for (let guard = 0; guard < 4 && ps.offers.length; guard++) {
    const offer = ps.offers[0];
    const ctx = context(m, ps);
    let best = -1;
    let bestS = -Infinity;
    let bestPriority = -Infinity;
    offer.slots.forEach((s, i) => {
      if (s.sold) return;
      if (s.kind === 'chess' && ctx.strategy?.rewardAllowed?.(m, ps, gd.chess(s.id)) === false) return;
      if (s.kind === 'item' && ctx.strategy?.itemAllowed?.(gd.item(s.id)) === false) return;
      const sc = s.kind === 'item' ? (canUseItem(m, ps, s) ? 10 : 1) + gd.tierOf(s.id) * 3
        + Math.max(economyItemBonus(m, ps, gd.item(s.id)), ctx.strategy?.itemBonus(m, ps, gd.item(s.id)) || 0) : buyScore(m, ps, s.id, ctx, true);
      const priority = ctx.strategy?.rewardPriority?.(m, ps, s) ?? 0;
      if (priority > bestPriority || priority === bestPriority && sc > bestS) { bestS = sc; bestPriority = priority; best = i; }
    });
    if (best < 0) {
      if (!ctx.strategy?.rewardAllowed) break;
      // Decline an all-disallowed offer rather than acquiring an unrelated card for its tier/merge score.
      ps.offers.shift(); ps.dirty();
      const stats = ps._botRecipeStats ||= {}; stats.draftOffersDeclined = (stats.draftOffersDeclined || 0) + 1;
      continue;
    }
    if (freeSlot(ps.hand) < 0 && !(ctx.strategy?.shoppingRepair && freeShoppingSlot(m, ps))) sellWeakestHand(m, ps, { keepPairs: false });
    if (!tryDo(() => ps.pickReward(best))) {
      // could not take it (sold out / no room): drop the offer
      ps.offers.shift();
      ps.dirty();
    }
    ctx.strategy?.cleanupAcquisitions?.(m, ps);
  }
}

/**
 * Prep routine up to the final arrangement, whose default plan is already on the board. Returns the layout
 * rehearsal still to run (Match steps it in wall-clock-bounded slices, then calls botPrepEnd) or null.
 */
export function botPrepBegin(m, ps) {
  return runSteps(botPrepBeginSteps(m, ps));
}

/**
 * botPrepBegin as a step generator (the same actions in the same order, hence the same rng draws and decisions): it
 * yields between whole prep actions — never while the board holds a transient layout — so Match.scheduleBotPrep runs
 * it in wall-clock-bounded slices like the rehearsal (50–120 ms of planning in one callback late in a 4-bot match
 * otherwise). Returns the rehearsal job (or null).
 */
export function* botPrepBeginSteps(m, ps) {
  if (!ps.alive || ps.ready) return null;
  // Opt-in opening observations precede personal choices, rewards, items and all economy actions.
  coreStrategy(m, ps._botFocusId)?.prepStart?.(m, ps);
  m.autoPickPersonalChoice(ps, 'bot');
  // 1. reward offers (free)
  takeOffers(m, ps);
  useEconomyItems(m, ps);
  coreStrategy(m, ps._botFocusId)?.useEconomy(m, ps);
  yield;
  // 2. economy: dead bench weight back to funds, units toward a full board, the level curve, then everything else;
  //    merges completed while buying queue reward offers that expire at prep end — take them right away
  sellJunk(m, ps);
  yield;
  const economySteps = coreStrategy(m, ps._botFocusId)?.beforeEconomySteps;
  if (economySteps) yield* economySteps(m, ps, { LayoutPlan });
  if (coreStrategy(m, ps._botFocusId)?.priorityLevel(m, ps)) levelUp(m, ps);
  yield* buyLoopSteps(m, ps, { fillOnly: true, maxRefreshes: 0 });
  takeOffers(m, ps);
  levelUp(m, ps);
  yield;
  yield* buyLoopSteps(m, ps, { fillOnly: false, maxRefreshes: MAX_REFRESHES });
  takeOffers(m, ps);
  levelUp(m, ps, { spare: true });
  if (coreStrategy(m, ps._botFocusId)?.spendAllFunds && !m.gd.leftoverKeptBands.includes(ps.bandId)) {
    // No further upgrade is planned this prep: release recipe reserves and spend expiring funds on useful cards.
    coreStrategy(m, ps._botFocusId)?.bankRemainder?.(m, ps);
    yield* buyLoopSteps(m, ps, { spendAll: true, maxRefreshes: MAX_REFRESHES });
  }
  maybeFreeze(m, ps);
  yield;
  // 3. placement, 4. items, placement again (item carriers gain value; rehearsed when the match allows it)
  yield* arrangeSteps(m, ps);
  equipItems(m, ps);
  yield;
  if (coreStrategy(m, ps._botFocusId)?.forecast) {
    // Refunds and refresh gifts must settle before the forecast snapshots its final assets and equipment.
    for (let pass=0;pass<4;pass++) {
      yield* finishAssetsSteps(m, ps);
      m.autoPickPersonalChoice(ps, 'bot');
      yield* arrangeSteps(m, ps);
      equipItems(m, ps);
      yield;
      // Replacing a board member can require a bench sale. Spend its refund before freezing the final roster.
      if (ps.funds===0 && ps.tempEmpty && !ps.offers.length) break;
    }
  }
  return yield* arrangeSteps(m, ps, { final: true, defer: true });
}

/** Prep routine, end: the rehearsed layout (when it beat the default plan), temp, a free hand slot, Ready. */
export function botPrepEnd(m, ps, job = null) {
  runSteps(botPrepEndSteps(m, ps, job));
}

/** botPrepEnd as a step generator (see botPrepBeginSteps). */
export function* botPrepEndSteps(m, ps, job = null) {
  if (!ps.alive || ps.ready) return;
  if (job && job.done && job.best !== job.plans[0]) yield* applyPlanSteps(m, ps, job.chosen, job.best);
  // Forecast already finished all economic cleanup before trials. Do not sell/refund/redraw under a selected plan.
  if (!coreStrategy(m, ps._botFocusId)?.forecast) yield* finishAssetsSteps(m, ps);
  coreStrategy(m, ps._botFocusId)?.commitForecast?.(m, ps, job);
  // what the next prep's bench shed may judge by value: what is owned now (later gains wait for a placement step)
  rememberOwned(ps);
  m.autoPickPersonalChoice(ps, 'bot');
  const rightPlan = lucienRightPlan(m, ps, { rangeRec, rangeTiles });
  if (rightPlan) yield* applyPlanSteps(m, ps, [...ps.board.values()].filter((p) => p.kind === 'chess'), rightPlan);
  const coopRight = coopLucienRightPlan(m, ps, { rangeRec, rangeTiles });
  if (coopRight) {
    applyControlPositions(ps, coopRight);
    (ps._botSiracusaCoopHistory ||= []).push({ factor: 'coop-lucien-right', round: m.round,
      side: coopRight.side, paired: coopRight.paired, fieldZone: coopRight.fieldZone, changes: coopRight.changes,
      applied: [...coopRight].every(([uid, key]) => ps.find(uid)?.key === key && pieceDir(ps.find(uid).piece) === coopRight.dirs.get(uid)) });
  }
  const bodyPlan = largeBodyCoveragePlan(m, ps, { fieldModel, rangeRec, rangeTiles, isHealer, effDps });
  if (bodyPlan) {
    if (m.isSolo) yield* applyPlanSteps(m, ps, [...ps.board.values()].filter((p) => p.kind === 'chess'), bodyPlan);
    else applyControlPositions(ps, bodyPlan); // Fixed roster: keep deployed summons and their existing cells intact.
    if (!m.isSolo) (ps._botSiracusaCoopHistory ||= []).push({ factor: 'coop-large-body-coverage', round: m.round,
      repairs: bodyPlan.repairs, applied: [...bodyPlan].every(([uid, key]) => ps.find(uid)?.key === key
        && pieceDir(ps.find(uid).piece) === bodyPlan.dirs.get(uid)) });
  }
  const finalBoardSteps = coreStrategy(m, ps._botFocusId)?.finalBoardSteps;
  if (finalBoardSteps) yield* finalBoardSteps(m, ps, { LayoutPlan, rangeRec, rangeTiles, fieldModel, bossInputSteps, applyPlanSteps,
    *recoverEconomySteps() {
      // Explicit opt-in emergency hook: visible cards/rewards only, no extra upgrades or refreshes.
      takeOffers(m, ps); useEconomyItems(m, ps); coreStrategy(m, ps._botFocusId)?.useEconomy(m, ps);
      yield* buyLoopSteps(m, ps, { spendAll: true, maxRefreshes: 0 });
      takeOffers(m, ps); yield* arrangeSteps(m, ps); equipItems(m, ps); yield;
    },
    planLayoutSteps: (owner, pieces, options) => planLayoutSteps(m, owner, pieces, LAYOUT_PARAMS, options) });
  tryDo(() => ps.setReady(true));
}

/** Economic tail, kept in its original position for retained recipes and before trials for the new forecast. */
function* finishAssetsSteps(m, ps) {
  // 5. temp → hand / sell / destroy; keep one hand slot free for next round's merges
  if (coreStrategy(m, ps._botFocusId)?.shoppingRepair && freeSlot(ps.hand)<0) freeShoppingSlot(m, ps);
  resolveTemp(m, ps);
  if (freeSlot(ps.hand) < 0) freeHandSlot(m, ps);
  if (coreStrategy(m, ps._botFocusId)?.spendAllFunds && !m.gd.leftoverKeptBands.includes(ps.bandId)) {
    // Refresh gifts can force another cleanup sale. Repeat the real asset/refresh pass with finite refund guards.
    for (let pass = 0; pass < 4 && ps.funds > 0; pass++) {
      const before = ps.allChess().map((p) => `${p.uid}:${p.id}`).join();
      const banked = coreStrategy(m, ps._botFocusId)?.bankRemainder?.(m, ps);
      if (banked) equipItems(m, ps);
      if (coreStrategy(m, ps._botFocusId)?.shoppingRepair) {
        yield* buyLoopSteps(m, ps, { spendAll:true, maxRefreshes:64 });
      } else for (let n = 0; n < 64 && m.gd.refreshPrice > 0 && ps.funds >= m.gd.refreshPrice; n++) {
          if (!tryDo(() => spendAction(m, ps, () => ps.refresh()))) break;
          yield;
        }
      if (ps.allChess().map((p) => `${p.uid}:${p.id}`).join() !== before) {
        takeOffers(m, ps); yield* arrangeSteps(m, ps); equipItems(m, ps);
        resolveTemp(m, ps);
        if (freeSlot(ps.hand) < 0) freeHandSlot(m, ps);
      }
    }
    maybeFreeze(m, ps);
  }
}

/**
 * Free one hand slot: on a bot's own seat a kept bounty Art goes first (“神秘顾客” pays its fund and passes to a
 * teammate when destroyed, 教鞭 gives nothing — its chance of a perfect-battle payout is worth less than a slot for a
 * merge), else the weakest bench single is sold. A human's seat under AI 托管 never loses an item this way.
 */
function freeHandSlot(m, ps) {
  if (coreStrategy(m, ps._botFocusId)?.shoppingRepair && freeShoppingSlot(m, ps)) return true;
  if (ps.isBot && !ps.autoplay) {
    const art = ps.hand.find((p) => p && p.kind === 'item' && isBountyArt(m.gd, p.id));
    if (art && tryDo(() => ps.destroy(art.uid))) return true;
  }
  return sellWeakestHand(m, ps);
}

/** The whole prep routine in one go (the rehearsal, if any, runs synchronously). */
export function botPrep(m, ps) {
  const job = botPrepBegin(m, ps);
  if (job) job.run();
  botPrepEnd(m, ps, job);
}

/**
 * Freeze the shop (free) when it shows a copy that would complete a held pair and the bot cannot afford it: the unsold
 * slots are kept at the next round start (PlayerState.startRound rollShop keepFrozen), the rest rerolled.
 */
function maybeFreeze(m, ps) {
  if (coreStrategy(m, ps._botFocusId)?.freezeAfterSpending && ps.funds > 0) {
    if (ps.shop.frozen) tryDo(() => ps.freeze());
    return;
  }
  if (holdCriticalShop(m, ps)) return;
  if (coreStrategy(m, ps._botFocusId)?.holdShop && ps.shop.frozen) tryDo(() => ps.freeze());
  if (ps.shop.frozen) return;
  if (ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) > ps.funds && ps.completesChessMerge(s.id))) tryDo(() => ps.freeze());
}

/** A lock persists only while an unaffordable planned key remains; freeze() itself is a toggle. */
function holdCriticalShop(m, ps) {
  const recipe = coreStrategy(m, ps._botFocusId), gd = ps.gd || m.gd;
  if (recipe?.holdShop?.(m,ps)) {
    if (!ps.shop.frozen) tryDo(() => ps.freeze());
    return true;
  }
  if (!recipe?.shoppingRepair || !ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess'
    && (ps.priceOf(s) > ps.funds || freeSlot(ps.hand)<0) && recipe.importantBuy(m, ps, gd.chess(s.id)))) return false;
  if (!ps.shop.frozen) tryDo(() => ps.freeze());
  return true;
}

/** Before selling a chess for room, equip/consume on a legal free carrier, then destroy a spare unprotected item.
 * Bounded across automatic temp refills and reward items. Human autoplay never destroys an item here. */
export function freeShoppingSlot(m, ps) {
  const recipe = coreStrategy(m, ps._botFocusId), gd = ps.gd || m.gd;
  if (!recipe?.shoppingRepair) return false;
  const tried = new Set();
  for (let guard=0;guard<gd.benchSize + ps.temp.length + 4;guard++) {
    if (freeSlot(ps.hand)>=0) return true;
    let used = false;
    for (const item of [...ps.hand,...ps.temp]) {
      if (item?.kind!=='item' || tried.has(item.uid) || !canUseItem(m, ps, item)) continue;
      tried.add(item.uid);
      const rec = gd.item(item.id);
      if (rec.itemType!=='EQUIP' || recipe.holdItem(m, ps, rec)) continue;
      const target = itemTarget(m, ps, item);
      // Freeing space must not destroy locked equipment, including when redeeming an economic consumable.
      if (!target || (target.items?.length || 0)>=gd.equipPerChess
        || recipe.itemReplacement?.(m, ps, rec, target)===false) continue;
      if (tryDo(()=>ps.equip(item.uid,target.uid))) { used=true;break; }
    }
    if (used) continue;
    const disposable = ps.isBot && !ps.autoplay ? [...ps.hand,...ps.temp].filter(p=>p?.kind==='item'
      && !isMutationCell(gd,p.id) && !recipe.protectItem?.(m,ps,gd.item(p.id)))
      .sort((a,b)=>(gd.item(a.id)?.price||0)-(gd.item(b.id)?.price||0)||a.uid-b.uid)[0] : null;
    if (!disposable || !tryDo(()=>ps.destroy(disposable.uid))) return false;
  }
  return freeSlot(ps.hand)>=0;
}

/** Whether level `lv` of the 调度中心 opens one of the player's slotted 自选 pieces with copies left (player/diy.js). */
export function diyOpensAt(ps, lv) {
  const st = ps.diyStock;
  if (!st || !st.entries || !st.entries.size) return false;
  for (const e of st.entries.values()) if (e.shopLevel === lv && e.left > 0) return true;
  return false;
}

/** The 调度中心 level-ups of a bot's prep (exported for tests). */
export function levelUp(m, ps, { spare = false } = {}) {
  const gd = ps?.gd || m.gd;
  for (let guard = 0; guard < 6; guard++) {
    if (ps.shop.level >= gd.maxShopLevel) return;
    const price = Math.max(0, ps.shop.upgradePrice);
    if (ps.funds < price) return;
    const r = m.round;
    const recipe = coreStrategy(m, ps._botFocusId);
    // [ASSUMED] The optional late-level gate inspects the same proposed roster used by arrangement.
    // Read-only selection; no extra rehearsal, purchase, arrangement or random draw.
    const fielded = recipe?.lateUpgradeLineup && r >= gd.bossRound && ps.shop.level === 5
      ? chooseLineup(m, ps, context(m, ps)).set : null;
    const recipeTarget = recipe?.levelTarget(m, ps, { spare, fielded });
    if (recipeTarget != null && ps.shop.level >= recipeTarget) return;
    let rewardContext;
    const order = recipe?.upgradeMergeOrder?.(m, ps, { scoreReward: id => buyScore(m, ps, id, rewardContext ||= context(m, ps), true) });
    if (order && !order.upgradeFirst) {
      (ps._botMergeOrder ||= []).push({ round: r, level: ps.shop.level, funds: ps.funds, first: 'merge', current: order.current, next: order.next });
      return;
    }
    if (recipeTarget != null && !recipe.beforeUpgrade(m, order?.gatePlayer || ps, fielded ? { ...bondPlan(m, ps), fielded } : bondPlan(m, ps))) return;
    if (recipeTarget != null && price > 0 && ps.funds < price + recipe.upgradeReserve(m, ps)) return;
    const target = recipeTarget ?? LEVEL_TARGET[Math.min(LEVEL_TARGET.length - 1, r)];
    const nextTarget = LEVEL_TARGET[Math.min(LEVEL_TARGET.length - 1, r + 1)];
    // early levels only once the board is full (units first); later a 6-unit core is enough
    const boardReady = ps.allChess().length >= (r <= 4 ? ps.deployCap : Math.min(ps.deployCap, 6))
      || recipe?.readyForUpgrade?.(m, ps) === true;
    let want = price === 0;
    if (!want && ps.shop.level < target && (boardReady || r >= 6)) want = true;
    // a human's 自选 slots of the next level (AI 托管): that step one round earlier (DIY_PIECE_BONUS)
    if (!want && boardReady && ps.shop.level < nextTarget && diyOpensAt(ps, ps.shop.level + 1)) want = true;
    if (!want && ps.shop.level < nextTarget && price <= 2 && boardReady) want = true;
    if (!want && spare && ps.funds >= price + 1 + fundsReserve(m, ps) && ps.shop.level < nextTarget + 1 && boardReady) want = true;
    if (!want && ps.funds >= price + 14) want = true;
    if (!want || !tryDo(() => spendAction(m, ps, () => ps.levelUp()))) return;
    if (recipe && ps.shop.level === 4) ps._botFourAt = m.round;
    if (order) {
      const audit = { round: r, level: order.level, funds: ps.funds + price, first: 'upgrade', current: order.current, next: order.next, purchases: [] };
      (ps._botMergeOrder ||= []).push(audit);
      // Upgrade retains visible cards. Complete the reserved merges immediately, before another upgrade or refresh.
      for (const slot of order.slots) {
        const index = ps.shop.slots.indexOf(slot);
        if (index < 0 || slot.sold || !ps.completesChessMerge(slot.id)) continue;
        if (freeSlot(ps.hand) < 0 && !(recipe.shoppingRepair && freeShoppingSlot(m, ps))) break;
        const before = recipe.afterPurchase ? new Set(ps.allChess().map(p => p.uid)) : null;
        if (!tryDo(() => spendAction(m, ps, () => ps.buy(index)))) break;
        if (before) recipe.afterPurchase(m, ps, slot, before);
        audit.purchases.push(slot.id);
        useEconomyItems(m, ps); recipe.useEconomy?.(m, ps); takeOffers(m, ps);
      }
      if (order.pendingSlots?.some(s => !s.sold && ps.completesChessMerge(s.id)
        && ps.priceOf(s) > ps.funds) && !ps.shop.frozen) ps.freeze();
      return;
    }
  }
}

/**
 * Funds a band that keeps its leftover (gd.leftoverKeptBands: 坎诺特 利滚利 "每回合剩余的资金可以继承，剩余至少5资金时，
 * 每回合额外获得1资金") holds back from discretionary spending — refreshes, full-board purchases that complete nothing,
 * items, spare level-ups: the interest capital (coin_carry_over bb.capital, 5). 0 for every other band (their
 * leftover is lost at the prep end, so spending it all is free value).
 */
function fundsReserve(m, ps) {
  if (!m.gd.leftoverKeptBands.includes(ps.bandId)) return 0;
  const band = m.gd.band(ps.bandId);
  const buff = band && Array.isArray(band.buffs) ? band.buffs.find((b) => b && b.key === 'coin_carry_over') : null;
  const cap = Number(buff && buff.bb && buff.bb.capital);
  return Number.isFinite(cap) && cap > 0 ? cap : 5;
}

/** Buying / rerolling toward the lineup; a step generator (yields after each purchase or reroll). */
function* buyLoopSteps(m, ps, { fillOnly = false, maxRefreshes = 0, spendAll = false } = {}) {
  const gd = ps?.gd || m.gd;
  let refreshes = 0;
  const minPrice = spendAll ? 0 : 2;
  const bankReserve = fundsReserve(m, ps);
  // the best lineup is reused while the owned chess stay the same (a refresh changes only the shop)
  let memo = null;
  for (let guard = 0; guard < 40; guard++) {
    if (guard > 0) yield;
    coreStrategy(m, ps._botFocusId)?.liquidity?.(m, ps);
    const ctx = context(m, ps);
    if (ctx.strategy?.focusedDraftSafety && m.wave && m.round > 1 && ps.shop.level === 2) {
      const key = draftSafetyKey(m, ps);
      if (ps._botDraftSafety?.key !== key) {
        const chosen = chooseLineup(m, ps, ctx).set;
        const layout = yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS,
          { rng: createRng(deriveSeed(m.seed, `siracusa-safe-layout:${m.round}:${ps.seat}`)) });
        const input = yield* bossInputSteps(m, ps, chosen, layout, { keepWithdrawn: true });
        yield* evaluateDraftSafety(m, ps, input, key);
      }
    }
    const reserve = Math.max(bankReserve, spendAll ? 0 : ctx.strategy?.spendReserve(m, ps) || 0);
    const purchaseReserve = Math.max(reserve, spendAll ? 0 : ctx.strategy?.purchaseReserve?.(m, ps) || 0);
    if (ctx.strategy?.trade(m, ps, ctx, {
      lineupFor: view => chooseLineup(m, view, context(m, view)),
      lineupScore: (view, pieces) => lineupScore(m, view, pieces, context(m, view)),
    })) { takeOffers(m, ps); continue; }
    // Refresh layers require an active core. Put three owned core members on the board before refreshing.
    if (ctx.strategy && !ps.bonds[ctx.focus]?.active && (ctx.owned.counts.get(ctx.focus) || 0) >= 3) yield* arrangeSteps(m, ps);
    const ownedN = ps.allChess().length;
    const ownKey = `${ps.allChess().map((p) => `${p.uid}:${p.id}:${(p.items || []).length}`).join()}|${ctx.focus}|${ctx.second}`;
    const boardFull = ownedN >= ps.deployCap;
    // the first pass fills the board, then completes the merges it can afford — before any level-up spends the funds
    const mergesOnly = fillOnly && boardFull;
    // keep room for merges: a crowded bench sheds its weakest single — never one that came this prep (the buy picks by
    // lineup gain, the shed by piece value: it used to sell the single just bought for 3–5 back for 1; QA of the 0.1.1
    // bots) nor one gained since the last prep (the operator a 突变细胞 transformation put on the bench, its deployment
    // freed: in 20 solo 绝境 昆图斯 matches the shed sold 44 of 222 before the placement step could deploy them). The
    // shed is pre-emptive (one slot is still free), so with only fresh singles it waits for the next prep.
    if (freeSlot(ps.hand)<0 && ctx.strategy?.shoppingRepair && ps.shop.slots.some(s=>s && !s.sold
      && ps.priceOf(s)<=ps.funds && (s.kind==='chess' && ctx.strategy.importantBuy(m,ps,gd.chess(s.id))
        || s.kind==='item' && ctx.strategy.importantItem?.(m,ps,gd.item(s.id))))
      && freeShoppingSlot(m,ps)) continue; // equipment/consumables may change assets, bonds and funds: rebuild context
    const used = ps.hand.filter(Boolean).length;
    if (used >= gd.benchSize - 1) sellWeakestHand(m, ps, { keepFresh: true });
    // a full hand refuses every purchase, the third copy of a held pair too (PlayerState.buy, PRTS 卫戍协议/帮助 §手牌区):
    // an affordable one sheds the weakest hand single first (like the shed above, never one of this prep)
    if (freeSlot(ps.hand) < 0 && ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds && ps.completesChessMerge(s.id))) {
      sellWeakestHand(m, ps, { handOnly: true, keepFresh: true });
    }
    let best = -1;
    let bestS = 0;
    let bestMerges = false;
    let bestEconomic = false;
    let bestImportant = false;
    let cur = null;
    ps.shop.slots.forEach((s, i) => {
      if (!s || s.sold) return;
      if (s.kind === 'chess' && ctx.strategy?.purchaseAllowed?.(m, ps, gd.chess(s.id)) === false) return;
      if (s.kind === 'item' && ctx.strategy?.itemAllowed?.(gd.item(s.id)) === false) return;
      if (s.kind === 'item' && ctx.strategy?.purchaseItemAllowed?.(m, ps, gd.item(s.id)) === false) return;
      const price = ps.priceOf(s);
      if (price > ps.funds) return;
      const important = s.kind==='chess' ? ctx.strategy?.importantBuy?.(m,ps,gd.chess(s.id)) === true
        : ctx.strategy?.importantItem?.(m,ps,gd.item(s.id)) === true;
      const economyItem = s.kind === 'item' ? Math.max(economyItemBonus(m, ps, gd.item(s.id)), ctx.strategy?.itemBonus(m, ps, gd.item(s.id)) || 0,
        ctx.strategy?.purchaseItemBonus?.(m, ps, gd.item(s.id)) || 0) : 0;
      const cycle = s.kind === 'chess' && ctx.strategy?.cycleValue(m, ps, gd.chess(s.id), ctx) > 0;
      if (purchaseReserve > 0 && ps.funds - price < purchaseReserve && !economyItem && !cycle
        && !(s.kind === 'chess' && ctx.strategy?.criticalBuy(m, ps, gd.chess(s.id), ctx))) return;
      let sc;
      if (s.kind === 'chess') {
        const merges = ps.completesChessMerge(s.id);
        if (freeSlot(ps.hand) < 0 || (mergesOnly && !merges && !important)) return;
        const base = gd.baseIdOf(s.id);
        if (boardFull && !merges && ps.funds - price < reserve
          && (ps.funds - price < bankReserve || !cycle && !ctx.strategy?.criticalBuy(m, ps, gd.chess(s.id), ctx))) return; // banked (坎诺特)
        sc = buyScore(m, ps, s.id, ctx) - price;
        if (boardFull && !merges) {
          if (!ctx.copies.get(base)) {
            // with a full board a new operator must improve the lineup
            if (!cur) {
              if (!memo || memo.key !== ownKey) memo = { key: ownKey, cur: chooseLineup(m, ps, ctx) };
              cur = memo.cur;
            }
            const gain = lineupGain(m, ps, s.id, ctx, cur);
            if (gain <= 2 && !important && !developmentBuy(m, ps, chessRec(m, s.id, ps), ctx) && !ctx.strategy?.cycleValue(m, ps, chessRec(m, s.id, ps), ctx)) return;
            sc += Math.min(15, gain * 0.5);
          } else if (!important && (gd.isGolden(s.id) || (!ctx.keep.has(base) && !(ctx.pairs < MAX_PAIRS && (chessRec(m, s.id, ps)?.tier ?? 6) <= 3 && countFree(ps.hand) >= 3)))) {
            // a second copy of a non-keeper with no bench room for another pair is clutter, sold later at a loss
            return;
          }
        }
        if (!boardFull) sc += 8;
        if (important) sc = Math.max(sc, BUY_FULL_MIN+1);
      } else {
        if (fillOnly && !economyItem) return;
        if (!canUseItem(m, ps, { id: s.id })) return;
        if (freeSlot(ps.hand) < 0) return;
        if (ps.funds - price < reserve && !ps.completesItemMerge(s.id) && !economyItem) return;
        const carriers = (economyItem ? ps.allChess() : [...ps.board.values()]).filter((p) => p.kind === 'chess' && (p.items || []).length < gd.equipPerChess).length;
        if (!carriers) return;
        sc = 6 + (gd.tierOf(s.id) || 1) * 3 - price + (ps.completesItemMerge(s.id) ? 10 : 0) + economyItem;
      }
      if ((important && !bestImportant) || (important === bestImportant
        && ((economyItem > 0 && !bestEconomic) || ((economyItem > 0) === bestEconomic && sc > bestS)))) {
        bestS = sc; best = i; bestMerges = s.kind === 'chess' && ps.completesChessMerge(s.id); bestEconomic = economyItem > 0;
        bestImportant = important;
      }
    });
    // leftover funds are lost at prep end: reroll while a purchase stays affordable (a band that keeps them: down to its
    // reserve — a free refresh is always taken)
    const refreshCost = ps.shop.freeRefreshes > 0 ? 0 : gd.refreshPrice;
    const growthRefresh = (boardFull || (ctx.strategy && ps.bonds[ctx.focus]?.active))
      && Math.max(refreshGrowth(m, ps, ctx), ctx.strategy?.refreshValue(m, ps, ctx) || 0) >= 2;
    const canRefresh = refreshes < maxRefreshes && ps.funds >= refreshCost
      + (growthRefresh ? (refreshCost > 0 ? reserve : 0) : refreshCost > 0 ? Math.max(minPrice, reserve) : minPrice);
    // a full board buys only what improves it (merge progress, a lineup upgrade), and only when it is worth more than
    // the refreshes its price would pay for (each may show the third copy of a held pair, refreshValue)
    let buy = best >= 0 && bestS >= (boardFull ? BUY_FULL_MIN : 3);
    if (buy && boardFull && canRefresh && !bestMerges && !bestEconomic && !(ps.shop.slots[best]?.kind === 'chess' && ctx.strategy?.criticalBuy(m, ps, gd.chess(ps.shop.slots[best].id), ctx))) {
      const price = Math.max(1, ps.priceOf(ps.shop.slots[best]));
      if (bestS < refreshValue(m, ps, ctx) * price / Math.max(1, refreshCost)) buy = false;
    }
    if (buy) {
      const slot = ps.shop.slots[best];
      const before = ctx.strategy?.afterPurchase ? new Set(ps.allChess().map((p) => p.uid)) : null;
      if (!tryDo(() => spendAction(m, ps, () => ps.buy(best)))) return;
      if (before) ctx.strategy.afterPurchase(m, ps, slot, before);
      useEconomyItems(m, ps);
      ctx.strategy?.useEconomy(m, ps);
      if (ctx.strategy) takeOffers(m, ps);
      continue;
    }
    if (canRefresh) {
      if (holdCriticalShop(m, ps)) return;
      if (ctx.strategy?.beforeRefreshSteps && (yield* ctx.strategy.beforeRefreshSteps(m,ps,{
        LayoutPlan,takeOffers:()=>takeOffers(m,ps),
      }))) continue;
      if ((ctx.strategy?.shoppingRepair || ctx.strategy?.holdShop) && ps.shop.frozen) tryDo(()=>ps.freeze());
      if (!tryDo(() => spendAction(m, ps, () => ps.refresh()))) return;
      refreshes++;
      continue;
    }
    return;
  }
}

/**
 * Choose the deployed set and put it on the best tiles for this round's enemies (planLayout). `final`: the last
 * arrangement of the prep — candidate plans are rehearsed (see createRehearsal) when the match allows it; with `defer`
 * the default plan is placed now and the rehearsal job is returned (the caller runs it and applies `job.best`).
 * @returns {null | ReturnType<typeof createRehearsal>}
 */
export function arrange(m, ps, opts = {}) {
  return runSteps(arrangeSteps(m, ps, opts));
}

/** arrange as a step generator (yields inside the layout planning, see planLayoutSteps). */
export function* arrangeSteps(m, ps, { final = false, defer = false } = {}) {
  const ctx = context(m, ps);
  const chosen = final && ctx.strategy?.forecast ? [...ps.board.values()].filter(p => p.kind==='chess')
    : chooseLineup(m, ps, ctx).set;
  const chosenSet = new Set(chosen.map((p) => p.uid));
  // withdraw board chess that are not chosen (to free cap) when the hand has space
  for (const [, p] of [...ps.board]) {
    if (p.kind !== 'chess' || chosenSet.has(p.uid)) continue;
    if (freeSlot(ps.hand) < 0) freeSiracusaProtectedSlot(m, ps, p);
    if (freeSlot(ps.hand) < 0 && ctx.strategy?.beforeWithdrawal?.(m, ps, p, { chosen, freeShoppingSlot }) === true) continue;
    if(freeSlot(ps.hand)<0&&ctx.strategy?.withdrawalPriority?.(m,ps,p)>0){
      const priority=ctx.strategy.withdrawalPriority(m,ps,p);
      freeShoppingSlot(m,ps);
      if(freeSlot(ps.hand)<0){
        const reserve=ps.hand.filter(q=>q?.kind==='chess'&&!chosenSet.has(q.uid)&&!(q.items?.length)
          &&!preserveChess(m,ps,q)&&!ctx.strategy.keep(m,ps,chessRec(m,q.id,ps),ctx)
          &&(ctx.strategy.withdrawalPriority(m,ps,q)||0)<priority)
          .sort((a,b)=>pieceValue(m,ps,a,ctx)-pieceValue(m,ps,b,ctx)||a.uid-b.uid)[0];
        if(reserve&&sellChess(m,ps,reserve)) (ps._botCoopUnusedHistory||=[]).push({kind:'withdrawal-reserve',round:m.round,kept:p.id,sold:reserve.id});
      }else (ps._botCoopUnusedHistory||=[]).push({kind:'withdrawal-item-space',round:m.round,kept:p.id});
    }
    if (freeSlot(ps.hand) < 0 && preserveChess(m, ps, p)) {
      const safe = ctx.strategy?.safeWithdrawals;
      if (typeof safe === 'function' ? safe(m, ps, p) : safe === true) freeShoppingSlot(m, ps);
      if (freeSlot(ps.hand) < 0) sellWeakestHand(m, ps, { handOnly: true, keepPairs: false });
    }
    const idx = freeSlot(ps.hand);
    if (idx >= 0) tryDo(() => ps.move(p.uid, { area: 'hand', idx }));
    else sellChess(m, ps, p);
  }
  yield;
  if (final && ctx.strategy?.forecast && m.botRehearsal > 0
    && (m.wave || m.isSolo && m.round === m.gd.bossRound)) {
    const plans = [];
    const proposalRng = i => createRng(deriveSeed(m.seed, `forecast-layout:${m.round}:${ps.seat}:${i}`));
    plans.push(yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS, { formationRoles: false, rng: proposalRng(0) }));
    // Deadline cancellation can happen at any later yield: put the valid control on the real board first.
    yield* applyPlanSteps(m, ps, chosen, plans[0]);
    if (m.wave) {
      // Economy, equipment and the deployed roster are final. Search only positions/facings of these same pieces.
      plans.push(yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS, { fireControl: true,
        seedPlan: plans[0], rng: proposalRng(1), developmentPhase: ctx.strategy.developmentForecast ? 'combat' : null,
        placementVariant:ctx.strategy.placementVariants?.(m,ps)?1:0 }));
      if (ctx.strategy.developmentForecast) {
        plans.push(yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS,
          { fireControl: true, seedPlan: plans[0], rng: proposalRng(2), developmentPhase: 'farm' }));
        // Without a useful engine, growth/combat refinement can coincide. Reuse the spare trial slot for diversity.
        if (distinctPlans(plans).length < 3) plans[2] = yield* planLayoutSteps(m, ps, chosen,
          { ...LAYOUT_PARAMS, ...REHEARSAL_VARIANTS[1] }, { rng: proposalRng(2) });
      }
      else plans.push(yield* planLayoutSteps(m, ps, chosen, { ...LAYOUT_PARAMS, ...REHEARSAL_VARIANTS[1] },
        { rng: proposalRng(2),placementVariant:ctx.strategy.placementVariants?.(m,ps)?2:0 }));
    } else {
      // R14 has no farming. Keep the existing roster and mechanics; compare alternative legal complete layouts.
      for (let i=1;i<3;i++) plans.push(yield* planLayoutSteps(m, ps, chosen,
        { ...LAYOUT_PARAMS, ...REHEARSAL_VARIANTS[i] }, { rng: proposalRng(i) }));
    }
    if (!m.wave && ctx.strategy.finalProtectionPlans) {
      plans.push(...yield* ctx.strategy.finalProtectionPlans(m, ps, chosen, plans, {
        model: fieldModel(m, ps), unitOf, recOf: p => rangeRec(ps, (ps.gd || m.gd).chess(p.id)),
        makePlan: () => new LayoutPlan(), ids: ctx.strategy.ids,
      }));
    }
    if (m.wave && ctx.strategy.normalContactPlans) {
      const alternatives = yield* ctx.strategy.normalContactPlans(m, ps, chosen, plans, {
        model: fieldModel(m, ps), unitOf,
        recOf: p => p.kind === 'token' ? (ps.gd || m.gd).token(p.id) : rangeRec(ps, (ps.gd || m.gd).chess(p.id)),
        makePlan: () => new LayoutPlan(), ids: ctx.strategy.ids,
      });
      // Keep the valid original control. Two refinements replace trial slots, never expand the forecast budget.
      for (let i = 0; i < Math.min(2, alternatives.length); i++) plans[i + 1] = alternatives[i];
    }
    const job = yield* createForecastSteps(m, ps, chosen, plans,
      plan => bossInputSteps(m, ps, plan.lineup || chosen, plan, { keepWithdrawn: true }), ctx.strategy);
    if (job && !defer) while (!job.run()) { /* synchronous tools */ }
    const target = job?.done ? job.best : plans[0];
    yield* applyPlanSteps(m, ps, job?.done ? job.chosen : chosen, target);
    return defer ? job : null;
  }
  const plans = [];
  if (final && m.wave && m.botRehearsal > 0) {
    for (const v of REHEARSAL_VARIANTS) {
      plans.push(yield* planLayoutSteps(m, ps, chosen, { ...LAYOUT_PARAMS, ...v }, { formationRoles: false }));
    }
    // Extra proposals use their own deterministic stream: merely offering a formation must not reroll later drafts.
    // Never replace m.rngBots across a yield, since other players may be planning between slices.
    if (m.opts.botFormationRoles === true) plans.splice(3, 0, yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS,
      { rng: createRng(deriveSeed(m.seed, `formation:${m.round}:${ps.seat}`)) }));
    const training = [];
    const extraRng = () => m.opts.botHumanLessons || ps._botFocusId === 'lateranoShip' && lateranoLesson(m, 'formation')
      ? createRng(deriveSeed(m.seed, `lesson:${m.round}:${ps.seat}:${training.length}`)) : m.rngBots;
    for (const set of ctx.strategy?.combatLineups?.(m, ps, chosen) || []) {
      const plan = yield* planLayoutSteps(m, ps, set, LAYOUT_PARAMS, { rng: extraRng() });
      plan.lineup = set; plan.combat = true; training.push(plan);
    }
    for (const set of ctx.strategy?.trainingLineups?.(m, ps, chosen) || []) {
      const plan = yield* planLayoutSteps(m, ps, set, LAYOUT_PARAMS, { rng: extraRng() });
      plan.lineup = set; training.push(plan);
    }
    plans.splice(1, 0, ...training);
  } else {
    // Do not let an intermediate shopping arrangement change item carriers or consume safe firing positions.
    plans.push(yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS, { formationRoles: final && !!m.wave && m.opts.botFormationRoles === true }));
  }
  if (final && !m.wave && m.isSolo && m.round === m.gd.bossRound && m.botRehearsal >= 2 && ctx.strategy?.bossLayoutValue) {
    const model = fieldModel(m, ps);
    if (model.bossBodies.length || m.bossId === 'boss_5') {
      plans.push(yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS, { bossFocus: true, facingPlan: plans[0] }));
      if (m.botRehearsal >= 3) plans.push(yield* planLayoutSteps(m, ps, chosen, LAYOUT_PARAMS, { bossFocus: true,
        rng: createRng(deriveSeed(m.seed, `boss-layout:${m.round}:${ps.seat}`)) }));
      const inputSteps = (plan) => bossInputSteps(m, ps, chosen, plan);
      const job = yield* createBossRehearsalSteps(m, ps, chosen, plans, inputSteps);
      if (job) {
        if (defer) { yield* applyPlanSteps(m, ps, chosen, plans[0]); return job; }
        while (!job.run()) { /* synchronous tools */ }
        yield* applyPlanSteps(m, ps, chosen, job.best); return null;
      }
    }
  }
  if (defer && plans.length > 1) {
    const job = yield* createRehearsalSteps(m, ps, chosen, plans);
    yield* applyPlanSteps(m, ps, chosen, plans[0]);
    return job;
  }
  const target = plans.length > 1 ? rehearse(m, ps, chosen, plans) : plans[0];
  yield* applyPlanSteps(m, ps, target.lineup || chosen, target);
  return null;
}

/** Pure shadow board: forecast summons using the same planner, without moving cards, granting UIDs or drawing m.rngBots. */
export function* bossInputSteps(m, ps, chosen, plan, { keepWithdrawn = false, independentPlanning = false } = {}) {
  // Explicit input experiment: even a cold bond/route cache must not draw the real AI stream.
  // Match can itself be a seat-policy proxy whose setter forwards to the real game. A prototype shadow would
  // forward writes through that setter too; keep every planning assignment in a local overlay instead.
  const overlay = new Map([['rngBots', createRng(deriveSeed(m.seed, `shadow-bond-plan:${m.round}:${ps.seat}`))]]);
  const planningMatch = independentPlanning ? new Proxy(m, {
    get(target, key) { return overlay.has(key) ? overlay.get(key) : Reflect.get(target, key, target); },
    set(_target, key, value) { overlay.set(key, value); return true; },
  }) : m;
  const shadow = Object.assign(Object.create(Object.getPrototypeOf(ps)), ps, { board: new Map(),
    hand: ps.hand.slice(), temp: ps.temp.slice(), _botSiracusa: { ...ps._botSiracusa },
    _botRouteHistory: (ps._botRouteHistory || []).slice() });
  const selected = new Set(chosen.map((p) => p.uid));
  shadow.hand = shadow.hand.map((p) => selected.has(p?.uid) ? null : p);
  shadow.temp = shadow.temp.filter((p) => !selected.has(p?.uid));
  // A withdrawn operator still belongs to BOARD_AND_DECK bonds. This virtual hand is used for counting only;
  // actual moves and bench capacity remain PlayerState's responsibility. Retained boss trials keep their input.
  if (keepWithdrawn) shadow.hand.push(...[...ps.board.values()].filter(p => p.kind === 'chess' && !selected.has(p.uid)));
  for (const p of chosen) if (plan.has(p.uid)) shadow.board.set(plan.get(p.uid), { ...p, dir: planDir(plan, p.uid) });
  const tokens = [...ps.board.values(), ...ps.hand, ...ps.temp].filter((p) => p?.kind === 'token');
  const rng = createRng(deriveSeed(m.seed, `boss-summons:${m.round}:${ps.seat}`));
  for (const token of tokens) for (let n = 0; n < (token.count || 1); n++) {
    const p = { ...token, count: 1, uid: n ? -token.uid * 1000 - n : token.uid };
    const next = yield* planLayoutSteps(planningMatch, shadow, [p], LAYOUT_PARAMS,
      { occupied: new Set([...shadow.board.keys(), ...plan.reserved]), rng });
    const key = next.get(p.uid); if (!key) break;
    shadow.board.set(key, { ...p, dir: planDir(next, p.uid) });
  }
  shadow.bonds = computeBonds(shadow.gd || m.gd, shadow);
  return shadow.battleInput();
}

/**
 * Put the chosen pieces on their planned tiles, fill what is still off the board, then place summons. Placed summons go
 * back to their stacks first: they would sit on the plan's tiles (an operator moved onto one swaps it elsewhere), and a
 * 凯瑟琳 device left beside a tile its operator moved away from would face nothing (QA, playtest #6).
 */
function* applyPlanSteps(m, ps, chosen, target) {
  if (target.lineup) {
    const keep = new Set(chosen.map((p) => p.uid));
    const withdraw = [...ps.board.values()].filter((p) => p.kind === 'chess' && !keep.has(p.uid));
    if (withdraw.length > ps.hand.filter((p) => !p).length) return;
    for (const p of withdraw) {
      if (!tryDo(() => ps.move(p.uid, { area: 'hand', idx: freeSlot(ps.hand) }))) return;
    }
  }
  liftTokens(ps);
  // move pieces onto their targets (board → board moves swap; hand → board may swap an occupant back to the hand)
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const p of chosen) {
      const k = target.get(p.uid);
      if (!k) continue;
      const loc = ps.find(p.uid);
      const dir = planDir(target, p.uid);
      if (!loc || (loc.area === 'board' && loc.key === k && pieceDir(loc.piece) === dir)) continue;
      const [r, c] = parseKey(k);
      // onto its own tile: an in-place re-orientation (not a move)
      if (tryDo(() => ps.move(p.uid, { area: 'board', row: r, col: c }, dir)) && loc.key !== k) moved = true;
    }
    if (!moved) break;
  }
  // anything chosen still off the board: the best remaining free tile
  // (the server's g.move decides legality: a refused tile is excluded on the second pass)
  const refused = new Set();
  for (let pass = 0; pass < 2; pass++) {
    const off = chosen.filter((p) => { const loc = ps.find(p.uid); return loc && loc.area !== 'board'; });
    if (!off.length || ps.deployCount >= ps.deployCap) break;
    yield;
    const again = yield* planLayoutSteps(m, ps, off, LAYOUT_PARAMS, { occupied: new Set([...ps.board.keys(), ...refused, ...(target.reserved || [])]) });
    for (const p of off) {
      const k = again.get(p.uid);
      if (!k || ps.deployCount >= ps.deployCap) continue;
      const [r, c] = parseKey(k);
      if (!tryDo(() => ps.move(p.uid, { area: 'board', row: r, col: c }, planDir(again, p.uid)))) refused.add(k);
    }
    if (!refused.size) break;
  }
  yield* placeTokensSteps(m, ps, target.reserved);
}

/** Board summons back to their hand stacks (or a free hand slot). */
function liftTokens(ps) {
  for (const p of [...ps.board.values()]) {
    if (p.kind !== 'token') continue;
    const stack = ps.hand.findIndex((x) => x && x.kind === 'token' && x.ownerUid === p.ownerUid && x.id === p.id);
    const idx = stack >= 0 ? stack : freeSlot(ps.hand);
    if (idx >= 0) tryDo(() => ps.move(p.uid, { area: 'hand', idx }));
  }
}

/**
 * Summons that help the operator on the tile they face (range 1-1: their own tile + the one in front) instead of
 * covering the enemy path: 凯瑟琳's 爬行号·防护单元 (a hand piece since user playtest #6).
 */
const FRONT_SUPPORT_TOKENS = new Set(['token_10041_cathy_catsld']);
/** Device tile offsets around an operator (behind it — enemies come from the gates on the right —, above, below, in front) and the facing that points back at it. */
const SUPPORT_SPOTS = Object.freeze([[0, -1, 'RIGHT'], [1, 0, 'DOWN'], [-1, 0, 'UP'], [0, 1, 'LEFT']]);

/**
 * A tile + direction for a front-support device: next to the most valuable operator no device faces yet (blockers
 * first — they take the hits —, then DPS), pointing at it; null when none is free.
 */
function supportSpot(m, ps, p, reserved = new Set()) {
  const rec = (ps.gd || m.gd).token(p.id);
  if (!rec) return null;
  const map = ps.deployMap();
  const pos = positionClass(rec);
  const faced = new Set();
  for (const [k, q] of ps.board) {
    if (q.kind !== 'token' || !FRONT_SUPPORT_TOKENS.has(q.id)) continue;
    const [r, c] = parseKey(k);
    const [dr, dc] = rotateOffset(0, 1, pieceDir(q));
    faced.add(tileKey(r + dr, c + dc));
  }
  const ops = [...ps.board.entries()].filter(([k, q]) => q.kind === 'chess' && !faced.has(k)).map(([k, q]) => [k, (ps.gd || m.gd).chess(q.id)]).filter(([, c]) => c)
    .sort((a, b) => Number(isBlocker(b[1])) - Number(isBlocker(a[1])) || dpsOf(b[1]) - dpsOf(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [k] of ops) {
    const [r, c] = parseKey(k);
    for (const [dr, dc, dir] of SUPPORT_SPOTS) {
      const t = tileKey(r + dr, c + dc);
      if (!reserved.has(t) && !ps.board.has(t) && canPlace(map, pos, r + dr, c + dc)) return [r + dr, c + dc, dir];
    }
  }
  return null;
}

/** Tiles a summon placement tries before giving up (a refused tile is skipped and the next best one taken). */
const SUMMON_TRIES = 4;

/**
 * Placeable summons from the hand / temp onto the best free tiles (one per stack count). The server's g.move decides
 * legality: a refused tile is excluded and the next best one tried (SUMMON_TRIES).
 */
function* placeTokensSteps(m, ps, reserved = new Set()) {
  for (const p of [...ps.hand, ...ps.temp]) {
    if (!p || p.kind !== 'token') continue;
    for (let n = p.count || 1; n > 0; n--) {
      yield;
      if (FRONT_SUPPORT_TOKENS.has(p.id)) {
        const spot = supportSpot(m, ps, p, reserved);
        if (!spot || !tryDo(() => ps.move(p.uid, { area: 'board', row: spot[0], col: spot[1] }, spot[2]))) break;
        continue;
      }
      const refused = new Set();
      let placed = false;
      for (let t = 0; t < SUMMON_TRIES && !placed; t++) {
        const plan = yield* planLayoutSteps(m, ps, [p], LAYOUT_PARAMS, { occupied: new Set([...ps.board.keys(), ...refused, ...reserved]) });
        const k = plan.get(p.uid);
        if (!k) break;
        const [r, c] = parseKey(k);
        if (tryDo(() => ps.move(p.uid, { area: 'board', row: r, col: c }, planDir(plan, p.uid)))) placed = true;
        else refused.add(k);
      }
      if (!placed) break;
    }
  }
}

/** What an item does: the key of its first buff (data/items.json `buffs`, e.g. use_equip_reward_char_chess). */
const itemEffect = (rec) => (rec && Array.isArray(rec.buffs) && rec.buffs[0] && typeof rec.buffs[0].key === 'string' ? rec.buffs[0].key : '');

/** 突变细胞 (buff char_chess_transformation_equip). */
const isMutationCell = (gd, itemId) => itemEffect(gd.item(itemId)) === 'char_chess_transformation_equip';

/**
 * Whom the bot injects with 突变细胞 (after the battle its carrier — deployed or on the bench: every owned carrier's item
 * hooks run — is destroyed and a random operator one tier higher joins the bench, PlayerState.transformChess; the next
 * prep's lineup step deploys it like any owned unit, so a deployed carrier only costs a re-placement): the least
 * valuable normal operator below 6阶 with a free equip slot — never an elite, never one of a merge pair (the merge
 * progress would be lost), nobody already carrying a cell. null: the cell waits in the hand.
 */
export function cellTarget(m, ps, ctx = context(m, ps)) {
  const gd = ps?.gd || m.gd;
  let best = null;
  let bestV = Infinity;
  for (const p of ps.allChess()) {
    if (preserveChess(m, ps, p)) continue;
    if (gd.isGolden(p.id) || gd.tierOf(p.id) >= 6 || (p.items || []).length >= gd.equipPerChess) continue;
    if ((p.items || []).some((it) => isMutationCell(gd, it.id)) || (ctx.copies.get(gd.baseIdOf(p.id)) || 0) >= 2) continue;
    const v = pieceValue(m, ps, p, ctx);
    if (v < bestV || (v === bestV && p.uid < best.uid)) { bestV = v; best = p; }
  }
  return best;
}

/** Whether the bot's own last battle was perfect (no counted leak). */
function lastPerfect(m, ps) {
  const r = m.lastResults && m.lastResults.get(ps.playerId);
  return !!r && r.perfect !== false && !(r.leaked || []).some((l) => l && l.counted !== false);
}

/**
 * The carrier of an item (null = keep it), by what the item does (itemEffect):
 *   信标 (destroys its carrier for a pick of two chess of the same tier): the highest-tier bench single, else the
 *     weakest normal deployed operator;
 *   拟态物质 (a third copy of a pair, else a member of a bond): a pair (highest tier), else a focus member — never one
 *     of 2 copies whose pool is out (the item gives nothing then);
 *   博士投影 (promotes to elite; the normal one at the next round start, the golden one at once): the strongest normal
 *     deployed operator;
 *   突变细胞 (the carrier becomes a random tier + 1 operator after the battle): cellTarget;
 *   随身身份牌 / 简易通讯机 / 寻呼模块 (act on the carrier's bonds): the operator whose bonds matter most (focus first);
 *   funds, 紧急调度券, 人事部文档 …: anyone, one with a free slot first (on a full carrier the item replaces one of its
 *     items, GitHub #263); a bond signature item (requiresBondId): a member of that bond;
 *   other equipment: the strongest deployed damage dealers with a free slot (SURVIVAL items blockers first).
 */
export function itemTarget(m, ps, item, ctx = context(m, ps)) {
  const gd = ps?.gd || m.gd;
  const rec = gd.item(item.id);
  if (!rec) return null;
  if (ctx.strategy?.itemAllowed?.(rec) === false) return null;
  const key = itemEffect(rec);
  const value = new Map();
  const val = (p) => { if (!value.has(p.uid)) value.set(p.uid, pieceValue(m, ps, p, ctx)); return value.get(p.uid); };
  const deployed = [...ps.board.values()].filter((p) => p.kind === 'chess' && ctx.strategy?.itemTargetAllowed?.(m, ps, rec, p) !== false);
  const owned = ps.allChess();
  const explicit = ctx.strategy?.ownedItemTarget?.(m, ps, rec, owned);
  if (explicit !== undefined) return owned.includes(explicit) && ctx.strategy?.itemTargetAllowed?.(m, ps, rec, explicit) !== false ? explicit : null;
  const preferred = ctx.strategy?.itemTarget?.(m, ps, rec, deployed);
  if (preferred && deployed.includes(preferred)) return preferred;
  const normal = (p) => !gd.isGolden(p.id);
  const byVal = (list, dir = -1) => list.slice().sort((a, b) => dir * (val(a) - val(b)) || a.uid - b.uid);
  const rel = (p) => { let r = 0; for (const b of chessRec(m, p.id, ps)?.bonds || []) r += b === ctx.focus ? 3 : b === ctx.second ? 2 : ps.bonds[b] && ps.bonds[b].active ? 1 : 0; return r; };
  switch (key) {
    case 'use_equip_recruit_new_char_and_give_char_to_player_most_bond': {
      // a bench single of the highest tier (a pick of two of its tier), else the weakest deployed normal operator
      const counts = copyCounts(m, ps);
      const bench = owned.filter((p) => normal(p) && !preserveChess(m, ps, p) && ps.find(p.uid)?.area !== 'board' && (counts.get(gd.baseIdOf(p.id)) || 0) < 2)
        .sort((a, b) => (chessRec(m, b.id, ps)?.tier || 0) - (chessRec(m, a.id, ps)?.tier || 0) || val(a) - val(b) || a.uid - b.uid);
      return bench[0] || byVal(deployed.filter((p) => normal(p) && !preserveChess(m, ps, p)), 1)[0] || null;
    }
    case 'use_equip_reward_char_chess': {
      // with 2 copies owned and none left in the pool the item gives nothing (GitHub #207): such a pair is no carrier
      const counts = copyCounts(m, ps);
      const live = (base) => { const pool = typeof ps.poolOf === 'function' ? ps.poolOf(base) : m.pool; return pool.left(base) > 0 || !pool.has(base); };
      const dead = (p) => (counts.get(gd.baseIdOf(p.id)) || 0) >= 2 && !live(gd.baseIdOf(p.id));
      const pair = owned.filter((p) => normal(p) && !dead(p) && (counts.get(gd.baseIdOf(p.id)) || 0) + 1 >= mergeNeed(m, gd.baseIdOf(p.id)))
        .sort((a, b) => (chessRec(m, b.id, ps)?.tier || 0) - (chessRec(m, a.id, ps)?.tier || 0) || a.uid - b.uid);
      return pair[0] || owned.filter((p) => !dead(p)).sort((a, b) => rel(b) - rel(a) || val(b) - val(a) || a.uid - b.uid)[0] || null;
    }
    // 博士投影: the normal one promotes at the next round start, the golden one (缪尔赛思's R1 item, item merges) at once;
    // both refuse an elite (builtinMeta: BAD_TARGET 'already elite')
    case 'equip_round_start_upgrade_char':
    case 'use_equip_upgrade_char':
      return (deployed.some(normal) ? deployed : owned).filter(normal).sort((a, b) =>
        (val(b) + promotionGrowth(m, ps, chessRec(m, b.id, ps), ctx)) - (val(a) + promotionGrowth(m, ps, chessRec(m, a.id, ps), ctx)) || a.uid - b.uid)[0] || null;
    case 'char_chess_transformation_equip':
      return cellTarget(m, ps, ctx);
    case 'use_equip_reward_char_chess_bond_layer':
    case 'use_equip_reward_char_chess_with_same_bond':
    case 'use_equip_reward_special_goods_char_chess':
      return owned.slice().sort((a, b) => rel(b) - rel(a) || val(b) - val(a) || a.uid - b.uid)[0] || null;
    default:
      break;
  }
  const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
  const list = byVal(deployed);
  const free = (p) => (p.items || []).length < gd.equipPerChess;
  // a consumable on a full carrier destroys one of its items (the replace rule, GitHub #263): a carrier with a free slot
  // first — the effect is the same on anyone
  if (consume) return list.find(free) || owned.find(free) || list[0] || owned[0] || null;
  if (rec.requiresBondId) {
    const member = list.find((p) => free(p) && (chessRec(m, p.id, ps)?.bonds || []).includes(rec.requiresBondId));
    if (member) return member;
  }
  // damage dealers carry equipment first (healers / non-attackers last); survival items on blockers first
  const dealer = (p) => { const c = chessRec(m, p.id, ps); return c && !isHealer(c) && c.attackKind !== 'none'; };
  const blocker = (p) => isBlocker(chessRec(m, p.id, ps));
  const order = rec.category === 'SURVIVAL'
    ? [...list.filter(blocker), ...list.filter((p) => !blocker(p) && dealer(p)), ...list.filter((p) => !blocker(p) && !dealer(p))]
    : [...list.filter(dealer), ...list.filter((p) => !dealer(p))];
  return order.find(free) || null;
}

/** 教鞭 / “神秘顾客”: an Art that adds a bounty to the own next battle (trap_create_self_choice). */
const isBountyArt = (gd, itemId) => { const rec = gd.item(itemId); return !!rec && Array.isArray(rec.buffs) && rec.buffs.some((b) => b && b.key === 'trap_create_self_choice'); };

/**
 * Use an Art: 画卷 copies the operator on its tile (its range is the tile + the one in front) — the most valuable
 * deployed operator, with a free hand slot for the copy; 教鞭 offers a scored personal bounty choice, “神秘顾客” adds a
 * random bounty — only after a perfect battle with LP to spare, else the Art stays in the hand for a later round
 * (destroying 教鞭 gives nothing; a full hand at the prep end: freeHandSlot).
 */
function useArt(m, ps, item, ctx) {
  const rec = m.gd.item(item.id);
  const keys = (rec && Array.isArray(rec.buffs) ? rec.buffs : []).map((b) => b && b.key);
  if (keys.includes('trap_copy_front_char')) {
    if (freeSlot(ps.hand) < 0) return;
    const best = [...ps.board.entries()].filter(([, p]) => p.kind === 'chess').sort((a, b) => pieceValue(m, ps, b[1], ctx) - pieceValue(m, ps, a[1], ctx) || a[1].uid - b[1].uid)[0];
    if (!best) return;
    const [r, c] = parseKey(best[0]);
    tryDo(() => ps.useArt(item.uid, r, c));
    return;
  }
  if (keys.includes('trap_create_self_choice')) {
    if (!lastPerfect(m, ps) || ps.lp < 10) return; // kept
    const [key] = [...ps.board.keys()];
    if (key) {
      const [r, c] = parseKey(key);
      if (tryDo(() => ps.useArt(item.uid, r, c))) m.autoPickPersonalChoice(ps, 'bot');
    }
    return;
  }
  const [key] = [...ps.board.keys()];
  if (key) { const [r, c] = parseKey(key); tryDo(() => ps.useArt(item.uid, r, c)); }
}

function equipItems(m, ps) {
  const gd = ps?.gd || m.gd;
  const tried = new Set();
  for (let guard = 0; guard < 12; guard++) {
    const item = [...ps.hand, ...ps.temp].find((p) => p && p.kind === 'item' && canUseItem(m, ps, p) && !tried.has(p.uid)
      && !coreStrategy(m, ps._botFocusId)?.holdItem(m, ps, gd.item(p.id)));
    if (!item) break;
    tried.add(item.uid);
    const ctx = context(m, ps);
    const rec = gd.item(item.id);
    if (rec && rec.itemType === 'MAGIC') { useArt(m, ps, item, ctx); continue; }
    const target = itemTarget(m, ps, item, ctx);
    if (!target) continue;
    const replace = ctx.strategy?.itemReplacement?.(m, ps, rec, target) ?? null;
    if (replace === false) continue; // A recipe may protect a locked equipment pair, including from consumables.
    tryDo(() => ps.equip(item.uid, target.uid, replace));
  }
}

/**
 * Free a hand slot for an item worth keeping (突变细胞): sell the weakest single hand chess, else (on a bot's own seat
 * only — a human's items under AI 托管 are never destroyed to make room, like freeHandSlot) destroy the cheapest other
 * hand item, else sell the weakest hand chess even of a pair. `piece` (in temp): done once the freed slot pulled it in
 * (PlayerState._fillHandFromTemp — resolveTemp asks for the rightmost temp piece, the next one a slot pulls in). false:
 * the hand stays full (summon cards only).
 */
function makeHandRoom(m, ps, piece = null) {
  const room = () => freeSlot(ps.hand) >= 0 || (piece != null && !ps.temp.includes(piece));
  if (room()) return true;
  if (coreStrategy(m, ps._botFocusId)?.shoppingRepair && freeShoppingSlot(m, ps) && room()) return true;
  if (sellWeakestHand(m, ps, { handOnly: true }) && room()) return true;
  const gd = ps?.gd || m.gd;
  const junk = ps.isBot && !ps.autoplay ? ps.hand.filter((p) => p && p.kind === 'item' && !isMutationCell(gd, p.id))
    .sort((a, b) => ((gd.item(a.id) || {}).price || 0) - ((gd.item(b.id) || {}).price || 0) || a.uid - b.uid)[0] : null;
  if (junk && tryDo(() => ps.destroy(junk.uid)) && room()) return true;
  return sellWeakestHand(m, ps, { handOnly: true, keepPairs: false }) && room();
}

/**
 * Empty the temp row before Ready. A freed hand slot pulls the temp pieces in by itself, rightmost first
 * (PlayerState._fillHandFromTemp), so the pieces are decided right → left: the one at hand is always the next a freed
 * slot takes. A chess: the weakest bench single is sold to make room (it may be the temp chess itself), else the temp
 * chess is sold; an item: see below, else destroyed.
 */
function resolveTemp(m, ps) {
  for (let i = ps.temp.length - 1; i >= 0; i--) {
    const p = ps.temp[i];
    if (!p) continue;
    if (freeSlot(ps.hand) < 0 && freeSiracusaProtectedSlot(m, ps, p) && !ps.temp.includes(p)) continue;
    if (coreStrategy(m, ps._botFocusId)?.shoppingRepair && freeSlot(ps.hand)<0) {
      freeShoppingSlot(m, ps);
      if (!ps.temp.includes(p)) continue;
    }
    const idx = freeSlot(ps.hand); // (a recompute pulls it in; a state set up without one)
    if (idx >= 0 && tryDo(() => ps.move(p.uid, { area: 'hand', idx }))) continue;
    if (p.kind === 'chess') {
      if (!sellWeakestHand(m, ps)) {
        if (preserveChess(m, ps, p) && sellWeakestHand(m, ps, { handOnly: true, keepPairs: false })) continue;
        sellChess(m, ps, p);
      }
    } else if (p.kind === 'item') {
      // 突变细胞 comes back after every transformation (昆图斯's strategy item), and a human's item under AI 托管 is theirs:
      // make room in the hand (sell a bench operator) rather than lose it — only a hand of nothing but items still drops it
      if ((isMutationCell(m.gd, p.id) || ps.autoplay) && makeHandRoom(m, ps, p)) {
        if (!ps.temp.includes(p)) continue;
        const j = freeSlot(ps.hand);
        if (j >= 0 && tryDo(() => ps.move(p.uid, { area: 'hand', idx: j }))) continue;
      }
      tryDo(() => ps.destroy(p.uid));
    }
  }
  // anything left (e.g. sells failed): final sweep — tokens cannot be sold, they are dropped with the temp slot (and
  // come back at the next round start, PlayerState.startRound)
  for (let i = 0; i < ps.temp.length; i++) {
    const p = ps.temp[i];
    if (!p) continue;
    if (p.kind === 'chess') sellChess(m, ps, p);
    else if (p.kind === 'item') tryDo(() => ps.destroy(p.uid));
  }
  if (!ps.tempEmpty) ps.resolveTemp();
}
