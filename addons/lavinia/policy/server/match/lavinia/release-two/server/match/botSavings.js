// [ASSUMED] Expiring funds can buy real assets rather than only blind refreshes. Optional per-recipe policy.
// No balance changes: currency is held in the hand; parking operators are bought/sold through PlayerState.
const gdOf = (m, ps) => ps.gd || m.gd;
import { botSell } from './botSiracusaSales.js';
export const savingsCash = (rec) => rec?.buffs?.some((b) => b.key === 'equip_destory_gain_random_coin');
const stateOf = (ps) => ps._botSavings ||= { releasedAt: -1, parked: [] };
const statsOf = (ps) => ps._botRecipeStats ||= {};

export function releaseSavings(m, ps, { current = false, target = Infinity } = {}) {
  const gd = gdOf(m, ps), state = stateOf(ps);
  if (state.releasedAt !== m.round) {
    state.releasedAt = m.round;
    for (const saved of state.parked.filter((p) => p.round < m.round)) {
      const piece = ps.find(saved.uid)?.piece;
      if (piece?.kind === 'chess' && piece.id === saved.id && !piece.items?.length && botSell(m, ps, piece.uid)?.ok) {
        const stats = statsOf(ps); stats.soldSavings = (stats.soldSavings || 0) + 1;
      }
    }
    state.parked = state.parked.filter((p) => p.round >= m.round && ps.find(p.uid));
    state.cashReady = [...ps.hand, ...ps.temp].filter((p) => p?.kind === 'item' && savingsCash(gd.item(p.id))).map((p) => p.uid);
  }
  for (const it of [...ps.hand, ...ps.temp]) {
    if (ps.funds >= target) break;
    if (it?.kind !== 'item' || !savingsCash(gd.item(it.id)) || !ps.find(it.uid)) continue;
    if (m.round < gd.bossRound && !state.cashReady?.includes(it.uid)
      && !(current && gd.item(it.id)?.params?.min === gd.item(it.id)?.params?.max)) continue;
    const carrier = ps.allChess().find((p) => (p.items?.length || 0) < gd.equipPerChess);
    if (!carrier) continue;
    const before = ps.funds;
    if (ps.equip(it.uid, carrier.uid)?.ok) {
      const stats = statsOf(ps); stats.redeemedCash = (stats.redeemedCash || 0) + Math.max(0, ps.funds - before);
    }
  }
}

export function preserveSavings(m, ps, rec) {
  return stateOf(ps).parked.some((p) => p.round === m.round && p.id === rec?.chessId && ps.find(p.uid));
}

export function bankRemainder(m, ps, { itemAllowed = () => true, chessAllowed = () => true } = {}) {
  const gd = gdOf(m, ps), state = stateOf(ps);
  if (m.round >= gd.bossRound || gd.leftoverKeptBands.includes(ps.bandId)) return false;
  let bought = false;
  for (let guard = 0; guard < 3 && ps.funds > 0; guard++) {
    // Keep two hand slots for rewards/merges, and at most one liquidation operator in flight.
    if (ps.hand.filter((p) => !p).length < 3) break;
    const owned = new Set(ps.allChess().map((p) => gd.baseIdOf(p.id))), candidates = [];
    for (const [idx, slot] of ps.shop.slots.entries()) {
      if (!slot || slot.sold || ps.priceOf(slot) > ps.funds) continue;
      const price = ps.priceOf(slot);
      if (slot.kind === 'item') {
        const rec = gd.item(slot.id);
        if (!itemAllowed(rec)) continue;
        // A fixed-value coin carries exactly; a passive item remains useful. Do not gamble on piggy-bank rolls here.
        if (savingsCash(rec) && rec.params?.min === rec.params?.max) candidates.push({ idx, score: 100 + rec.params.min - price, kind: 'Cash' });
        else if (rec?.kind === 'passive' && rec.giveBondId !== ps._botFocusId && !rec.canGiveBond
          && (!rec.requiresBondId || ps.bonds[rec.requiresBondId]?.active)
          && ps.allChess().some((p) => !preserveSavings(m, ps, gd.chess(p.id)) && (p.items?.length || 0) < gd.equipPerChess)) candidates.push({ idx, score: 50 + rec.tier * 2 - price, kind: 'Gear' });
      } else if (slot.kind === 'chess' && !state.parked.length && ps.funds <= 3) {
        const rec = gd.chess(slot.id);
        if (!chessAllowed(rec)) continue;
        if (!rec || rec.isGolden || rec.bonds.includes(ps._botFocusId) || owned.has(gd.baseIdOf(slot.id))) continue;
        const swire = rec.garrisonIds?.some((id) => {
          const g = gd.garrison(id);
          return g?.eventType === 'SERVER_GAIN' && g.effectKey === 'SERVER_GAIN_EQUIP' && g.bbStr?.chess === 'chess_item_1_03_e_a';
        });
        if (swire || rec.tier === 1) candidates.push({ idx, score: swire ? 30 : 20, kind: 'Chess', id: slot.id });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
    const pick = candidates[0];
    if (!pick) break;
    const before = new Set(ps.allChess().map((p) => p.uid));
    if (!ps.buy(pick.idx)?.ok) break;
    const stats = statsOf(ps), key = `banked${pick.kind}`;
    stats[key] = (stats[key] || 0) + 1;
    if (pick.kind === 'Chess') {
      const p = ps.allChess().find((p) => !before.has(p.uid) && p.id === pick.id);
      if (p) state.parked.push({ uid: p.uid, id: p.id, round: m.round });
    }
    bought = true;
  }
  return bought;
}
