// [ASSUMED] Independent opt-in two-seat stable-Raid trials, with native Texas Alter as the explicit exception.
// true: stable-source paid purchases only (abandoned after three pilots); upgrade-gate: ignore unstable Raid
// only in beforeUpgrade, keeping all purchase hooks literal. Defaults, free rewards and combat stay inherited.
import { routeLayerEngine } from './siracusaFocusedDraft.js';

const RAID = 'raidShip', TEXAS = 'chess_char_4_16_a';
export function stableRaidSource(gd, rec) {
  if (!routeLayerEngine(gd, rec, [RAID])) return false;
  return (rec.garrisonIds || []).some(id => {
    const g = gd.garrison(id);
    if (!g) return false;
    // Generated Raid sources currently contain only direct start/prep gains. Kill/hit triggers stay excluded.
    if (g.effectKey === 'act2autochess_gar_event_onstart') {
      const bonds = (g.bbStr?.bond_id || '').split(',');
      return g.bb?.bond_add_count > 0 && (g.bbStr?.bond_type === 'bond_self' || bonds.includes(RAID));
    }
    return ['SERVER_PREP_START', 'SERVER_PREP_FIN'].includes(g.eventType)
      && g.effectKey === 'SERVER_ADD_BOND_CHESS_ALL' && g.bb?.count > 0;
  });
}

export function stableRaidPurchaseAllowed(m, ps, rec) {
  if (m.mode !== 'coop' || m.isSolo || m.order.length !== 2 || m.difficulty !== 'ABYSS'
    || ps.bandId !== 'band_chiave' || ps._botFocusId !== 'siracusaShip'
    || ps._botRoute?.id !== 'siracusaShip:arcane-raid' || !rec?.bonds?.includes(RAID)) return true;
  return ps.gd.baseIdOf(rec.chessId) === TEXAS || stableRaidSource(ps.gd, rec);
}

const cache = new WeakMap();
export function withSiracusaStableRaid(parent, enabled) {
  if (!enabled) return parent;
  if (enabled !== true && enabled !== 'upgrade-gate') throw Error('Unknown Siracusa stable Raid trial');
  let variants = cache.get(parent); if (!variants) { variants = new Map(); cache.set(parent, variants); }
  if (variants.has(enabled)) return variants.get(enabled);
  const overrides = enabled === 'upgrade-gate' ? {
    beforeUpgrade(m, ps, plan) {
      if (m.round < 3 || m.round > 13 || !m.wave) return parent.beforeUpgrade(m, ps, plan);
      const hidden = ps.shop.slots.filter(s => s?.kind === 'chess' && !s.sold
        && !ps.gd.chess(s.id)?.bonds.includes('siracusaShip') && !stableRaidPurchaseAllowed(m, ps, ps.gd.chess(s.id)));
      if (!hidden.length) return parent.beforeUpgrade(m, ps, plan);
      const view = Object.create(ps); view.shop = { ...ps.shop, slots: ps.shop.slots.map(s => hidden.includes(s) ? null : s) };
      const allowed = parent.beforeUpgrade(m, view, plan);
      (ps._botSiracusaHumanHistory ||= []).push({ factor: 'stable-raid-upgrade', kind: 'upgrade-gate', round: m.round,
        level: ps.shop.level, funds: ps.funds, hidden: hidden.map(s => s.id), allowed });
      return allowed;
    },
  } : {
    purchaseAllowed(m, ps, rec) {
      const inherited = parent.purchaseAllowed(m, ps, rec), allowed = stableRaidPurchaseAllowed(m, ps, rec);
      if (inherited && !allowed && ps.shop.slots.some(s => s?.kind === 'chess' && !s.sold && s.id === rec.chessId)) {
        const history = ps._botSiracusaStableRaidHistory ||= [], refreshes = ps.round.refreshes;
        if (!history.some(x => x.round === m.round && x.refreshes === refreshes && x.id === rec.chessId))
          history.push({ round: m.round, refreshes, id: rec.chessId, level: ps.shop.level });
      }
      return inherited && allowed;
    },
  };
  const recipe = Object.freeze({ ...parent, ...overrides }); variants.set(enabled, recipe); return recipe;
}
