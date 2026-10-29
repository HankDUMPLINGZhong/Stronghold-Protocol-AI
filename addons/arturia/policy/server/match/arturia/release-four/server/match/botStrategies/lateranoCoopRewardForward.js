// [ASSUMED] Reserve an early first Skillful/Foresight helper before its native engine arrives.
// Free merge selection only; paid permissions, upgrade gates and combat candidates stay inherited.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { breakpointRewardNeeded, breakpointRewardValue, withCoopRewardBreakpoints } from './lateranoCoopRewardBreakpoints.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip', VISION = 'visiShip';
const IMMEDIATE = [CORE, 'preciShip', SKILL, VISION, 'steadShip'];
const base = (ps, p) => ps.gd.baseIdOf(p.chessId ?? p.id);
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && m.round < m.gd.bossRound
  && ps.bandId === 'band_paganini' && ps._botFocusId === CORE && ps.offers[0]?.source === 'merge';

/** One distinct reserve per role, not another copy or an unbounded support collection. */
export function forwardSupportBonds(m, ps, rec, recipe) {
  if (!scoped(m, ps) || m.round > 8 || !rec || rec.bonds.includes(CORE)) return [];
  const own = ps.allChess(), id = base(ps, rec);
  if (own.some(p => base(ps, p) === id)) return [];
  const result = [];
  const has = bond => rec.bonds.includes(bond) && !ps.gd.modeInactiveBonds.has(bond);
  if (has(SKILL) && !own.some(p => base(ps, p) !== recipe.ids.archetto && pieceBonds(ps.gd, p).includes(SKILL))) result.push(SKILL);
  if (has(VISION) && !own.some(p => base(ps, p) !== recipe.ids.executorAlter && pieceBonds(ps.gd, p).includes(VISION))) result.push(VISION);
  return result;
}

/** Read generated deterministic SERVER_GAIN coins, without firing hooks or counting a sale twice. */
export function rewardGainFunds(ps, rec) {
  return (rec?.garrisonIds || []).reduce((n, id) => {
    const g = ps.gd.garrison(id);
    if (g?.eventType !== 'SERVER_GAIN' || g.effectType !== 'SERVER_GAIN_EQUIP') return n;
    const item = ps.gd.item(g.bbStr?.chess);
    const buff = item?.buffs?.find(b => b.key === 'equip_destory_gain_random_coin');
    const bb = buff?.bb;
    return n + (bb && bb.min === bb.max && Number.isFinite(bb.min) ? Math.max(0, bb.min) * Math.max(0, g.bb?.count || 0) : 0);
  }, 0);
}

export function withCoopRewardForwardSupport(parent) {
  const retained = withCoopRewardBreakpoints(parent);
  const details = (m, ps) => {
    const slots = ps.offers[0].slots.filter(s => s.kind === 'chess' && !s.sold);
    const rows = slots.map(slot => {
      const rec = ps.gd.chess(slot.id), value = breakpointRewardValue(m, ps, rec, parent);
      const duplicateElite = ps.allChess().some(p => base(ps, p) === base(ps, rec) && ps.gd.isGolden(p.id));
      return { id: slot.id, inheritedPriority: retained.rewardPriority(m, ps, slot),
        needed: breakpointRewardNeeded(m, ps, rec, parent), forwardBonds: forwardSupportBonds(m, ps, rec, parent),
        immediate: (value.breakpoints || []).some(b => b.placement === 'board' && b.tiers > 0 && IMMEDIATE.includes(b.id)),
        gainFunds: duplicateElite ? 0 : rewardGainFunds(ps, rec) };
    });
    const needed = rows.some(r => r.needed), immediate = rows.some(r => r.immediate);
    return rows.map(r => ({ ...r,
      // [ASSUMED] The existing required-target bucket is100000; a first future helper sits below it.
      priority: r.inheritedPriority + (!needed && !immediate && r.forwardBonds.length ? 10000 : 0)
        + (!needed ? r.gainFunds * 8 : 0),
    }));
  };
  const install = (m, ps) => {
    if (ps._botCoopForwardRewardObserver) return;
    ps._botCoopForwardRewardObserver = true;
    const pick = ps.pickReward;
    ps.pickReward = function(index) {
      const slot = ps.offers[0]?.slots[index], rows = scoped(m, ps) && slot?.kind === 'chess' ? details(m, ps) : null;
      const result = pick.call(ps, index);
      if (result?.ok && rows) (ps._botCoopFactorHistory ||= []).push({ factor: 'reward-forward-support', action: 'reward',
        round: m.round, chosen: slot.id, options: rows });
      return result;
    };
  };
  return Object.freeze({ ...retained,
    rewardPriority(m, ps, slot) {
      const old = retained.rewardPriority(m, ps, slot);
      if (!scoped(m, ps) || slot.kind !== 'chess') return old;
      install(m, ps);
      return details(m, ps).find(r => r.id === slot.id)?.priority ?? old;
    },
  });
}
