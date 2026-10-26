// Reusable execution scope: eligibility, candidate generation and scores belong to callers.
import { forecastPool } from './workers.js';
import { computationOwner } from './identity.js';

const states = new WeakMap(), matches = new WeakMap();
export const forecastWorkerState = ps => {
  const state = states.get(ps);
  return state && !state.closed && state.m.phase === 'PREP' && state.m.round === state.round ? state : null;
};
export function cancelForecastScopes(m, ps) {
  for (const state of [...(matches.get(computationOwner(m)) || [])]) if (!ps || state.ps === ps) {
    try { state.cancel(); }
    catch (error) { try { m.log?.warn?.(`AI forecast cleanup failed: ${error.message || error}`); } catch {} }
  }
}
export function withForecastWorkers(parent, { poolFactory = forecastPool, eligible = () => true, historyField = '_botCoopWorkerHistory' } = {}) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (!eligible(m, ps)) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return;
    }
    cancelForecastScopes(m, ps);
    const pool = poolFactory(m);
    if (!pool) { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return; }
    const started = performance.now(), owner = {}, gen = parent.finalBoardSteps?.(m, ps, h);
    const state = { m, ps, round: m.round, owner, pool, closed: false, submitted: 0, consumed: 0, fallback: 0, ticks: 0,
      cancel() { if (!state.closed) { try { gen?.return?.(); } finally { close(); } } } };
    const close = () => {
      if (state.closed) return;
      state.closed = true;
      try { pool.cancelOwner(owner); }
      finally {
        states.delete(ps); matches.get(computationOwner(m))?.delete(state);ps._botCoopWorkerWaiting=false;
        (ps[historyField] ||= []).push({ round: state.round, ms: performance.now() - started,
          submitted: state.submitted, consumed: state.consumed, fallback: state.fallback, consumedTicks: state.ticks });
      }
    };
    if (!matches.has(computationOwner(m))) matches.set(computationOwner(m), new Set()); matches.get(computationOwner(m)).add(state); states.set(ps, state);
    try { if (gen) yield* gen; } finally { close(); }
  } });
}
