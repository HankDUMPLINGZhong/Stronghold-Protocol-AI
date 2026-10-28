// [ASSUMED] Three independent four-seat trials over the retained11/56 policy.
// Community inspiration is recorded in siracusa-coop.md; thresholds are AI policy, not game rules.
// Current holdings/shops/public waves only. No actual combat seeds, future shops or teammate assets.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { createForecastSteps } from '../botForecast.js';
import { draftSafetyKey } from './siracusaDraftSafety.js';
import { siracusaContactInput, applySiracusaContact } from './siracusaCoopTactics.js';
import { coopRoleEntryPlan, applyCoopRolePlan } from './lateranoCoopRoles.js';

export const SIRACUSA_COMMUNITY_FACTORS = Object.freeze(['coop-four-miracle-bridge', 'coop-four-risk-deputy', 'coop-four-vigil-growth']);
const CORE = 'siracusaShip', MIRA = 'miraShip', DEPUT = 'deputShip', WIND = 'chess_char_2_11_a', VIGIL = 'chess_char_3_19_a';
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const kinds = (ps, bond, pieces = ps.allChess()) => new Set(pieces.filter(p => pieceBonds(ps.gd, p).includes(bond)).map(p => base(ps, p)));
const scope = (m, ps, seats = 4) => m.mode === 'coop' && !m.isSolo && m.difficulty === 'ABYSS' && m.order.length === seats
  && !!m.wave && m.round >= 3 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const early = (m, ps) => scope(m, ps) && m.round <= 7 && ps.shop.level === 2;
const record = (ps, row) => (ps._botSiracusaCoopHistory ||= []).push(row);

/** Do not divert the currently executable upgrade or a visible affordable core/key purchase. */
function budgetAllows(parent, m, ps, rec) {
  const slot = ps.shop.slots.find(s => s?.kind === 'chess' && !s.sold && s.id === rec.chessId);
  if (!slot || ps.priceOf(slot) > ps.funds) return false;
  if (ps.shop.slots.some(s => s?.kind === 'chess' && !s.sold && ps.priceOf(s) <= ps.funds
    && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id))
    && (ps.gd.chess(s.id).bonds.includes(CORE) || parent.importantBuy?.(m, ps, ps.gd.chess(s.id))))) return false;
  const target = parent.levelTarget(m, ps), upgradePrice = Math.max(0, ps.shop.upgradePrice);
  const extra = Math.max(0, parent.upgradeReserve(m, ps));
  const ready = ps.allChess().length >= (m.round <= 4 ? ps.deployCap : Math.min(ps.deployCap, 6)) || parent.readyForUpgrade?.(m, ps) === true;
  const executable = ps.shop.level < target && ps.funds >= upgradePrice + extra && (ready || m.round >= 6)
    && parent.beforeUpgrade(m, ps, { route: ps._botRoute });
  const reserve = Math.max(0, parent.spendReserve(m, ps) || 0, parent.purchaseReserve?.(m, ps) || 0,
    executable ? upgradePrice + extra : 0);
  return ps.funds - ps.priceOf(slot) >= reserve;
}

export function siracusaMiracleBridge(parent, m, ps, rec, reward = false) {
  if (!scope(m, ps) || m.round > 9 || ps.shop.level > 4 || base(ps, rec) !== WIND
    || ps.gd.modeInactiveBonds.has(MIRA)) return false;
  const owned = ps.allChess(), copies = owned.filter(p => base(ps, p) === WIND);
  if (copies.some(p => ps.gd.isGolden(p.id)) || copies.length >= 2) return false;
  const otherMiracles = kinds(ps, MIRA, owned.filter(p => base(ps, p) !== WIND));
  if (otherMiracles.size !== 1) return false; // completes two; do not buy a lone speculative Miracle.
  if (reward) return !(ps.offers?.[0]?.slots || []).some(s => s?.kind === 'chess' && ps.gd.chess(s.id)?.bonds.includes(CORE));
  return budgetAllows(parent, m, ps, rec);
}

export function siracusaRiskDeputy(parent, m, ps, rec) {
  if (!early(m, ps) || !rec.bonds.includes(DEPUT) || rec.bonds.includes(CORE) || rec.tier > 3
    || ps.gd.modeInactiveBonds.has(DEPUT) || kinds(ps, CORE).size >= 6) return false;
  const risk = ps._botDraftSafety;
  if (risk?.round !== m.round || risk.key !== draftSafetyKey(m, ps) || risk.safe !== false) return false;
  if (kinds(ps, DEPUT).size !== 1 || ps.allChess().some(p => base(ps, p) === base(ps, rec))
    || (ps._botCommunityDeputPaid || []).includes(base(ps, rec))) return false;
  return budgetAllows(parent, m, ps, rec);
}

function deputyPlans(ps, h, snapshot) {
  const original = snapshot(ps, h), chosen = original.lineup, proposals = [];
  if (kinds(ps, DEPUT, chosen).size >= 2) return [original];
  const pinned = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  for (const p of chosen) if (base(ps, p) === 'chess_char_4_10_a' || pieceBonds(ps.gd, p).includes('raidShip')) pinned.add(p.uid);
  for (const a of ps.allChess().filter(p => !chosen.includes(p) && pieceBonds(ps.gd, p).includes(DEPUT))) for (const d of chosen) {
    if (pinned.has(d.uid) || d.items?.length) continue;
    const lineup = chosen.map(p => p === d ? a : p);
    if (kinds(ps, DEPUT, lineup).size < 2 || kinds(ps, CORE, lineup).size < kinds(ps, CORE, chosen).size) continue;
    if (['swiftShip', 'arcaneShip', 'raidShip'].some(id => ps.bonds[id]?.active && kinds(ps, id, lineup).size < ps.gd.bond(id).activeCount)) continue;
    const r = ps.gd.chess(d.id), heal = x => x.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(x.subProfessionId);
    if (heal(r) && !lineup.some(p => heal(ps.gd.chess(p.id)))) continue;
    if (r.position === 'MELEE' && r.stats.blockCnt > 0 && !lineup.some(p => {
      const q = ps.gd.chess(p.id); return q.position === 'MELEE' && q.stats.blockCnt > 0;
    })) continue;
    const plan = coopRoleEntryPlan(ps, h, original, lineup);
    if (!plan || chosen.some(p => pinned.has(p.uid) && (plan.get(p.uid) !== original.get(p.uid) || plan.dirs.get(p.uid) !== original.dirs.get(p.uid)))) continue;
    plan.entry = { incoming: a.uid, outgoing: d.uid };
    proposals.push(plan);
  }
  return [original, ...proposals.slice(0, 2)];
}

/** Only Vigil facing and empty legal wolf destinations change. All chess locations are pinned. */
export function siracusaVigilPlans(m, ps, h, snapshot) {
  const original = snapshot(ps, h), chosen = original.lineup;
  for (const [key, p] of ps.board) if (p.kind === 'token') { original.set(p.uid, key); original.dirs.set(p.uid, p.dir || 'RIGHT'); }
  const routes = h.fieldModel(m, ps).routes.filter(r => !r.fallback && r.n > 0), offered = [];
  const copy = () => { const p = new h.LayoutPlan(original); p.lineup = chosen; p.dirs = new Map(original.dirs); return p; };
  for (const vigil of chosen.filter(p => base(ps, p) === VIGIL)) {
    const wolves = [...ps.board.values()].filter(p => p.kind === 'token' && p.ownerUid === vigil.uid);
    const home = original.get(vigil.uid), [r, c] = home.split(',').map(Number), rec = h.rangeRec(ps, ps.gd.chess(vigil.id));
    const score = plan => {
      const cover = new Set(h.rangeTiles(rec, r, c, plan.dirs.get(vigil.uid)));
      return routes.reduce((value, rt) => {
        if (rt.fly && !rec.canHitFly) return value;
        const hits = rt.tiles.filter(k => cover.has(k)).length;
        const wolf = wolves.find(w => rt.tiles.includes(plan.get(w.uid)));
        const at = wolf ? rt.tiles.indexOf(plan.get(wolf.uid)) : -1;
        return value + rt.n * (Math.min(hits, 8) + (at >= 0 && cover.has(plan.get(wolf.uid)) ? 15 : 0)
          + (at >= 1 && cover.has(rt.tiles[at - 1]) ? 15 : 0));
      }, 0);
    };
    const candidates = [];
    for (const dir of DIRS) {
      const p = copy(); p.dirs.set(vigil.uid, dir); candidates.push(p);
      for (const wolf of wolves) for (const key of new Set(routes.filter(rt => !rt.fly).flatMap(rt => rt.tiles))) {
        if (ps.board.has(key) || !ps._legal(wolf, ...key.split(',').map(Number))) continue;
        const q = copy(); q.dirs.set(vigil.uid, dir); q.set(wolf.uid, key); candidates.push(q);
      }
    }
    for (const p of candidates) {
      p.growthGeometry = score(p); p.growthOwner = vigil.uid;
      if (p.growthGeometry > score(original)) offered.push(p);
    }
  }
  const sig = p => [...p].map(([uid, key]) => [uid, key, p.dirs.get(uid)]).join('|');
  const seen = new Set([sig(original)]), plans = [original];
  offered.sort((a, b) => b.growthGeometry - a.growthGeometry || sig(a).localeCompare(sig(b)));
  for (const p of offered) if (!seen.has(sig(p)) && plans.length < 3) { seen.add(sig(p)); plans.push(p); }
  return plans;
}

/** Record actual engine garrison sources; wolf kills are reported separately, never credited to Vigil. */
export function observeVigilGrowth(battle, _ctx, plan) {
  const owners = new Set(plan.lineup.filter(p => p.id.replace(/_[ab]$/, '_a') === VIGIL).map(p => p.uid));
  const metrics = { vigilCoreGain: 0, vigilMiracleGain: 0, vigilKills: 0, wolfKills: 0 };
  battle.on('layerGain', ({ source, bondId, n }) => {
    if (!owners.has(source?.uid)) return;
    if (bondId === CORE) metrics.vigilCoreGain += n;
    if (bondId === MIRA) metrics.vigilMiracleGain += n;
  });
  battle.on('kill', ({ killer, victim }) => {
    if (victim?.side !== 'enemy') return;
    if (owners.has(killer?.uid)) metrics.vigilKills++;
    else if (owners.has(killer?.ownerUnit?.uid)) metrics.wolfKills++;
  });
  return () => metrics;
}

export function siracusaGrowthInput(ps, plan) {
  const input = siracusaContactInput(ps, plan);
  // Contact input moves real tokens after the initial shadow was sorted. Restore actual board reading order.
  input.units.sort((a, b) => b.row - a.row || a.col - b.col);
  return input;
}

export function selectVigilGrowth(plans, outcomes) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === 2 && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(rows[0])) return { index: 0 };
  const gain = r => r.vigilCoreGain + r.vigilMiracleGain;
  const score = rs => [Math.min(...rs.map(gain)), rs.reduce((n, r) => n + gain(r), 0)];
  let index = 0, best = score(rows[0]);
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, s) => r.lost > rows[0][s].lost || r.leaks > rows[0][s].leaks || r.deaths > rows[0][s].deaths)) continue;
    const next = score(rows[i]);
    if (next[0] > best[0] || next[0] === best[0] && next[1] > best[1]) { index = i; best = next; }
  }
  return { index };
}

const cache = new WeakMap();
export function withSiracusaCommunity(parent, factor, { snapshot, probe, prepareInput }) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const miracle = factor === 'coop-four-miracle-bridge', deputy = factor === 'coop-four-risk-deputy';
  const allowed = (m, ps, rec) => miracle ? siracusaMiracleBridge(parent, m, ps, rec) : siracusaRiskDeputy(parent, m, ps, rec);
  const overrides = miracle || deputy ? {
    purchaseAllowed: (m, ps, rec) => parent.purchaseAllowed(m, ps, rec) || allowed(m, ps, rec),
    importantBuy: (m, ps, rec) => parent.importantBuy(m, ps, rec) || allowed(m, ps, rec),
    ...(miracle ? {
      rewardAllowed: (m, ps, rec) => parent.rewardAllowed(m, ps, rec) || siracusaMiracleBridge(parent, m, ps, rec, true),
    } : {}),
    keep: (m, ps, rec, plan) => parent.keep(m, ps, rec, plan) || deputy && early(m, ps) && rec.bonds.includes(DEPUT),
    afterPurchase(m, ps, slot, before) {
      parent.afterPurchase?.(m, ps, slot, before);
      if (!scope(m, ps) || slot.kind !== 'chess' || !(miracle ? base(ps, slot) === WIND : ps.gd.chess(slot.id).bonds.includes(DEPUT) && !ps.gd.chess(slot.id).bonds.includes(CORE))) return;
      if (deputy) ps._botCommunityDeputPaid = [...new Set([...(ps._botCommunityDeputPaid || []), base(ps, slot)])];
      record(ps, { factor, kind: 'purchase', round: m.round, id: slot.id, fundsAfter: ps.funds });
    },
  } : {};
  const recipe = Object.freeze({ ...parent, ...overrides,
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!scope(m, ps, factor === 'coop-two-vigil-growth' ? 2 : 4) || miracle) return;
      if (deputy) {
        if (m.round > 7 || kinds(ps, CORE).size >= 6 || kinds(ps, DEPUT).size < 2) return;
        const plans = deputyPlans(ps, h, snapshot); if (plans.length < 2) return;
        const risk = yield* probe(m, ps, h, [plans[0]], () => ({ index: 0 }), { input: siracusaContactInput });
        if (!risk || risk.stale || risk.job.outcomes.length !== 2 || risk.job.outcomes.some(r => !r.valid || r.leaks < 1)) return;
        const result = yield* probe(m, ps, h, plans, undefined, { input: siracusaContactInput }); if (!result) return;
        if (!result.stale && result.job.bestIndex) applyCoopRolePlan(ps, result.job.best);
        record(ps, { factor, kind: 'formation', round: m.round, index: result.job.bestIndex, stale: result.stale, outcomes: result.job.outcomes });
        return;
      }
      if (!ps.bonds[CORE]?.active || !field(ps).some(p => base(ps, p) === VIGIL)) return;
      const plans = siracusaVigilPlans(m, ps, h, snapshot); if (plans.length < 2) return;
      const stamp = () => JSON.stringify([m.round, ps.lp, ps.funds, ps.battleInput(), ps.hand, ps.temp]);
      const before = stamp();
      function* inputs(plan) { yield; return prepareInput(m, ps, plan.lineup, plan, siracusaGrowthInput(ps, plan)); }
      const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputs, {
        forecastReadinessOnly: true, forecastLayerGainsEnabled: true, forecastContext: () => ({}),
        observeForecast: observeVigilGrowth, selectForecast: selectVigilGrowth,
      });
      if (!job) return; while (!job.run(4)) yield;
      const stale = before !== stamp();
      if (!stale && job.bestIndex) applySiracusaContact(ps, job.best);
      record(ps, { factor, kind: 'formation', round: m.round, index: job.bestIndex, stale, outcomes: job.outcomes,
        plans: job.plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    },
  });
  variants.set(factor, recipe); return recipe;
}
