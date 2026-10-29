// [ASSUMED] Bounded tier-four development on the medic/single-bridge/early-four candidate.
// Only owned pieces, route, round and LP are inspected; no battle result or future shop is queried.
const gdOf = (m, ps) => ps.gd || m.gd;

export function lateranoFourDevelopment(m, ps, ids, releaseRound = 12) {
  const gd = gdOf(m, ps), all = ps.allChess();
  const own = id => all.filter(p => gd.baseIdOf(p.id) === id);
  const missing = [];
  if (!own(ids.mostima).length) missing.push(ids.mostima);
  if (![ids.ptilopsis4, ids.ptilopsis5].some(id => own(id).length)) missing.push(ids.ptilopsis4);
  if (ps._botRoute?.support === 'preciShip') {
    const partners = [ids.leonhardt, ids.kroosAlter];
    // Acquired Lemuen/Titi each replace one four-tier helper alongside the native Executor.
    const mature = [ids.lemuen, ids.titi].filter(id => own(id).length).length;
    if (partners.filter(id => own(id).length).length < Math.max(0, 2 - mature)) {
      for (const id of partners) if (!own(id).length) missing.push(id);
    }
  }
  const mostima = own(ids.mostima);
  const pair = mostima.filter(p => !gd.isGolden(p.id)).length >= 2 && !mostima.some(p => gd.isGolden(p.id));
  const window = ps.shop.level === 4 && m.round >= 10 && m.round < releaseRound && ps.lp > 8;
  return { window, missing, pair, hold: window && (missing.length > 0 || pair) };
}

export function withLateranoFourDevelopment(recipe, { releaseRound = 12 } = {}) {
  const state = (m, ps) => lateranoFourDevelopment(m, ps, recipe.ids, releaseRound);
  const latePrecision = rec => rec.tier >= 6 && rec.bonds.includes('preciShip') && !rec.bonds.includes('lateranoShip');
  const completeWithoutWhite = (m, ps) => {
    const gd = gdOf(m, ps), owned = new Set(ps.allChess().map(p => gd.baseIdOf(p.id)));
    return [recipe.ids.executor, recipe.ids.lemuen, recipe.ids.titi].every(id => owned.has(id))
      && ![recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].some(id => owned.has(id));
  };
  const reserve = (m, ps, rec) => {
    if (m.round > m.gd.bossRound || !latePrecision(rec)) return false;
    const gd = gdOf(m, ps), id = gd.baseIdOf(rec.chessId || rec.id);
    const copies = ps.allChess().filter(p => gd.baseIdOf(p.id) === id);
    return rec.isGolden || !copies.some(p => gd.isGolden(p.id)) && copies.length <= 2;
  };
  const required = (m, ps, rec) => {
    const s = state(m, ps);
    if (!s.window) return false;
    const id = gdOf(m, ps).baseIdOf(rec.chessId || rec.id);
    return s.missing.includes(id) || s.pair && id === recipe.ids.mostima;
  };
  return Object.freeze({ ...recipe,
    keep: (m, ps, rec) => reserve(m, ps, rec) || recipe.keep(m, ps, rec),
    preserve: (m, ps, rec) => reserve(m, ps, rec) || recipe.preserve(m, ps, rec),
    unitBonus(m, ps, rec, plan) {
      const value = recipe.unitBonus(m, ps, rec, plan);
      if (m.round < m.gd.bossRound || ps._botRoute?.support !== 'preciShip'
        || !ps.allChess().some(p => latePrecision(gdOf(m, ps).chess(p.id)))) return value;
      // Executor/Lemuen/Titi already make three: preserve a missing medic slot rather than rewarding more damage tags.
      // Reed remains a damage/healing candidate, never an automatic replacement of a promoted Titi.
      if (latePrecision(rec)) return value + (completeWithoutWhite(m, ps) && rec.subProfessionId !== 'incantationmedic' ? 0 : 12);
      return [recipe.ids.leonhardt, recipe.ids.kroosAlter].includes(gdOf(m, ps).baseIdOf(rec.chessId || rec.id)) ? value - 6 : value;
    },
    levelTarget(m, ps, options) {
      const target = recipe.levelTarget(m, ps, options), s = state(m, ps);
      if (!s.hold) return target;
      if (target > 4) {
        const stats = ps._botRecipeStats ||= {};
        const rounds = stats.fourDevelopmentRounds ||= [];
        if (!rounds.includes(m.round)) stats.fourDevelopmentRounds = [...rounds, m.round];
      }
      return Math.min(4, target);
    },
    priorityLevel: (m, ps) => !state(m, ps).hold && recipe.priorityLevel(m, ps),
    spendReserve: (m, ps) => state(m, ps).hold ? 0 : recipe.spendReserve(m, ps),
    beforeUpgrade(m, ps, plan) {
      if (state(m, ps).hold) return false;
      return recipe.beforeUpgrade(m, ps, plan);
    },
    importantBuy: (m, ps, rec) => recipe.purchaseAllowed(m, ps, rec) !== false
      && (required(m, ps, rec) || recipe.importantBuy(m, ps, rec)),
    criticalBuy: (m, ps, rec, ...args) => recipe.purchaseAllowed(m, ps, rec) !== false
      && (required(m, ps, rec) || recipe.criticalBuy(m, ps, rec, ...args)),
    buyBonus: (m, ps, rec, ...args) => recipe.buyBonus(m, ps, rec, ...args) + (required(m, ps, rec) ? 16 : 0),
  });
}
