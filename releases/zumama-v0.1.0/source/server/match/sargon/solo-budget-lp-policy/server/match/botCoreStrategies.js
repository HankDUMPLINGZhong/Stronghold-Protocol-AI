import { SARGON_FACTORS } from './botStrategies/sargonFactors.js';
import { sargonPepe } from './botStrategies/sargonPepe.js';
export const CORE_STRATEGIES = Object.freeze({ sargonShip: sargonPepe });
export const coreStrategy = (m, core) => m.opts.botCoreStrategies !== false ? (core === 'sargonShip' && m.opts.botSargonFactor ? SARGON_FACTORS[m.opts.botSargonFactor] : CORE_STRATEGIES[core]) ?? null : null;
