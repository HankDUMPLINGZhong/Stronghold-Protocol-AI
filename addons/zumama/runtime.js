// Named Sargon policy. The host owns game rules, card pools and all legal actions.
import * as soloHard from './policy/server/match/sargon/solo-c-policy/server/match/botDevelopment.js';
import * as soloAbyss from './policy/server/match/sargon/solo-budget-lp-policy/server/match/botDevelopment.js';
import * as coopTwo from './policy/server/match/sargon/coop-fireline-stack-policy/server/match/botDevelopment.js';
import * as coopFour from './policy/server/match/sargon/coop-four-review-policy/server/match/botDevelopment.js';
import { COMPUTATION_OWNER, computationOwner } from '../../aiCompute/identity.js';

export const BAND = 'band_pepe';
export const CORE = 'sargonShip';
const views = new WeakMap();
function selection(m) {
  const coop = m.mode === 'coop' && !m.isSolo;
  const four = coop && (m.opts.seats?.length || 0) >= 4;
  return coop ? { driver: four ? coopFour : coopTwo, factor: four ? 'coop-swift-budget-pair-four' : 'coop-swift-budget-pair-two', four }
    : { driver: m.difficulty === 'ABYSS' ? soloAbyss : soloHard,
      factor: m.difficulty === 'ABYSS' ? 'solo-budget-lp' : 'solo-c-combined', four: false };
}
export function policyView(m, ps) {
  let players = views.get(m); if (!players) { players = new WeakMap(); views.set(m, players); }
  if (!players.has(ps)) {
    const selected = selection(m), coop = m.mode === 'coop' && !m.isSolo;
    const opts = Object.freeze({ ...m.opts, botCoreStrategies: true, botRehearsal: 3,
      botFormationRoles: true, botHumanLessons: false, botLateranoLessons: false,
      botSargonVersion: 'tempo', botSargonFactor: selected.factor,
      botSargonCoopSeat: coop ? ps.playerId : null,
      botSargonEarlyStead: 'dynamic', botSargonSteadGate: selected.four ? 'space-three' : 'none',
      botSargonFireline: 'combined', botSargonFourMargin: selected.four ? 'single-leak' : false,
      botSargonFourReview: selected.four ? 'B' : 'none' });
    players.set(ps, new Proxy(m, {
      get(target, key) {
        if (key === 'opts') return opts;
        if (key === COMPUTATION_OWNER) return computationOwner(target);
        if (key === 'botRehearsal') return 3;
        if (key === 'botCoreStrategies') return true;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: (target, key, value) => Reflect.set(target, key, value, target),
    }));
  }
  return players.get(ps);
}
export const pickCard = (m, ps, cards, available) => selection(m).driver.botPickCard(policyView(m, ps), ps, cards, available);
export const prepBegin = (m, ps) => selection(m).driver.botPrepBeginSteps(policyView(m, ps), ps);
export const prepEnd = (m, ps, job) => selection(m).driver.botPrepEndSteps(policyView(m, ps), ps, job);
