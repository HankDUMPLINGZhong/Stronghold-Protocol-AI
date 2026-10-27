// [ASSUMED] Isolated co-op four-to-five member-gate ablation over retained14/56.
// Replace only the four economic gate callbacks at tier four; all other tiers and actions stay inherited.
const CORE = 'lateranoShip';
const hooks = ['levelTarget', 'beforeUpgrade', 'priorityLevel', 'spendReserve'];

export function withLateranoCoopFiveGate(recipe, economy, { requireActive = false } = {}) {
  const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini'
    && ps._botFocusId === CORE && ps.shop.level === 4;
  const active = ps => !requireActive || ps.bonds[CORE]?.active === true && ps.bonds[CORE].count >= 3;
  return Object.freeze({ ...recipe, ...Object.fromEntries(hooks.map(key => [key, (m, ps, ...args) => {
    if (!scoped(m, ps)) return recipe[key](m, ps, ...args);
    if (!active(ps)) return key === 'levelTarget' ? 4 : key === 'spendReserve' ? 0 : false;
    return economy[key](m, ps, ...args);
  }])) });
}
