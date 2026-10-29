// [ASSUMED] Free merge alternatives may bridge the current army without becoming a shop route.
// Only own assets and generated traits are inspected; no future shops, teammate armies or real outcomes.
import { computeBonds, pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { layerForecast } from '../botStrategy.js';

const CORE = 'lateranoShip', PREC = 'preciShip', SKILL = 'skillfulShip', VISION = 'visiShip';
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.round < m.gd.bossRound
  && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id || p.chessId);
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const tank = r => r.profession === 'TANK' && r.stats.blockCnt > 0;
const heal = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic', 'wandermedic'].includes(r.subProfessionId);
const count = (ps, own, bond) => new Set(own.filter(p => pieceBonds(ps.gd, p).includes(bond)).map(p => base(ps, p))).size;
const eligible = (m, ps) => scope(m, ps) && ps.offers[0]?.source === 'merge';

/** Long-term targets keep their inherited order; a spare tag alone is not a required engine. */
export function bridgeRewardNeeded(m, ps, rec, recipe) {
  const id = base(ps, rec), own = ps.allChess(), same = own.filter(p => base(ps, p) === id);
  if (same.some(p => ps.gd.isGolden(p.id))) return false;
  if (rec.bonds.includes(CORE)) return true;
  if ((recipe.rewardAllowed || recipe.rewardScoreAllowed || recipe.purchaseAllowed)?.(m, ps, rec) === false) return false;
  const keys = [recipe.ids.titi, recipe.ids.ptilopsis4, recipe.ids.ptilopsis5];
  if (ps._botRoute?.support === SKILL) keys.push(recipe.ids.astgenne);
  if (ps._botRoute?.support === PREC) keys.push(recipe.ids.leonhardt, recipe.ids.kroosAlter);
  if (keys.includes(id)) return true;
  if (same.filter(p => !ps.gd.isGolden(p.id)).length >= 2 && rec.bonds.some(b => [PREC, SKILL, VISION].includes(b))) return true;
  if (rec.bonds.includes(SKILL) && own.some(p => base(ps, p) === recipe.ids.archetto) && count(ps, own, SKILL) < 2) return true;
  return rec.bonds.includes(VISION) && own.some(p => base(ps, p) === recipe.ids.executorAlter) && count(ps, own, VISION) < 2;
}

function combatValue(r) {
  const s = r.stats, bb = r.skill?.bb || {};
  if (!s) return 0;
  const damage = ['heal', 'none'].includes(r.attackKind) ? 0 : s.atk * (s.aspd || 100) / 100 / Math.max(.4, s.bat || 1)
    * (1 + Math.min(1, Math.max(0, bb.atk || 0) * .4 + Math.max(0, (bb.atk_scale || 1) - 1) * .15));
  const targets = r.subProfessionId === 'centurion' ? Math.min(3, s.blockCnt) : 1;
  return damage * targets / 40 + (tank(r) ? (s.maxHp + s.def * 5) / 400 : Math.min(5, (s.maxHp + s.def * 3) / 700))
    + (heal(r) ? 10 + s.atk / 100 : 0);
}

/** Actual bond counting includes bench Foresight; battle members and tier breakpoints remain distinct. */
function armyValue(m, ps, lineup) {
  const own = ps.allChess(), chosen = new Set(lineup.map(p => p.uid));
  const bonds = computeBonds(ps.gd, { ...ps, board: new Map(lineup.map((p, i) => [String(i), p])),
    hand: own.filter(p => !chosen.has(p.uid)), temp: [] });
  let combat = lineup.reduce((n, p) => n + combatValue(ps.gd.chess(p.id)), 0), growth = 0;
  for (const [id, b] of Object.entries(bonds)) {
    if (!b.active) continue;
    const relevant = [CORE, PREC, SKILL, VISION, 'steadShip'].includes(id);
    combat += (relevant ? 8 : 3) + Math.min(12, Math.sqrt(b.layers || 0));
    if (id === 'steadShip' && b.count >= 3 || id === PREC && b.count >= 3) combat += 15;
    if (id === CORE && b.count >= 6) combat += 50;
  }
  for (const p of lineup) for (const [id, gain] of layerForecast(ps.gd, ps.gd.chess(p.id), CORE, ps.shop.level)) {
    if (bonds[id]?.active) growth += Math.min(8, gain) * ([CORE, PREC, SKILL, VISION, 'steadShip'].includes(id) ? .6 : .1);
  }
  return { value: combat + Math.min(20, growth), combat, growth, bonds };
}

function safeSwap(ps, before, after, recipe) {
  const b = armyValue(ps.m, ps, before).bonds, a = armyValue(ps.m, ps, after).bonds;
  if ((a[CORE]?.count || 0) < Math.min(6, b[CORE]?.count || 0)) return false;
  for (const bond of [PREC, SKILL]) if (b[bond]?.active && (ps.layers[bond] || 0) >= 40
    && (a[bond]?.count || 0) < Math.min(bond === PREC ? 3 : 2, b[bond].count)) return false;
  const rec = p => ps.gd.chess(p.id);
  if (before.some(p => tank(rec(p))) && !after.some(p => tank(rec(p)))) return false;
  if (before.some(p => heal(rec(p))) && !after.some(p => heal(rec(p)))) return false;
  if (ps.allChess().some(p => base(ps, p) === recipe.ids.executorAlter) && b[VISION]?.active && !a[VISION]?.active) return false;
  const locked = [recipe.ids.mostima, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  return !before.some(p => !after.includes(p) && (locked.includes(base(ps, p)) || p.items?.length || owners.has(p.uid)));
}

/** One legal roster substitution, bounded by deploy cap; no combinatorial or battle search during selection. */
export function bridgeRewardValue(m, ps, rec, recipe, chosen = field(ps), delta = (a, b) => a.value - b.value) {
  const own = ps.allChess(), id = base(ps, rec);
  if (own.some(p => base(ps, p) === id && ps.gd.isGolden(p.id))) return { value: -1000, lineup: null };
  const extra = { kind: 'chess', uid: -1, id: rec.chessId, items: [] };
  const baseline = armyValue(m, ps, chosen);
  const options = chosen.length < ps.deployCap ? [[...chosen, extra]] : chosen.map(p => chosen.map(q => q === p ? extra : q));
  let best = { value: -100, lineup: null };
  for (const lineup of options) {
    if (!safeSwap(ps, chosen, lineup, recipe)) continue;
    const score = armyValue(m, ps, lineup), value = delta(score, baseline);
    if (value > best.value) best = { value, combat: score.combat - baseline.combat, growth: score.growth - baseline.growth,
      lineup, bonds: score.bonds };
  }
  return best;
}

export function withCoopRewardBridge(parent, { rewardValue = bridgeRewardValue, rewardNeeded = bridgeRewardNeeded,
  retain = () => false, factor = 'reward-bridge' } = {}) {
  // Retained selectors predate afterReward; adapt the real acquisition API, without changing its result.
  const installPick = (m, ps) => {
    if (ps._botCoopBridgePickInstalled) return;
    ps._botCoopBridgePickInstalled = true;
    const pick = ps.pickReward;
    ps.pickReward = function(index) {
      const offer = ps.offers[0], slot = offer?.slots[index];
      const before = new Set(ps.allChess().map(p => p.uid));
      const detail = eligible(m, ps) && slot?.kind === 'chess' ? {
        needed: rewardNeeded(m, ps, ps.gd.chess(slot.id), parent),
        options: offer.slots.filter(s => s.kind === 'chess').map(s => {
          const rec = ps.gd.chess(s.id), value = rewardValue(m, ps, rec, parent);
          return { id: s.id, needed: rewardNeeded(m, ps, rec, parent), value: value.value,
            combat: value.combat ?? null, growth: value.growth ?? null,
            ...(value.breakpoints ? { breakpoints: value.breakpoints } : {}) };
        }),
      } : null;
      const result = pick.call(ps, index);
      if (result?.ok && slot) out.afterReward(m, ps, slot, before, offer, detail);
      return result;
    };
  };
  const leases = ps => ps._botCoopRewardBridges || [];
  const current = (m, ps, p) => scope(m, ps) && leases(ps).some(l => l.uid === p.uid && m.round <= l.round + 2)
    && (field(ps).includes(p) || retain(m, ps, p, parent) || rewardValue(m, ps, ps.gd.chess(p.id), parent).value > 0);
  const matching = (m, ps, rec) => ps.allChess().some(p => p.id === rec.chessId && current(m, ps, p));
  const out = { ...parent,
    rewardScoreAllowed(m, ps, rec) {
      return eligible(m, ps) || (parent.rewardScoreAllowed || parent.purchaseAllowed)?.(m, ps, rec) !== false;
    },
    rewardPriority(m, ps, slot) {
      const old = parent.rewardPriority?.(m, ps, slot) || 0;
      if (!eligible(m, ps) || slot.kind !== 'chess') return old;
      installPick(m, ps);
      const options = ps.offers[0].slots.filter(s => s.kind === 'chess' && !s.sold);
      const needed = options.some(s => rewardNeeded(m, ps, ps.gd.chess(s.id), parent));
      if (needed) return old + (rewardNeeded(m, ps, ps.gd.chess(slot.id), parent) ? 100000 : 0);
      return rewardValue(m, ps, ps.gd.chess(slot.id), parent).value;
    },
    afterReward(m, ps, slot, before, offer, detail = null) {
      ps._botCoopBridgeSeenOffers ||= new WeakSet();
      if (ps._botCoopBridgeSeenOffers.has(offer)) return;
      ps._botCoopBridgeSeenOffers.add(offer);
      parent.afterReward?.(m, ps, slot, before, offer);
      if (!scope(m, ps) || offer?.source !== 'merge' || slot.kind !== 'chess') return;
      const rec = ps.gd.chess(slot.id), needed = detail?.needed ?? rewardNeeded(m, ps, rec, parent);
      const pieces = ps.allChess().filter(p => !before.has(p.uid));
      if (!needed) for (const p of pieces) (ps._botCoopRewardBridges ||= []).push({ uid: p.uid, id: p.id, round: m.round });
      (ps._botCoopFactorHistory ||= []).push({ factor, action: 'reward', round: m.round,
        chosen: slot.id, needed, options: detail?.options || offer.slots.filter(s => s.kind === 'chess').map(s => ({ id: s.id })) });
    },
    keep: (m, ps, r, ...xs) => matching(m, ps, r) || parent.keep(m, ps, r, ...xs),
    preserve: (m, ps, r, ...xs) => matching(m, ps, r) || parent.preserve(m, ps, r, ...xs),
    cleanupAcquisitions(m, ps, ...xs) {
      if (!scope(m, ps)) return parent.cleanupAcquisitions?.(m, ps, ...xs);
      const sell = ps.sell;
      ps.sell = function(uid, ...args) {
        const p = ps.find(uid)?.piece;
        return p && current(m, ps, p) ? { ok: false } : sell.call(ps, uid, ...args);
      };
      try { return parent.cleanupAcquisitions?.(m, ps, ...xs); } finally { ps.sell = sell; }
    },
    combatLineups(m, ps, chosen) {
      const inherited = parent.combatLineups?.(m, ps, chosen) || [];
      if (!scope(m, ps)) return inherited;
      const alternatives = [];
      for (const p of ps.allChess().filter(p => !chosen.includes(p) && current(m, ps, p))) {
        const best = rewardValue(m, ps, ps.gd.chess(p.id), parent, chosen);
        if (best.value > 0 && best.lineup) alternatives.push({ value: best.value, lineup: best.lineup.map(q => q.uid === -1 ? p : q) });
      }
      alternatives.sort((a, b) => b.value - a.value);
      return [...inherited, ...alternatives.slice(0, 2).map(a => a.lineup)];
    },
  };
  return Object.freeze(out);
}
