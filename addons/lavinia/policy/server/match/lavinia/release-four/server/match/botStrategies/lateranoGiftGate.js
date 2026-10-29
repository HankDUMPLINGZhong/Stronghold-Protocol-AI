// Observe only an already-delivered Paganini reward, never peek at a future roll or the shop RNG.
// [ASSUMED] Round and member thresholds are a policy experiment, not a change to game rules.
const KEY = 'band:paganini:done', CORE = 'lateranoShip';

/** Called immediately around a real buy/refresh/upgrade, before later rewards or sales can hide its result. */
export function observePaganiniSpend(m, ps) {
  if (ps.bandId !== 'band_paganini' || ps.counters[KEY] || ps._botPaganiniGift) return null;
  const before = new Set(ps.allChess().map(p => p.uid));
  return () => {
    if (!ps.counters[KEY]) return;
    const gd = ps.gd || m.gd;
    // _afterSpend dispatches the band after the purchase/merge or refresh effects. Its elite is the last
    // newly acquired core elite; an elite created by the triggering purchase comes earlier (META §1.6).
    const gifts = ps.allChess().filter(p => !before.has(p.uid) && gd.isGolden(p.id)
      && gd.tierOf(p.id) >= 4 && gd.chess(p.id)?.bonds.includes(CORE)).sort((a,b) => b.uid-a.uid);
    if (gifts.length) ps._botPaganiniGift = Object.freeze({ id: gifts[0].id, tier: gd.tierOf(gifts[0].id), round: m.round });
  };
}

export const paganiniMinimumMembers = fromRound => (m, ps) =>
  ps.bandId === 'band_paganini' && ps.counters[KEY] && ps._botPaganiniGift?.tier === 4
    && ps.shop.level === 4 && m.round >= fromRound ? 5 : 6;
