// Opt-in input correctness for original contact repair: current PREP_FIN, public bands,
// and actual in-battle growth. No real meta dispatch or forecast/actual seed reuse.
import { createForecastSteps } from '../botForecast.js';
import { prepareSiracusaCoopInput } from './siracusaCoopExperiments.js';
import { siracusaContactInput } from './siracusaCoopTactics.js';
import { selectStealthRepair } from './lateranoStealthWave.js';

export const SIRACUSA_CONTACT_INPUTS_ROLLBACK = 'contact-fire-inputs-rollback';
const publicMates = (m, ps) => m.order.filter(p => p !== ps && p.alive)
  .map(p => ({ playerId: p.playerId, bandId: p.bandId }));
const stamp = (m, ps) => JSON.stringify([m.round, ps.lp, ps.funds, ps.battleInput(), ps.hand, ps.temp,
  ps.shop.slots, publicMates(m, ps)]);

/** Mirror global:contentb_info from public band IDs and our own prep counters only.
 * Same-roster contact plans do not change bench ownership. Never dispatch onBattleStart
 * on live state: it may run non-projectable economic or other one-off effects.
 */
export function correctedContactInput(m, ps, plan) {
  const input = siracusaContactInput(ps, plan);
  prepareSiracusaCoopInput(m, ps, plan.lineup, plan, input);
  const mates = publicMates(m, ps), rs = ps.round;
  input.contentInfo = {
    round: m.round, kind: 'normal', shopLevel: ps.shop.level, funds: ps.funds,
    handUnits: ps.hand.filter(Boolean).length, handChess: ps.hand.filter(p => p?.kind === 'chess').length,
    roundStats: { refreshes: rs.refreshes | 0, buys: rs.buys | 0, sells: rs.sells | 0,
      spent: rs.spent | 0, gainedChess: rs.gainedChess | 0, arts: rs.arts | 0 },
    matchBands: [ps.bandId, ...mates.map(p => p.bandId)].filter(Boolean), teammates: mates,
  };
  return input;
}

/** Preserve the original two common independent samples and original LP/leak selector. */
export function* probeCorrectedContact(m, ps, h, plans, { context, observe } = {}) {
  const before = stamp(m, ps);
  function* inputs(plan) { yield; return correctedContactInput(m, ps, plan); }
  const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputs, {
    forecastReadinessOnly: true, forecastLayerGainsEnabled: true,
    forecastContext: () => context || ({}), observeForecast: observe || (() => () => ({})), selectForecast: selectStealthRepair,
  });
  if (!job) return null;
  while (!job.run(4)) yield;
  return { job, stale: before !== stamp(m, ps) };
}
