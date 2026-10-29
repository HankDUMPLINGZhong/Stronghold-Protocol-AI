// [ASSUMED] Bounded previous-round geometry alternatives, never historical battle results.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { siracusaCoopProbe } from './siracusaCoopExperiments.js';
import { siracusaContactInput } from './siracusaCoopTactics.js';
import { selectStealthRepair } from './lateranoStealthWave.js';
import { probeCorrectedContact } from './siracusaContactInputs.js';

export const SIRACUSA_CONTACT_ROLLBACK = 'contact-fire-rollback';
const signature = p => [...p].sort((a, b) => a[0] - b[0])
  .map(([uid, key]) => `${uid}:${key}:${p.dirs.get(uid)}`).join('|');

/** Return a still-owned chess to its former square, exchanging the current occupant atomically.
 * Keep at most two chess changed, actual tokens and Aroma/Raid/summon-owner pins unchanged.
 * A newly acquired occupant need not have existed last round. No withdrawn/merged piece is recreated.
 */
export function contactRollbackPlans(m, ps, h, original, previous, limit = 6) {
  if (!previous || previous.round !== m.round - 1 || previous.stageId !== m.stageId) return [];
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp]
    .filter(p => p?.kind === 'token').map(p => p.ownerUid));
  const pieces = new Map(original.lineup.map(p => [p.uid, p]));
  const fixed = new Set(original.lineup.filter(p => owners.has(p.uid)
    || ps.gd.baseIdOf(p.id) === 'chess_char_4_10_a' || pieceBonds(ps.gd, p).includes('raidShip')).map(p => p.uid));
  const seen = new Set([signature(original)]), plans = [];
  for (const old of previous.entries) {
    const p = pieces.get(old.uid);
    if (!p || fixed.has(p.uid) || ps.gd.baseIdOf(p.id) !== old.base) continue;
    if (!ps._legal(p, ...old.key.split(',').map(Number))) continue;
    const other = [...original].find(([uid, key]) => uid !== p.uid && key === old.key);
    if (other && (!pieces.has(other[0]) || fixed.has(other[0])
      || !ps._legal(pieces.get(other[0]), ...original.get(p.uid).split(',').map(Number)))) continue;
    const q = new h.LayoutPlan(original); q.lineup = original.lineup;
    q.dirs = new Map(original.dirs); q.reserved = new Set(original.reserved || []);
    if (other) q.set(other[0], original.get(p.uid));
    q.set(p.uid, old.key); q.dirs.set(p.uid, old.dir);
    const key = signature(q);
    if (!seen.has(key)) { seen.add(key); q.rollback = { anchor: p.uid, exchanged: other?.[0] ?? null }; plans.push(q); }
    if (plans.length >= limit) break;
  }
  return plans;
}

export function rememberContactLayout(m, ps, original) {
  return { round: m.round, stageId: m.stageId, entries: original.lineup.map(p => ({
    uid: p.uid, base: ps.gd.baseIdOf(p.id), key: original.get(p.uid), dir: original.dirs.get(p.uid),
  })) };
}

/** The existing forecast accepts only three plans. Evaluate every extra candidate in bounded
 * batches against the untouched incumbent, then run the unchanged selector on complete samples.
 * Never apply an intermediate winner or read actual wave outcomes. Deadline cancellation still
 * unwinds the generator before any extra real moves are made.
 */
export function* probeContactRollback(m, ps, h, plans, { corrected = false, context, observe, select = selectStealthRepair } = {}) {
  const outcomes = [];
  for (let start = 1; start < plans.length; start += 2) {
    const batch = [plans[0], ...plans.slice(start, start + 2)];
    const result = corrected ? yield* probeCorrectedContact(m, ps, h, batch, { context, observe })
      : yield* siracusaCoopProbe(m, ps, h, batch, selectStealthRepair, { input: siracusaContactInput });
    if (!result || result.stale) return null;
    for (const row of result.job.outcomes) if (row.index || start === 1)
      outcomes.push({ ...row, index: row.index ? start + row.index - 1 : 0 });
  }
  const decision = select(plans, outcomes, context);
  return { stale: false, job: { bestIndex: decision.index, outcomes, decision } };
}
