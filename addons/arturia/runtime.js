import * as currentTwo from './policy/server/match/arturia/release-two/server/match/botDevelopment.js';
import * as currentFour from './policy/server/match/arturia/release-four/server/match/botDevelopment.js';
import { captureOwnSurvivalOpening as captureCurrentTwo } from './policy/server/match/arturia/release-two/server/match/botStrategies/lateranoCoopOwnSurvival.js';
import { captureOwnSurvivalOpening as captureCurrentFour } from './policy/server/match/arturia/release-four/server/match/botStrategies/lateranoCoopOwnSurvival.js';
// AI policy adapter only. Rules, PlayerState validation and the battle engine belong to the installation.
import * as solo from './policy/server/match/arturia/solo-policy/server/match/botDevelopment.js';
import * as two from './policy/server/match/arturia/two-policy/server/match/botDevelopment.js';
import * as four from './policy/server/match/arturia/four-policy/server/match/botDevelopment.js';
import { captureOwnSurvivalOpening as captureTwo } from './policy/server/match/arturia/two-policy/server/match/botStrategies/lateranoCoopOwnSurvival.js';
import { captureOwnSurvivalOpening as captureFour } from './policy/server/match/arturia/four-policy/server/match/botStrategies/lateranoCoopOwnSurvival.js';
import { COMPUTATION_OWNER, computationOwner } from '../aiCompute/identity.js';
import { forecastCacheSteps } from '../aiCompute/sampleCache.js';
const cooperative = m => m.mode === 'coop' && !m.isSolo;
const large = m => (m.opts.seats?.length || 0) >= 4;
const seats = m => m.opts.seats?.length || m.order?.length || 0;
const current = m => cooperative(m) && m.difficulty === 'ABYSS' && (seats(m) === 2 || seats(m) === 4);
const driver = m => current(m) ? (seats(m) === 4 ? currentFour : currentTwo) : cooperative(m) ? (large(m) ? four : two) : solo;

export const ARTURIA = 'arturia';
export const BAND = 'band_paganini';
export const CORE = 'lateranoShip';
export const isArturia = (m, ps) => ps?.isBot === true
  && m.opts?.seats?.some(s => s.playerId === ps.playerId && s.isBot && s.botPersona === ARTURIA) === true;

// A view per match avoids changing shared match options while generators yield between players/rooms.
const views = new WeakMap();
export function policyView(m) {
  if (!views.has(m)) {
    const opts = Object.freeze({ ...m.opts, botStrategy: 'growth', botCoreStrategies: true, botRehearsal: 3,
      botFrontlineRepair: false, botFormationRoles: true, botHumanLessons: false,
      botSiracusaEngines: false, botLateranoLessons: Object.freeze(['quintus', 'roster']),
      botLateranoExperiment: current(m) ? 'coop-prep-fin-helm-separate' : 'team28-vision-difficulty',
      botLateranoCoopExperiment: 'coop-prep-fin-helm-separate', botSiracusaArcaneWeight: 0.65,
      botSiracusaAdjustments: Object.freeze([]), botSiracusaInvestorDeadline: 9 });
    views.set(m, new Proxy(m, {
      get(target, key) {
        if (key === 'opts') return opts;
        if (key === COMPUTATION_OWNER) return computationOwner(target);
        if (key === 'botRehearsal') return 3;
        if (key === 'botCoreStrategies') return true;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    }));
  }
  return views.get(m);
}

export const pickCard = (m, ps, cards, available) => driver(m).botPickCard(policyView(m), ps, cards, available);
const cached = (m, ps, gen, keepOpen = false) => forecastCacheSteps(m, ps, { namespace: 'arturia',
  enabled: cooperative(m) && !m.wave && m.round === m.gd.bossRound }, gen, { keepOpen });
export const prepBegin = (m, ps) => { const view = policyView(m);
  if (cooperative(m)) (current(m) ? (seats(m) === 4 ? captureCurrentFour : captureCurrentTwo) : (large(m) ? captureFour : captureTwo))(view, ps);
  return cached(view, ps, driver(m).botPrepBeginSteps(view, ps), true); };
export const prepEnd = (m, ps, job) => { const view = policyView(m); return cached(view, ps, driver(m).botPrepEndSteps(view, ps, job)); };
