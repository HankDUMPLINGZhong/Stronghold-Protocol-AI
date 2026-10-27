// Shared execution cache. Strategies supply complete immutable trial inputs and projection dependencies.
// This module never generates candidates, chooses seeds, scores results or increases a work budget.
const players = new WeakMap(), matches = new WeakMap();
const OWNER = Symbol.for('stronghold.ai.compute.owner.v1');
const MAX_ENTRIES = 512, MAX_BYTES = 16 * 1024 * 1024;
const ownerOf = (m, ps) => m[OWNER] || ps?.m || m;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Policy proxies bind functions on each read. Read the underlying value descriptor instead.
// Accessor factories cannot be identified reliably, so those contexts use the uncached path.
function rawFunction(object, key) {
  for (let p = object; p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return 'value' in d && typeof d.value === 'function' ? d.value : null;
  }
  return null;
}
function runtimeContext(m) {
  const ctor = rawFunction(m, 'BattleClass'), factory = rawFunction(m, 'newBattle');
  return ctor && factory ? [m.ds, m.gd, m.battleContent, ctor, factory] : null;
}

/** Typed, ordered encoding: Infinity, undefined, collection order and reference aliasing stay distinct. */
export function forecastContextKey(value) {
  const refs = new WeakMap(); let next = 0;
  function encode(v) {
    if (v === null) return ['null'];
    if (typeof v === 'undefined') return ['undefined'];
    if (typeof v === 'number') {
      if (Number.isNaN(v)) throw Error('NaN context');
      return ['number', Object.is(v, -0) ? '-0' : String(v)];
    }
    if (typeof v === 'string' || typeof v === 'boolean') return [typeof v, v];
    if (typeof v !== 'object') throw Error('Opaque context');
    if (refs.has(v)) return ['ref', refs.get(v)];
    const id = next++; refs.set(v, id);
    if (Object.getOwnPropertySymbols(v).length) throw Error('Symbol context');
    const proto = Object.getPrototypeOf(v);
    if (v instanceof Map || v instanceof Set) {
      const map = v instanceof Map;
      if (proto !== (map ? Map.prototype : Set.prototype) || Object.getOwnPropertyNames(v).length) throw Error('Opaque collection');
      return map ? ['map', id, [...v].map(([k, x]) => [encode(k), encode(x)])] : ['set', id, [...v].map(encode)];
    }
    const array = Array.isArray(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw Error('Opaque context');
    const entries = Object.getOwnPropertyNames(v).map(k => {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!('value' in d)) throw Error('Accessor context');
      return [k, encode(d.value)];
    });
    return [array ? 'array' : proto === null ? 'null-object' : 'object', id, entries];
  }
  try { return JSON.stringify(encode(value)); } catch { return null; }
}

function valid(state, m) {
  return state && !state.closed && state.m === m && state.round === m.round && m.phase === 'PREP';
}
export function forecastSampleCacheState(m, ps) {
  const state = players.get(ps);
  return m.opts?.botSharedForecastCache !== false && valid(state, m) ? state : null;
}

/** One lease can span prep-begin, its returned forecast job, and prep-end. */
export function beginForecastSampleCache(m, ps, { namespace = 'default', historyField = '_aiComputeSampleCacheHistory', enabled = true } = {}) {
  const old = players.get(ps);
  if (!enabled || m.phase !== 'PREP' || m.opts?.botSharedForecastCache === false) {
    if (old) endForecastSampleCache(ps, old); return null;
  }
  if (valid(old, m) && old.namespace === namespace) return old;
  if (old) endForecastSampleCache(ps, old);
  const owner = ownerOf(m, ps), state = { m, ps, owner, round: m.round, namespace, historyField, closed: false,
    context: runtimeContext(m), epoch: 0, entries: new Map(), bytes: 0, peakBytes: 0,
    hits: 0, savedFieldSteps: 0, budgetStops: 0, invalidations: 0, evictions: 0 };
  players.set(ps, state);
  if (!matches.has(owner)) matches.set(owner, new Set());
  matches.get(owner).add(state);
  return state;
}
export function endForecastSampleCache(ps, state = players.get(ps)) {
  if (!state || state.closed) return;
  state.closed = true;
  if (players.get(ps) === state) players.delete(ps);
  matches.get(state.owner)?.delete(state);
  const { namespace, round, hits, savedFieldSteps, budgetStops, invalidations, evictions, peakBytes } = state;
  (ps[state.historyField] ||= []).push({ namespace, round, hits, savedFieldSteps, budgetStops, invalidations,
    evictions, peakBytes, storedSamples: state.entries.size });
  state.entries.clear(); state.bytes = 0;
}
export function cancelForecastSampleCaches(m, ps) {
  for (const state of [...(matches.get(ownerOf(m, ps)) || [])]) if (!ps || state.ps === ps) endForecastSampleCache(state.ps, state);
}

/** Begin keeps the lease for its returned job; end and interrupted generators always release it. */
export function* forecastCacheSteps(m, ps, options, steps, { keepOpen = false } = {}) {
  const lease = beginForecastSampleCache(m, ps, options); let complete = false;
  try { const value = yield* steps; complete = true; return value; }
  finally { if (!keepOpen || !complete) endForecastSampleCache(ps, lease); }
}

export function lookupForecastSample(m, ps, projection, context) {
  const state = forecastSampleCacheState(m, ps);
  if (!state) return null;
  const runtime = runtimeContext(m);
  if (!runtime) return null;
  if (!state.context || !same(runtime, state.context)) {
    state.entries.clear(); state.bytes = 0; state.context = runtime; state.epoch++; state.invalidations++;
  }
  const key = forecastContextKey([state.namespace, projection, context]);
  if (key === null) return null;
  return { state, epoch: state.epoch, key, row: state.entries.get(key) };
}
function freezePlain(v, seen = new WeakSet(), freeze = true) {
  if (!v || typeof v !== 'object' || seen.has(v)) return;
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw Error('Opaque outcome');
  seen.add(v);
  for (const key of Object.getOwnPropertyNames(v)) {
    if (Array.isArray(v) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (!d.enumerable || !('value' in d)) throw Error('Opaque outcome property');
    freezePlain(d.value, seen, freeze);
  }
  if (freeze) Object.freeze(v);
}
export function storeForecastSample(m, ps, token, outcome, steps) {
  if (!token || players.get(ps) !== token.state || !valid(token.state, m) || token.epoch !== token.state.epoch
    || !same(token.state.context, runtimeContext(m) || [])
    || !Number.isSafeInteger(steps) || steps < 0) return;
  let copy, encoded;
  try {
    encoded = forecastContextKey(outcome);
    if (encoded === null || outcome?.valid !== true || /\["number","(?:-?Infinity)"\]/.test(encoded)) return;
    freezePlain(outcome, new WeakSet(), false);
    copy = structuredClone(outcome);
    freezePlain(copy);
  } catch { return; }
  const state = token.state, bytes = 2 * (token.key.length + encoded.length);
  if (bytes > MAX_BYTES) return;
  if (state.entries.has(token.key)) {
    state.bytes -= state.entries.get(token.key).bytes; state.entries.delete(token.key);
  }
  while (state.entries.size && (state.entries.size >= MAX_ENTRIES || state.bytes + bytes > MAX_BYTES)) {
    const key = state.entries.keys().next().value, row = state.entries.get(key);
    state.bytes -= row.bytes; state.entries.delete(key); state.evictions++;
  }
  state.entries.set(token.key, Object.freeze({ outcome: copy, steps, bytes }));
  state.bytes += bytes; state.peakBytes = Math.max(state.peakBytes, state.bytes);
}

/** Optional caller-owned logical budget. Exact ceiling preserves the old final-tick rejection. */
export function replayForecastSample(token, session = null) {
  if (!token?.row || players.get(token.state.ps) !== token.state || !valid(token.state, token.state.m)
    || token.epoch !== token.state.epoch || !same(token.state.context, runtimeContext(token.state.m) || [])) return null;
  const cost = token.row.steps, available = session ? Math.max(0, session.limits.fieldSteps - session.steps) : Infinity;
  token.state.hits++; token.state.savedFieldSteps += Math.min(cost, available);
  if (session) {
    session.steps += Math.min(cost, available);
    if (cost >= available) { session.reason ||= 'field-step-budget'; token.state.budgetStops++; return false; }
  }
  return true;
}
