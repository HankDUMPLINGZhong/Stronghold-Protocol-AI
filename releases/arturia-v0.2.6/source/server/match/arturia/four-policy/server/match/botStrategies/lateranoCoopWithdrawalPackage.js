// [ASSUMED] Full-hand retreat repair only. No buying, upgrade or lineup-value changes.
import { pieceBonds } from '../../../../../bondsMeta.js';

export function coopWithdrawalWorth(m, ps, p, recipe) {
  if (m.mode !== 'coop' || m.isSolo || m.round < 8 || m.round > m.gd.bossRound || p?.kind !== 'chess') return false;
  const gd = ps.gd, id = gd.baseIdOf(p.id), rec = gd.chess(p.id), bonds = pieceBonds(gd, p);
  if ([recipe.ids.faith, recipe.ids.mostima, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.executorAlter].includes(id)) return true;
  if (rec.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(rec.subProfessionId)) return true;
  const precision = new Set(ps.allChess().filter(q => pieceBonds(gd, q).includes('preciShip')).map(q => gd.baseIdOf(q.id)));
  if (bonds.includes('preciShip') && (precision.size >= 3 || (ps.layers.preciShip || 0) >= 40)) return true;
  return bonds.includes('skillfulShip') && (ps.layers.skillfulShip || 0) >= 40 && (gd.isGolden(p.id) || rec.tier >= 4);
}

/** Entry uses the incoming unit's own reserve slot for the outgoing piece; no spare hand slot is needed. */
export function repairCoopWithdrawal(m, ps, outgoing, { chosen, freeShoppingSlot }, recipe) {
  if (ps.hand.some(p => !p) || !coopWithdrawalWorth(m, ps, outgoing, recipe)) return false;
  const location = ps.find(outgoing.uid); if (location?.area !== 'board') return false;
  const selected = new Set(chosen.map(p => p.uid));
  const pinned = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  if (pinned.has(outgoing.uid)) return false;
  const at = key => key.split(',').map(Number), legal = (p, key) => ps._legal(p, ...at(key));
  const move = (p, key) => { const [row, col] = at(key); return ps.move(p.uid, { area: 'board', row, col }, p.dir || 'RIGHT'); };
  const incoming = chosen.filter(p => ps.find(p.uid)?.area === 'hand').sort((a, b) => a.uid - b.uid);
  for (const p of incoming) if (legal(p, location.key)) {
    if (!move(p, location.key)?.ok) continue;
    (ps._botCoopWithdrawalHistory ||= []).push({ factor: 'withdrawal-package', round: m.round, kind: 'direct-entry', kept: outgoing.id, incoming: p.id });
    return true;
  }
  // A melee/ranged mismatch can use an already selected ally as a legal two-step bridge.
  for (const p of incoming) for (const [key, bridge] of ps.board) {
    if (bridge.kind !== 'chess' || !selected.has(bridge.uid) || pinned.has(bridge.uid)
      || !legal(bridge, location.key) || !legal(outgoing, key) || !legal(p, key)) continue;
    if (!move(bridge, location.key)?.ok) continue;
    if (!move(p, key)?.ok) throw Error('Validated withdrawal bridge entry failed');
    (ps._botCoopWithdrawalHistory ||= []).push({ factor: 'withdrawal-package', round: m.round, kind: 'bridge-entry', kept: outgoing.id, incoming: p.id, bridge: bridge.id });
    return true;
  }
  // Existing inventory handling equips or destroys a disposable item; never sell another combat unit here.
  if (freeShoppingSlot(m, ps))
    (ps._botCoopWithdrawalHistory ||= []).push({ factor: 'withdrawal-package', round: m.round, kind: 'item-space', kept: outgoing.id });
  return false;
}

/** Retire only unselected low-tier non-native components. The last Foresight activation/support remains a hard guard. */
export function coopRetirableComponent(m, ps, p, recipe, chosen, { keepPairs = false } = {}) {
  if (m.mode !== 'coop' || m.isSolo || m.round < 8 || m.round > m.gd.bossRound || p?.kind !== 'chess'
    || chosen.some(q => q.uid === p.uid) || p.items?.length) return false;
  const gd = ps.gd, rec = gd.chess(p.id), bonds = pieceBonds(gd, p);
  if (rec.tier > 3 || bonds.includes('lateranoShip')) return false;
  if (keepPairs && !gd.isGolden(p.id) && ps.allChess().filter(q => gd.baseIdOf(q.id) === gd.baseIdOf(p.id)
    && !gd.isGolden(q.id)).length >= 2) return false;
  if (m.round < m.gd.bossRound && bonds.includes('visiShip')) {
    const rest = ps.allChess().filter(q => q.uid !== p.uid && pieceBonds(gd, q).includes('visiShip'));
    if (ps.bonds.visiShip?.active && new Set(rest.map(q => gd.baseIdOf(q.id))).size < 2) return false;
    const saint = ps.allChess().some(q => gd.baseIdOf(q.id) === recipe.ids.executorAlter);
    if (saint && !rest.some(q => gd.baseIdOf(q.id) !== recipe.ids.executorAlter)) return false;
  }
  return true;
}

export function retireCoopLowTier(m, ps, outgoing, { chosen }, recipe, { keepPairs = false } = {}) {
  if (ps.hand.some(p => !p)) return null;
  const isRetirable = p => coopRetirableComponent(m, ps, p, recipe, chosen, { keepPairs });
  const self = isRetirable(outgoing);
  const target = self ? outgoing : coopWithdrawalWorth(m, ps, outgoing, recipe)
    ? ps.hand.filter(isRetirable).sort((a, b) => ps.gd.chess(a.id).tier - ps.gd.chess(b.id).tier || a.uid - b.uid)[0] : null;
  if (!target || !ps.sell(target.uid)?.ok) return null;
  const kind = self ? 'retire-outgoing' : 'retire-reserve';
  (ps._botCoopWithdrawalHistory ||= []).push({ factor: 'withdrawal-low-tier', round: m.round, kind,
    sold: target.id, soldUid: target.uid, kept: self ? null : outgoing.id });
  return kind;
}

export function withCoopWithdrawalPackage(parent, { retireLowTier = false, keepLowTierPairs = false } = {}) {
  const out = { ...parent, beforeWithdrawal(m, ps, p, h) {
    if (parent.beforeWithdrawal?.(m, ps, p, h)) return true;
    if (retireLowTier) {
      const retired = retireCoopLowTier(m, ps, p, h, parent, { keepPairs: keepLowTierPairs });
      if (retired) return retired === 'retire-outgoing';
    }
    return repairCoopWithdrawal(m, ps, p, h, parent);
  } };
  if (keepLowTierPairs) {
    const pair = (m, ps, rec) => m.mode === 'coop' && !m.isSolo && m.round >= 8 && m.round <= m.gd.bossRound
      && rec.tier <= 3 && !ps.gd.isGolden(rec.chessId || rec.id)
      && ps.allChess().filter(p => ps.gd.baseIdOf(p.id) === ps.gd.baseIdOf(rec.chessId || rec.id)
        && !ps.gd.isGolden(p.id)).length >= 2;
    out.keep = (m, ps, rec, ...xs) => pair(m, ps, rec) || parent.keep(m, ps, rec, ...xs);
    out.preserve = (m, ps, rec, ...xs) => pair(m, ps, rec) || parent.preserve(m, ps, rec, ...xs);
    out.trade = (m, ps, ...xs) => {
      const old = ps._botCoopKeepLowTierPairs;
      ps._botCoopKeepLowTierPairs = m.mode === 'coop' && !m.isSolo && m.round >= 8 && m.round <= m.gd.bossRound;
      try { return parent.trade(m, ps, ...xs); }
      finally { if (old === undefined) delete ps._botCoopKeepLowTierPairs; else ps._botCoopKeepLowTierPairs = old; }
    };
  }
  return Object.freeze(out);
}
