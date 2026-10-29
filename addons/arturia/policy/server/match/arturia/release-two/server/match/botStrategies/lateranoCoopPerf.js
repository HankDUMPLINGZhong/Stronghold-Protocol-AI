// Policy compatibility adapter: cache mechanics are shared, eligibility stays strategy-owned.
import { withComputationCache } from '../../../../../../../../../aiCompute/cache.js';
export { computationCacheState as coopPerfState, memoScore as memoCoopScore, memoRange as memoCoopRange, memoPair as memoCoopPair } from '../../../../../../../../../aiCompute/cache.js';
export const withCoopPerfCache = parent => withComputationCache(parent, {
  eligible: m => m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound && m.botRehearsal >= 2,
});
