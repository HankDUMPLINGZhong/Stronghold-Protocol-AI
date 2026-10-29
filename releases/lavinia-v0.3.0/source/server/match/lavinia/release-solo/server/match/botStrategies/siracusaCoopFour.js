// [ASSUMED] Independent four-seat trials over the literal selected contact policy.
// No acquisition/gear changes. Only the staged-three factor changes upgrade timing.
import { pieceBonds } from '../../../../../bondsMeta.js';
import { legalTiles, placeClass, canPlace, basePositionClass } from '../../../../../board.js';
import { rotateOffset } from '../../../../../../sim/dir.js';
import { extendedGrid } from '../../../../../../sim/targeting.js';
import { AROMA_ANCHORS } from './siracusaAromaFixed.js';
import { controlBonds } from './lateranoControlBoss.js';
import { selectStealthRepair } from './lateranoStealthWave.js';
import { allCoopForecastsFatal } from './lateranoCoopRescue.js';
import { siracusaContactPlans, siracusaContactInput, applySiracusaContact } from './siracusaCoopTactics.js';
import { coopRoleEntryPlan, applyCoopRolePlan } from './lateranoCoopRoles.js';
import { withLateranoCoopBossSelf, createCoopSelfBossForecast } from './lateranoCoopBossSelf.js';

export const SIRACUSA_FOUR_FACTORS = Object.freeze(['coop-staged-three', 'coop-fatal-contact', 'coop-held-boss-roster', 'coop-staged-three-mature', 'coop-staged-three-opening', 'coop-four-r7-core-pair']);
const CORE = 'siracusaShip', AROMA = 'chess_char_4_10_a';
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const bondsOf = (ps, p) => pieceBonds(ps.gd, p);
export const siracusaNativeEliteKinds = ps => new Set(ps.allChess().filter(p => ps.gd.isGolden(p.id)
  && bondsOf(ps, p).includes(CORE)).map(p => ps.gd.baseIdOf(p.id)));
export const siracusaFourScope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 4
  && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
const record = (ps, row) => (ps._botSiracusaCoopHistory ||= []).push(row);
const signature = p => [...p].map(([uid, key]) => [uid, key, p.dirs.get(uid)]).sort((a, b) => a[0] - b[0]).join('|');
const owners = ps => new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));

export function siracusaFatalPins(m, ps) {
  const chosen = field(ps), summoned = owners(ps), anchor = AROMA_ANCHORS[m.stageId];
  const aromas = chosen.filter(p => ps.gd.baseIdOf(p.id) === AROMA).sort((a, b) =>
    Number(ps.gd.isGolden(b.id)) - Number(ps.gd.isGolden(a.id)) || a.uid - b.uid);
  const main = aromas.find(p => anchor && ps.find(p.uid).key === anchor.r + ',' + anchor.c) || aromas[0];
  return new Set(chosen.filter(p => p === main || summoned.has(p.uid) || bondsOf(ps, p).includes('raidShip')).map(p => p.uid));
}

/** Quiet RIGHT homes for new raiders; existing raiders/owners and all real tokens remain untouched. */
function quietEntry(m, ps, h, plan, incoming) {
  if (!bondsOf(ps, incoming).includes('raidShip') || !controlBonds(ps, plan.lineup).raidShip?.active) return true;
  const model = h.fieldModel(m, ps), targets = model.bossBodies?.length ? model.bossBodies
    : model.routes.filter(r => !r.fly).flatMap(r => r.tiles.map(key => ({ center: key.split(',').map(Number), tiles: [key] })));
  const contact = new Set([...model.routes.flatMap(r => r.tiles.slice(0, 3)), ...(model.bossBodies || []).flatMap(b => b.tiles)]);
  const used = new Set([...plan].filter(([uid]) => uid !== incoming.uid).map(([, key]) => key));
  for (const [key, p] of ps.board) if (p.kind === 'token') used.add(key);
  const rec = h.rangeRec(ps, ps.gd.chess(incoming.id)), map = ps.deployMap();
  const cells = [...legalTiles(map, placeClass(ps, rec))].filter(([r, c]) => !used.has(r + ',' + c));
  const grid = [...extendedGrid(rec.rangeGrid || [[0, 0]], rec.skill?.bb?.ability_range_forward_extend || 0),
    ...(rec.skill?.rangeGrid || []), ...(rec.skill?.trigger?.customRangeGrid || [])];
  const cover = (r, c, g) => g.map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, 'RIGHT'); return (r + a) + ',' + (c + b); });
  const homes = cells.filter(([r, c]) => !cover(r, c, grid).some(key => contact.has(key)));
  for (const [r, c] of homes) for (const [lr, lc] of cells) {
    if (r === lr && c === lc || !canPlace(map, basePositionClass(rec), lr, lc)) continue;
    if (!targets.some(t => Math.max(Math.abs(lr - t.center[0]), Math.abs(lc - t.center[1])) <= 2
      && cover(lr, lc, rec.rangeGrid || [[0, 0]]).some(key => t.tiles.includes(key)))) continue;
    plan.set(incoming.uid, r + ',' + c); plan.dirs.set(incoming.uid, 'RIGHT');
    plan.reserved = new Set([lr + ',' + lc]); return true;
  }
  return false;
}

/** One held replacement per candidate; six distinct natives, equipment and summon owners cannot be sacrificed. */
export function siracusaHeldBossPlans(m, ps, h, snapshot) {
  const original = snapshot(ps, h), chosen = original.lineup, before = controlBonds(ps, chosen), pinned = owners(ps);
  for (const p of chosen) if (bondsOf(ps, p).includes('raidShip')) pinned.add(p.uid);
  const raidRoute = ps._botRoute?.supports?.includes('raidShip') || ps._botRoute?.id === 'arcane-raid';
  const relevant = p => bondsOf(ps, p).some(b => [CORE, 'arcaneShip', 'raidShip', 'swiftShip'].includes(b));
  const quality = p => {
    const r = h.rangeRec(ps, ps.gd.chess(p.id)), s = r.stats || {}, rate = (s.aspd || 100) / 100 / Math.max(.3, s.bat || 1.5);
    const magic = ['arts', 'true'].includes(r.dmgType);
    return ps.gd.chess(p.id).tier * 3 + Number(ps.gd.isGolden(p.id)) * 15 + Math.sqrt(Math.max(0, (s.atk || 0) * rate))
      + Number(magic) * (raidRoute ? 12 : 5);
  };
  const proposals = [];
  for (const a of ps.allChess().filter(p => !chosen.includes(p) && relevant(p))) for (const d of chosen) {
    if (pinned.has(d.uid) || d.items?.length) continue;
    const lineup = chosen.map(p => p === d ? a : p), after = controlBonds(ps, lineup);
    if ((after[CORE]?.count || 0) < Math.max(6, before[CORE]?.count || 0)) continue;
    const activations = ['arcaneShip', 'raidShip', 'swiftShip'].reduce((n, id) => n
      + Number(after[id]?.active && !before[id]?.active) * (10 + Math.min(60, ps.layers[id] || 0)), 0);
    // Offer route activations and stronger/elite copies; layer units are used only to shortlist, never to choose the winner.
    const gain = quality(a) - quality(d) + activations + (raidRoute && after.arcaneShip?.active && after.raidShip?.active ? 20 : 0);
    if (gain <= 0) continue;
    const plan = coopRoleEntryPlan(ps, h, original, lineup); if (!plan) continue;
    if (chosen.some(p => pinned.has(p.uid) && (plan.get(p.uid) !== original.get(p.uid) || plan.dirs.get(p.uid) !== original.dirs.get(p.uid)))) continue;
    if (!quietEntry(m, ps, h, plan, a)) continue;
    plan.entry = { incoming: a.uid, outgoing: d.uid, incomingId: a.id, outgoingId: d.id, gain,
      bonds: Object.fromEntries([CORE, 'swiftShip', 'arcaneShip', 'raidShip'].map(id => [id, after[id]?.count || 0])) };
    proposals.push(plan);
  }
  proposals.sort((a, b) => b.entry.gain - a.entry.gain || a.entry.incoming - b.entry.incoming || a.entry.outgoing - b.entry.outgoing);
  const plans = [original], seen = new Set();
  for (const plan of proposals) if (!seen.has(plan.entry.incoming) && plans.length < 4) { plans.push(plan); seen.add(plan.entry.incoming); }
  return plans;
}

const cache = new WeakMap();
export function withSiracusaFourFactor(parent, factor, { snapshot, probe, prepareInput }) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(factor)) return variants.get(factor);
  const matureGate = factor === 'coop-staged-three-mature';
  const openingGate = factor === 'coop-staged-three-opening';
  const stagingRound = (m, ps) => siracusaFourScope(m, ps) && !!m.wave && m.round === 7;
  // Opening eligibility is latched by prepStart, never lazily at an upgrade decision after a merge.
  const qualified = ps => openingGate ? ps._botSiracusaR7Opening?.eligible === true
    : !matureGate || siracusaNativeEliteKinds(ps).size >= 2;
  const denied = (m, ps) => (matureGate || openingGate) && stagingRound(m, ps) && ps.shop.level === 2 && !qualified(ps);
  const staged = (m, ps) => stagingRound(m, ps) && ps.allChess().length >= 6
    && qualified(ps);
  const boss = withLateranoCoopBossSelf({ *finalBoardSteps(m, ps, h) {
    const plans = siracusaHeldBossPlans(m, ps, h, snapshot); if (plans.length < 2) return;
    const job = yield* createCoopSelfBossForecast(m, ps, plans, 10); if (!job) return;
    while (!job.run(4)) yield;
    if (!job.stale && job.bestIndex) applyCoopRolePlan(ps, job.best);
    record(ps, { factor, round: m.round, index: job.bestIndex, stale: job.stale, outcomes: job.outcomes,
      entries: plans.slice(1).map(p => p.entry), plans: plans.map(p => [...p]) });
  } });
  const recipe = Object.freeze({ ...parent, ...(openingGate ? {
    prepStart(m, ps) {
      if (stagingRound(m, ps) && !ps._botSiracusaR7Opening) {
        const eliteKinds = [...siracusaNativeEliteKinds(ps)], eligible = eliteKinds.length >= 2;
        ps._botSiracusaR7Opening = { round: m.round, eliteKinds, eligible };
        record(ps, { factor, kind: 'opening-eligibility', ...ps._botSiracusaR7Opening });
      }
      parent.prepStart?.(m, ps);
    },
  } : {}), ...(factor === 'coop-staged-three' || matureGate || openingGate ? {
    levelTarget(m, ps, options) { return denied(m, ps) ? 2 : staged(m, ps) && ps.shop.level <= 3 ? 3 : parent.levelTarget(m, ps, options); },
    priorityLevel(m, ps) { return denied(m, ps) ? false : staged(m, ps) && ps.shop.level === 2 ? true : parent.priorityLevel(m, ps); },
    spendReserve(m, ps) { return denied(m, ps) ? 0 : staged(m, ps) && ps.shop.level <= 3
      ? ps.shop.level === 2 && ps.funds >= ps.shop.upgradePrice ? Math.max(0, ps.shop.upgradePrice) : 0 : parent.spendReserve(m, ps); },
    beforeUpgrade(m, ps, plan) { return denied(m, ps) || staged(m, ps) && ps.shop.level === 3 ? false : parent.beforeUpgrade(m, ps, plan); },
  } : {
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!siracusaFourScope(m, ps)) return;
      if (factor === 'coop-held-boss-roster') {
        if (m.wave || m.round !== m.gd.bossRound) return;
        const oldModel = ps._botCoopOwnBossModel, oldInput = ps._botCoopBossPrepInput;
        ps._botCoopOwnBossModel = 'template';
        ps._botCoopBossPrepInput = (mm, pp, plan, input) => prepareInput(mm, pp, plan.lineup, plan, input);
        try { yield* boss.finalBoardSteps(m, ps, h); }
        finally {
          if (oldModel === undefined) delete ps._botCoopOwnBossModel; else ps._botCoopOwnBossModel = oldModel;
          if (oldInput === undefined) delete ps._botCoopBossPrepInput; else ps._botCoopBossPrepInput = oldInput;
        }
        return;
      }
      if (!m.wave || m.round < 1 || m.round > 13 || (ps.bonds[CORE]?.count || 0) < 6) return;
      const risk = yield* probe(m, ps, h, [snapshot(ps, h)], () => ({ index: 0 }), { input: siracusaContactInput });
      if (!risk || risk.stale || !allCoopForecastsFatal(risk.job.outcomes, ps.lp)) return;
      const options = { fixedUids: siracusaFatalPins(m, ps), radius: 3, limit: 4 };
      const sets = [siracusaContactPlans(m, ps, h, snapshot, { ...options, endurance: true }),
        siracusaContactPlans(m, ps, h, snapshot, options)];
      const plans = [], seen = new Set();
      for (const p of sets.flat()) if (!seen.has(signature(p)) && plans.length < 5) { plans.push(p); seen.add(signature(p)); }
      if (plans.length < 2) return;
      const result = yield* probe(m, ps, h, plans, selectStealthRepair, { input: siracusaContactInput }); if (!result) return;
      if (!result.stale && result.job.bestIndex) applySiracusaContact(ps, result.job.best);
      record(ps, { factor, round: m.round, index: result.job.bestIndex, stale: result.stale, risk: risk.job.outcomes,
        outcomes: result.job.outcomes, plans: plans.map(p => [...p]) });
    },
  }) });
  variants.set(factor, recipe); return recipe;
}
