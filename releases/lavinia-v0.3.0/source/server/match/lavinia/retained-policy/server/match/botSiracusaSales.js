// Optional AI sale policy. Human PlayerState.sell and the actual economy rules remain untouched.
import { pieceBonds } from '../../../../bondsMeta.js';
const CORE = 'siracusaShip';
export const siracusaSaleScope = (m, ps) => m.mode === 'solo' && m.isSolo && m.difficulty === 'ABYSS'
  && m.opts?.botSiracusaSoloExperiment === 'solo-sale-protection' && ps.bandId === 'band_chiave' && ps._botFocusId === CORE
  || m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_chiave'
  && ps._botFocusId === CORE && ['coop-early-sale-protection', 'coop-large-body-coverage', 'coop-lucien-right', 'coop-equipment', 'coop-stealth-contact', 'coop-pre-six-roles', 'coop-gun-contact', 'coop-staged-three', 'coop-fatal-contact', 'coop-held-boss-roster', 'coop-staged-three-mature', 'coop-staged-three-opening', 'coop-opening-fire-directions', 'coop-opening-lucien-right', 'coop-opening-first-aroma-cash', 'coop-first-aroma-cash', 'coop-two-r7-opening', 'coop-two-three-window', 'coop-two-fatal-facing', 'coop-two-r7-core-pair', 'coop-four-r7-core-pair'].includes(m.opts?.botSiracusaCoopExperiment);
export function botSaleAllowed(m, ps, p) {
  if (!siracusaSaleScope(m, ps) || p?.kind !== 'chess') return true;
  const gd = ps.gd || m.gd, own = ps.allChess(), native = xs => new Set(xs.filter(q => pieceBonds(gd, q).includes(CORE)).map(q => gd.baseIdOf(q.id))).size;
  const state = ps._botSiracusaSaleGuard ||= { formed: false, observed: new Set() };
  if (native(own) >= 6 || (ps.bonds[CORE]?.count || 0) >= 6) state.formed = true;
  let reason = null;
  if (gd.chess(p.id)?.tier >= 6 && (p.boughtRound === m.round || ps._botSeenUids && !ps._botSeenUids.has(p.uid))) reason = 'new-tier-six';
  if (pieceBonds(gd, p).includes(CORE) && state.formed && native(own.filter(q => q.uid !== p.uid)) < 6) reason = 'six-native';
  if (!reason) return true;
  const key = `${m.round}:${p.uid}:${reason}`;
  if (!state.observed.has(key)) {
    state.observed.add(key);
    (m.isSolo ? ps._botSiracusaSoloHistory ||= [] : ps._botSiracusaCoopHistory ||= []).push({ factor: m.isSolo ? 'solo-sale-protection' : 'coop-early-sale-protection', round: m.round,
      kind: 'protected-sale-candidate', reason, uid: p.uid, id: p.id, nativeBefore: native(own) });
  }
  return false;
}
export function botSell(m, ps, uid) {
  return botSaleAllowed(m, ps, ps.find(uid)?.piece) ? ps.sell(uid) : { ok: false, error: 'BOT_SALE_PROTECTED' };
}
/** Threshold/new-tier-six protection outranks surplus layer copies when storage is full. */
export function freeSiracusaProtectedSlot(m, ps, piece) {
  if (!siracusaSaleScope(m, ps) || !piece || botSaleAllowed(m, ps, piece) || ps.hand.some(p => !p)) return false;
  const gd = ps.gd || m.gd;
  const candidates = ps.hand.filter(p => p?.kind === 'chess' && p.uid !== piece.uid && !p.items?.length && botSaleAllowed(m, ps, p));
  candidates.sort((a, b) => Number(pieceBonds(gd, a).includes(CORE)) - Number(pieceBonds(gd, b).includes(CORE))
    || gd.chess(a.id).tier - gd.chess(b.id).tier || Number(gd.isGolden(a.id)) - Number(gd.isGolden(b.id)) || a.uid - b.uid);
  const sold = candidates[0]; if (!sold || !botSell(m, ps, sold.uid).ok) return false;
  (m.isSolo ? ps._botSiracusaSoloHistory ||= [] : ps._botSiracusaCoopHistory ||= []).push({ factor: m.isSolo ? 'solo-sale-protection' : 'coop-early-sale-protection', round: m.round, kind: 'protected-room', kept: piece.id, sold: sold.id });
  return true;
}
