// [ASSUMED] R14 free merges value deployable own combat portfolios, never future draws or layer growth.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { resolveProfile } from '../../../../../../../../../../sim/professions.js';

const CORE = 'lateranoShip', PREC = 'preciShip', SKILL = 'skillfulShip';
const base = (ps, p) => ps.gd.baseIdOf(p.id || p.chessId);
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && m.round === m.gd.bossRound
  && ps.bandId === 'band_paganini' && ps._botFocusId === CORE && ps.offers[0]?.source === 'merge';
const heals = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tanks = r => r.profession === 'TANK' && (r.stats?.blockCnt || 0) > 0;
// [ASSUMED] A static single-target proxy, not a battle prediction. Reuse profession hit counts,
// and amortize an explicitly described repeated-slash burst over its charge/animation cycle.
// Unknown skill mechanisms retain the old approximation; no card IDs or observed outcomes enter it.
export function finalRewardCombatPower(r) {
  if (!r || ['heal', 'none'].includes(r.attackKind)) return 0;
  const bb = r.skill?.bb || {}, s = r.stats;
  const profile = resolveProfile({ ...r, subProf: r.subProfessionId, traitBb: r.trait?.bb || {} });
  const hits = (profile.hits || 1) * (profile.hitDmgMul ?? 1);
  const normal = s.atk * (s.aspd || 100) / 100 / Math.max(.4, s.bat || 1) * hits;
  const skill = 1 + Math.min(1.5, Math.max(0, bb.atk || 0) * .5 + Math.max(0, (bb.atk_scale || 1) - 1) * .2);
  const repeats = Number(r.skill?.desc?.match(/总计(\d+)次斩击/)?.[1] || 0);
  let burst = 0;
  if (repeats > 0 && bb.d_atk_scale > 0 && bb.d_hit_interval > 0 && r.skill.spType === 'INCREASE_WITH_TIME') {
    const duration = Math.max(r.skill.duration || 0, repeats * bb.d_hit_interval);
    const cycle = Math.max(1, r.skill.spCost / Math.max(.1, s.spRecovery || 1) + duration);
    // Slashes replace normal attacks while channeling; do not count both during that interval.
    burst = Math.max(0, s.atk * (repeats * bb.d_atk_scale + (bb.e_atk_scale_end || 0)) - normal * duration) / cycle;
  }
  return normal * skill + burst
    + (r.profession === 'WARRIOR' ? Math.min(3, s.blockCnt) * 65 : 0)
    + (tanks(r) ? Math.min(300, s.def * .25 + s.maxHp * .025) : 0);
}

/** Distinct-base portfolios, bounded beam; preserve acquired main carries and prioritize six natives. */
export function finalRewardPortfolio(ps, owned, recipe) {
  const gd = ps.gd, main = new Set([recipe.ids.archetto, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen]);
  const groups = new Map();
  for (const p of owned) {
    const id = base(ps, p), list = groups.get(id) || [];
    list.push(p); groups.set(id, list);
  }
  const cap = ps.deployCap, bonus = ps.bondCountBonus || {}, enabled = id => !gd.modeInactiveBonds.has(id);
  const score = s => s.power + (enabled(CORE) ? Math.min(6, s.core + (bonus[CORE] || 0)) * 150 : 0)
    + (enabled(PREC) && s.prec + (bonus[PREC] || 0) >= 3 ? 25 + Math.min(25, Math.sqrt(ps.layers[PREC] || 0)) : 0)
    + (enabled(SKILL) && s.skill + (bonus[SKILL] || 0) >= 2 ? 20 + Math.min(25, Math.sqrt(ps.layers[SKILL] || 0)) : 0)
    + Number(s.tank) * 35 + Number(s.heal) * 45;
  let beam = [{ n: 0, core: 0, prec: 0, skill: 0, tank: false, heal: false, power: 0, roster: [] }];
  // Required groups first: a bounded beam must not fill every slot before a later main carry is processed.
  for (const [id, pieces] of [...groups].sort((a, b) => Number(main.has(b[0])) - Number(main.has(a[0])))) {
    const options = pieces.map(p => {
      const r = gd.chess(p.id), bonds = pieceBonds(gd, p);
      return { p, r, bonds, power: finalRewardCombatPower(r) / 35 + (main.has(id) ? 35 : 0) };
    }).sort((a, b) => b.power - a.power || a.p.uid - b.p.uid);
    // Item-bearing alternatives may have different tags; keep both when present.
    const variants = options.filter((o, i) => i === 0 || o.bonds.join() !== options[0].bonds.join()).slice(0, 2);
    const next = new Map();
    for (const s of beam) {
      const choices = [...(!main.has(id) ? [s] : []), ...variants.filter(() => s.n < cap).map(o => ({
        n: s.n + 1, core: Math.min(6, s.core + Number(o.bonds.includes(CORE))),
        prec: Math.min(3, s.prec + Number(o.bonds.includes(PREC))), skill: Math.min(2, s.skill + Number(o.bonds.includes(SKILL))),
        tank: s.tank || tanks(o.r), heal: s.heal || heals(o.r), power: s.power + o.power, roster: [...s.roster, o.p],
      }))];
      for (const v of choices) {
        const k = [v.n, v.core, v.prec, v.skill, Number(v.tank), Number(v.heal)].join(',');
        if (!next.has(k) || next.get(k).power < v.power) next.set(k, v);
      }
    }
    beam = [...next.values()].sort((a, b) => score(b) - score(a)).slice(0, 256);
  }
  const best = beam.sort((a, b) => score(b) - score(a))[0];
  return best ? { value: score(best), core: best.core + (bonus[CORE] || 0), roster: best.roster } : { value: -1e6, core: 0, roster: [] };
}

/** Account for an immediate third-copy merge; a second copy has only a small remaining-shop option value. */
export function finalMergeRewardValues(m, ps, recipe) {
  const own = ps.allChess(), baseline = finalRewardPortfolio(ps, own, recipe), values = [];
  for (const slot of ps.offers[0].slots.filter(s => s.kind === 'chess' && !s.sold)) {
    const rec = ps.gd.chess(slot.id), id = base(ps, rec), same = own.filter(p => base(ps, p) === id);
    if (same.some(p => ps.gd.isGolden(p.id))) { values.push({ id: slot.id, value: -10000, duplicateElite: true }); continue; }
    let future = [...own, { uid: -1, kind: 'chess', id: slot.id, items: [] }];
    if (same.filter(p => !ps.gd.isGolden(p.id)).length >= 2) {
      const consumed = new Set(same.filter(p => !ps.gd.isGolden(p.id)).slice(0, 2).map(p => p.uid));
      future = [...own.filter(p => !consumed.has(p.uid)), { uid: -1, kind: 'chess', id: ps.gd.goldenIdOf(slot.id), items: [] }];
    }
    const best = finalRewardPortfolio(ps, future, recipe), main = [recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto].includes(id);
    const value = best.value - baseline.value + (same.length && main ? 2 : 0) + Math.max(0, finalRewardCombatPower(rec)) * 1e-6;
    values.push({ id: slot.id, value, beforeCore: baseline.core, afterCore: best.core,
      roster: best.roster.map(p => ({ uid: p.uid, id: p.id })) });
  }
  return values;
}

export function withCoopFinalMergeRewards(parent) {
  const cache = new WeakMap();
  const evaluate = (m, ps) => {
    const offer = ps.offers[0], stamp = JSON.stringify([ps.allChess().map(p => [p.uid, p.id, p.items]), ps.deployCap, ps.layers]);
    let row = cache.get(ps);
    if (!row || row.offer !== offer || row.stamp !== stamp) {
      row = { offer, stamp, values: finalMergeRewardValues(m, ps, parent) }; cache.set(ps, row);
    }
    return row.values;
  };
  const install = (m, ps) => {
    if (ps._botCoopFinalRewardObserver) return;
    ps._botCoopFinalRewardObserver = true;
    const pick = ps.pickReward;
    ps.pickReward = function(index) {
      const offer = ps.offers[0], slot = offer?.slots[index], detail = scoped(m, ps) && slot?.kind === 'chess' ? evaluate(m, ps) : null;
      const result = pick.call(ps, index);
      if (result?.ok && detail) (ps._botCoopFactorHistory ||= []).push({ factor: 'final-merge-rewards', action: 'reward', round: m.round, chosen: slot.id, options: detail });
      return result;
    };
  };
  return Object.freeze({ ...parent,
    rewardScoreAllowed: (m, ps, rec) => scoped(m, ps) || (parent.rewardScoreAllowed || parent.purchaseAllowed)?.(m, ps, rec) !== false,
    rewardPriority(m, ps, slot) {
      if (!scoped(m, ps) || slot.kind !== 'chess') return parent.rewardPriority?.(m, ps, slot) || 0;
      install(m, ps); return evaluate(m, ps).find(v => v.id === slot.id)?.value ?? -1e6;
    },
  });
}
