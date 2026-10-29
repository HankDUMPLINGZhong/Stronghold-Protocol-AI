// [ASSUMED] T2: owned regular medics remain eligible when an incantation-only board is in own LP danger.
// Candidate generation only. Existing safety/growth selection, purchasing and public opening-LP rules remain.
import { ownSurvivalOpeningLP } from './lateranoCoopOwnSurvival.js';

export const REGULAR_MEDIC_OPENING_LP_MAX = 10;
export const regularMedic = rec => rec?.profession === 'MEDIC' && rec.subProfessionId !== 'incantationmedic'
  && rec.attackKind === 'heal';
export function permitsRegularMedicOption(m, openingLP, records) {
  if (m.mode !== 'coop' || m.isSolo || !m.wave || m.round < 7 || m.round >= m.gd.bossRound
    || !Number.isFinite(openingLP) || openingLP <= 0 || openingLP > REGULAR_MEDIC_OPENING_LP_MAX) return false;
  return records.some(r => r.subProfessionId === 'incantationmedic')
    && !records.some(r => regularMedic(r) || r.subProfessionId === 'guardian');
}
const scopes = new WeakMap(), scanning = new WeakSet();
/** Offline control scan: enumerate both proposal sets, return the unmodified control, never run changed proposals. */
export function setCoopMedicOptionScan(ps, enabled) { if (enabled) scanning.add(ps); else scanning.delete(ps); }
export function regularMedicGap(m, ps, records) {
  const s = scopes.get(ps);
  return !!s && s.m === m && s.round === m.round && !s.paused
    && permitsRegularMedicOption(m, ownSurvivalOpeningLP(m, ps), records);
}
const signature = p => JSON.stringify({ lineup: p.lineup.map(u => u.uid),
  positions: [...p], dirs: [...p.dirs] });
export function auditCoopMedicPlans(m, ps, plans, control, chosen, bench, rec) {
  const s = scopes.get(ps); if (!s || s.paused) return plans;
  let before; s.paused = true;
  try { before = control(); } finally { s.paused = false; }
  const base = before.map(signature), next = plans.map(signature);
  (ps._botCoopMedicOptionHistory ||= []).push({ round: m.round, openingLP: ownSurvivalOpeningLP(m, ps),
    scan: s.scan, before: base, after: next, changed: JSON.stringify(base) !== JSON.stringify(next),
    board: chosen.map(u => ({ uid: u.uid, id: u.id })),
    medics: bench.filter(u => regularMedic(rec(u))).map(u => ({ uid: u.uid, id: u.id })),
    candidates: plans.map(p => ({ lineup: p.lineup.map(u => u.id), positions: [...p], dirs: [...p.dirs] })) });
  return s.scan ? before : plans;
}
export function withCoopMedicOption(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (m.mode !== 'coop' || m.isSolo || m.order.length !== 4 || !m.wave || m.round < 7 || m.round >= m.gd.bossRound) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return;
    }
    const previous = scopes.get(ps);
    scopes.set(ps, { m, round: m.round, scan: scanning.has(ps), paused: false });
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally { if (previous) scopes.set(ps, previous); else scopes.delete(ps); }
  } });
}
