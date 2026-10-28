import { coopForecastPool } from '../botForecastWorkers.js';

const states = new WeakMap(), matches = new WeakMap();
export const coopWorkerState = ps => {
  const state = states.get(ps);
  return state && !state.closed && state.m.phase === 'PREP' && state.m.round === state.round ? state : null;
};
export function cancelCoopWorkerScopes(m, ps) {
  for (const state of [...(matches.get(m) || [])]) if (!ps || state.ps === ps) state.cancel();
}
export function withCoopWorkerForecast(parent, { poolFactory = coopForecastPool } = {}) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (m.mode !== 'coop' || m.isSolo || m.wave || m.round !== m.gd.bossRound || m.botRehearsal < 2) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return;
    }
    cancelCoopWorkerScopes(m, ps);
    const pool = poolFactory(m);
    if (!pool) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const started = performance.now(), owner = {}, gen = parent.finalBoardSteps?.(m, ps, h);
    const state = { m, ps, round: m.round, owner, pool, closed: false, submitted: 0, consumed: 0, fallback: 0, ticks: 0,
      cancel() { if (!state.closed) { gen?.return?.(); close(); } } };
    const close = () => {
      if (state.closed) return;
      state.closed = true; pool.cancelOwner(owner); states.delete(ps); matches.get(m)?.delete(state);ps._botCoopWorkerWaiting=false;
      (ps._botCoopWorkerHistory ||= []).push({ round: state.round, ms: performance.now() - started,
        submitted: state.submitted, consumed: state.consumed, fallback: state.fallback, consumedTicks: state.ticks });
    };
    if (!matches.has(m)) matches.set(m, new Set()); matches.get(m).add(state); states.set(ps, state);
    try { if (gen) yield* gen; } finally { close(); }
  } });
}
