// 拉特兰: six members, pooled ammunition, Precision / Dexterity, and a shared Foresight economy.
// Sources: generated bands/chess/garrisons/bonds and their existing content handlers. META §1.6.
// [ASSUMED] Scores, forecasts, round targets and switching margins are bot policy, never game effects.
import { rotateOffset } from '../../../../../../sim/dir.js';
import { basePositionClass } from '../../../../../board.js';

const CORE = 'lateranoShip';
const ids = Object.freeze({ insider: 'chess_char_1_01_a', executor: 'chess_char_2_01_a', exusiai: 'chess_char_3_01_a',
  archetto: 'chess_char_3_21_a', enforcer: 'chess_char_3_07_a', faith: 'chess_char_4_01_a', mostima: 'chess_char_4_02_a',
  executorAlter: 'chess_char_5_01_a', lemuen: 'chess_char_6_01_a', virtuosa: 'chess_char_6_09_a', exusiaiAlter: 'chess_char_6_13_a',
  ayerscarpe: 'chess_char_3_02_a', ptilopsis4: 'chess_char_4_21_a', ptilopsis5: 'chess_char_5_16_a',
  ines: 'chess_char_4_04_a', coldshot: 'chess_char_5_21_a', kroosAlter: 'chess_char_4_06_a', titi: 'chess_char_5_02_a',
  leonhardt: 'chess_char_4_14_a', minimalist: 'chess_char_3_13_a', tippi: 'chess_char_2_13_a',
  gnosis: 'chess_char_4_13_a', astgenne: 'chess_char_6_16_a', fold: 'chess_char_2_17_a' });
const route = (support, name) => Object.freeze({ id: `${CORE}:${support}`, name, strategyName: '拉特兰', core: CORE,
  coreMembers: 6, support, supports: Object.freeze([support]), supportMembers: support === 'preciShip' ? 3 : 2,
  economy: Object.freeze({ bond: 'visiShip', members: 2, layerMilestones: Object.freeze([80, 150]) }) });
const routes = Object.freeze([route('preciShip', '精准'), route('skillfulShip', '灵巧')]);
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const copies = (gd, ps, id) => ps.allChess().filter((p) => base(gd, p) === id);
const has = (gd, ps, id) => copies(gd, ps, id).length > 0;
const noop = () => 0;

/** Only inspect the reward AFTER acquisition; no prediction of the seeded gift roll or future shop. */
function giftState(m, ps) {
  const b = gdOf(m, ps).band(ps.bandId)?.buffs?.find((b) => b.key === 'band_cost_coin_reach_cnt_gain_chess_from_pool');
  return b ? { spent: ps.counters['band:paganini:spent'] || 0, threshold: b.bb.coin_cnt,
    done: !!ps.counters['band:paganini:done'] } : null;
}

function routeScores(m, ps, counts) {
  const gd = gdOf(m, ps);
  const quality = (id) => copies(gd, ps, id).reduce((n, p) => Math.max(n, gd.isGolden(p.id) ? 2 : 1), 0);
  return { [routes[0].id]: quality(ids.executor) * 8 + quality(ids.lemuen) * 22 + quality(ids.kroosAlter) * 2 + quality(ids.titi) * 4
      + Math.min(3, counts.get('preciShip') || 0) * 6 + Math.min(24, (ps.layers.preciShip || 0) / 4),
    [routes[1].id]: quality(ids.archetto) * 18 + Math.min(2, counts.get('skillfulShip') || 0) * 8
      + Math.min(24, (ps.layers.skillfulShip || 0) / 3) };
}

function visionPlan(m, ps) {
  const gd = gdOf(m, ps);
  if ((ps.layers.visiShip || 0) >= 150) return 'complete';
  if (copies(gd, ps, ids.executorAlter).some((p) => gd.isGolden(p.id)) && m.round <= 10) return 'executor';
  // An optional economy, not a compulsory second roster. Late, stalled projects cannot pay back the slots.
  if (m.round >= 11 && (ps.layers.visiShip || 0) < 80) return 'dormant';
  return [ids.ines, ids.coldshot].some((id) => has(gd, ps, id)) ? 'team' : 'dormant';
}

function frontlineAnchors(m, ps) {
  const gd = gdOf(m, ps);
  if ((ps.layers[CORE] || 0) >= 120 && has(gd, ps, ids.faith)) return new Set();
  const score = (p) => (base(gd, p) === ids.faith ? 30 : base(gd, p) === ids.fold ? 15 : 0)
    + gd.chess(p.id).tier * (gd.isGolden(p.id) ? 2 : 1);
  return new Set(ps.allChess().filter((p) => gd.chess(p.id).bonds.includes('steadShip'))
    .sort((a, b) => score(b) - score(a) || a.uid - b.uid).map((p) => base(gd, p)).filter((id, i, a) => a.indexOf(id) === i).slice(0, 2));
}

function selectRoute(m, ps, counts) {
  const gd = gdOf(m, ps), available = routes.filter((r) => !gd.modeInactiveBonds.has(r.support));
  if (!available.length) return null;
  let current = available.find((r) => r.id === ps._botRoute?.id);
  const state = ps._botLaterano ||= { since: m.round, observed: -1, challenger: null, aheadSince: null };
  if (!current) {
    current = available[Math.floor(m.rngBots() * available.length)];
    state.since = m.round; state.challenger = null; state.aheadSince = null;
  } else if (state.observed !== m.round) {
    const scores = routeScores(m, ps, counts);
    const other = available.find((r) => r !== current && scores[r.id] >= scores[current.id] + 18);
    if (!other) { state.challenger = null; state.aheadSince = null; }
    else {
      if (state.challenger !== other.id) { state.challenger = other.id; state.aheadSince = m.round; }
      if (m.round - state.since >= 3 && m.round > state.aheadSince) {
        current = other; state.since = m.round; state.challenger = null; state.aheadSince = null;
      }
    }
  }
  state.observed = m.round;
  return current;
}

function buyBonus(m, ps, rec, plan, counts) {
  const gd = gdOf(m, ps), id = base(gd, rec), fresh = !has(gd, ps, id);
  let value = 0;
  if (rec.bonds.includes(CORE) && fresh && (counts.get(CORE) || 0) < 6) {
    // Complete the distinct-member breakpoint before spare copies or optional economy pieces.
    const n = counts.get(CORE) || 0;
    value += n >= 5 ? 60 : n >= 4 ? 44 : 30;
  }
  if (id === ids.mostima) value += fresh ? 18 : 4;
  if (id === ids.executorAlter) value += rec.isGolden ? 16 : fresh ? 8 : 0;
  if (id === ids.exusiaiAlter) value += 12;
  if (fresh && id === ids.fold && m.round <= 8) value += 10;
  // Faith already supplies one Steadfast member; buy one inexpensive frontline partner, not a new main route.
  if (fresh && rec.bonds.includes('steadShip') && (counts.get('steadShip') || 0) < 2
    && has(gd, ps, ids.faith) && m.round <= 10) value += id === ids.fold ? 14 : 8;
  if (plan.route?.support === 'preciShip') {
    if (id === ids.lemuen) value += 40;
    const needsEngine = (counts.get('preciShip') || 0) < 3 || ![ids.kroosAlter, ids.titi, ids.leonhardt].some((id) => has(gd, ps, id));
    if (fresh && needsEngine && [ids.kroosAlter, ids.titi].includes(id)) value += id === ids.titi ? 16 : 12;
    if (fresh && needsEngine && id === ids.leonhardt) value += 8;
    if (fresh && id === ids.minimalist && has(gd, ps, ids.kroosAlter)
      && !ps.allChess().some((p) => castForecast(gd.chess(p.id)) >= 5)) value += 8;
    if (fresh && rec.bonds.includes('preciShip') && (counts.get('preciShip') || 0) < 3) value += 18;
  } else {
    if (id === ids.archetto) value += 28;
    if ([ids.ayerscarpe, ids.ptilopsis4, ids.ptilopsis5].includes(id) && has(gd, ps, ids.archetto)) value += 24;
    if (fresh && [ids.tippi, ids.gnosis].includes(id) && (counts.get('skillfulShip') || 0) < 2) value += 8;
    if (fresh && id === ids.astgenne) value += 8;
    if (fresh && rec.bonds.includes('skillfulShip') && (counts.get('skillfulShip') || 0) < 2) value += 22;
  }
  // Foresight counts the bench. Its second representative must be acquired before the first bullets are fired.
  const vision = visionPlan(m, ps);
  if (fresh && rec.bonds.includes('visiShip') && (counts.get('visiShip') || 0) < 2
    && ['executor', 'team'].includes(vision)) value += 8;
  if (vision === 'team' && [ids.ines, ids.coldshot].includes(id)) value += fresh ? 8 : 0;
  return value;
}

function unitBonus(m, ps, rec, plan) {
  const gd = gdOf(m, ps), id = base(gd, rec);
  if (id === ids.executorAlter) return rec.isGolden ? 16 : 8;
  if (id === ids.mostima) return rec.isGolden ? 14 : 8;
  if (rec.bonds.includes('steadShip') && id !== ids.faith
    && (id === ids.fold && m.round <= 8 || has(gd, ps, ids.faith) && (ps.layers[CORE] || 0) < 120)) return id === ids.fold ? 8 : 4;
  if (id === ids.lemuen && plan.route?.support === 'preciShip') return 24;
  if (plan.route?.support === 'preciShip' && [ids.kroosAlter, ids.titi, ids.leonhardt].includes(id)) return id === ids.titi ? 12 : 8;
  if (id === ids.archetto && plan.route?.support === 'skillfulShip') return 20;
  if ([ids.ayerscarpe, ids.ptilopsis4, ids.ptilopsis5].includes(id) && plan.route?.support === 'skillfulShip'
    && has(gd, ps, ids.archetto)) return 18;
  if ([ids.tippi, ids.astgenne].includes(id) && plan.route?.support === 'skillfulShip') return id === ids.astgenne ? 8 : 4;
  if (visionPlan(m, ps) === 'team' && [ids.ines, ids.coldshot].includes(id)) return id === ids.coldshot ? 8 : 4;
  return 0;
}

function lineupBonus(gd, pieces, bonds, plan) {
  let value = 0;
  const support = bonds[plan.route?.support];
  if (bonds[CORE]?.count >= 6) value += 48;
  if (support?.active) value += 18 + (plan.route.support === 'preciShip' && support.count >= 3
    ? (plan.ps?.m.round >= gd.bossRound ? 65 : 25) + Math.min(20, (support.layers || 0) * 0.2) : 0);
  if (plan.route?.support === 'preciShip' && support?.count > 3) value -= (support.count - 3) * 12;
  if (bonds.skillfulShip?.active && bonds.skillfulShip.layers >= 40) value += 20;
  const bases = pieces.map((p) => base(gd, p));
  // Repeated bodies do not advance six distinct members; don't bench all blockers to field spare engines.
  value -= (bases.length - new Set(bases).size) * 14;
  if (bonds.steadShip?.active) value += (bonds[CORE]?.layers || 0) >= 120 && bases.includes(ids.faith) ? 0 : 14;
  // Once invested, the third Precision member affects every ranged dealer, not just the nominal sub-route.
  if (plan.route?.support !== 'preciShip' && bonds.preciShip?.count >= 3) value += Math.min(30, (bonds.preciShip.layers || 0) * 0.3);
  return value;
}

/** The kit's ammo counter is not the number of hit targets or projectiles in a burst. */
function ammoWeight(rec) {
  const bb = rec?.skill?.bb || {};
  return bb.ammo > 0 || bb['attack@trigger_time'] > 0 ? (rec.bonds?.includes(CORE) ? 1 : 0.5) : 0;
}

/** [ASSUMED] Cast opportunity over 60 seconds, using the selected skill's SP type/cost/duration, not its rarity.
 * Attack/defence recovery are rough combat-rate estimates; real rehearsal resolves the actual conditions. */
function castForecast(rec) {
  const sk = rec?.skill;
  if (!sk || sk.skillType === 'PASSIVE' || !(sk.spCost > 0)) return 0;
  const interval = Math.max(0.3, (rec.stats?.bat || 1) * 100 / (rec.stats?.aspd || 100));
  const rate = sk.spType === 'INCREASE_WHEN_ATTACK' ? 1 / interval
    : sk.spType === 'INCREASE_WHEN_TAKEN_DAMAGE' ? 0.5 : rec.stats?.spRecovery || 1;
  const first = Math.max(0, sk.spCost - (sk.initSp || 0)) / rate;
  if (first > 60) return 0;
  const duration = Math.max(0, sk.duration || 0);
  return 1 + Math.floor((60 - first) / Math.max(0.5, sk.spCost / rate + duration));
}

function controlWeight(rec) {
  const bb = rec?.skill?.bb || {};
  return bb.stun > 0 || bb.sleep > 0 || bb['attack@sleep'] > 0
    || (rec?.talents || []).some((t) => t.bb?.stun > 0 || t.bb?.sleep > 0) ? 1 : 0;
}

function layoutValue(gd, units, plan, bonds, model = null) {
  let value = 0, risk = 0;
  for (const u of units) {
    const id = base(gd, u.rec);
    if (id === ids.mostima && bonds[CORE]?.active) {
      const gain = (u.rec.garrisonIds || []).map((g) => gd.garrison(g)).find((g) => g.bbStr?.range_id === 'x-5');
      for (const v of units) if (Math.abs(u.r - v.r) + Math.abs(u.c - v.c) === 1) {
        // Require actual enemy path coverage: a decorative neighbour cannot feed ammo.
        if (v.cover?.size && (!model || firingShare(units, v, model) > 0)) value += ammoWeight(v.rec) * (gain?.bb.bond_add_count || 1) * 0.65;
      }
    }
    if (bonds.skillfulShip?.active || bonds.preciShip?.active) {
      // Ptilopsis copies the front operator's prep-start trait AS HER OWN: its front is measured from Ptilopsis.
      const [dr, dc] = rotateOffset(0, 1, u.dir);
      const front = units.find((v) => v.r === u.r + dr && v.c === u.c + dc);
      const relevant = (v) => v?.rec.bonds.some((b) => [CORE, plan.route?.support || 'skillfulShip'].includes(b) && bonds[b]?.active);
      if (id === ids.archetto && relevant(front)) value += u.rec.isGolden ? 1.2 : 0.8;
      if ([ids.ptilopsis4, ids.ptilopsis5].includes(id) && front && base(gd, front.rec) === ids.archetto) value += 1.5;
      if (id === ids.ayerscarpe) {
        const back = units.find((v) => v.r === u.r - dr && v.c === u.c - dc);
        if (relevant(back)) value += u.rec.isGolden ? 1.2 : 0.8;
      }
    }
    if (id === ids.kroosAlter && bonds.preciShip?.active) {
      const [dr, dc] = rotateOffset(0, 1, u.dir);
      const front = units.find((v) => v.r === u.r + dr && v.c === u.c + dc);
      if (front && (!model || front.heal || firingShare(units, front, model) > 0)) {
        const grant = (u.rec.garrisonIds || []).map((id) => gd.garrison(id)).find((g) => g.bbStr?.give_garrison_id);
        const effect = gd.garrison(grant?.bbStr.give_garrison_id);
        value += Math.min(effect?.bb.max_add_count_per_battle || 10,
          castForecast(front.rec) * (effect?.bb.bond_add_count || 1)) * 0.25;
      }
    }
    if (id === ids.titi && bonds.preciShip?.active) for (const v of units) {
      if (v === u || !controlWeight(v.rec)) continue;
      const overlap = [...(u.cover || [])].some((key) => v.cover?.has(key)
        && (!model || model.routes.some((rt) => rt.tiles.includes(key))));
      if (overlap) value += 0.35;
    }
    if (u.rec.bonds?.includes('skillfulShip') && bonds.skillfulShip?.active) for (const v of units) {
      const dr = Math.abs(u.r - v.r), dc = Math.abs(u.c - v.c);
      if ((bonds.skillfulShip.layers >= 40 ? Math.max(dr, dc) <= 1 : dr + dc <= 1)) value += ammoWeight(v.rec) * 0.15;
    }
    if (id === ids.executorAlter && model) {
      risk += executorRisk(units, u, model);
      // Staying alive behind a blocker OUTSIDE the firing range cannot produce healing, ammo or layers.
      risk += (1 - firingShare(units, u, model)) * 3;
    }
  }
  // Saturated donor bonuses must not erase a carry's exposure or inability to reach the first blocker.
  return Math.min(6, value) - risk;
}

/** Fraction of targetable wave flow reachable before its first blocker, including that blocker's tile. */
function firingShare(units, u, model) {
  let reached = 0, total = 0;
  for (const rt of model.routes) {
    if (!(rt.fly ? u.air : u.ground)) continue;
    const n = rt.n ?? 1; total += n;
    let stop = rt.tiles.length - 1;
    if (!rt.fly) for (const v of units) if (v.block > 0) {
      const i = rt.tiles.indexOf(v.key); if (i >= 0) stop = Math.min(stop, i);
    }
    if (rt.tiles.slice(0, stop + 1).some((key) => u.cover?.has(key))) reached += n;
  }
  return total ? reached / total : 0;
}

/** [ASSUMED] Exposure penalty: keep a reachable firing position with another blocker taking first contact.
 * It is not a damage/survival prediction: the real rehearsals and battle diagnostics decide whether it works. */
function executorRisk(units, u, model) {
  const routes = model.routes.filter((r) => !r.fly), total = routes.reduce((n, r) => n + r.n, 0) || 1;
  let risk = 0;
  for (const rt of routes) {
    const i = rt.tiles.indexOf(u.key);
    if (i < 0) continue;
    const covered = units.some((v) => v !== u && v.block > 0 && rt.tiles.indexOf(v.key) >= 0
      && rt.tiles.indexOf(v.key) < i);
    risk += rt.n / total * ((covered ? 0 : 1.2) + (i < 3 ? 1.2 : 0));
  }
  return risk;
}

/** Let the shared placement engine compare legal empty neighbour tiles using the full combat objective. */
function layoutCandidates(gd, units) {
  const out = [];
  for (const u of units) if ([ids.mostima, ids.executorAlter, ids.archetto, ids.ayerscarpe, ids.ptilopsis4, ids.ptilopsis5, ids.kroosAlter, ids.titi].includes(base(gd, u.rec))) {
    for (const v of units) if (u !== v && (base(gd, u.rec) === ids.mostima ? ammoWeight(v.rec)
      : base(gd, u.rec) === ids.executorAlter ? v.block > 0
        : base(gd, u.rec) === ids.kroosAlter ? castForecast(v.rec) > 0
          : base(gd, u.rec) === ids.titi ? controlWeight(v.rec)
            : v.rec.bonds?.some((b) => ['skillfulShip', 'preciShip'].includes(b)))) {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ uid: u.uid, r: v.r + dr, c: v.c + dc });
    }
  }
  return out;
}

function levelTarget(m, ps) {
  // Reach the core's tiers on schedule; an optional tier-five engine must never delay tier-six carries.
  if (m.round < 3) return 1;
  if (m.round < 5) return 2;
  if (m.round < 7) return 3;
  if (m.round < 10) return 4;
  if (m.round === 10 && ps.shop.level === 4) {
    const gd = gdOf(m, ps), owned = new Set(ps.allChess().filter((p) => gd.chess(p.id).bonds.includes(CORE)).map((p) => base(gd, p)));
    const reachable = new Set(owned);
    for (const [id, entry] of m.pool.entries) if (entry.left > 0 && entry.tier <= 4 && gd.chess(id)?.bonds.includes(CORE)) reachable.add(id);
    // One bounded extra search at tier four when six members are actually reachable here; never wait on a ban.
    if (owned.size < 6 && reachable.size >= 6) return 4;
  }
  return m.round < 12 ? 5 : 6;
}
const upgradeReserve = (m, ps) => ps.shop.level >= 3 ? gdOf(m, ps).refreshPrice + 1 : 0;
const criticalBuy = (m, ps, rec) => {
  const gd = gdOf(m, ps);
  if (has(gd, ps, base(gd, rec))) return false;
  const n = new Set(ps.allChess().filter((p) => gd.chess(p.id).bonds.includes(CORE)).map((p) => base(gd, p))).size;
  return base(gd, rec) === ids.mostima || rec.bonds.includes(CORE) && n >= 4 && n < 6;
};
const beforeUpgrade = (m, ps) => !ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess'
  && ps.priceOf(s) <= ps.funds && criticalBuy(m, ps, gdOf(m, ps).chess(s.id)));
// Early upgrades require a full owned lineup in the shared planner. Reserving their price before filling it
// deadlocks both actions and loses funds at prep end. R5+ follows the ordinary catch-up rule.
const priorityLevel = (m, ps) => (m.round > 4 || ps.allChess().length >= ps.deployCap) && ps.shop.level < levelTarget(m, ps);
const spendReserve = (m, ps) => priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice + upgradeReserve(m, ps)
  ? Math.max(0, ps.shop.upgradePrice) : 0;
const refreshValue = (m, ps) => { const gift = giftState(m, ps); return gift && !gift.done && gift.spent < gift.threshold ? 4 : 0; };
const keep = (m, ps, rec) => ['executor', 'team'].includes(visionPlan(m, ps)) && rec.bonds.includes('visiShip');
// Keep one bench representative per Foresight base while its economy is being built, rather than all duplicates.
const preserve = (m, ps, rec) => !!rec && copies(gdOf(m, ps), ps, base(gdOf(m, ps), rec)).length === 1
  && ((rec.bonds.includes(CORE) && new Set(ps.allChess().filter((p) => gdOf(m, ps).chess(p.id)?.bonds.includes(CORE))
    .map((p) => base(gdOf(m, ps), p))).size <= 6)
    || (ps._botRoute?.support === 'preciShip' && (ps.layers.preciShip || 0) >= 20 && rec.bonds.includes('preciShip')
      && new Set(ps.allChess().filter((p) => gdOf(m, ps).chess(p.id)?.bonds.includes('preciShip'))
        .map((p) => base(gdOf(m, ps), p))).size <= 3)
    || frontlineAnchors(m, ps).has(base(gdOf(m, ps), rec))
    || (keep(m, ps, rec) && new Set(ps.allChess().filter((p) => gdOf(m, ps).chess(p.id)?.bonds.includes('visiShip'))
      .map((p) => base(gdOf(m, ps), p))).size <= 2));

const keyEquip = (rec) => rec?.buffs?.some((b) =>
  ['act1vautochess_equip_acarm025_global_buff', 'act1vautochess_equip_acarm037_global_buff'].includes(b.bbStr?.key));
function itemBonus(m, ps, rec) {
  if (!keyEquip(rec)) return 0;
  const gd = gdOf(m, ps), units = copies(gd, ps, ids.executorAlter);
  if (units.some((p) => p.items?.some((i) => gd.baseIdOf(i.id) === gd.baseIdOf(rec.id)))) return 0;
  return units.length ? 16 : 0;
}
function holdItem() {
  // Key gear is still useful on current carries. Never warehouse it for an operator not yet acquired.
  return false;
}
function itemTarget(m, ps, rec, deployed) {
  const gd = gdOf(m, ps);
  if (!keyEquip(rec)) {
    if (rec.kind !== 'passive' || rec.requiresBondId) return null;
    // Ordinary equipment should not destroy either member of the survival / attack-speed pair.
    return deployed.filter((p) => base(gd, p) !== ids.executorAlter && (p.items?.length || 0) < gd.equipPerChess)
      .sort((a, b) => gd.chess(b.id).tier - gd.chess(a.id).tier || a.uid - b.uid)[0] || null;
  }
  return deployed.filter((p) => base(gd, p) === ids.executorAlter && ((p.items?.length || 0) < gd.equipPerChess
    || p.items.some((i) => !keyEquip(gd.item(i.id))
      || (rec.isGolden && !gd.item(i.id)?.isGolden && gd.baseIdOf(i.id) === gd.baseIdOf(rec.id)))))
    .sort((a, b) => Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid)[0] || null;
}
function itemReplacement(m, ps, rec, target) {
  const gd = gdOf(m, ps);
  if (!keyEquip(rec) || base(gd, target) !== ids.executorAlter || target.items?.length < gd.equipPerChess) return null;
  return target.items.find((i) => rec.isGolden && !gd.item(i.id)?.isGolden && gd.baseIdOf(i.id) === gd.baseIdOf(rec.id))?.uid
    ?? target.items.find((i) => !keyEquip(gd.item(i.id)))?.uid ?? null;
}

/** Combat alternatives test the actual cost of dropping a core member for a missing frontline / Precision slot.
 * They compete on leaks and kills; unlike farming alternatives, a safer result may accept additional deaths. */
function combatLineups(m, ps, chosen) {
  const gd = gdOf(m, ps), out = [], chosenIds = new Set(chosen.map((p) => p.uid));
  const bench = ps.allChess().filter((p) => !chosenIds.has(p.uid));
  const rec = (p) => gd.chess(p.id);
  const frontline = (p) => basePositionClass(rec(p)) === 'melee' && rec(p).stats.blockCnt > 0;
  const power = (p) => rec(p).tier * (rec(p).isGolden ? 2 : 1) + (p.items?.length || 0);
  const weakest = (set, eligible) => set.filter(eligible).sort((a, b) =>
    Number(rec(a).bonds.includes(CORE)) - Number(rec(b).bonds.includes(CORE)) || power(a) - power(b) || a.uid - b.uid)[0];
  const swap = (set, add, remove) => remove ? set.map((p) => p === remove ? add : p) : set;
  // A high-layer Faith may stand alone. Before that, test a spare tank even if the six-core score disagrees.
  if (chosen.filter(frontline).length < 2 || (chosen.some((p) => base(gd, p) === ids.faith)
    && !chosen.some((p) => base(gd, p) !== ids.faith && rec(p).bonds.includes('steadShip')) && (ps.layers[CORE] || 0) < 120)) {
    const tank = bench.filter(frontline).sort((a, b) => Number(rec(b).bonds.includes('steadShip')) - Number(rec(a).bonds.includes('steadShip'))
      || power(b) - power(a) || a.uid - b.uid)[0];
    const remove = weakest(chosen, (p) => !frontline(p));
    if (tank && remove) out.push(swap(chosen, tank, remove));
  }
  if (ps._botRoute?.support === 'preciShip' || (ps.layers.preciShip || 0) >= 40) {
    let set = chosen.slice();
    const precise = (p) => rec(p).bonds.includes('preciShip');
    const distinct = (set) => new Set(set.filter(precise).map((p) => base(gd, p)));
    for (const p of bench.filter(precise).sort((a, b) => power(b) - power(a) || a.uid - b.uid)) {
      const members = distinct(set);
      if (members.size >= 3) break;
      if (members.has(base(gd, p))) continue;
      set = swap(set, p, weakest(set, (q) => !precise(q) && !frontline(q)));
    }
    if (distinct(chosen).size < 3 && distinct(set).size >= 3) out.push(set);
  }
  return out;
}

/** Offer weaker boards only as real rehearsal candidates. The ordinary combat lineup is always the control. */
function trainingLineups(m, ps, chosen) {
  const gd = gdOf(m, ps);
  if (m.round >= gd.bossRound || ps.lp < 12 || !ps.hand.some((p) => !p)) return [];
  if (!chosen.some((p) => [ids.executorAlter, ids.mostima, ids.archetto].includes(base(gd, p)))) return [];
  const out = [];
  const addWithout = (piece) => {
    if (!piece) return;
    const set = chosen.filter((p) => p !== piece);
    if (new Set(set.filter((p) => gd.chess(p.id).bonds.includes(CORE)).map((p) => base(gd, p))).size < 3) return;
    if (!out.some((s) => s.length === set.length && s.every((p, i) => p.uid === set[i].uid))) out.push(set);
  };
  addWithout(chosen.find((p) => base(gd, p) === ids.exusiaiAlter));
  const coreCount = new Set(chosen.filter((p) => gd.chess(p.id).bonds.includes(CORE)).map((p) => base(gd, p))).size;
  if (coreCount >= 6) for (const id of [ids.exusiaiAlter, ids.virtuosa, ids.exusiai, ids.insider, ids.faith]) {
    const p = chosen.find((p) => base(gd, p) === id);
    if (p) { addWithout(p); break; }
  }
  return out;
}

function rehearsalValue(m, ps, pp) {
  if (m.round >= gdOf(m, ps).bossRound) return 0;
  const gain = pp.layerGains || {};
  return Math.min(50, (gain[CORE] || 0) * 0.1 + (gain[ps._botRoute?.support] || 0) * 0.2
    + ((ps.layers.visiShip || 0) < 150 ? (gain.visiShip || 0) * 0.4 : 0));
}

export const laterano = Object.freeze({ name: '拉特兰', core: CORE, spendAllFunds: true, ids, routes, selectRoute, routeScores, giftState,
  buyBonus, unitBonus, lineupBonus, layoutValue, layoutCandidates, ammoWeight, castForecast, executorRisk, firingShare, visionPlan, levelTarget, upgradeReserve,
  beforeUpgrade, priorityLevel, spendReserve, criticalBuy, refreshValue, keep, preserve,
  itemBonus, holdItem, itemTarget, itemReplacement, combatLineups, trainingLineups, rehearsalValue,
  useEconomy: noop, trade: noop, cycleValue: noop });
