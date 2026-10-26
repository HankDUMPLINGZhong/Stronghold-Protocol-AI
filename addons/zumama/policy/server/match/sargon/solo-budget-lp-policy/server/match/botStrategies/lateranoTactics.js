// Optional 25894 lessons, extending the retained recipe rather than replacing either previous object.
// [ASSUMED] Search deadlines, survival thresholds and all weights are policy, not game mechanics.
// Sources: existing Mostima/Faith garrisons, selected loadouts, Quintus kit and acarm059 item.
import { laterano } from './laterano.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../../../../../../shared/loadoutRecord.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';

const { ids, core: CORE } = laterano;
const SALT = 'chess_item_4_10_e_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, rec) => gd.baseIdOf(rec.id ?? rec.chessId);
const owned = (m, ps, id) => ps.allChess().filter((p) => base(gdOf(m, ps), p) === id);
export const lateranoLesson = (m, part) => m?.opts?.botLateranoLessons === true || m?.opts?.botLateranoLessons?.includes?.(part) === true;
const enabled = lateranoLesson;
export const lateranoHealing = (m, ps) => ps._botFocusId === CORE && (enabled(m, 'frontline') || enabled(m, 'formation')
  || quintus(m));
const boss = (m, ps) => m.round >= gdOf(m, ps).bossRound;
const selected = (ps, rec) => loadoutRecord(rec, resolveRecordLoadout(rec, ps.loadoutFor(rec)));
const unfinished = (m, ps, id) => {
  const pieces = owned(m, ps, id), gd = gdOf(m, ps);
  return pieces.length > 0 && !pieces.some((p) => gd.isGolden(p.id));
};
const nativeCount = (m, ps) => new Set(ps.allChess().filter((p) => gdOf(m, ps).chess(p.id).bonds.includes(CORE))
  .map((p) => base(gdOf(m, ps), p))).size;
const available = (m, id) => (m.pool.entries.get(id)?.left || 0) > 0;
const elemental = (rec) => rec.subProfessionId === 'wandermedic';
const isSalt = (gd, rec) => base(gd, rec) === SALT;
const hasSalt = (m, ps) => [...ps.hand, ...ps.temp].some((i) => i?.kind === 'item' && isSalt(gdOf(m, ps), i))
  || ps.allChess().some((p) => p.items?.some((i) => isSalt(gdOf(m, ps), i)));
const hasMedic = (m, ps) => ps.allChess().some((p) => elemental(gdOf(m, ps).chess(p.id)));
const quintus = (m) => enabled(m, 'quintus') && m.bossId === 'boss_4' && m.round <= m.gd.bossRound;

/** Search an acquired core engine at its own tier, including a single copy, with an absolute deadline. */
function levelTarget(m, ps) {
  if (enabled(m, 'promotion') && ps.lp > 8) {
    if (ps.shop.level === 4 && m.round >= 9 && (m.round <= 10 || m.round === 11 && owned(m, ps, ids.mostima).length >= 2) && nativeCount(m, ps) >= 3
      && unfinished(m, ps, ids.mostima) && available(m, ids.mostima)) return 4;
    // One optional late search; release R13 even if the ordinary Executor was only just acquired.
    if (ps.shop.level === 5 && m.round === 12 && nativeCount(m, ps) >= 6
      && owned(m, ps, ids.mostima).some((p) => gdOf(m, ps).isGolden(p.id))
      && (owned(m, ps, ids.archetto).some((p) => gdOf(m, ps).isGolden(p.id)) || owned(m, ps, ids.executorAlter).length >= 2)
      && !owned(m, ps, ids.executorAlter).some((p) => gdOf(m, ps).isGolden(p.id))
      && available(m, ids.executorAlter)) return 5;
  }
  return laterano.levelTarget(m, ps);
}

function criticalBuy(m, ps, rec) {
  const gd = gdOf(m, ps), id = base(gd, rec);
  if (enabled(m, 'promotion') && m.round < 13 && id === ids.mostima && unfinished(m, ps, id)) return true;
  if (quintus(m) && elemental(rec) && !hasMedic(m, ps) && !hasSalt(m, ps)) return true;
  return laterano.criticalBuy(m, ps, rec);
}
const beforeUpgrade = (m, ps) => !ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess'
  && ps.priceOf(s) <= ps.funds && criticalBuy(m, ps, gdOf(m, ps).chess(s.id)));
const priorityLevel = (m, ps) => (m.round > 4 || ps.allChess().length >= ps.deployCap) && ps.shop.level < levelTarget(m, ps);
const spendReserve = (m, ps) => priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice + laterano.upgradeReserve(m, ps)
  ? Math.max(0, ps.shop.upgradePrice) : 0;

/** Faith's real garrison reads ACTIVE bonds only. Do not retain Steadfast's layers after deactivation. */
function faithDefence(gd, rec, bonds) {
  let value = rec.stats.def;
  for (const id of rec.garrisonIds || []) {
    const g = gd.garrison(id);
    if (g?.effectKey !== 'act1autochess_gar_eff_attrByBond' || !(g.bb.def > 0)) continue;
    const layers = (g.bbStr.bond_id || '').split(',').reduce((n, b) => n + (bonds[b]?.active ? bonds[b].layers || 0 : 0), 0);
    value *= 1 + Math.floor(layers / Math.max(1, g.bb.divide_num || 1)) * g.bb.def;
  }
  return value;
}

/** Evaluate the proposed board AFTER removing the partner, not the stronger board it replaces. */
function needsSteadfast(m, ps, pieces, bonds) {
  const gd = gdOf(m, ps), faith = pieces.find((p) => base(gd, p) === ids.faith);
  const core = bonds[CORE];
  const layers = core?.active ? core.layers || 0 : 0;
  const matureSupport = bonds.preciShip?.count >= 3 && bonds.preciShip.layers >= 50
    || bonds.skillfulShip?.active && bonds.skillfulShip.layers >= 60;
  return !(faith && faithDefence(gd, gd.chess(faith.id), bonds) >= 900 || core?.count >= 6 && layers >= 80 && matureSupport);
}

function buyBonus(m, ps, rec, plan, counts) {
  let value = laterano.buyBonus(m, ps, rec, plan, counts);
  const gd = gdOf(m, ps), id = base(gd, rec), fresh = !owned(m, ps, id).length;
  if (enabled(m, 'promotion') && id === ids.mostima && !boss(m, ps)
    && !owned(m, ps, id).some((p) => gd.isGolden(p.id))) value += fresh ? 12 : owned(m, ps, id).length >= 2 ? 32 : 16;
  if (enabled(m, 'formation') && id === ids.astgenne && !boss(m, ps)) value += fresh ? 16 : 0;
  if (enabled(m, 'frontline') && fresh && rec.bonds.includes('steadShip') && rec.tier <= 2
    && (m.round <= 6 || m.round <= 9 && owned(m, ps, ids.faith).length)
    && (counts.get('steadShip') || 0) < 2 && (counts.get(CORE) || 0) < 6) value += 16;
  if (quintus(m) && elemental(rec) && !hasMedic(m, ps)) value += hasSalt(m, ps) ? 10 : 38;
  return value;
}

function unitBonus(m, ps, rec, plan) {
  let value = laterano.unitBonus(m, ps, rec, plan);
  const id = base(gdOf(m, ps), rec);
  if (enabled(m, 'formation') && boss(m, ps)
    && [ids.mostima, ids.archetto, ids.ayerscarpe, ids.ptilopsis4, ids.ptilopsis5, ids.tippi, ids.astgenne].includes(id)) value = 0;
  if (enabled(m, 'formation') && !boss(m, ps) && base(gdOf(m, ps), rec) === ids.astgenne) value += 12;
  if (quintus(m) && boss(m, ps) && elemental(rec)) value += 24;
  return value;
}

function lineupBonus(gd, pieces, bonds, plan) {
  let value = laterano.lineupBonus(gd, pieces, bonds, plan);
  const ps = plan.ps, m = ps?.m;
  if (!m) return value;
  if (enabled(m, 'frontline')) {
    const needed = needsSteadfast(m, ps, pieces, bonds), count = bonds.steadShip?.count || 0;
    if (count >= 2 && needed) value += (bonds[CORE]?.count || 0) < 6 ? 24 : 10;
    // Retire soft retention once the actual replacement board has sufficient bulk or mature damage.
    if (count >= 2 && !needed) value -= (bonds[CORE]?.layers || 0) >= 120 ? 0 : 14;
  }
  if (enabled(m, 'formation') && boss(m, ps) && bonds.preciShip?.count >= 3
    && (bonds.preciShip.layers || 0) >= 30 && plan.route?.support !== 'preciShip') value += 50;
  if (quintus(m) && boss(m, ps)) {
    const medic = pieces.some((p) => elemental(gd.chess(p.id)));
    const protectedCarry = pieces.some((p) => gd.chess(p.id).tier >= 5 && p.items?.some((i) => isSalt(gd, i)));
    if (medic) value += protectedCarry ? 15 : 65;
  }
  return value;
}

function keep(m, ps, rec) {
  if (enabled(m, 'promotion') && base(gdOf(m, ps), rec) === ids.mostima && !boss(m, ps)
    && !owned(m, ps, ids.mostima).some((p) => gdOf(m, ps).isGolden(p.id))) return true;
  return laterano.keep(m, ps, rec);
}
function preserve(m, ps, rec) {
  if (quintus(m) && elemental(rec) && owned(m, ps, base(gdOf(m, ps), rec)).length === 1) return true;
  if (enabled(m, 'frontline') && rec.bonds.includes('steadShip') && !needsSteadfast(m, ps, ps.allChess(), ps.bonds)
    && base(gdOf(m, ps), rec) !== ids.faith) {
    // Keep may still protect an actual pair; this only releases the obsolete frontline-anchor veto.
    return rec.bonds.includes(CORE) && laterano.preserve(m, ps, rec);
  }
  if (enabled(m, 'promotion') && base(gdOf(m, ps), rec) === ids.mostima && !boss(m, ps)
    && unfinished(m, ps, ids.mostima)) return true;
  return laterano.preserve(m, ps, rec);
}

function layoutValue(gd, units, plan, bonds, model) {
  const ps = plan.ps, m = ps?.m;
  if (!enabled(m, 'formation') && !quintus(m)) return laterano.layoutValue(gd, units, plan, bonds, model);
  let value = 0;
  const final = boss(m, ps);
  if (!final || !enabled(m, 'formation')) value = laterano.layoutValue(gd, units, plan, bonds, model);
  // Prep-start traits and battle layer growth are disabled at the boss. Only combat effects count there.
  if (final && enabled(m, 'formation')) for (const u of units) {
    if (base(gd, u.rec) === ids.executorAlter && model?.routes?.length) value -= laterano.executorRisk(units, u, model);
    if (u.rec.bonds?.includes('skillfulShip') && bonds.skillfulShip?.active) for (const v of units) {
      const dr = Math.abs(u.r - v.r), dc = Math.abs(u.c - v.c);
      if ((bonds.skillfulShip.layers >= 40 ? Math.max(dr, dc) <= 1 : dr + dc <= 1)) value += laterano.ammoWeight(v.rec) * 0.15;
    }
  }
  if (!final && enabled(m, 'formation') && model?.routes?.length) {
    const santa = units.find((u) => base(gd, u.rec) === ids.executorAlter);
    if (santa) {
      // Give the acquired engine effective contact; never reward hiding it outside the firing line.
      value += laterano.firingShare(units, santa, model) * 1.5;
      const other = units.filter((u) => u !== santa && !u.heal && u.rec.position === 'RANGED');
      for (const u of other) {
        const shared = [...santa.cover].filter((k) => u.cover.has(k) && model.routes.some((rt) => rt.tiles.includes(k))).length;
        value -= Math.min(0.5, shared * 0.04);
      }
    }
  }
  if (quintus(m) && final) for (const u of units.filter((v) => elemental(v.rec))) {
    const cover = healingTiles(selected(ps, u.rec), u.r, u.c, u.dir);
    for (const v of units) if (v !== u && acceptsHealing(v.rec) && cover.has(v.key)) {
      value += base(gd, v.rec) === ids.faith ? 1.6 : v.rec.tier >= 5 ? 1.2 : 0.3;
    }
  }
  return value;
}

function itemBonus(m, ps, rec) {
  if (quintus(m) && isSalt(gdOf(m, ps), rec) && !hasSalt(m, ps)) return 35;
  return laterano.itemBonus(m, ps, rec);
}
function itemTarget(m, ps, rec, deployed) {
  const gd = gdOf(m, ps);
  if (quintus(m) && isSalt(gd, rec)) return deployed.filter((p) => !p.items?.some((i) => isSalt(gd, i))
    && gd.chess(p.id).attackKind !== 'heal' && (p.items?.length || 0) < gd.equipPerChess)
    .sort((a, b) => gd.chess(b.id).tier - gd.chess(a.id).tier || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid)[0] || null;
  return laterano.itemTarget(m, ps, rec, deployed);
}
function holdItem(m, ps, rec) {
  if (quintus(m) && isSalt(gdOf(m, ps), rec) && !boss(m, ps)) return ![...ps.board.values()]
    .some((p) => p.kind === 'chess' && gdOf(m, ps).chess(p.id).tier >= 5 && (p.items?.length || 0) < gdOf(m, ps).equipPerChess);
  return laterano.holdItem(m, ps, rec);
}

function trainingLineups(m, ps, chosen) {
  if (!enabled(m, 'formation')) return laterano.trainingLineups(m, ps, chosen);
  if (boss(m, ps) || ps.lp < 12) return [];
  // A same-roster, independently planned farming proposal also gets the strict deaths safety gate.
  const same = chosen.some((p) => base(gdOf(m, ps), p) === ids.executorAlter) ? [chosen] : [];
  return [...same, ...laterano.trainingLineups(m, ps, chosen)];
}
function rehearsalValue(m, ps, pp) {
  if (!enabled(m, 'formation')) return laterano.rehearsalValue(m, ps, pp);
  if (boss(m, ps)) return 0;
  const gd = gdOf(m, ps), gain = pp.layerGains || {};
  const lemuen = owned(m, ps, ids.lemuen).some((p) => selected(ps, gd.chess(p.id)).skill?.skillId === 'skchr_lemuen_3');
  return Math.min(50, (gain[CORE] || 0) * (lemuen ? 0.025 : 0.08)
    + (gain.preciShip || 0) * 0.35 + (gain.skillfulShip || 0) * 0.4
    + ((ps.layers.visiShip || 0) < 150 ? (gain.visiShip || 0) * 0.7 : 0));
}

export const lateranoTactics = Object.freeze({ ...laterano, levelTarget, criticalBuy, beforeUpgrade, priorityLevel, spendReserve,
  buyBonus, unitBonus, lineupBonus, keep, preserve, layoutValue, itemBonus, itemTarget, holdItem, trainingLineups, rehearsalValue,
  combatLayoutOnly: (plan) => enabled(plan.ps?.m, 'formation') && boss(plan.ps.m, plan.ps),
  faithDefence, needsSteadfast });
