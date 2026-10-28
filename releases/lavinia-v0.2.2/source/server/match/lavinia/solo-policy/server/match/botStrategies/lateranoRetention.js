// Narrow follow-up to the frozen 21/4 policy. [ASSUMED] Retention and geometric scores are AI policy.
import { pieceBonds } from '../../../../../bondsMeta.js';
import { isFormationAnchor } from '../botPositioning.js';
import { repairRouteProtection } from './lateranoContactRepair.js';

/** Keep one distinct Vision partner, not another Saint copy or a new field slot / acquisition project. */
export function visionPartner(m, ps, saintId) {
  const gd = ps.gd || m.gd;
  if (m.round > gd.bossRound || gd.modeInactiveBonds.has('visiShip')
    || ![...ps.board.values()].some(p => p.kind === 'chess' && gd.baseIdOf(p.id) === saintId)) return null;
  const candidates = ps.allChess().filter(p => gd.baseIdOf(p.id) !== saintId && pieceBonds(gd, p).includes('visiShip'));
  // User policy: keep activation even after 150, through the final R14 preparation. Release after R14.
  // An already deployed partner costs no additional bench slot. Otherwise retain the cheapest existing base.
  candidates.sort((a, b) => Number(ps.find(b.uid)?.area === 'board') - Number(ps.find(a.uid)?.area === 'board')
    || gd.chess(a.id).tier - gd.chess(b.id).tier || a.uid - b.uid);
  return candidates.length ? gd.baseIdOf(candidates[0].id) : null;
}

const contactMaps = new Set(['act1autochess_m02', 'act2autochess_m03']);
const contactRound = plan => contactMaps.has(plan.ps?.m.stageId)
  && plan.ps.m.round < plan.ps.m.gd.bossRound;
const anchor = u => isFormationAnchor(u.rec) && u.rec.bonds?.includes('steadShip');

/** Actual entrance-to-exit route order, including bends. Fence tiles are buildable but cannot block. */
export function contactFrontlineValue(units, plan, model) {
  if (!contactRound(plan)) return 0;
  const stage = plan.ps.m.stage;
  let value = 0;
  for (const u of units.filter(anchor)) {
    const tile = stage.tiles[stage.rows[u.r]?.[u.c]];
    if (!tile?.groundPassable) value -= 10000;
  }
  const routes = (model?.routes || []).filter(rt => !rt.fly && !rt.fallback && rt.n > 0);
  const total = routes.reduce((sum, rt) => sum + rt.n, 0) || 1;
  if (!units.some(anchor)) return value;
  for (const rt of routes) {
    const front = units.filter(anchor).reduce((i, u) => {
      const at = rt.tiles.indexOf(u.key); return at < 0 ? i : Math.min(i, at);
    }, Infinity);
    // Ordinary melee interceptors remain legal. Protect ranged damage / healing and the Saint's sustain window.
    for (const u of units) {
      if (anchor(u) || !(u.heal || u.rec.position === 'RANGED' || u.rec.subProfessionId === 'lord'
        || u.rec.chessId?.startsWith('chess_char_5_01_'))) continue;
      const at = rt.tiles.indexOf(u.key);
      // A layer/coverage bonus must not outweigh putting a ranged body ahead of the available tank.
      if (at >= 0 && at < front) value -= rt.n / total * 1000;
      if (front < Infinity && u.cover?.has(rt.tiles[front])) value += rt.n / total * 0.5;
    }
  }
  return value;
}

export function withLateranoRetention(baseline) {
  const partner = (m, ps, rec) => visionPartner(m, ps, baseline.ids.executorAlter) === (ps.gd || m.gd).baseIdOf(rec.chessId || rec.id);
  return Object.freeze({ ...baseline,
    repairContact: repairRouteProtection,
    keep(m, ps, rec) { return partner(m, ps, rec) || baseline.keep(m, ps, rec); },
    preserve(m, ps, rec) {
      const gd = ps.gd || m.gd;
      return partner(m, ps, rec) && ps.allChess().filter(p => gd.baseIdOf(p.id) === gd.baseIdOf(rec.chessId || rec.id)).length === 1
        || baseline.preserve(m, ps, rec);
    },
    layoutValue(gd, units, plan, bonds, model) {
      return baseline.layoutValue(gd, units, plan, bonds, model) + contactFrontlineValue(units, plan, model);
    },
    layoutCandidates(gd, units, plan, bonds) {
      const out = baseline.layoutCandidates(gd, units, plan, bonds);
      if (contactRound(plan)) {
        const model = plan.ps.m._botPath;
        const road = new Set((model?.routes || []).filter(rt => !rt.fly && !rt.fallback && rt.n > 0).flatMap(rt => rt.tiles));
        for (const u of units.filter(anchor)) for (const key of road) {
          const [r, c] = key.split(',').map(Number); out.push({ uid: u.uid, r, c });
        }
      }
      return out;
    }
  });
}
