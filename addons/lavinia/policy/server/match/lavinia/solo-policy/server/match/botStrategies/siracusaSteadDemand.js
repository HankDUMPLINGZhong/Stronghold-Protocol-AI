// [ASSUMED] Independent two-seat early-Stead demand trial over retained11/56.
// Buy only after inherited visible purchases, using bounded independent current-wave forecasts.
// Hypothetical purchases add ordinary units/cost counters only; no acquisition RNG or future offers.
import { computeBonds, pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { planLayoutSteps } from '../botDevelopment.js';
import { createRng, deriveSeed } from '../../../../../../../../../../sim/rng.js';
import { createForecastSteps } from '../botForecast.js';
import { correctedContactInput } from './siracusaContactInputs.js';
import { siracusaCoopSnapshot } from './siracusaCoopExperiments.js';
import { applyCoopRolePlan } from './lateranoCoopRoles.js';
import { steadDevelopmentBudget, steadDevelopmentWorth } from './siracusaSteadDevelopment.js';
import { earlyBridgeBundles, earlyBridgeLineup, projectEarlyBridgeMerge } from './siracusaEarlyBridge.js';
import { SIRACUSA_EARLY_BUILDS, earlyBuildScope, earlyBuildBundles, earlyBuildLineup, earlyBuildMoves, applyEarlyBuildPlan } from './siracusaEarlyBuild.js';

export const SIRACUSA_STEAD_DEMAND = 'human-stead-demand';
const CORE = 'siracusaShip', STEAD = 'steadShip';
const helpers = new WeakMap(), cache = new WeakMap();
const developmentCache = new WeakMap();
const bridgeCache = new WeakMap();
const buildCaches = new Map(SIRACUSA_EARLY_BUILDS.map(id => [id, new WeakMap()]));
const windTransferCache = new WeakMap();
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const has = (ps, p, id) => pieceBonds(ps.gd, p).includes(id);
const kinds = (ps, xs, id) => new Set(xs.filter(p => has(ps, p, id)).map(p => base(ps, p))).size;
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 2 && m.difficulty === 'ABYSS'
  && !!m.wave && ps.bandId === 'band_chiave' && ps._botFocusId === CORE && !ps.gd.modeInactiveBonds.has(STEAD);
const buying = (m, ps) => scope(m, ps) && m.round >= 3 && m.round <= 7 && ps.shop.level < 4;
const heal = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const quality = (ps, p) => ps.gd.chess(p.id).tier + Number(ps.gd.isGolden(p.id)) * 5;
const log = (ps, row) => (ps._botSiracusaSteadDemandHistory ||= []).push({ factor: SIRACUSA_STEAD_DEMAND, ...row });
const stamp = (m, ps) => JSON.stringify([m.round, ps.lp, ps.shop, ps.funds, ps.round, ps.battleInput(), ps.hand, ps.temp,
  m.order.filter(p => p !== ps && p.alive).map(p => [p.playerId, p.bandId])]);
const combinations = (xs, n) => n === 0 ? [[]] : xs.flatMap((x, i) => combinations(xs.slice(i + 1), n - 1).map(t => [x, ...t]));

/** Parent-visible keys and executable upgrade reserves win. Keep one paid refresh after any extra bundle. */
export function steadDemandBundles(parent, m, ps, { developmentPriority = false } = {}) {
  if (!buying(m, ps) || kinds(ps, ps.allChess(), CORE) >= 4 || ps._botSteadDemandBoughtRound === m.round) return [];
  const development = developmentPriority ? steadDevelopmentBudget(m, ps) : null;
  if (development?.defer) return [];
  const owned = ps.allChess(), held = new Set(owned.filter(p => has(ps, p, STEAD)).map(p => base(ps, p)));
  const paid = new Set(ps._botSteadDemandPaid || []);
  if (held.size >= 3 || paid.size >= 3) return [];
  const slots = ps.shop.slots.map((s, index) => ({ s, index })).filter(x => x.s?.kind === 'chess' && !x.s.sold);
  if (slots.some(({ s }) => ps.priceOf(s) <= ps.funds && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id))
    && (ps.gd.chess(s.id).bonds.includes(CORE) || parent.importantBuy?.(m, ps, ps.gd.chess(s.id))
      || parent.criticalBuy?.(m, ps, ps.gd.chess(s.id), { route: ps._botRoute })))) return [];
  const target = parent.levelTarget(m, ps), fee = Math.max(0, ps.shop.upgradePrice), extra = Math.max(0, parent.upgradeReserve(m, ps));
  const ready = owned.length >= (m.round <= 4 ? ps.deployCap : Math.min(ps.deployCap, 6)) || parent.readyForUpgrade?.(m, ps) === true;
  const executable = ps.shop.level < target && ps.funds >= fee + extra && (ready || m.round >= 6)
    && parent.beforeUpgrade(m, ps, { route: ps._botRoute });
  const reserve = Math.max(ps.gd.refreshPrice, parent.spendReserve(m, ps) || 0, parent.purchaseReserve?.(m, ps) || 0,
    executable ? fee + extra : 0, development?.reserve || 0);
  const candidates = slots.filter(({ s }) => {
    const r = ps.gd.chess(s.id), id = base(ps, s);
    return !r.isGolden && r.tier <= 3 && r.bonds.includes(STEAD) && !r.bonds.includes(CORE) && !held.has(id) && !paid.has(id);
  });
  const missingHeal = !field(ps).some(p => heal(ps.gd.chess(p.id)));
  const value = entries => entries.reduce((n, x) => { const r = ps.gd.chess(x.s.id);
    return n + (missingHeal && heal(r) ? 10 : 0) + (r.subProfessionId === 'fortress' ? 6 : 0) + r.tier; }, 0);
  const out = [];
  for (const count of [2, 3]) {
    const n = count - held.size;
    if (n <= 0 || n > ps.hand.filter(p => !p).length || n + paid.size > 3) continue;
    const bundles = combinations(candidates, n).filter(xs => new Set(xs.map(x => base(ps, x.s))).size === n)
      .map(entries => ({ entries, count, price: entries.reduce((n, x) => n + ps.priceOf(x.s), 0), reserve }))
      .filter(p => ps.funds - p.price >= reserve)
      .sort((a, b) => a.price - b.price || value(b.entries) - value(a.entries) || a.entries[0].index - b.entries[0].index);
    out.push(...bundles.slice(0, 2));
  }
  return out;
}

/** Pure own view. Deliberately no onGain/onBuy dispatch: future random rewards are not forecast inputs. */
export function steadPurchaseView(ps, bundle) {
  const view = Object.assign(Object.create(ps), { board: new Map(ps.board), hand: [...ps.hand], temp: [...ps.temp],
    layers: { ...ps.layers }, funds: ps.funds - bundle.price, round: { ...ps.round,
      spent: ps.round.spent + bundle.price, buys: ps.round.buys + bundle.entries.length,
      gainedChess: ps.round.gainedChess + bundle.entries.length }, _legalityStale: false });
  bundle.virtual = bundle.entries.map(({ s, index }) => ({ uid: -100 - index, kind: 'chess', id: s.id, items: [], poolCopies: 1, boughtRound: ps.m.round, meta: {} }));
  for (const p of bundle.virtual) { const i = view.hand.findIndex(p => !p); if (i < 0) throw Error('Stead projection hand full'); view.hand[i] = p; }
  view.bonds = computeBonds(ps.gd, view);
  return view;
}

/** Keep native growth pieces, equipment, Raid/Aroma and summon owners. Fill different owned natives before extras. */
export function steadDemandLineup(ps, suggested, count, { excludeStead = false, required = [] } = {}) {
  const owned = ps.allChess(), owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const pinned = p => owners.has(p.uid) || p.items?.length || has(ps, p, CORE) || has(ps, p, 'raidShip');
  const selected = suggested.filter(p => pinned(p));
  const add = p => { if (p && !selected.includes(p)) selected.push(p); };
  for (const p of field(ps)) if (owners.has(p.uid) || p.items?.length) add(p);
  const ordered = owned.slice().sort((a, b) => quality(ps, b) - quality(ps, a) || Number(suggested.includes(b)) - Number(suggested.includes(a)) || a.uid - b.uid);
  const nativeTarget = Math.min(6, kinds(ps, owned, CORE));
  for (const p of ordered) if (kinds(ps, selected, CORE) < nativeTarget && has(ps, p, CORE)
    && !selected.some(q => base(ps, q) === base(ps, p))) add(p);
  const steads = ordered.filter(p => has(ps, p, STEAD));
  for (const p of required) add(p);
  if (count && suggested.some(p => heal(ps.gd.chess(p.id))) && !selected.some(p => heal(ps.gd.chess(p.id))))
    add(steads.find(p => heal(ps.gd.chess(p.id))));
  for (const p of steads) if (kinds(ps, selected, STEAD) < count && !selected.some(q => base(ps, q) === base(ps, p))) add(p);
  if (selected.length > ps.deployCap || kinds(ps, selected, CORE) < nativeTarget || kinds(ps, selected, STEAD) < count) return null;
  if (suggested.some(p => heal(ps.gd.chess(p.id))) && !selected.some(p => heal(ps.gd.chess(p.id)))) {
    add(ordered.find(p => heal(ps.gd.chess(p.id)) && (!excludeStead || !has(ps, p, STEAD))));
  }
  for (const p of [...suggested, ...ordered]) if (selected.length < Math.min(ps.deployCap, owned.length)
    && (!has(ps, p, STEAD) || !excludeStead && selected.includes(p))) add(p);
  if (selected.length > ps.deployCap || selected.length < field(ps).length) return null;
  if (suggested.some(p => heal(ps.gd.chess(p.id))) && !selected.some(p => heal(ps.gd.chess(p.id)))) return null;
  if (['swiftShip', 'arcaneShip', 'raidShip'].some(id => ps.bonds[id]?.active && kinds(ps, selected, id) < ps.gd.bond(id).activeCount)) return null;
  return selected;
}

export function* steadDemandLayoutSteps(m, ps, h, lineup) {
  const tokens = [...ps.board].filter(([, p]) => p.kind !== 'chess'), owners = new Set(tokens.map(([, p]) => p.ownerUid));
  const seed = new h.LayoutPlan();
  for (const [key, p] of ps.board) if (p.kind === 'chess' && lineup.includes(p)
    && (owners.has(p.uid) || p.items?.length || has(ps, p, 'raidShip') || base(ps, p) === 'chess_char_4_10_a')) {
    seed.set(p.uid, key); seed.dirs.set(p.uid, p.dir);
  }
  // planLayout's seedPlan is a COMPLETE layout, not partial pins. Reserve pinned cells, plan all
  // operators, then restore pins and reject any collision with a recipe's mandatory starts.
  const plan = yield* planLayoutSteps(m, ps, lineup, undefined, { occupied: new Set([...tokens.map(([key]) => key), ...seed.values()]),
    rng: createRng(deriveSeed(m.seed, 'stead-demand-layout:' + m.round + ':' + ps.seat)) });
  for (const [uid, key] of seed) { plan.set(uid, key); plan.dirs.set(uid, seed.dirs.get(uid)); }
  if (plan.size !== lineup.length || new Set(plan.values()).size !== plan.size
    || lineup.some(p => !plan.has(p.uid) || !ps._legal(p, ...plan.get(p.uid).split(',').map(Number)))) return null;
  plan.lineup = lineup; plan.view = ps;
  return plan;
}

const valid = rs => rs.length === 2 && rs.every((r, i) => r.valid && r.sample === i);
const rows = (os, i) => os.filter(o => o.index === i).sort((a, b) => a.sample - b.sample);
const sum = (rs, key) => rs.reduce((s, r) => s + r[key], 0);
const rank = rs => [Math.max(...rs.map(r => r.lost)), sum(rs, 'lost'), Math.max(...rs.map(r => r.leaks)), sum(rs, 'leaks')];
const compare = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Demand pays for material gains; the independent construction opt-in may invest on neutral samples. */
export function selectSteadDemand(plans, outcomes, { lp = Infinity, purchase = true, developmentPriority = false, lossCap = 10, construction = false } = {}) {
  const before = rows(outcomes, 0); if (!valid(before)) return { index: 0 };
  const safe = rs => valid(rs) && rs.every((r, i) => r.lost <= before[i].lost && r.leaks <= before[i].leaks);
  const material = (a, b) => a.some(r => r.lost >= lp) && b.every(r => r.lost < lp)
    || sum(a, 'lost') - sum(b, 'lost') > 2 || sum(a, 'leaks') - sum(b, 'leaks') > 2;
  const eligible = plans.map((p, i) => ({ p, i, rs: rows(outcomes, i) })).filter(x => x.i && safe(x.rs)
    && (purchase ? (construction || material(before, x.rs)) && (!developmentPriority || steadDevelopmentWorth(before, x.rs, x.p.price, lp, lossCap))
      : compare(rank(x.rs), rank(before)) <= 0));
  if (purchase && !construction && plans[0].steadCount === 2) for (let i = eligible.length - 1; i >= 0; i--)
    if (eligible[i].p.steadCount >= 3 && !material(before, eligible[i].rs)) eligible.splice(i, 1);
  const rescue = purchase && developmentPriority && before.some(r => r.lost >= lp);
  eligible.sort((a, b) => (rescue ? a.p.price - b.p.price : 0) || compare(rank(a.rs), rank(b.rs)) || (a.p.price || 0) - (b.p.price || 0)
    || a.p.steadCount - b.p.steadCount || a.i - b.i);
  let winner = eligible[0]; if (!winner) return { index: 0 };
  // Third-kind proposals must earn their extra cost relative to a cheaper passing pair, too.
  if (purchase && !construction && winner.p.steadCount >= 3) {
    const pair = eligible.filter(x => x.p.steadCount === 2).sort((a, b) => compare(rank(a.rs), rank(b.rs)) || a.p.price - b.p.price)[0];
    if (pair && (!winner.rs.every((r, i) => r.lost <= pair.rs[i].lost && r.leaks <= pair.rs[i].leaks)
      || !material(pair.rs, winner.rs) || developmentPriority
        && !steadDevelopmentWorth(pair.rs, winner.rs, winner.p.price - pair.p.price, lp, lossCap))) winner = pair;
  }
  if (!purchase && !construction && compare(rank(winner.rs), rank(before)) === 0 && winner.p.steadCount >= plans[0].steadCount) return { index: 0 };
  return { index: winner.i };
}

function* probe(m, ps, plans, purchase, developmentPriority = false, construction = false) {
  const before = stamp(m, ps), outcomes = [];
  for (let start = 1; start < plans.length; start += 2) {
    const batch = [plans[0], ...plans.slice(start, start + 2)];
    function* input(p) { yield; const result = correctedContactInput(m, p.view, p);
      if (result.units.filter(u => u.kind === 'chess').length !== p.lineup.length) throw Error('Stead forecast omitted selected operators');
      return result; }
    const job = yield* createForecastSteps(m, ps, plans[0].lineup, batch, input, {
      forecastReadinessOnly: true, forecastLayerGainsEnabled: true, forecastContext: () => ({}), observeForecast: () => () => ({}),
      selectForecast: () => ({ index: 0 }),
    });
    if (!job) return null; while (!job.run(4)) yield;
    if (before !== stamp(m, ps)) return null;
    for (const r of job.outcomes) if (r.index || start === 1) outcomes.push({ ...r, index: r.index ? start + r.index - 1 : 0 });
  }
  return { ...selectSteadDemand(plans, outcomes, { lp: ps.lp, purchase, developmentPriority, lossCap: m.gd.lpCapPerRound, construction }), outcomes };
}

export function applySteadDemandPlan(ps, plan) {
  const current = field(ps), added = plan.lineup.filter(p => !current.includes(p));
  for (const p of added.slice(0, Math.max(0, plan.lineup.length - current.length))) {
    const legal = [...ps.deployMap().keys()].filter(k => !ps.board.has(k) && ps._legal(p, ...k.split(',').map(Number)));
    const key = legal.includes(plan.get(p.uid)) ? plan.get(p.uid) : legal[0];
    if (!key || !ps.move(p.uid, { area: 'board', row: +key.split(',')[0], col: +key.split(',')[1] }, plan.dirs.get(p.uid))?.ok)
      throw Error('Stead demand free staging failed');
  }
  applyCoopRolePlan(ps, plan);
}

export function withSiracusaSteadDevelopment(parent) { return withSiracusaSteadDemand(parent, { developmentPriority: true }); }
export function withSiracusaEarlyBridge(parent) { return withSiracusaSteadDemand(parent, { earlyBridge: true }); }
export function withSiracusaEarlyBuild(parent, buildMode) {
  if (!SIRACUSA_EARLY_BUILDS.includes(buildMode)) throw Error('Unknown Siracusa early construction trial');
  return withSiracusaSteadDemand(parent, { buildMode });
}
export function withSiracusaWindTransfer(parent) {
  return withSiracusaSteadDemand(parent, { buildMode: 'wind-elite', buildTransfer: true });
}

export function withSiracusaSteadDemand(parent, { developmentPriority = false, earlyBridge = false, buildMode = false, buildTransfer = false } = {}) {
  const recipes = buildTransfer ? windTransferCache : buildMode ? buildCaches.get(buildMode) : earlyBridge ? bridgeCache : developmentPriority ? developmentCache : cache;
  const inScope = buildTransfer ? (m, ps) => earlyBuildScope(m, ps, true) : scope;
  if (recipes.has(parent)) return recipes.get(parent);
  const recipe = Object.freeze({ ...parent,
    trade(m, ps, ctx, h) { if (h?.lineupFor) helpers.set(ps, h); return parent.trade(m, ps, ctx, h); },
    keep(m, ps, rec, ctx) { return parent.keep(m, ps, rec, ctx) || (buildMode ? inScope(m, ps) && m.round >= 4 && m.round <= 9 : buying(m, ps)) && ps._botSteadDemandPaid?.includes(ps.gd.baseIdOf(rec.chessId)); },
    *beforeRefreshSteps(m, ps, h) {
      if (parent.beforeRefreshSteps && (yield* parent.beforeRefreshSteps(m, ps, h))) return true;
      const bundles = buildMode ? earlyBuildBundles(parent, m, ps, buildMode, { transfer: buildTransfer }) : earlyBridge ? earlyBridgeBundles(parent, m, ps) : steadDemandBundles(parent, m, ps, { developmentPriority });
      const helper = helpers.get(ps); if (!bundles.length || !helper) return false;
      if (ps._botSteadDemandChecks?.round !== m.round) ps._botSteadDemandChecks = { round: m.round, n: 0 };
      if (ps._botSteadDemandChecks.n++ >= 3) return false;
      const original = yield* steadDemandLayoutSteps(m, ps, h, helper.lineupFor(ps).set); if (!original) return false;
      original.price = 0; original.steadCount = kinds(ps, original.lineup, STEAD);
      const plans = [original];
      for (const b of bundles) {
        const view = steadPurchaseView(ps, b);
        if ((earlyBridge || buildMode) && !projectEarlyBridgeMerge(view, b)) continue;
        if (buildMode && b.eliteWind) {
          const old = [...ps.board].find(([, p]) => base(ps, p) === 'chess_char_2_11_a');
          if (old) { view.hand = view.hand.map(p => p?.uid === b.virtual[0].uid ? null : p);
            view.board.set(old[0], { ...b.virtual[0], dir: old[1].dir });
            // Use one projected piece identity throughout the view and lineup.
            b.virtual[0] = view.board.get(old[0]); view.bonds = computeBonds(view.gd, view); }
        }
        const chosen = (buildMode ? earlyBuildLineup : earlyBridge ? earlyBridgeLineup : steadDemandLineup)(view, helper.lineupFor(view).set, b.count, { required: b.virtual });
        if (!chosen || !b.virtual.every(p => chosen.includes(p))) continue;
        const p = yield* steadDemandLayoutSteps(m, view, h, chosen); if (!p) continue;
        if (buildMode && !earlyBuildMoves(view, p)) continue;
        p.bundle = b; p.price = b.price; p.steadCount = kinds(view, chosen, STEAD); plans.push(p);
      }
      if (plans.length < 2) return false;
      const result = yield* probe(m, ps, plans, true, developmentPriority, !!buildMode); if (!result) return false;
      log(ps, { kind: 'purchase-check', round: m.round, index: result.index, outcomes: result.outcomes,
        ...(developmentPriority ? { policy: 'development-priority', lp: ps.lp, lossCap: m.gd.lpCapPerRound, development: steadDevelopmentBudget(m, ps) } : {}),
        ...(earlyBridge ? { policy: 'early-bridge', lp: ps.lp } : {}),
        ...(buildMode ? { policy: buildMode, lp: ps.lp } : {}),
        plans: plans.map(p => ({ ids: p.bundle?.entries.map(x => x.s.id) || [], price: p.price, count: p.steadCount, lineup: p.lineup.map(q => q.id),
          ...((earlyBridge || buildMode) && p.bundle ? { purpose: p.bundle.purpose, budget: p.bundle.budget } : {}) })) });
      if (!result.index) return false;
      const best = plans[result.index], b = best.bundle, remap = new Map();
      for (let i = 0; i < b.entries.length; i++) {
        const { s, index } = b.entries[i], owned = new Set(ps.allChess().map(p => p.uid));
        if (ps.shop.slots[index] !== s || s.sold || ps.funds - ps.priceOf(s) < b.reserve || !ps.buy(index)?.ok) throw Error('Validated Stead demand purchase failed');
        parent.afterPurchase?.(m, ps, s, owned);
        const actual = ps.allChess().find(p => !owned.has(p.uid) && base(ps, p) === base(ps, s));
        if (!actual) throw Error('Stead demand acquired piece missing'); remap.set(b.virtual[i].uid, actual);
      }
      const real = new h.LayoutPlan(); real.lineup = best.lineup.map(p => remap.get(p.uid) || ps.allChess().find(q => q.uid === p.uid));
      for (const p of best.lineup) { const q = remap.get(p.uid) || p; real.set(q.uid, best.get(p.uid)); real.dirs.set(q.uid, best.dirs.get(p.uid)); }
      ps._botSteadDemandBoughtRound = m.round;
      ps._botSteadDemandPaid = [...new Set([...(ps._botSteadDemandPaid || []), ...b.entries.map(x => base(ps, x.s))])];
      if (earlyBridge || buildMode) ps._botEarlyBridgeGold = (ps._botEarlyBridgeGold || 0) + b.price;
      (buildMode ? applyEarlyBuildPlan : applySteadDemandPlan)(ps, real); h.takeOffers();
      log(ps, { kind: 'package-buy', round: m.round, ids: b.entries.map(x => x.s.id), price: b.price, reserve: b.reserve, fundsAfter: ps.funds,
        ...(earlyBridge ? { policy: 'early-bridge', purpose: b.purpose, bridgeGold: ps._botEarlyBridgeGold } : {}) });
      if (buildMode) log(ps, { kind: 'construction-buy', policy: buildMode, round: m.round, purpose: b.purpose,
        ids: b.entries.map(x => x.s.id), price: b.price, reserve: b.reserve, fundsAfter: ps.funds, bridgeGold: ps._botEarlyBridgeGold });
      yield; return true;
    },
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!inScope(m, ps) || m.round < 3 || m.round > 9 || !ps._botSteadDemandPaid?.length) return;
      const original = siracusaCoopSnapshot(ps, h); original.view = ps; original.steadCount = kinds(ps, original.lineup, STEAD);
      const plans = [original];
      if (earlyBridge || buildMode) {
        const paid = new Set(ps._botSteadDemandPaid), required = ps.allChess().filter(p => paid.has(base(ps, p)))
          .sort((a, b) => quality(ps, b) - quality(ps, a)).slice(0, 1);
        const count = buildMode === 'stead-build' ? Math.min(3, kinds(ps, ps.allChess(), STEAD))
          : required.some(p => has(ps, p, STEAD)) && kinds(ps, ps.allChess(), STEAD) >= 3 ? 3 : 0;
        const chosen = (buildMode ? earlyBuildLineup : earlyBridgeLineup)(ps, original.lineup, count, { required });
        if (chosen && !(chosen.length === original.lineup.length && chosen.every(p => original.lineup.includes(p)))) {
          const p = yield* steadDemandLayoutSteps(m, ps, h, chosen);
          if (p && (!buildMode || earlyBuildMoves(ps, p))) { p.steadCount = kinds(ps, chosen, STEAD); plans.push(p); }
        }
      }
      for (const count of [0, 2, 3]) {
        if (earlyBridge || buildMode) break;
        const chosen = steadDemandLineup(ps, original.lineup, count, { excludeStead: count === 0 }); if (!chosen) continue;
        if (chosen.length === original.lineup.length && chosen.every(p => original.lineup.includes(p))) continue;
        const p = yield* steadDemandLayoutSteps(m, ps, h, chosen); if (!p) continue;
        p.steadCount = kinds(ps, chosen, STEAD); plans.push(p);
      }
      if (plans.length < 2) return;
      const result = yield* probe(m, ps, plans, false, developmentPriority, !!buildMode); if (!result) return;
      if (result.index) (buildMode ? applyEarlyBuildPlan : applySteadDemandPlan)(ps, plans[result.index]);
      log(ps, { kind: 'transition-check', round: m.round, index: result.index, outcomes: result.outcomes,
        plans: plans.map(p => ({ count: p.steadCount, lineup: p.lineup.map(q => q.id) })) });
    },
  }); recipes.set(parent, recipe); return recipe;
}
