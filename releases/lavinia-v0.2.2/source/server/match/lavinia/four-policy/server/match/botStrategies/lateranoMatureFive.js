// [ASSUMED] Independent economic factor from the observed26871 game, not a combat-clear guarantee.
// Only public owned assets/current active bonds are read. No forecast, future shop, gift or actual-result lookup.
import { lateranoFocused } from './lateranoFocused.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';

export function lateranoMatureFive(m, ps) {
  const gd = ps.gd || m.gd, { ids, core } = lateranoFocused;
  const pieces = ps.allChess();
  const records = pieces.map(p => {
    const rec = gd.chess(p.id);
    return { p, rec: loadoutRecord(rec, resolveRecordLoadout(rec, ps.loadoutFor(rec))) };
  });
  const distinct = new Set(pieces.map(p => gd.baseIdOf(p.id))).size;
  const natives = new Set(pieces.filter(p => pieceBonds(gd, p).includes(core)).map(p => gd.baseIdOf(p.id))).size;
  // An elite one-cost Insider or an elite stacking/control Mostima is not the mature main dealer by itself.
  const carry = records.find(({ p, rec }) => gd.isGolden(p.id) && rec.tier >= 2
    && rec.profession === 'SNIPER' && rec.bonds.includes(core) && !['heal', 'none'].includes(rec.attackKind));
  const tank = records.find(({ p, rec }) => {
    if (rec.profession !== 'TANK' || rec.stats.blockCnt < 2) return false;
    if (gd.isGolden(p.id) && rec.tier >= 3) return true;
    if (gd.baseIdOf(p.id) !== ids.faith) return false;
    let defence = rec.stats.def;
    for (const id of rec.garrisonIds || []) {
      const g = gd.garrison(id);
      if (g?.effectKey !== 'act1autochess_gar_eff_attrByBond' || !(g.bb.def > 0)) continue;
      const layers = (g.bbStr.bond_id || '').split(',').reduce((n, b) => n + (ps.bonds[b]?.active ? ps.layers[b] || 0 : 0), 0);
      defence *= 1 + Math.floor(layers / Math.max(1, g.bb.divide_num || 1)) * g.bb.def;
    }
    return defence >= 650;
  });
  const healer = records.find(({ rec }) => rec.attackKind === 'heal' || rec.dmgType === 'heal'
    || ['guardian', 'incantationmedic'].includes(rec.subProfessionId));
  const inScope = m.mode === 'solo' && ps.bandId === 'band_paganini' && ps._botFocusId === core
    && ps.shop.level === 4 && m.round >= 9 && m.round < gd.bossRound;
  return { ready: inScope && distinct >= 6 && natives >= 4 && !!carry && !!tank && !!healer,
    inScope, distinct, natives, carry: carry?.p.uid ?? null, tank: tank?.p.uid ?? null, healer: healer?.p.uid ?? null };
}
