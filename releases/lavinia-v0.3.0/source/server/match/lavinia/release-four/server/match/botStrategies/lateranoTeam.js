// [ASSUMED] Final-assault support is valued by the damage it keeps alive; acquisition is inherited verbatim.
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';

export function withLateranoTeam(recipe, { roster = false } = {}) {
  const main = (gd, rec) => [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(gd.baseIdOf(rec.chessId || rec.id));
  const final = ps => ps.m.round >= ps.m.gd.bossRound;
  function bossLayoutValue(gd, units, plan, bonds, model) {
    const dealers = units.filter(u => !u.heal && u.dps > 0);
    const weight = u => u.dps * (main(gd, u.rec) ? 3 : 1);
    const total = dealers.reduce((n, u) => n + weight(u), 0) || 1;
    const healers = units.map(u => {
      const rec = loadoutRecord(u.rec, resolveRecordLoadout(u.rec, plan.ps.loadoutFor(u.rec)));
      return { u, cover: healingTiles(rec, u.r, u.c, u.dir) };
    }).filter(h => h.cover.size);
    let value = recipe.bossLayoutValue(gd, units, plan, bonds, model);
    // A dead healer cannot sustain a dealer. Value reciprocal coverage, with diminishing returns for overlap.
    for (const u of units) if (acceptsHealing(u.rec)) {
      const n = healers.filter(h => h.u !== u && h.cover.has(u.key)).length;
      const covered = Math.min(1.5, n);
      value += covered * (u.heal ? 1.5 : 8 * weight(u) / total);
      if (main(gd, u.rec) && healers.length && !n) value -= 4;
    }
    return value;
  }
  function lineupBonus(gd, pieces, bonds, plan) {
    let value = recipe.lineupBonus(gd, pieces, bonds, plan);
    if (!roster || !final(plan.ps)) return value;
    // Elemental medicine has a second role; its small direct healing does not replace a full medic's throughput.
    const healing = pieces.reduce((sum, p) => {
      const rec = gd.chess(p.id);
      if (rec?.dmgType !== 'heal' && rec?.attackKind !== 'heal') return sum;
      return sum + (rec.subProfessionId === 'wandermedic' ? 0.5 : 1);
    }, 0);
    return value + Math.min(1.5, healing) * 24;
  }
  return Object.freeze({ ...recipe, bossLayoutValue, lineupBonus,
    // Coverage is mandatory for the main carries. Spare helpers must not displace their treatment for one more shot.
    bossCoverageRequired: (gd, u) => main(gd, u.rec) });
}
