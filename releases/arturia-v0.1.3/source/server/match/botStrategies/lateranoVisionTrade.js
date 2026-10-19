// [ASSUMED] After Vision 80, cycle immediate effects; with Astgenne owned, also cycle any <=1-cost chess.
// Use real prices, buys, coin equipment and sales; never liquidate an existing representative or complete a merge.
const VISION = 'visiShip', COIN = 'chess_item_1_03_e_a';
const immediateEvents = new Set(['SERVER_GAIN', 'SERVER_CHESS_SOLD']);
const garrisons = (gd, rec) => (rec.garrisonIds || []).map(id => gd.garrison(id)).filter(Boolean);

export function tradeVision80(m, ps, { retain = () => false } = {}) {
  const gd = ps.gd || m.gd;
  const vision = (ps.layers[VISION] || 0) >= 80;
  const star = ps.allChess().some(p => gd.baseIdOf(p.id) === 'chess_char_6_16_a');
  if (!vision && !star) return;
  for (const [index, slot] of ps.shop.slots.entries()) {
    if (!slot || slot.sold || slot.kind !== 'chess') continue;
    const rec = gd.chess(slot.id);
    if (!rec || rec.isGolden || ps.completesChessMerge(slot.id) || retain(m, ps, rec)) continue;
    const effects = garrisons(gd, rec), price = ps.priceOf(slot), refund = gd.sellPrice(slot.id);
    const coinCount = effects.filter(g => g.eventType === 'SERVER_GAIN' && g.effectKey === 'SERVER_GAIN_EQUIP'
      && g.bbStr?.chess === COIN).reduce((n, g) => n + (g.bb.count || 0), 0);
    const cheapEffect = vision && rec.bonds.includes(VISION) && price <= 1 && price <= refund
      && effects.some(g => immediateEvents.has(g.eventType));
    const starCycle = star && price <= 1 && price <= refund;
    // Swire: 2 paid = 1 sale + 1 coin. A normal coin already held could merge with the gift: leave it intact.
    const coinCycle = vision && rec.bonds.includes(VISION) && coinCount > 0 && price <= refund + coinCount
      && m.itemPool.canGain(COIN) && !ps.completesItemMerge(COIN);
    const pool = ps.poolOf(gd.baseIdOf(slot.id));
    if ((!cheapEffect && !coinCycle && !starCycle) || price > ps.funds || ps.hand.filter(p => !p).length < (coinCycle ? 2 : 1)
      || pool.has(gd.baseIdOf(slot.id)) && pool.left(gd.baseIdOf(slot.id)) < 1) continue;
    const beforeChess = new Set(ps.allChess().map(p => p.uid));
    const beforeItems = new Set([...ps.hand, ...ps.temp].filter(p => p?.kind === 'item').map(p => p.uid));
    const beforeFunds = ps.funds, beforeVision = ps.layers[VISION] || 0;
    if (!ps.buy(index)?.ok) continue;
    const piece = ps.allChess().find(p => !beforeChess.has(p.uid) && p.id === slot.id);
    if (!piece || piece.items?.length) continue;
    let redeemed = 0;
    if (coinCycle) for (const item of [...ps.hand, ...ps.temp]) {
      if (item?.kind !== 'item' || beforeItems.has(item.uid) || gd.item(item.id)?.baseId !== COIN) continue;
      const before = ps.funds;
      if (ps.equip(item.uid, piece.uid)?.ok) redeemed += ps.funds - before;
    }
    if (!ps.sell(piece.uid)?.ok) continue;
    const stats = ps._botRecipeStats ||= {};
    stats.visionTrades = (stats.visionTrades || 0) + 1;
    stats.visionTradeSpent = (stats.visionTradeSpent || 0) + price;
    stats.visionTradeNetCash = (stats.visionTradeNetCash || 0) + ps.funds - beforeFunds;
    stats.visionTradeLayers = (stats.visionTradeLayers || 0) + (ps.layers[VISION] || 0) - beforeVision;
    if (starCycle) stats.starTrades = (stats.starTrades || 0) + 1;
    (ps._botVisionTrades ||= []).push({ round: m.round, id: slot.id, price, refund, redeemed,
      netCash: ps.funds - beforeFunds, visionGain: (ps.layers[VISION] || 0) - beforeVision, starCycle, coinCycle });
  }
}

export function withLateranoVisionTrade(recipe) {
  const cycle = (m, ps) => tradeVision80(m, ps, { retain: (m, ps, rec) => recipe.importantBuy(m, ps, rec) || recipe.criticalBuy(m, ps, rec) });
  return Object.freeze({ ...recipe,
    useEconomy(m, ps) { recipe.useEconomy(m, ps); cycle(m, ps); },
    liquidity(m, ps) { recipe.liquidity?.(m, ps); cycle(m, ps); }
  });
}
