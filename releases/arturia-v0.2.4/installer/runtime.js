// AI policy adapter only. Rules, PlayerState validation and the battle engine belong to the installation.
import * as policy from './policy/server/match/botDevelopment.js';

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
      botLateranoExperiment: 'team28-vision-difficulty',
      botLateranoCoopExperiment: 'coop-twenty-one-incantation-branches', botSiracusaArcaneWeight: 0.65,
      botSiracusaAdjustments: Object.freeze([]), botSiracusaInvestorDeadline: 9 });
    views.set(m, new Proxy(m, {
      get(target, key) {
        if (key === 'opts') return opts;
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

export const pickCard = (m, ps, cards, available) => policy.botPickCard(policyView(m), ps, cards, available);
export const prepBegin = (m, ps) => policy.botPrepBeginSteps(policyView(m), ps);
export const prepEnd = (m, ps, job) => policy.botPrepEndSteps(policyView(m), ps, job);
