// [ASSUMED] Three independent two-seat follow-ups from the human84735 comparison, over retained11/56.
// Current own offers/assets/shop only. Defaults, R1, actual combat seeds and teammate private assets stay untouched.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { siracusaCoopSnapshot } from './siracusaCoopExperiments.js';
import { coopRoleEntryPlan, applyCoopRolePlan } from './lateranoCoopRoles.js';
import { probeContactRollback } from './siracusaContactRollback.js';

export const SIRACUSA_HUMAN_FOLLOWUPS = Object.freeze(['human-first-vigil', 'human-stead-package', 'human-three-before-four']);
const CORE = 'siracusaShip', STEAD = 'steadShip', VIGIL = 'chess_char_3_19_a', HONEY = 'chess_char_3_18_a';
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 2 && m.difficulty === 'ABYSS'
  && !!m.wave && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const kinds = (ps, bond, pieces = ps.allChess()) => new Set(pieces.filter(p => pieceBonds(ps.gd, p).includes(bond)).map(p => base(ps, p)));
const log = (ps, factor, row) => (ps._botSiracusaFollowupHistory ||= []).push({ factor, ...row });
const foreignStead = rec => rec.bonds.includes(STEAD) && !rec.bonds.includes(CORE);
const early = (m, ps) => scope(m, ps) && m.round >= 3 && m.round <= 7 && ps.shop.level < 4;

export function firstVigilOffer(m, ps) {
  const offer = ps.offers?.[0];
  if (!scope(m, ps) || m.round < 3 || m.round > 9 || offer?.tier !== 3
    || ps.allChess().some(p => base(ps, p) === VIGIL)) return false;
  const slots = offer.slots.filter(s => s && !s.sold);
  return slots.some(s => s.kind === 'chess' && s.price === 0 && base(ps, s) === VIGIL)
    && !slots.some(s => s.kind === 'chess' && base(ps, s) !== VIGIL && ps.gd.chess(s.id).bonds.includes(CORE));
}

/** Protect all inherited current spending reserves and an executable upgrade; never sell to fund a package. */
export function steadPackagePlan(parent, m, ps) {
  if (!early(m, ps) || kinds(ps, CORE).size >= 4 || ps.gd.modeInactiveBonds.has(STEAD)) return null;
  const held = kinds(ps, STEAD), paid = new Set(ps._botSiracusaPackagePaid || []);
  if (held.size >= 3 || paid.size >= 3) return null;
  const slots = ps.shop.slots.map((s, index) => ({ s, index })).filter(({ s }) => s?.kind === 'chess' && !s.sold);
  if (slots.some(({ s }) => ps.priceOf(s) <= ps.funds && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id))
    && (ps.gd.chess(s.id).bonds.includes(CORE) || parent.importantBuy?.(m, ps, ps.gd.chess(s.id))
      || parent.criticalBuy?.(m, ps, ps.gd.chess(s.id), { route: ps._botRoute })))) return null;
  const target = parent.levelTarget(m, ps), fee = Math.max(0, ps.shop.upgradePrice), extra = Math.max(0, parent.upgradeReserve(m, ps));
  const ready = ps.allChess().length >= (m.round <= 4 ? ps.deployCap : Math.min(ps.deployCap, 6)) || parent.readyForUpgrade?.(m, ps) === true;
  const executable = ps.shop.level < target && ps.funds >= fee + extra && (ready || m.round >= 6)
    && parent.beforeUpgrade(m, ps, { route: ps._botRoute });
  const reserve = Math.max(0, parent.spendReserve(m, ps) || 0, parent.purchaseReserve?.(m, ps) || 0, executable ? fee + extra : 0);
  const candidates = slots.filter(({ s }) => {
    const rec = ps.gd.chess(s.id), id = base(ps, s);
    return foreignStead(rec) && rec.tier <= 3 && !held.has(id) && !paid.has(id);
  }).sort((a, b) => ps.priceOf(a.s) - ps.priceOf(b.s) || a.index - b.index);
  const bundles = [];
  for (let i = 0; i < candidates.length; i++) {
    if (held.size) bundles.push([candidates[i]]);
    else for (let j = i + 1; j < candidates.length; j++) if (base(ps, candidates[i].s) !== base(ps, candidates[j].s)) bundles.push([candidates[i], candidates[j]]);
  }
  const free = ps.hand.filter(p => !p).length;
  for (const entries of bundles.sort((a, b) => a.reduce((n, x) => n + ps.priceOf(x.s), 0) - b.reduce((n, x) => n + ps.priceOf(x.s), 0)
    || a[0].index - b[0].index)) {
    const price = entries.reduce((n, x) => n + ps.priceOf(x.s), 0);
    if (entries.length > free || paid.size + entries.length > 3 || ps.funds - price < reserve) continue;
    return { entries, price, reserve, held: [...held], nativeKinds: kinds(ps, CORE).size };
  }
  return null;
}

/** Same-prep two-to-three-to-four only. A prep already starting at tier3 keeps its original upgrade rules. */
export function holdsNewTierThree(m, ps) {
  const start = ps._botSiracusaFollowupOpening;
  return scope(m, ps) && m.round >= 3 && m.round <= 13 && start?.round === m.round && start.level === 2 && ps.shop.level === 3
    && !ps.allChess().some(p => [VIGIL, HONEY].includes(base(ps, p)) && ps.gd.isGolden(p.id));
}

const heal = rec => rec.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(rec.subProfessionId);
const value = (ps, p) => ps.gd.chess(p.id).tier + Number(ps.gd.isGolden(p.id)) * 4;
const combinations = (xs, n) => n === 0 ? [[]] : xs.flatMap((x, i) => combinations(xs.slice(i + 1), n - 1).map(t => [x, ...t]));

/** At most two alternatives per 2/3-Stead threshold. Existing cores, item holders, Raid/Aroma and token owners pin. */
export function steadPackageRosterPlans(m, ps, h) {
  const original = siracusaCoopSnapshot(ps, h), chosen = original.lineup, held = kinds(ps, STEAD);
  if (!early(m, ps) || held.size < 2) return [original];
  const groups = [...held].map(id => ps.allChess().filter(p => base(ps, p) === id)
    .sort((a, b) => value(ps, b) - value(ps, a) || Number(chosen.includes(b)) - Number(chosen.includes(a)) || a.uid - b.uid)[0]);
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const pinned = p => owners.has(p.uid) || p.items?.length || pieceBonds(ps.gd, p).some(id => [CORE, 'raidShip'].includes(id));
  const proposals = [], before = kinds(ps, STEAD, chosen).size;
  for (const count of [2, 3]) {
    if (before >= count || groups.length < count) continue;
    let offered = 0;
    for (const goal of combinations(groups, count).sort((a, b) => b.reduce((s, p) => s + value(ps, p), 0) - a.reduce((s, p) => s + value(ps, p), 0))) {
      const missing = goal.filter(p => !chosen.includes(p)), freeN = Math.min(missing.length, Math.max(0, ps.deployCap - chosen.length));
      const removals = chosen.filter(p => !goal.includes(p) && !pinned(p)).sort((a, b) => value(ps, a) - value(ps, b) || a.uid - b.uid).slice(0, missing.length - freeN);
      if (removals.length + freeN !== missing.length) continue;
      const lineup = [...chosen.filter(p => !removals.includes(p)), ...missing];
      if (chosen.some(p => heal(ps.gd.chess(p.id))) && !lineup.some(p => heal(ps.gd.chess(p.id)))) continue;
      if (['swiftShip', 'arcaneShip', 'raidShip'].some(id => ps.bonds[id]?.active && kinds(ps, id, lineup).size < ps.gd.bond(id).activeCount)) continue;
      const staged = new h.LayoutPlan(original); staged.lineup = [...chosen]; staged.dirs = new Map(original.dirs);
      const freeAdds = [], occupied = new Set(ps.board.keys());
      for (const p of missing.slice(0, freeN)) {
        const fronts = chosen.filter(q => ps.gd.chess(q.id).position === 'MELEE').map(q => original.get(q.uid).split(',').map(Number));
        const distance = key => { const [r, c] = key.split(',').map(Number); return fronts.length ? Math.min(...fronts.map(([a, b]) => Math.abs(r - a) + Math.abs(c - b))) : 0; };
        const key = [...ps.deployMap().keys()].filter(k => !occupied.has(k) && ps._legal(p, ...k.split(',').map(Number)))
          .sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))[0];
        if (!key) break;
        occupied.add(key); staged.lineup.push(p); staged.set(p.uid, key); staged.dirs.set(p.uid, 'RIGHT'); freeAdds.push(p.uid);
      }
      if (freeAdds.length !== freeN) continue;
      const plan = coopRoleEntryPlan(ps, h, staged, lineup);
      if (!plan || chosen.some(p => pinned(p) && (plan.get(p.uid) !== original.get(p.uid) || plan.dirs.get(p.uid) !== original.dirs.get(p.uid)))) continue;
      plan.freeAdds = freeAdds; proposals.push(plan); if (++offered === 2) break;
    }
  }
  return [original, ...proposals];
}

const cache = new WeakMap();
export function applySteadPackagePlan(ps, plan) {
  for (const uid of plan.freeAdds) { const [row, col] = plan.get(uid).split(',').map(Number);
    if (!ps.move(uid, { area: 'board', row, col }, plan.dirs.get(uid))?.ok) throw Error('Stead free entry failed'); }
  applyCoopRolePlan(ps, plan);
}

export function withSiracusaHumanFollowup(parent, factor) {
  if (factor == null || factor === false) return parent;
  if (!SIRACUSA_HUMAN_FOLLOWUPS.includes(factor)) throw Error('Unknown Siracusa human follow-up');
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const overrides = factor === SIRACUSA_HUMAN_FOLLOWUPS[0] ? {
    rewardPriority(m, ps, slot) {
      const prior = parent.rewardPriority?.(m, ps, slot) || 0;
      if (!firstVigilOffer(m, ps) || slot.kind !== 'chess' || base(ps, slot) !== VIGIL) return prior;
      const key = `${m.round}:${ps.offers[0].slots.map(s => s?.id).join(',')}`;
      if (ps._botSiracusaVigilOfferKey !== key) { ps._botSiracusaVigilOfferKey = key; log(ps, factor, { kind: 'reward-priority', round: m.round, slots: ps.offers[0].slots.map(s => s.id) }); }
      return prior + 10000;
    },
  } : factor === SIRACUSA_HUMAN_FOLLOWUPS[2] ? {
    prepStart(m, ps) { if (scope(m, ps)) ps._botSiracusaFollowupOpening = { round: m.round, level: ps.shop.level }; parent.prepStart?.(m, ps); },
    levelTarget(m, ps, options) {
      const target = parent.levelTarget(m, ps, options);
      if (!holdsNewTierThree(m, ps)) return target;
      if (target > 3 && ps._botSiracusaThreeHoldLogged !== m.round) {
        ps._botSiracusaThreeHoldLogged = m.round; log(ps, factor, { kind: 'hold-tier3', round: m.round, funds: ps.funds, target });
      }
      return Math.min(3, target);
    },
    priorityLevel: (m, ps) => holdsNewTierThree(m, ps) ? false : parent.priorityLevel(m, ps),
    spendReserve: (m, ps) => holdsNewTierThree(m, ps) ? 0 : parent.spendReserve(m, ps),
    beforeUpgrade(m, ps, ctx) {
      if (!holdsNewTierThree(m, ps)) return parent.beforeUpgrade(m, ps, ctx);
      log(ps, factor, { kind: 'hold-tier3', round: m.round, funds: ps.funds }); return false;
    },
  } : {
    purchaseAllowed: (m, ps, rec) => parent.purchaseAllowed(m, ps, rec) || !!steadPackagePlan(parent, m, ps)?.entries.some(x => x.s.id === rec.chessId),
    keep: (m, ps, rec, ctx) => parent.keep(m, ps, rec, ctx) || early(m, ps) && foreignStead(rec),
    trade(m, ps, ctx, helpers) {
      if (parent.trade(m, ps, ctx, helpers)) return true;
      const plan = steadPackagePlan(parent, m, ps); if (!plan) return false;
      const ids = [];
      for (const { s, index } of plan.entries) {
        if (ps.shop.slots[index] !== s || s.sold) throw Error('Stead package shop changed before purchase');
        const before = new Set(ps.allChess().map(p => p.uid)), result = ps.buy(index);
        if (!result?.ok) throw Error('Prevalidated Stead package purchase failed');
        ids.push(s.id); ps._botSiracusaPackagePaid = [...new Set([...(ps._botSiracusaPackagePaid || []), base(ps, s)])];
        parent.afterPurchase?.(m, ps, s, before);
      }
      log(ps, factor, { kind: 'package-buy', round: m.round, ids, price: plan.price, reserve: plan.reserve, fundsAfter: ps.funds }); return true;
    },
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      const plans = steadPackageRosterPlans(m, ps, h); if (plans.length < 2) return;
      const result = yield* probeContactRollback(m, ps, h, plans, { corrected: true }); if (!result || result.stale) return;
      const index = result.job.bestIndex;
      if (index) applySteadPackagePlan(ps, plans[index]);
      log(ps, factor, { kind: 'stead-roster', round: m.round, index, outcomes: result.job.outcomes,
        plans: plans.map(p => ({ lineup: p.lineup.map(q => q.id), positions: [...p] })) });
    },
  };
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
