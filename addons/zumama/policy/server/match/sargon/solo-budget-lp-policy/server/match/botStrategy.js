// Data-derived bond objectives and layer-source estimates for bot.js (DESIGN §6.6).
// [ASSUMED] All valuation weights, forecast trigger counts and planning horizons here are AI heuristics.
// They never grant layers, mutate the match, inspect future shop rolls or change official effects.
import { rotateOffset } from '../../../../../../../../../../sim/dir.js';
import { coreStrategy } from './botCoreStrategies.js';

const splitIds = (s) => String(s || '').split(',').map((s) => s.trim()).filter(Boolean);
const enabled = (gd, id) => !!gd.bond(id) && !gd.modeInactiveBonds.has(id);
const traitCache = new WeakMap();

function traits(gd, rec) {
  if (!rec) return [];
  let cache = traitCache.get(gd);
  if (!cache) traitCache.set(gd, (cache = new Map()));
  if (!cache.has(rec.chessId)) cache.set(rec.chessId, (rec.garrisonIds || []).map((id) => gd.garrison(id)).filter(Boolean));
  return cache.get(rec.chessId);
}

/** The first powered core threshold (阿戈尔 5, other cores 6), bounded by the actual deploy cap. */
export function coreTarget(gd, id, cap) {
  const th = gd.bond(id)?.thresholds || [3];
  return th.find((n) => n >= 5 && n <= cap) ?? th[0];
}

const routeCache = new WeakMap();
/** Immutable route objects share an engine; a route describes a core, a damage add-on and an economy objective. */
export function bondRoutes(gd, focus, cap) {
  let cache = routeCache.get(gd);
  if (!cache) routeCache.set(gd, (cache = new Map()));
  const key = `${focus}:${cap}`;
  if (!cache.has(key)) {
    const members = (gd.bond(focus)?.members || []).map((id) => gd.chess(id)).filter(Boolean);
    const routes = gd.bondIds.filter((id) => {
      const b = gd.bond(id);
      return b && !b.isCore && b.activeType === 'BATTLE' && !b.noStack && b.thresholdTemplate !== 'count_threshold_downward'
        && members.some((c) => c.bonds?.includes(id));
    }).map((support) => Object.freeze({
      id: `${focus}:${support}`, core: focus, support, coreMembers: coreTarget(gd, focus, cap),
      supportMembers: Math.min(3, gd.bond(support).thresholds.at(-1)),
      economy: focus === 'lateranoShip' ? Object.freeze({ bond: 'visiShip', members: 2, layerMilestones: Object.freeze([80, 150]) }) : null,
    }));
    cache.set(key, Object.freeze(routes));
  }
  return cache.get(key);
}

/** A user-specified band commitment takes precedence over tentative owned-card advantages. */
export function fixedBandCore(m, ps) {
  const gd = ps.gd || m.gd;
  if (ps.bandId === 'band_pepe' && enabled(gd, 'sargonShip')) return 'sargonShip';
  if (ps.bandId === 'band_jesica' && m.opts.botYanCore !== false && enabled(gd, 'yanShip')) return 'yanShip';
  // User recipe: Chiave's guaranteed Siracusa gifts bind the plan, even before three members are owned.
  if (enabled(gd, 'siracusaShip') && gd.band(ps.bandId)?.buffs?.some((b) =>
    b.key === 'refresh_shop_count_gain_coin_bond_char_chess' && b.bbStr?.bond === 'siracusaShip')) return 'siracusaShip';
  if (enabled(gd, 'lateranoShip') && gd.band(ps.bandId)?.buffs?.some((b) =>
    b.key === 'band_cost_coin_reach_cnt_gain_chess_from_pool' && gd.bandBondIds(ps.bandId).includes('lateranoShip'))) return 'lateranoShip';
  return null;
}

/** Seeded opening choice; Chiave always commits to Siracusa without reweighting the opening band picker. */
export function openingCore(m, ps, owned) {
  const gd = ps.gd || m.gd;
  const fixed = fixedBandCore(m, ps);
  if (fixed) { m.rngBots(); return fixed; } // Preserve the opening core choice's single RNG draw.
  const choices = [];
  for (const id of gd.bondIds) {
    if (!enabled(gd, id) || !gd.bond(id).isCore) continue;
    const available = new Set();
    for (const p of ps.allChess()) if (gd.chess(p.id)?.bonds?.includes(id)) available.add(gd.baseIdOf(p.id));
    for (const [base, entry] of m.pool.entries) if (entry.left > 0 && gd.chess(base)?.bonds?.includes(id)) available.add(base);
    if (available.size < coreTarget(gd, id, ps.deployCap)) continue;
    const visible = ps.shop.slots.filter((s) => s && !s.sold && s.kind === 'chess' && gd.chess(s.id)?.bonds?.includes(id)).length;
    const mates = m.alivePlayers().filter((p) => p !== ps && p._botFocusId === id).length;
    const weight = (1 + visible * 4 + (owned.counts.get(id) || 0) * 8 + (gd.bandBondIds(ps.bandId).includes(id) ? 8 : 0)) / (1 + mates * 3);
    choices.push({ id, weight });
  }
  // Avoid an opening with no usable cards while another core is already strongly represented in the visible shop.
  const strongest = Math.max(0, ...choices.map((c) => c.weight));
  const viable = choices.filter((c) => c.weight >= strongest * 0.6);
  let r = m.rngBots() * viable.reduce((s, c) => s + c.weight, 0);
  for (const c of viable) { r -= c.weight; if (r < 0) return c.id; }
  return viable.at(-1)?.id ?? null;
}

/** Seed a sub-route once; change only after three rounds and a two-member advantage for the alternative. */
export function selectRoute(m, ps, focus, counts) {
  const gd = ps.gd || m.gd;
  const recipe = coreStrategy(m, focus);
  if (recipe) {
    const previous = ps._botRoute;
    const route = recipe.selectRoute(m, ps, counts);
    ps._botRoute = route;
    if (route?.id !== previous?.id) {
      ps._botRouteRound = m.round;
      (ps._botRouteHistory ||= []).push({ round: m.round, from: previous?.id ?? null, to: route?.id ?? null });
    }
    return route;
  }
  let routes = bondRoutes(gd, focus, ps.deployCap).filter((r) => enabled(gd, r.support));
  if (focus === 'lateranoShip') {
    const laterano = routes.filter((r) => ['preciShip', 'skillfulShip'].includes(r.support));
    if (laterano.length) routes = laterano;
  }
  if (!routes.length) { ps._botRoute = null; return null; }
  const previous = ps._botRoute;
  let route = routes.find((r) => r.id === previous?.id);
  if (!route) {
    route = routes[Math.floor(m.rngBots() * routes.length)];
    ps._botRouteRound = m.round;
  } else if (m.round - ps._botRouteRound >= 3) {
    const best = supportBond(m, ps, focus, counts, route.support);
    const alternative = routes.find((r) => r.support === best);
    if (alternative && (counts.get(best) || 0) >= (counts.get(route.support) || 0) + 2
      && (ps.layers[best] || 0) + 10 >= (ps.layers[route.support] || 0)) {
      route = alternative; ps._botRouteRound = m.round;
    }
  }
  ps._botRoute = route;
  if (route.id !== previous?.id) (ps._botRouteHistory ||= []).push({ round: m.round, from: previous?.id ?? null, to: route.id });
  return route;
}

/** Approximate repeatable layers per round, using the effect's actual bond IDs and blackboard amounts. */
export function layerForecast(gd, rec, focus, level = 4) {
  const out = new Map();
  const add = (ids, amount) => { for (const id of ids) if (enabled(gd, id) && amount > 0) out.set(id, (out.get(id) || 0) + amount); };
  for (const g of traits(gd, rec)) {
    const b = g.bb || {}, s = g.bbStr || {};
    const ids = splitIds(s.bond || s.bond_id);
    const own = rec.bonds || [];
    const count = b.count || 0;
    if (g.eventType === 'IN_BATTLE') {
      // Three successful triggers, bounded by the real per-battle cap; not a promise that the unit survives/fires.
      add(s.bond_type === 'bond_by_id' ? ids : own, Math.min(b.max_add_count_per_battle ?? Infinity, (b.bond_add_count || 0) * 3));
      continue;
    }
    if (!['SERVER_PREP_START', 'SERVER_PREP_FIN', 'SERVER_REFRESH_SHOP'].includes(g.eventType)) continue;
    switch (g.effectKey) {
      case 'SERVER_ADD_BOND': add(ids, count); break;
      case 'SERVER_ADD_BOND_CHESS_ALL': add(own, count); break;
      case 'SERVER_ADD_BOND_POSITION': add(own, count * 1.5); break;
      case 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER': add([focus], count); break;
      case 'SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER': add([focus], (b.multi || 1) * 3); break;
      case 'SERVER_ADD_BOND_METHOD': {
        const n = s.add_method === 'shoplv' ? level : 3;
        add(ids, n * (b.multi || 1)); break;
      }
      case 'SERVER_ADD_BOND_ROUND_COIN_COST': add(ids, Math.floor(12 / Math.max(1, b.count || 3)) * (b.layer || 0)); break;
      case 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER': add(ids, Math.min(b.max_layer || Infinity, 3 * (b.multiplier || 0))); break;
      case 'SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT': add(ids, b.layer || 0); break;
      case 'SERVER_ADD_BOND_IN_HAND': add(own, count * 2); break;
      default: break;
    }
  }
  return out;
}

/** Choose a damage add-on by owned members, overlap with the core, its layer engines and invested layers. */
export function supportBond(m, ps, focus, counts, previous = null) {
  const gd = ps.gd || m.gd;
  const owned = ps.allChess();
  let best = null, bestScore = -Infinity;
  const routes = bondRoutes(gd, focus, ps.deployCap);
  for (const { support: id } of routes) {
    const b = gd.bond(id), n = counts.get(id) || 0;
    if (!enabled(gd, id) || b.isCore || b.activeType !== 'BATTLE' || !n || b.noStack || b.thresholdTemplate === 'count_threshold_downward') continue;
    let overlap = 0, growth = 0;
    const seen = new Set();
    for (const p of owned) {
      const rec = gd.chess(p.id), base = gd.baseIdOf(p.id);
      if (!rec) continue;
      if (!seen.has(base) && rec.bonds?.includes(focus) && rec.bonds.includes(id)) overlap++;
      seen.add(base);
      growth += layerForecast(gd, rec, focus, ps.shop.level).get(id) || 0;
    }
    const score = n * 7 + overlap * 5 + Math.min(10, growth * 0.4) + Math.sqrt(ps.layers[id] || 0) + (id === previous ? 4 : 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/** How much layers of this bond matter to the current plan, including a funded 远见 side objective. */
export function layerInterest(gd, id, plan, bonds = {}) {
  if (plan.strategy?.valuesBond?.(id) === false) return 0;
  if (!enabled(gd, id)) return 0;
  if (id === plan.focus) return 1;
  if (id === plan.second || plan.route?.supports?.includes(id)) return 0.85;
  if (id === 'visiShip') return bonds[id]?.active ? 0.65 : plan.focus === 'lateranoShip' ? 0.4 : 0.15;
  return bonds[id]?.active ? 0.25 : 0.05;
}

/** Keep actual layer engines useful late in a match; stronger elite traits receive their actual larger forecast. */
export function growthValue(m, ps, rec, plan) {
  if (plan.strategy?.combatRosterOnly?.(m, ps)) return 0;
  const gd = ps.gd || m.gd;
  let value = 0;
  for (const [id, amount] of layerForecast(gd, rec, plan.focus, ps.shop.level)) value += amount * layerInterest(gd, id, plan, ps.bonds);
  const horizon = Math.max(0.35, Math.min(1, ((m.gd.bossRound || 14) - m.round + 1) / 5));
  return Math.min(18, Math.sqrt(value) * 2.5) * horizon;
}

/** Distinct missing core/support members may be acquired before a single swap can improve the current board. */
export function developmentBuy(m, ps, rec, ctx) {
  const gd = ps.gd || m.gd;
  if (!rec || rec.isGolden || ctx.owned.bases.has(gd.baseIdOf(rec.chessId))) return 0;
  const recipe = coreStrategy(m, ctx.focus);
  if (recipe && recipe.buyBonus(m, ps, rec, ctx, ctx.owned.counts) > 0) return 10;
  const primary = rec.bonds?.includes(ctx.focus) && (ctx.owned.counts.get(ctx.focus) || 0) < coreTarget(gd, ctx.focus, ps.deployCap);
  const support = rec.bonds?.includes(ctx.second) && (ctx.owned.counts.get(ctx.second) || 0) < Math.min(3, gd.bond(ctx.second)?.thresholds?.at(-1) || 2);
  const economy = ctx.focus === 'lateranoShip' && rec.bonds?.includes('visiShip') && (ctx.owned.counts.get('visiShip') || 0) < 2
    && ps.allChess().some((p) => (layerForecast(gd, gd.chess(p.id), ctx.focus, ps.shop.level).get('visiShip') || 0) > 0);
  return primary ? 12 : support ? 7 : economy ? 8 : 0;
}

/** Promotion can double a layer engine; compare the actual elite blackboards as well as immediate piece power. */
export function promotionGrowth(m, ps, rec, plan) {
  if (plan.strategy?.combatRosterOnly?.(m, ps)) return 0;
  const gd = ps.gd || m.gd, elite = gd.chess(gd.goldenIdOf(rec.chessId));
  if (!elite) return 0;
  const normal = layerForecast(gd, rec, plan.focus, ps.shop.level);
  let gain = 0;
  for (const [id, value] of layerForecast(gd, elite, plan.focus, ps.shop.level)) gain += Math.max(0, value - (normal.get(id) || 0)) * layerInterest(gd, id, plan, ps.bonds);
  return Math.min(20, gain * 0.4);
}

/** Extra value of using otherwise lost final funds for a real, still-triggerable layer-producing refresh. */
export function refreshGrowth(m, ps, plan) {
  if (plan.strategy?.combatRosterOnly?.(m, ps)) return 0;
  if (m.gd.leftoverKeptBands.includes(ps.bandId)) return 0;
  const gd = ps.gd || m.gd;
  let value = 0;
  for (const p of ps.allChess()) for (const g of traits(gd, gd.chess(p.id))) {
    const b = g.bb || {}, s = g.bbStr || {};
    let amount = 0;
    if (g.effectKey === 'SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT'
      && ps.pieceRoundCount(p, `garrison:${g.effectKey}:refreshes`) < (b.refresh_cnt || 1)) amount = b.layer || 0;
    if (g.effectKey === 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER' && ps.find(p.uid)?.area === 'board') {
      amount = Math.max(0, Math.min(b.multiplier || 0, (b.max_layer || Infinity) - ps.round.refreshes * (b.multiplier || 0)));
    }
    for (const id of splitIds(s.bond)) if (ps.bonds[id]?.active) value += amount * layerInterest(gd, id, plan, ps.bonds);
  }
  return value;
}

/** Value of positional layer conditions in a candidate layout; consumes only public record blackboards. */
export function layoutGrowth(gd, units, plan, bonds, model = null) {
  if (plan.strategy?.combatLayoutOnly?.(plan)) return plan.strategy.layoutValue(gd, units, plan, bonds, model) || 0;
  let value = 0;
  const rows = new Map(), at = new Map();
  for (const u of units) { rows.set(u.r, (rows.get(u.r) || 0) + 1); at.set(u.key, u); }
  const interest = (rec) => (rec?.bonds || []).reduce((n, id) => n + (bonds[id]?.active ? layerInterest(gd, id, plan, bonds) : 0), 0);
  for (const u of units) for (const g of traits(gd, u.rec)) {
    const b = g.bb || {}, s = g.bbStr || {};
    if (g.effectKey === 'SERVER_ADD_BOND_POSITION') {
      const [dr, dc] = rotateOffset(0, s.dir === 'behind' ? -1 : 1, u.dir);
      const other = at.get(`${u.r + dr},${u.c + dc}`);
      if (other) value += (b.count || 0) * (interest(u.rec) + interest(other.rec));
    }
    if (s.conditionkey === 'character_same_row' && (rows.get(u.r) || 0) >= (b.check_count || 3)) {
      value += Math.min(12, (b.bond_add_count || b.count || 2) * 3) * interest(u.rec);
    }
    if (s.add_method === 'same_row') value += (rows.get(u.r) || 0) * (b.multi || 1) * interest(u.rec);
  }
  // [ASSUMED] One forecast layer is worth 0.035 expected kills; capped so combat coverage stays decisive.
  return Math.min(1.2, value * 0.035) + (plan.strategy?.layoutValue(gd, units, plan, bonds, model) || 0);
}
