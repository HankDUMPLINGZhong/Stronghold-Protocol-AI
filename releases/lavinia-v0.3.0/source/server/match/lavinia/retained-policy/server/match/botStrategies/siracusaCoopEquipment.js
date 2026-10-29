// [ASSUMED] Independent owner-requested equipment trial; high tier means IV–VI.
// Only real owned pairs, public pool availability and complete independent fatal forecasts are used.
import { pieceBonds } from '../../../../../bondsMeta.js';
import { allCoopForecastsFatal } from './lateranoCoopRescue.js';

export const SIRACUSA_EXTRA_ITEMS = Object.freeze({
  badge: 'chess_item_6_11_e_a', doctor: 'chess_item_5_06_e_a',
  document: 'chess_item_6_08_e_a', mimic: 'chess_item_5_05_e_a',
});
const CORE = 'siracusaShip', ids = Object.values(SIRACUSA_EXTRA_ITEMS);
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const inventory = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');
const free = (ps, p) => (p.items?.length || 0) < ps.gd.equipPerChess;
const native = (ps, p) => pieceBonds(ps.gd, p).includes(CORE);
const tier = (ps, p) => ps.gd.chess(p.id)?.tier || 0;
const pending = (ps, p) => p.items?.some(i => base(ps, i) === SIRACUSA_EXTRA_ITEMS.doctor);
const dps = (ps, p) => {
  const rec = ps.gd.chess(p.id), s = rec?.stats || {};
  return ['heal', 'none'].includes(rec?.attackKind) ? 0 : (s.atk || 0) / (s.bat || 1.5) * (s.aspd || 100) / 100;
};
const rank = (ps, a, b) => tier(ps, b) - tier(ps, a) || Number(ps.gd.isGolden(b.id)) - Number(ps.gd.isGolden(a.id))
  || dps(ps, b) - dps(ps, a) || a.uid - b.uid;

export function siracusaEquipmentTarget(m, ps, rec, { emergency = false } = {}) {
  const id = base(ps, rec), own = ps.allChess(), available = own.filter(p => free(ps, p));
  if (id === SIRACUSA_EXTRA_ITEMS.badge) return available.filter(p => tier(ps, p) >= 4 && dps(ps, p) > 0
    && !p.items?.some(i => base(ps, i) === id)).sort((a, b) => Number(native(ps, b)) - Number(native(ps, a))
      || rank(ps, a, b))[0] || null;
  if (id === SIRACUSA_EXTRA_ITEMS.document) return ps.deployCap < 9 ? available[0] || null : null;
  if (id === SIRACUSA_EXTRA_ITEMS.doctor) return available.filter(p => !ps.gd.isGolden(p.id) && !pending(ps, p)
    && !own.some(q => base(ps, q) === base(ps, p) && ps.gd.isGolden(q.id)))
    .sort((a, b) => rank(ps, a, b))[0] || null;
  if (id !== SIRACUSA_EXTRA_ITEMS.mimic || !ps.hand.some(p => !p)) return null;
  const normals = available.filter(p => !ps.gd.isGolden(p.id) && !pending(ps, p)
    && !own.some(q => base(ps, q) === base(ps, p) && ps.gd.isGolden(q.id)));
  const pairs = normals.filter(p => (emergency || tier(ps, p) >= 4)
    && own.filter(q => !ps.gd.isGolden(q.id) && base(ps, q) === base(ps, p)).length >= 2
    && (() => { const pool = ps.poolOf?.(p.id) || m.pool; return !pool.has(base(ps, p)) || pool.left(base(ps, p)) > 0; })());
  if (pairs.length) return pairs.sort((a, b) => rank(ps, a, b))[0];
  // The emergency random recruit is deliberately restricted to an actual pure native carrier.
  return emergency ? normals.filter(p => native(ps, p) && pieceBonds(ps.gd, p).length === 1)
    .sort((a, b) => rank(ps, a, b))[0] || null : null;
}

const cache = new WeakMap();
export function withSiracusaCoopEquipment(parent, { snapshot, probe }) {
  if (cache.has(parent)) return cache.get(parent);
  const special = rec => ids.includes(rec?.baseId || rec?.id);
  const target = (m, ps, rec) => siracusaEquipmentTarget(m, ps, rec);
  const out = Object.freeze({ ...parent,
    itemAllowed: rec => special(rec) || parent.itemAllowed(rec),
    purchaseItemAllowed(m, ps, rec) {
      if (!special(rec)) return parent.purchaseItemAllowed?.(m, ps, rec) ?? true;
      if (m.round === 2) return false;
      const id = base(ps, rec);
      if (id === SIRACUSA_EXTRA_ITEMS.mimic) return !inventory(ps).some(i => base(ps, i) === id);
      if (id === SIRACUSA_EXTRA_ITEMS.doctor && !rec.isGolden && m.round >= (ps.gd.hiddenRound || ps.gd.bossRound)) return false;
      return !!target(m, ps, rec);
    },
    holdItem(m, ps, rec) { return special(rec) ? !target(m, ps, rec) : parent.holdItem(m, ps, rec); },
    protectItem(m, ps, rec) { return special(rec) || parent.protectItem?.(m, ps, rec); },
    ownedItemTarget(m, ps, rec, own) { return special(rec) ? target(m, ps, rec) : parent.ownedItemTarget?.(m, ps, rec, own); },
    itemTargetAllowed(m, ps, rec, p) { return special(rec) ? target(m, ps, rec)?.uid === p.uid : parent.itemTargetAllowed?.(m, ps, rec, p); },
    *finalBoardSteps(m, ps, h) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      if (!m.wave || m.round < 3 || m.round > 13 || !h.recoverEconomySteps) return;
      const mimic = () => inventory(ps).find(i => base(ps, i) === SIRACUSA_EXTRA_ITEMS.mimic);
      if (!mimic() || !siracusaEquipmentTarget(m, ps, ps.gd.item(mimic().id), { emergency: true })) return;
      let risk = yield* probe(m, ps, h, [snapshot(ps, h)], () => ({ index: 0 }));
      if (!risk || risk.stale || !allCoopForecastsFatal(risk.job.outcomes, ps.lp)) return;
      const log = { factor: 'coop-equipment', round: m.round, lp: ps.lp, before: risk.job.outcomes, actions: [] };
      (ps._botSiracusaCoopHistory ||= []).push(log);
      for (let pass = 0; pass < 2; pass++) {
        const item = mimic(), p = item && siracusaEquipmentTarget(m, ps, ps.gd.item(item.id), { emergency: true });
        if (!p) break;
        const action = { id: item.id, target: p.id, uid: p.uid, used: !!ps.equip(item.uid, p.uid)?.ok }; log.actions.push(action);
        if (!action.used) break;
        yield* h.recoverEconomySteps();
        risk = yield* probe(m, ps, h, [snapshot(ps, h)], () => ({ index: 0 }));
        action.after = risk?.job.outcomes;
        if (!risk || risk.stale || !allCoopForecastsFatal(risk.job.outcomes, ps.lp)) break;
      }
    },
  });
  cache.set(parent, out); return out;
}
