// [ASSUMED] A free reward that completes a real eight-slot six Laterano / three Precision / two Skillful
// army with treatment and a tank takes priority over a card that cannot. No unseen cards or rewards are added.
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';
import { isFormationAnchor } from '../botPositioning.js';

const CORE = 'lateranoShip', PRECI = 'preciShip', SKILL = 'skillfulShip';
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);

/** Bounded role-state search; each base contributes at most one real variant. Returns an actual roster witness.
 * Counts are capped at the required breakpoints. No battlefield, money or RNG is touched.
 */
export function lateranoRewardPackage(m, ps, recipe, candidate = null) {
  const gd = ps.gd || m.gd;
  if ([CORE, PRECI, SKILL].some(b => gd.modeInactiveBonds.has(b))) return null;
  const owned = ps.allChess(), all = owned.slice();
  if (candidate) {
    const id = candidate.chessId || candidate.id;
    if (!id || owned.some(p => base(gd, p) === base(gd, candidate) && gd.isGolden(p.id))) return null;
    all.push({ kind: 'chess', uid: -1, id, items: [] });
  }
  const mains = [recipe.ids.exusiaiAlter, recipe.ids.lemuen];
  const required = all.reduce((mask, p) => mask | (mains.includes(base(gd, p)) ? 1 << mains.indexOf(base(gd, p)) : 0), 0);
  const goal = Math.max(0, 6 - (ps.bondCountBonus?.[CORE] || 0)), cap = ps.deployCap;
  const groups = new Map();
  for (const p of all) {
    const rec = gd.chess(p.id), bonds = pieceBonds(gd, p), id = base(gd, p);
    const flags = [Number(bonds.includes(CORE)), Number(bonds.includes(PRECI)), Number(bonds.includes(SKILL)),
      Number(rec.attackKind === 'heal' || rec.dmgType === 'heal' || ['guardian', 'incantationmedic'].includes(rec.subProfessionId) || id === recipe.ids.titi),
      Number(isFormationAnchor(rec)), mains.includes(id) ? 1 << mains.indexOf(id) : 0];
    const group = groups.get(id) || [];
    if (!group.some(q => q.flags.join() === flags.join())) group.push({ p, flags });
    groups.set(id, group);
  }
  const list = [...groups.values()].sort((a, b) => b[0].flags[0] - a[0].flags[0] || b[0].flags[5] - a[0].flags[5]
    || (base(gd, a[0].p) < base(gd, b[0].p) ? -1 : 1));
  const suffix = Array.from({ length: list.length + 1 }, () => [0, 0, 0]);
  for (let i = list.length - 1; i >= 0; i--) for (let k = 0; k < 3; k++) suffix[i][k] = suffix[i + 1][k] + Number(list[i].some(q => q.flags[k]));
  if (suffix[0][0] < goal || suffix[0][1] < 3 || suffix[0][2] < 2) return null;
  let states = [{ n: 0, c: 0, p: 0, s: 0, h: 0, t: 0, main: 0, lineup: [] }];
  for (let i = 0; i < list.length; i++) {
    const next = new Map();
    for (const old of states) for (const unit of [null, ...list[i]]) {
      if (unit && old.n >= cap) continue;
      const f = unit?.flags || [0, 0, 0, 0, 0, 0];
      const st = { n: old.n + Number(!!unit), c: Math.min(goal, old.c + f[0]), p: Math.min(3, old.p + f[1]),
        s: Math.min(2, old.s + f[2]), h: old.h | f[3], t: old.t | f[4], main: old.main | f[5],
        lineup: unit ? [...old.lineup, unit.p] : old.lineup };
      if (st.n + goal - st.c > cap || st.c + suffix[i + 1][0] < goal || st.p + suffix[i + 1][1] < 3 || st.s + suffix[i + 1][2] < 2) continue;
      if (st.c === goal && st.p === 3 && st.s === 2 && st.h && st.t && st.main === required) {
        const selected = new Set(st.lineup.map(p => p.uid));
        const bonds = computeBonds(gd, { ...ps, board: new Map(st.lineup.map(p => [p.uid, p])), hand: all.filter(p => !selected.has(p.uid)) });
        if (bonds[CORE]?.count >= 6 && bonds[PRECI]?.count >= 3 && bonds[SKILL]?.active) return st.lineup;
      }
      const key = [st.n, st.c, st.p, st.s, st.h, st.t, st.main].join(':');
      if (!next.has(key)) next.set(key, st);
    }
    states = [...next.values()];
  }
  return null;
}

export function withLateranoRewardPackage(recipe) {
  return Object.freeze({ ...recipe,
    rewardPriority(m, ps, slot) {
      const inherited = recipe.rewardPriority?.(m, ps, slot) || 0, offer = ps.offers[0];
      if (!offer || m.round > m.gd.bossRound || slot.kind !== 'chess') return inherited;
      const signature = ps.allChess().map(p => `${p.uid}:${p.id}:${p.items?.map(i => i.id).join(',') || ''}`).join('|');
      let cache = ps._botRewardPackageCache;
      if (cache?.offer !== offer || cache.signature !== signature) {
        const start = performance.now(), before = lateranoRewardPackage(m, ps, recipe), options = [];
        for (const s of offer.slots) {
          const rec = s.kind === 'chess' && !s.sold && ps.gd.chess(s.id);
          const allowed = !!rec && (recipe.rewardAllowed || recipe.rewardScoreAllowed || recipe.purchaseAllowed)?.(m, ps, rec) !== false;
          const witness = !before && allowed ? lateranoRewardPackage(m, ps, recipe, rec) : null;
          options.push({ id: s.id, allowed, priority: Number(!!witness), lineup: witness?.map(p => p.id) || [] });
        }
        cache = ps._botRewardPackageCache = { offer, signature, options };
        if (options.some(o => o.priority)) (ps._botRewardPackageHistory ||= []).push({ round: m.round, options, ms: performance.now() - start });
      }
      return inherited + (cache.options.find(o => o.id === slot.id)?.priority || 0);
    },
  });
}
