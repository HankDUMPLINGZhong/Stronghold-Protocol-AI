// Public host ABI. Plugins import this shared path rather than bundling their own pools or mutable caches.
export { COMPUTATION_API, createForecastBattle, stepForecastBattle, createForecastTrial } from './forecast.js';
export { createOrderedForecastJob } from './ordered.js';
export { COMPUTATION_OWNER, computationOwner } from './identity.js';
export { computationCacheState, memoScore, memoRange, memoPair, withComputationCache } from './cache.js';
export { ForecastWorkerPool, forecastPool, closeForecastWorkers } from './workers.js';
export { forecastWorkerState, cancelForecastScopes, withForecastWorkers } from './scopes.js';
