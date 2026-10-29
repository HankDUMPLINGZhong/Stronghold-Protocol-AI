// [ASSUMED] Independent, opt-in two-seat ordinary-round factors from the human84735 review.
// Default recipe, real battle seeds/results and teammate private holdings are never consulted here.
import { lateranoMergeOrder } from './lateranoMergeOrder.js';
import { levelUp } from '../botDevelopment.js';
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { pieceDir } from '../../../../../../../../../board.js';
import { reserveRaidPositions } from '../botRaidPositioning.js';
import { siracusaCoopSnapshot } from './siracusaCoopExperiments.js';
import { siracusaContactPlans, applySiracusaContact } from './siracusaCoopTactics.js';
import { probeContactRollback } from './siracusaContactRollback.js';

export const SIRACUSA_HUMAN_FACTORS = Object.freeze(['human-legal-upgrade', 'human-upgrade-order', 'human-raid-contact']);
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 2 && m.difficulty === 'ABYSS'
  && !!m.wave && m.round >= 3 && m.round <= 13 && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip';
const record = (ps, row) => (ps._botSiracusaHumanHistory ||= []).push(row);
const signature = p => [...p].map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).sort().join('|');

/** Hide only purchase-forbidden chess from the inherited upgrade gate, preserving every other readiness veto. */
export function legalUpgradeView(m, ps, parent) {
  const forbidden = ps.shop.slots.filter(s => s?.kind === 'chess' && !s.sold
    && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id)) === false);
  if (!forbidden.length) return { view: ps, forbidden };
  const view = Object.create(ps);
  view.shop = { ...ps.shop, slots: ps.shop.slots.map(s => forbidden.includes(s) ? null : s) };
  return { view, forbidden };
}

/** Current own counters/pairs only: no prediction of which identity the band will grant. */
export function siracusaGiftUpgrade(m, ps, parent) {
  if (!scope(m, ps) || m.round < 8 || ![2, 3, 4].includes(ps.shop.level)) return null;
  const level = ps.shop.level, target = parent.levelTarget(m, ps), fee = Math.max(0, ps.shop.upgradePrice);
  if (target <= level || ps.funds < fee + 2) return null;
  const band = ps.gd.band(ps.bandId), every = band.params.refresh_count, cap = band.params.max_count;
  const total = ps.counters['band:chiave:refreshes'] || 0, remaining = every - total % every;
  const given = ps.counters['band:chiave:r'] === m.round ? ps.counters['band:chiave'] || 0 : 0;
  if (remaining > 2 || given >= cap) return null;
  const counts = new Map();
  for (const p of ps.allChess()) if (!ps.gd.isGolden(p.id) && pieceBonds(ps.gd, p).includes('siracusaShip')) {
    const id = ps.gd.baseIdOf(p.id); counts.set(id, (counts.get(id) || 0) + 1);
  }
  const pairs = [...counts].filter(([, n]) => n >= 2).map(([id]) => id);
  return pairs.length ? { level, target: level + 1, fee, remaining, total, pairs } : null;
}

/** Joint quiet Raid homes + ordinary melee contact. Ranged anchors, owners and all existing tokens stay fixed. */
export function siracusaRaidContactPlans(m, ps, h) {
  const original = siracusaCoopSnapshot(ps, h);
  for (const [key, p] of ps.board) if (p.kind === 'token') { original.set(p.uid, key); original.dirs.set(p.uid, pieceDir(p)); }
  for (const p of original.lineup) original.dirs.set(p.uid, pieceDir(p));
  if (!ps.bonds.raidShip?.active) return [original];
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const raiders = original.lineup.filter(p => pieceBonds(ps.gd, p).includes('raidShip'));
  if (raiders.some(p => owners.has(p.uid))) return [original];
  const occupied = new Set([...ps.board].filter(([, p]) => !raiders.includes(p)).map(([key]) => key));
  const starts = reserveRaidPositions(ps.gd, original.lineup, { ps }, { model: h.fieldModel(m, ps), map: ps.deployMap(), occupied,
    recOf: p => h.rangeRec(ps, ps.gd.chess(p.id)) });
  if (!starts) return [original];
  const raid = new h.LayoutPlan(original); raid.lineup = original.lineup; raid.dirs = new Map(original.dirs);
  raid.reserved = new Set(starts.reserved);
  for (const [uid, home] of starts.starts) { raid.set(uid, home.key); raid.dirs.set(uid, 'RIGHT'); }
  const fixed = new Set([...ps.board.values()].filter(p => {
    const rec = p.kind === 'chess' ? ps.gd.chess(p.id) : null;
    return p.kind === 'token' || owners.has(p.uid) || starts.fixed.has(p.uid)
      || ps.gd.baseIdOf(p.id) === 'chess_char_4_10_a' || rec?.position !== 'MELEE' || !(rec.stats?.blockCnt > 0) || rec.attackKind === 'heal';
  }).map(p => p.uid));
  const contact = siracusaContactPlans(m, ps, h, () => raid, { fixedUids: fixed, radius: 1, limit: 3, endurance: true });
  const candidates = [original], seen = new Set([signature(original)]);
  for (const plan of [...contact.slice(1), raid]) {
    if ([...fixed].some(uid => !starts.fixed.has(uid) && (plan.get(uid) !== original.get(uid) || plan.dirs.get(uid) !== original.dirs.get(uid)))) continue;
    if (new Set(plan.values()).size !== plan.size || original.lineup.some(p => !ps._legal(p, ...plan.get(p.uid).split(',').map(Number)))) continue;
    const key = signature(plan); if (seen.has(key)) continue;
    seen.add(key); candidates.push(plan); if (candidates.length === 3) break;
  }
  // Existing tokens stay implicit in battleInput; never rewrite their stored facing or summon identity.
  return candidates.map(p => {
    const q = new h.LayoutPlan(); q.lineup = original.lineup; q.dirs = new Map(); q.reserved = new Set(p.reserved || []);
    for (const unit of q.lineup) { q.set(unit.uid, p.get(unit.uid)); q.dirs.set(unit.uid, p.dirs.get(unit.uid)); }
    return q;
  });
}

const cache = new WeakMap();
export function withSiracusaHumanTrial(parent, factor) {
  if (factor == null || factor === false) return parent;
  if (!SIRACUSA_HUMAN_FACTORS.includes(factor)) throw Error('Unknown Siracusa human-review factor');
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const overrides = factor === SIRACUSA_HUMAN_FACTORS[0] ? {
    beforeUpgrade(m, ps, plan) {
      if (!scope(m, ps)) return parent.beforeUpgrade(m, ps, plan);
      const { view, forbidden } = legalUpgradeView(m, ps, parent), allowed = parent.beforeUpgrade(m, view, plan);
      if (forbidden.length) record(ps, { factor, round: m.round, kind: 'upgrade-gate', funds: ps.funds, level: ps.shop.level,
        hidden: forbidden.map(s => s.id), allowed });
      return allowed;
    },
  } : factor === SIRACUSA_HUMAN_FACTORS[1] ? {
    levelTarget(m, ps, options) { return scope(m, ps) && ps._botSiracusaGiftTarget != null
      ? Math.min(parent.levelTarget(m, ps, options), ps._botSiracusaGiftTarget) : parent.levelTarget(m, ps, options); },
    upgradeMergeOrder(m, ps, { scoreReward }) {
      if (!scope(m, ps) || m.round < 8 || ![2, 3, 4].includes(ps.shop.level)) return parent.upgradeMergeOrder?.(m, ps, { scoreReward });
      return lateranoMergeOrder(m, ps, parent, scoreReward, { partialBundle: true });
    },
    *beforeRefreshSteps(m, ps, h) {
      if (parent.beforeRefreshSteps && (yield* parent.beforeRefreshSteps(m, ps, h))) return true;
      const intent = siracusaGiftUpgrade(m, ps, parent); if (!intent) return false;
      ps._botSiracusaGiftTarget = intent.target;
      try { levelUp(m, ps); } finally { delete ps._botSiracusaGiftTarget; }
      const changed = ps.shop.level !== intent.level;
      record(ps, { factor, round: m.round, kind: 'gift-order', ...intent, changed, fundsAfter: ps.funds });
      if (changed) { h.takeOffers(); yield; } return changed;
    },
  } : {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!scope(m, ps) || m.round < 5) return;
      const plans = siracusaRaidContactPlans(m, ps, h); if (plans.length < 2) return;
      const result = yield* probeContactRollback(m, ps, h, plans, { corrected: true });
      if (!result || result.stale) return;
      const index = result.job.bestIndex; if (index) applySiracusaContact(ps, plans[index]);
      record(ps, { factor, round: m.round, kind: 'joint-contact', index, outcomes: result.job.outcomes,
        plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
    },
  };
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(factor, recipe); return recipe;
}
