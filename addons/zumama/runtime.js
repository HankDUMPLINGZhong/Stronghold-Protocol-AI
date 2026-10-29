import { forecastCacheSteps } from '../../aiCompute/sampleCache.js';
// Named Sargon policy. The host owns game rules, card pools and all legal actions.
import * as soloHard from './policy/server/match/sargon/solo-c-policy/server/match/botDevelopment.js';
import * as soloAbyss from './policy/server/match/sargon/solo-budget-lp-policy/server/match/botDevelopment.js';
import * as coopTwo from './policy/server/match/sargon/coop-fireline-stack-policy/server/match/botDevelopment.js';
import * as coopFour from './policy/server/match/sargon/coop-four-review-policy/server/match/botDevelopment.js';
import { COMPUTATION_OWNER, computationOwner } from '../../aiCompute/identity.js';

export const BAND = 'band_pepe';
export const CORE = 'sargonShip';
import * as currentTwo from './policy/server/match/zumama/release-two/server/match/sargon/coop-fireline-stack-policy/server/match/botDevelopment.js';
import * as currentFour from './policy/server/match/zumama/release-four/server/match/sargon/coop-four-review-policy/server/match/botDevelopment.js';
import { captureOwnBossOpening as captureTwo } from './policy/server/match/zumama/release-two/server/match/sargon/ownBossForecast.js';
import { captureOwnBossOpening as captureFour } from './policy/server/match/zumama/release-four/server/match/sargon/ownBossForecast.js';
const views = new WeakMap();
const openingHooks = new WeakMap();
const currentPopulation = m => m.mode === 'coop' && !m.isSolo && m.difficulty === 'ABYSS'
  ? m.opts.seats?.length || m.order?.length : 0;
// The adopted research captures public LP when prep opens, before any teammate acts.
// Keep that timing while the named policy itself continues preparing last.
function armOpening(m, ps) {
  const n = currentPopulation(m); if (n !== 2 && n !== 4) return;
  let players = openingHooks.get(m);
  if (!players) {
    players = new Set(); openingHooks.set(m, players);
    const enter = m.enterPrep;
    m.enterPrep = function(...args) {
      const result = enter.apply(this, args);
      for (const player of players) {
        const capture = currentPopulation(this) === 4 ? captureFour : captureTwo;
        capture(policyView(this, player), player);
      }
      return result;
    };
  }
  players.add(ps);
}
function selection(m) {
  const coop = m.mode === 'coop' && !m.isSolo;
  const four = coop && (m.opts.seats?.length || 0) >= 4;
  const n = m.opts.seats?.length || m.order?.length;
  const current = coop && m.difficulty === 'ABYSS' && (n === 2 || n === 4);
  if (current) return { driver: n === 4 ? currentFour : currentTwo, factor: n === 4 ? 'coop-swift-budget-pair-four' : 'coop-swift-budget-pair-two', four: n === 4 };
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
export const pickCard = (m, ps, cards, available) => { armOpening(m, ps); return selection(m).driver.botPickCard(policyView(m, ps), ps, cards, available); };
const cached = (m, ps, gen, keepOpen = false) => forecastCacheSteps(m, ps, { namespace: 'zumama',
  enabled: m.mode === 'coop' && !m.isSolo && !m.wave && m.round === m.gd.bossRound }, gen, { keepOpen });
export const prepBegin = (m, ps) => { armOpening(m, ps); const view = policyView(m, ps); return cached(view, ps, selection(m).driver.botPrepBeginSteps(view, ps), true); };
export const prepEnd = (m, ps, job) => { const view = policyView(m, ps); return cached(view, ps, selection(m).driver.botPrepEndSteps(view, ps, job)); };
