// [ASSUMED] Own-asset reward valuation and bounded transition liquidation, learned from player review.
// No seed/coordinate cases, future draws, teammate formations or actual combat results enter decisions.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { createForecastSteps } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyCoopRolePlan, coopRoleEntryPlan } from './lateranoCoopRoles.js';
import { coopEntryState, selectCoopSafety } from './lateranoCoopSafety.js';
import { visibleLateranoThirds } from './lateranoCoopThirdCopy.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip', VISION = 'visiShip';
const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_21_a']);
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id || p.chessId);
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const tank = r => r.profession === 'TANK' && r.stats.blockCnt > 0;
const heal = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic', 'wandermedic'].includes(r.subProfessionId);
const count = (ps, pieces, bond) => new Set(pieces.filter(p => pieceBonds(ps.gd, p).includes(bond)).map(p => base(ps, p))).size;
const note = (ps, data) => (ps._botCoopFactorHistory ||= []).push({ factor: 'player-review', ...data });
const layers = (ps, id) => ps.layers[id] || 0;

/** A bounded static combat proxy; actual forecasts still choose the final normal-wave formation. */
export function reviewCombatPower(r) {
  if (!r || ['heal', 'none'].includes(r.attackKind)) return 0;
  const bb = r.skill?.bb || {}, stats = r.stats;
  const skill = 1 + Math.min(1.5, Math.max(0, bb.atk || 0) * .5 + Math.max(0, (bb.atk_scale || 1) - 1) * .2);
  const attack = stats.atk * (stats.aspd || 100) / 100 / Math.max(.4, stats.bat || 1) * skill;
  return attack + (r.profession === 'WARRIOR' ? Math.min(3, stats.blockCnt) * 65 : 0)
    + (tank(r) ? Math.min(300, stats.def * .25 + stats.maxHp * .025) : 0);
}

const special = (ps, rec, key) => (rec.garrisonIds || []).map(id => ps.gd.garrison(id)).find(g => g?.effectKey === key);
const hasSphere = ps => [...ps.hand, ...ps.temp].some(p => p?.kind === 'item' && ps.gd.baseIdOf(p.id) === 'chess_item_6_09_e_a');

/** Reward selection is distinct from shop legality. Free alternatives are compared, including real gain effects. */
export function reviewRewardValue(m, ps, rec, recipe) {
  const owned = ps.allChess(), id = base(ps, rec), same = owned.filter(p => base(ps, p) === id);
  if (same.some(p => ps.gd.isGolden(p.id))) return -10000;
  const native = rec.bonds.includes(CORE), fresh = !same.length;
  let value = reviewCombatPower(rec) / 35 + (heal(rec) ? 8 : 0);
  if (native) value += 55 + (fresh && count(ps, owned, CORE) < 6 ? 90 : 0);
  if (MAIN.has(id)) value += 45;
  if (id === recipe.ids.mostima && m.round < m.gd.bossRound) value += 45;
  if (same.length) value += same.length >= 2 ? 24 : native || heal(rec) ? 12 : 3;
  for (const bond of rec.bonds) {
    if (!fresh || ps.gd.modeInactiveBonds.has(bond)) continue;
    // Offers occur before arrangement: include already owned partners still on the bench.
    const before = count(ps, owned, bond);
    if (bond === 'steadShip' && m.round <= 8) value += before === 2 ? 85 : before === 1 ? 45 : 0;
    if (bond === SKILL && before < 2 && owned.some(p => base(ps, p) === recipe.ids.archetto)) value += before === 1 ? 80 : 10;
    if (bond === 'preciShip') value += before === 2 ? 45 : 15;
    if (bond === VISION) value += before === 1 ? 50 : before === 0 ? 22 : 0;
    if (bond === 'miraShip' && before === 1 && m.round < m.gd.bossRound) value += 65;
  }
  const sphere = special(ps, rec, 'SERVER_GAIN_EQUIP');
  if (sphere?.bbStr?.chess === 'chess_item_6_09_e_a') value += hasSphere(ps) ? 30 : 100;
  if (m.round < m.gd.bossRound && special(ps, rec, 'SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER')) {
    const dominant = Object.entries(ps.bonds).filter(([, b]) => b.active).sort((a, b) => b[1].layers - a[1].layers)[0];
    if (dominant) value += 40 + 4 * new Set(field(ps).filter(p => pieceBonds(ps.gd, p).includes(dominant[0])).map(p => ps.gd.chess(p.id).tier)).size;
  }
  return value;
}

function temporaryReward(m, ps, p) {
  if (m.round >= m.gd.bossRound || !ps._botCoopReviewRewards?.has(p.uid)) return false;
  const r = ps.gd.chess(p.id);
  return r.tier >= 4 && r.bonds.some(b => ['arcaneShip', 'raidShip'].includes(b)
    && count(ps, ps.allChess().filter(q => q.uid !== p.uid), b) >= 1);
}

/** Fund a visible card completely before any sale. Mature portfolios, cores, pairs and last tank/healer survive. */
export function reviewFundingPlan(m, ps, recipe, slot, { emergency = false } = {}) {
  if (!scope(m, ps) || !slot || slot.sold || slot.kind !== 'chess' || !ps.hand.some(p => !p)) return null;
  const price = ps.priceOf(slot), target = base(ps, slot), owned = ps.allChess();
  if (ps.funds >= price) return { sales: [], funds: ps.funds };
  const hard = new Set([recipe.ids.mostima, recipe.ids.faith, recipe.ids.archetto, recipe.ids.executorAlter,
    recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.titi, recipe.ids.astgenne, recipe.ids.ptilopsis4, recipe.ids.ptilopsis5]);
  const pinned = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  let remaining = owned.slice(), funds = ps.funds;
  const sales = [];
  for (let pass = 0; pass < 3 && funds < price; pass++) {
    const candidates = remaining.filter(p => {
      const r = ps.gd.chess(p.id), id = base(ps, p), bonds = pieceBonds(ps.gd, p), after = remaining.filter(q => q.uid !== p.uid);
      if (p.items?.length || pinned.has(p.uid) || hard.has(id) || id === target || bonds.includes('maniShip')) return false;
      if (!ps.gd.isGolden(p.id) && remaining.filter(q => base(ps, q) === id && !ps.gd.isGolden(q.id)).length >= 2) return false;
      if (bonds.includes(CORE) || count(ps, after, CORE) < Math.min(6, count(ps, owned, CORE))) return false;
      if (heal(r) && !after.some(q => heal(ps.gd.chess(q.id))) || tank(r) && !after.some(q => tank(ps.gd.chess(q.id)))) return false;
      if (r.subProfessionId === 'wandermedic' && m.bossId === 'boss_4') return false;
      if (bonds.includes(VISION) && remaining.some(q => base(ps, q) === recipe.ids.executorAlter)
        && !after.some(q => base(ps, q) !== recipe.ids.executorAlter && pieceBonds(ps.gd, q).includes(VISION))) return false;
      for (const [bond, threshold, mature] of [[SKILL, 2, 40], ['preciShip', 3, 50], [VISION, 2, 80]])
        if (layers(ps, bond) >= mature && count(ps, remaining, bond) >= threshold && count(ps, after, bond) < threshold) return false;
      if (!emergency && bonds.includes('miraShip') && count(ps, remaining, 'miraShip') >= 2 && count(ps, after, 'miraShip') < 2) return false;
      const related = bonds.some(b => [SKILL, VISION, 'preciShip'].includes(b));
      return !related || r.tier <= 3; // Higher-tier real support engines are not transition cash.
    }).sort((a, b) => {
      const rank = p => Number(ps.find(p.uid)?.area === 'board') * 1000 + reviewCombatPower(ps.gd.chess(p.id));
      return rank(a) - rank(b) || a.uid - b.uid;
    });
    if (!candidates.length) return null;
    const p = candidates[0]; sales.push({ uid: p.uid, id: p.id, area: ps.find(p.uid)?.area });
    funds += ps.gd.sellPrice(p.id); remaining = remaining.filter(q => q.uid !== p.uid);
  }
  return funds >= price ? { sales, funds } : null;
}

/** Repeated owned attackers/defenders and free temporary packages may replace weak transition members. */
export function reviewCombatLineups(m, ps, chosen, recipe) {
  if (!scope(m, ps) || !m.wave || m.round >= m.gd.bossRound) return [];
  const out = [], seen = new Set(), before = count(ps, chosen, CORE);
  const pinned = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  for (const add of ps.allChess().filter(p => !chosen.includes(p))) {
    const r = ps.gd.chess(add.id), duplicate = chosen.some(p => base(ps, p) === base(ps, add));
    if (!temporaryReward(m, ps, add) && !(ps.lp <= 18 && duplicate && (tank(r) || r.bonds.includes(CORE)))) continue;
    for (const remove of chosen.slice().sort((a, b) => reviewCombatPower(ps.gd.chess(a.id)) - reviewCombatPower(ps.gd.chess(b.id)) || a.uid - b.uid)) {
      const rr = ps.gd.chess(remove.id), set = chosen.map(p => p === remove ? add : p);
      if (MAIN.has(base(ps, remove)) || base(ps, remove) === recipe.ids.mostima || remove.items?.length || pinned.has(remove.uid)) continue;
      if (count(ps, set, CORE) < Math.min(6, before)
        || !temporaryReward(m, ps, add) && tank(rr) && !set.some(p => tank(ps.gd.chess(p.id)))) continue;
      if (!temporaryReward(m, ps, add) && reviewCombatPower(r) <= reviewCombatPower(rr) * 1.15) continue;
      const signature = set.map(p => p.uid).sort((a, b) => a - b).join(',');
      if (!seen.has(signature)) { seen.add(signature); out.push(set); }
      if (out.length >= 2) return out;
      break;
    }
  }
  return out;
}

export function withCoopPlayerReview(parent) {
  const installPick = (m, ps) => {
    if (!scope(m, ps) || ps._botCoopReviewPickInstalled) return;
    // Install at first reward evaluation too: older frozen selectors have no prepStart callback either.
    ps._botCoopReviewPickInstalled = true;
    const pick = ps.pickReward;
    ps.pickReward = function(index) {
      const offer = ps.offers[0], slot = offer?.slots[index], before = new Set(ps.allChess().map(p => p.uid));
      const result = pick.call(ps, index);
      if (result?.ok && slot) out.afterReward(m, ps, slot, before, offer);
      return result;
    };
  };
  const out = { ...parent,
    prepStart(m, ps) {
      parent.prepStart?.(m, ps);
      installPick(m, ps);
    },
    rewardScoreAllowed(m, ps, rec) { return scope(m, ps) || (parent.rewardScoreAllowed || parent.purchaseAllowed)(m, ps, rec); },
    rewardPriority(m, ps, slot) {
      const inherited = parent.rewardPriority?.(m, ps, slot) || 0;
      if (!scope(m, ps) || slot.kind !== 'chess') return inherited;
      installPick(m, ps);
      const value = inherited * 1000 + reviewRewardValue(m, ps, ps.gd.chess(slot.id), parent);
      if (ps._botCoopReviewOffer?.offer !== ps.offers[0]) ps._botCoopReviewOffer = { offer: ps.offers[0], values: new Map() };
      ps._botCoopReviewOffer.values.set(slot.id, value);
      return value;
    },
    afterReward(m, ps, slot, before, offer) {
      ps._botCoopReviewSeenOffers ||= new WeakSet();
      if (ps._botCoopReviewSeenOffers.has(offer)) return;
      ps._botCoopReviewSeenOffers.add(offer);
      parent.afterReward?.(m, ps, slot, before, offer);
      if (!scope(m, ps) || slot.kind !== 'chess') return;
      ps._botCoopReviewRewards ||= new Set();
      for (const p of ps.allChess()) if (!before.has(p.uid)) ps._botCoopReviewRewards.add(p.uid);
      note(ps, { action: 'reward', round: m.round, chosen: slot.id, options: offer.slots.map(s => ({ id: s.id,
        value: ps._botCoopReviewOffer?.values.get(s.id) ?? null })) });
    },
    cleanupAcquisitions(m, ps, ...xs) {
      if (!scope(m, ps)) return parent.cleanupAcquisitions?.(m, ps, ...xs);
      const sell = ps.sell;
      ps.sell = function(uid, ...args) {
        const p = ps.find(uid)?.piece;
        return p && temporaryReward(m, ps, p) ? { ok: false } : sell.call(ps, uid, ...args);
      };
      try { return parent.cleanupAcquisitions?.(m, ps, ...xs); } finally { ps.sell = sell; }
    },
    keep(m, ps, rec, ...xs) { return scope(m, ps) && ps.allChess().some(p => p.id === rec.chessId && temporaryReward(m, ps, p)) || parent.keep(m, ps, rec, ...xs); },
    preserve(m, ps, rec, ...xs) { return scope(m, ps) && ps.allChess().some(p => p.id === rec.chessId && temporaryReward(m, ps, p)) || parent.preserve(m, ps, rec, ...xs); },
    lineupBonus(gd, pieces, bonds, ctx) {
      let value = parent.lineupBonus(gd, pieces, bonds, ctx);
      const ps = ctx.ps, m = ps?.m;
      if (!m || !scope(m, ps) || m.round >= gd.bossRound) return value;
      if (pieces.some(p => temporaryReward(m, ps, p))) for (const id of ['arcaneShip', 'raidShip']) if (bonds[id]?.active) value += 24;
      for (const p of pieces) if (special(ps, gd.chess(p.id), 'SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER')) value += 16;
      return value;
    },
    combatLineups(m, ps, chosen) { return [...(parent.combatLineups?.(m, ps, chosen) || []), ...reviewCombatLineups(m, ps, chosen, out)]; },
    trade(m, ps, ctx, h) {
      if (parent.trade(m, ps, ctx, h)) return true;
      if (!scope(m, ps)) return false;
      const emergency = ps._botCoopReviewEmergency === m.round;
      const targets = emergency ? ps.shop.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot?.kind === 'chess' && !slot.sold
        && !ps.allChess().some(p => base(ps, p) === base(ps, slot) && ps.gd.isGolden(p.id))
        && (ps.completesChessMerge(slot.id) || ps.gd.chess(slot.id).bonds.includes(CORE) && ps.gd.chess(slot.id).tier >= 3)) : visibleLateranoThirds(m, ps);
      for (const target of targets) {
        const plan = reviewFundingPlan(m, ps, out, target.slot, { emergency });
        if (!plan || !plan.sales.length && !emergency) continue;
        const audit = { action: 'funding', round: m.round, emergency, target: target.slot.id, funds: ps.funds, sales: plan.sales, bought: false };
        for (const sale of plan.sales) if (!ps.sell(sale.uid)?.ok) return false;
        const previous = new Set(ps.allChess().map(p => p.uid)), settle = out.observeSpend?.(m, ps), result = ps.buy(target.index); settle?.();
        audit.bought = !!result?.ok; note(ps, audit);
        if (!result?.ok) return false;
        out.afterPurchase?.(m, ps, target.slot, previous); out.useEconomy?.(m, ps); return true;
      }
      return false;
    },
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!scope(m, ps) || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 3 || ps._botCoopReviewChecked === m.round) return;
      ps._botCoopReviewChecked = m.round;
      const targets = ps.shop.slots.filter(s => s?.kind === 'chess' && !s.sold && ps.gd.chess(s.id).bonds.includes(CORE)
        && ps.gd.chess(s.id).tier >= 3 && !ps.allChess().some(p => base(ps, p) === base(ps, s) && ps.gd.isGolden(p.id)));
      const canFund = targets.some(s => reviewFundingPlan(m, ps, out, s, { emergency: true }));
      const original = bossFormationSnapshot(ps, h), alternatives = reviewCombatLineups(m, ps, original.lineup, out);
      if (!canFund && !alternatives.length) return;
      function* evaluate(plans) {
        function* inputs(plan) { yield; return stealthBattleInput(ps, plan); }
        const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputs, {
          forecastReadinessOnly: true,
          prepareForecastInput: (m, ps, _c, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
          forecastContext: () => ({}), observeForecast: (_b, _c, plan) => pp => coopEntryState(ps, plan, pp),
          selectForecast: (p, outcomes) => selectCoopSafety(p, outcomes),
        });
        if (job) while (!job.run(4)) yield;
        return job;
      }
      const plans = [original];
      for (const lineup of alternatives) { const p = coopRoleEntryPlan(ps, h, original, lineup); if (p) plans.push(p); }
      const job = yield* evaluate(plans);
      if (job?.bestIndex) {
        applyCoopRolePlan(ps, job.best);
        note(ps, { action: 'roster', round: m.round, selected: job.bestIndex,
          lineups: job.plans.map(p => p.lineup.map(u => u.id)), outcomes: job.outcomes });
      }
      const threshold = Math.min(6, Math.max(2, Math.ceil(ps.lp / 2)));
      const reference = job?.outcomes.filter(r => r.index === job.bestIndex);
      if (!canFund || !reference || reference.length !== 2 || reference.some(r => !r.valid || r.lost < threshold)) return;
      note(ps, { action: 'emergency', round: m.round, lp: ps.lp, threshold, outcomes: job.outcomes });
      ps._botCoopReviewEmergency = m.round;
      try { yield* h.recoverEconomySteps(); } finally { ps._botCoopReviewEmergency = null; }
      const current = bossFormationSnapshot(ps, h), nextPlans = [current];
      for (const lineup of reviewCombatLineups(m, ps, current.lineup, out)) {
        const p = coopRoleEntryPlan(ps, h, current, lineup); if (p) nextPlans.push(p);
      }
      if (nextPlans.length > 1) { const next = yield* evaluate(nextPlans); if (next?.bestIndex) applyCoopRolePlan(ps, next.best); }
    },
  };
  return Object.freeze(out);
}
