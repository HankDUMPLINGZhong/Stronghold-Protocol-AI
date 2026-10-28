// Opt-in R14 engineering cache. Candidate order, samples, scores and logical work limits stay inherited.
const states = new WeakMap();
export function coopPerfState(ps) {
  const entry = states.get(ps);
  return entry && entry.m.round === entry.round && entry.m.phase === 'PREP' ? entry.state : undefined;
}

/** Only use with a locally immutable plan: each scorer owns its own cache and captured geometry. */
export function memoCoopScore(ps, fn) {
  const state = coopPerfState(ps); if (!state) return fn;
  const cache = new WeakMap();
  return plan => {
    state.scoreCalls++;
    if (cache.has(plan)) { state.scoreHits++; return cache.get(plan); }
    const value = fn(plan); cache.set(plan, value); return value;
  };
}

/** Geometry depends on the range record and coordinates, not on the order of the candidate comparisons. */
export function memoCoopRange(ps, fn) {
  const state = coopPerfState(ps); if (!state) return fn;
  const records = new Map();
  return (rec, r, c, dir = 'RIGHT') => {
    state.rangeCalls++;
    let cache = records.get(rec); if (!cache) records.set(rec, cache = new Map());
    const key = `${r},${c}:${dir}`;
    if (cache.has(key)) { state.rangeHits++; return cache.get(key); }
    const value = fn(rec, r, c, dir); cache.set(key, value); return value;
  };
}

/** Repeated cover/contact queries of the same immutable plan and unit, within one generator invocation. */
export function memoCoopPair(ps, fn) {
  const state = coopPerfState(ps); if (!state) return fn;
  const cache = new WeakMap();
  return (plan, unit) => {
    state.scoreCalls++;
    let row = cache.get(plan); if (!row) cache.set(plan, row = new WeakMap());
    if (row.has(unit)) { state.scoreHits++; return row.get(unit); }
    const value = fn(plan, unit); row.set(unit, value); return value;
  };
}

export function withCoopPerfCache(parent) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (m.mode !== 'coop' || m.isSolo || m.wave || m.round !== m.gd.bossRound || m.botRehearsal < 2) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); return;
    }
    const old = states.get(ps), started = performance.now();
    const state = { samples: new Map(), sharedHits: 0, savedFieldSteps: 0, rangeCalls: 0, rangeHits: 0, scoreCalls: 0, scoreHits: 0 };
    states.set(ps, { state, m, round: m.round });
    const helpers = { ...h, rangeTiles: memoCoopRange(ps, h.rangeTiles) };
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, helpers); }
    finally {
      if (old) states.set(ps, old); else states.delete(ps);
      const { samples, ...metrics } = state;
      (ps._botCoopPerfHistory ||= []).push({ round: m.round, ms: performance.now() - started,
        ...metrics, contexts: samples.size });
    }
  } });
}
