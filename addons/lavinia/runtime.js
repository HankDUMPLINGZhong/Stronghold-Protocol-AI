// Named Siracusa adapter. Rules, data, legal actions and ordinary AI belong to the host.
import * as retained from './policy/server/match/lavinia/retained-policy/server/match/botDevelopment.js';
import * as solo from './policy/server/match/lavinia/solo-policy/server/match/botDevelopment.js';
import * as two from './policy/server/match/lavinia/two-policy/server/match/botDevelopment.js';
import * as four from './policy/server/match/lavinia/four-policy/server/match/botDevelopment.js';
import { COMPUTATION_OWNER, computationOwner } from '../aiCompute/identity.js';
export const LAVINIA = 'lavinia', BAND = 'band_chiave', CORE = 'siracusaShip';
export const isLavinia = (m, ps) => ps?.isBot === true && m.opts?.seats?.some(s => s.playerId === ps.playerId && s.isBot && s.botPersona === LAVINIA) === true;
const select = m => {
  if (m.difficulty !== 'ABYSS') return 'retained';
  if (m.mode === 'solo' && m.isSolo) return 'solo';
  if (m.mode === 'coop' && !m.isSolo) {
    const n = m.opts.seats?.length || m.order?.length;
    if (n === 2) return 'two'; if (n === 4) return 'four';
  }
  return 'retained';
};
const drivers = { retained, solo, two, four }, views = new WeakMap();
export function policyView(m) {
  if (!views.has(m)) {
    const mode = select(m), multiplayer = mode === 'two' || mode === 'four';
    const opts = Object.freeze({ ...m.opts, botStrategy: 'growth', botCoreStrategies: true, botRehearsal: 3,
      botFrontlineRepair: false, botFormationRoles: true, botHumanLessons: true,
      botSiracusaEngines: Object.freeze(['promotion', 'hybrid', 'boss']), botLateranoLessons: false,
      botLateranoExperiment: false, botLateranoCoopExperiment: false, botSiracusaSoloExperiment: false,
      botSiracusaCoopExperiment: multiplayer ? 'coop-two-core-pair-four-deputy-vigil' : 'coop-two-r7-core-pair',
      botSiracusaContactAdopted: multiplayer, botSiracusaBossAdopted: multiplayer,
      botSiracusaWindAdopted: mode === 'two', botSiracusaBossTrial: mode === 'four' ? 'boss-four-samples' : undefined,
      botSiracusaMixedTrial: undefined, botSiracusaWindTransferTrial: false,
      botSiracusaEarlyBuildTrial: false, botSiracusaEarlyBridgeTrial: false,
      botSiracusaSteadDemandTrial: false, botSiracusaSteadDevelopmentTrial: false,
      botSiracusaHumanFollowup: false, botSiracusaArcaneDraftTrial: false,
      botSiracusaHumanTrial: false, botSiracusaStableRaidTrial: false, botSiracusaRaidDeploymentTrial: false,
      botSiracusaArcaneWeight: 0.65, botSiracusaAdjustments: Object.freeze([]), botSiracusaInvestorDeadline: 9 });
    views.set(m, new Proxy(m, {
      get(target, key) {
        if (key === 'opts') return opts;
        if (key === COMPUTATION_OWNER) return computationOwner(target);
        if (key === 'botRehearsal') return 3; if (key === 'botCoreStrategies') return true;
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      }, set: (target, key, value) => Reflect.set(target, key, value, target),
    }));
  }
  return views.get(m);
}
export const pickCard = (m, ps, cards, available) => drivers[select(m)].botPickCard(policyView(m), ps, cards, available);
export const prepBegin = (m, ps) => drivers[select(m)].botPrepBeginSteps(policyView(m), ps);
export const prepEnd = (m, ps, job) => drivers[select(m)].botPrepEndSteps(policyView(m), ps, job);
