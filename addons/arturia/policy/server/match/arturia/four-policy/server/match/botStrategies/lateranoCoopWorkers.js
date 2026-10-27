// Laterano enables the common executor only for its previously measured R14 path.
import { withForecastWorkers } from '../../../../../../../../../aiCompute/scopes.js';
export { forecastWorkerState as coopWorkerState, cancelForecastScopes as cancelCoopWorkerScopes } from '../../../../../../../../../aiCompute/scopes.js';
export const withCoopWorkerForecast = (parent, options = {}) => withForecastWorkers(parent, {
  eligible: m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound && m.botRehearsal >= 2,
  ...options,
});
