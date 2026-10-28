// [ASSUMED] Main-carry retention and final-assault priorities are policy, never changes to battle mechanics.
import { pieceBonds } from '../../../../../bondsMeta.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const finale = (m) => !!m && m.round >= m.gd.bossRound;
const count = (gd, pieces, bond) => new Set(pieces.filter(p => pieceBonds(gd, p).includes(bond)).map(p => base(gd, p))).size;

/** Extend any retained recipe without changing its opening, acquisition or pre-boss layer plan. */
export function withLateranoFinale(recipe, { allProtectedWithdrawals = false } = {}) {
  const { ids } = recipe, carries = new Set([ids.exusiaiAlter, ids.lemuen]);
  const main = (gd, p) => carries.has(base(gd, p));
  const retained = (m, ps, rec) => main(gdOf(m, ps), rec)
    && (rec.isGolden || !ps.allChess().some(p => base(gdOf(m, ps), p) === base(gdOf(m, ps), rec) && gdOf(m, ps).isGolden(p.id)));

  function lineupBonus(gd, pieces, bonds, plan) {
    let value = recipe.lineupBonus(gd, pieces, bonds, plan);
    const ps = plan.ps;
    if (!finale(ps.m)) return value;
    const owned = ps.allChess(), required = new Set(owned.filter(p => main(gd, p)).map(p => base(gd, p)));
    const field = new Set(pieces.map(p => base(gd, p)));
    // Crossing six different members cannot be traded for spare copies or a third Skillful layerer.
    const target = Math.min(6, count(gd, owned, CORE) + (ps.bondCountBonus?.[CORE] || 0));
    value -= Math.max(0, target - (bonds[CORE]?.count || 0)) * 20000;
    for (const id of required) if (!field.has(id)) value -= 5000;
    return value;
  }

  function layoutValue(gd, units, plan, bonds, model) {
    if (!finale(plan.ps?.m)) return recipe.layoutValue(gd, units, plan, bonds, model);
    // Existing combat aura only. No Mostima donor, Archetto front, White Owl copy or same-row layer rewards.
    const dealers = units.filter(u => !u.heal && u.dps > 0), weight = u => u.dps * (main(gd, u.rec) ? 2 : 1);
    const total = dealers.reduce((s, u) => s + weight(u), 0) || 1;
    let value = 0;
    if (bonds[SKILL]?.active) for (const u of units.filter(u => u.rec.bonds?.includes(SKILL))) {
      for (const v of dealers) {
        const dr = Math.abs(u.r - v.r), dc = Math.abs(u.c - v.c);
        if ((bonds[SKILL].layers || 0) >= 40 ? Math.max(dr, dc) <= 1 : dr + dc <= 1) value += weight(v) / total;
      }
    }
    const ps = plan.ps, m = ps.m;
    // Preserve the retained Quintus combat objective verbatim: elemental cleansing needs real healing coverage.
    if (m.round === m.gd.bossRound && m.bossId === 'boss_4'
      && (m.opts.botLateranoLessons === true || m.opts.botLateranoLessons?.includes?.('quintus'))) {
      for (const u of units.filter(u => u.rec.subProfessionId === 'wandermedic')) {
        const selected = loadoutRecord(u.rec, resolveRecordLoadout(u.rec, ps.loadoutFor(u.rec)));
        const cover = healingTiles(selected, u.r, u.c, u.dir);
        for (const v of units) if (v !== u && acceptsHealing(v.rec) && cover.has(v.key)) {
          value += base(gd, v.rec) === ids.faith ? 1.6 : v.rec.tier >= 5 ? 1.2 : 0.3;
        }
      }
    }
    return value;
  }

  function bossLayoutValue(gd, units, plan, bonds, model) {
    const dealers = units.filter(u => u.ground && !u.heal && u.dps > 0);
    const weight = u => u.dps * (main(gd, u.rec) ? 2 : 1);
    const total = dealers.reduce((s, u) => s + weight(u), 0) || 1;
    const windows = model.bossBodies?.length ? model.bossBodies.map(b => b.tiles)
      : model.routes.filter(r => r.dwell > 0).flatMap(r => r.tiles.map(k => [k]));
    let best = 0;
    for (const tiles of windows) {
      const firing = dealers.filter(u => tiles.some(k => u.cover.has(k)));
      const share = firing.reduce((s, u) => s + weight(u), 0) / total;
      // Score a shared target window, not physical clustering (area attacks still matter in rehearsal).
      let score = share * share * 6;
      for (const u of dealers.filter(u => main(gd, u.rec))) score += firing.includes(u) ? 4 : -12;
      best = Math.max(best, score);
    }
    return best;
  }

  return Object.freeze({ ...recipe, bossFocus: true, safeWithdrawals: allProtectedWithdrawals ? true : (m, ps, p) => main(gdOf(m, ps), p),
    combatRosterOnly: (m) => finale(m),
    combatLayoutOnly: plan => finale(plan.ps?.m),
    keep: (m, ps, rec) => retained(m, ps, rec) || recipe.keep(m, ps, rec),
    preserve: (m, ps, rec) => retained(m, ps, rec) || recipe.preserve(m, ps, rec),
    unitBonus: (m, ps, rec, plan) => finale(m) ? base(gdOf(m, ps), rec) === ids.faith ? 8 : 0 : recipe.unitBonus(m, ps, rec, plan),
    lineupBonus, layoutValue, bossLayoutValue });
}
