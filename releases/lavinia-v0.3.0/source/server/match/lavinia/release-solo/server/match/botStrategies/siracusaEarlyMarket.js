// Independent market factors over the retained co-op recipe. Visible cards and actual holdings only.
const CORE = 'siracusaShip', LAP = 'chess_char_2_16_a', AROMA = 'chess_char_4_10_a', SURTR = 'chess_char_5_07_a';
const base = (ps, p) => ps.gd.baseIdOf(p.id ?? p.chessId);
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.round >= 1 && ps.bandId === 'band_chiave' && ps._botFocusId === CORE;
export function earlyMarketTarget(m, ps, rec, kind, parent) {
  if (!scope(m, ps) || !rec || parent.purchaseAllowed(m, ps, rec) === false) return false;
  const id = base(ps, rec), same = ps.allChess().filter(p => base(ps, p) === id);
  if (kind === 'coop-early-aroma') return id === AROMA && !same.length;
  if (ps.shop.level === 2 && id === LAP) return true;
  if (same.some(p => ps.gd.isGolden(p.id))) return false;
  return id === SURTR || ps.shop.level >= 3 && rec.bonds.includes(CORE);
}
const cache = new WeakMap();
export function withSiracusaEarlyMarket(parent, kind) {
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (!variants.has(kind)) {
    const rawTarget = (m, ps, rec) => earlyMarketTarget(m, ps, rec, kind, parent);
    const target = (m, ps, rec) => rawTarget(m, ps, rec) && (kind === 'coop-early-aroma'
      || ps.funds >= Math.max(0, ps.shop.upgradePrice)
      && ps.shop.level < Math.max(parent.levelTarget(m, ps) ?? ps.shop.level, parent.levelTarget(m, ps, { spare: true }) ?? ps.shop.level));
    variants.set(kind, Object.freeze({ ...parent,
      criticalBuy: (m, ps, rec, ctx) => target(m, ps, rec) || parent.criticalBuy(m, ps, rec, ctx),
      importantBuy: (m, ps, rec) => target(m, ps, rec) || parent.importantBuy(m, ps, rec),
      buyBonus: (m, ps, rec, ...xs) => parent.buyBonus(m, ps, rec, ...xs) + (target(m, ps, rec) ? 100 : 0),
      beforeUpgrade(m, ps, plan) {
        const visible = ps.shop.slots.filter(s => s?.kind === 'chess' && !s.sold && ps.priceOf(s) <= ps.funds && rawTarget(m, ps, ps.gd.chess(s.id)));
        if (visible.length) {
          const ids = visible.map(s => s.id), key = `${m.round}:${ps.shop.level}:${ps.funds}:${ids.join(',')}`;
          if (ps._botSiracusaUpgradeVeto !== key) {
            ps._botSiracusaUpgradeVeto = key;
            (ps._botSiracusaCoopHistory ||= []).push({ factor: kind, round: m.round, kind: 'upgrade-deferred', level: ps.shop.level, funds: ps.funds, ids });
          }
          return false;
        }
        return parent.beforeUpgrade(m, ps, plan);
      },
    }));
  }
  return variants.get(kind);
}
