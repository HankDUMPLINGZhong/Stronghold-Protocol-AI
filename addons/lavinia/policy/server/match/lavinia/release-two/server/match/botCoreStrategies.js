import { selectCompatibleTrial } from './botStrategies/siracusaCompatibleTrials.js';
import { withSiracusaKeyValue } from './botStrategies/siracusaKeyValue.js';
import { selectSiracusaSoloPolicy } from './botStrategies/siracusaSoloTransfer.js';
import { withSiracusaMixedTrial } from './botStrategies/siracusaMixedTrials.js';
import { SIRACUSA_CONTACT_INPUTS_ROLLBACK } from './botStrategies/siracusaContactInputs.js';
import { CONTACT_SAFE_NO_MICRO, isContactGuard } from './botStrategies/siracusaContactGuards.js';
import { SIRACUSA_BOSS_FOUR, withSiracusaCoopBossForecast } from './botStrategies/siracusaCoopBossForecast.js';
import { SIRACUSA_BOSS_POOL_COMBINED, SIRACUSA_BOSS_POOL_TWO_BONDS } from './botStrategies/siracusaBossPoolTrials.js';
import { withSiracusaHumanTrial } from './botStrategies/siracusaHumanTrials.js';
import { withSiracusaStableRaid } from './botStrategies/siracusaStableRaid.js';
import { withSiracusaRaidDeployment } from './botStrategies/siracusaRaidDeployment.js';
import { withSiracusaArcaneDraft } from './botStrategies/siracusaArcaneDraft.js';
import { withSiracusaHumanFollowup } from './botStrategies/siracusaHumanFollowups.js';
import { withSiracusaSteadDemand, withSiracusaSteadDevelopment, withSiracusaEarlyBridge, withSiracusaEarlyBuild, withSiracusaWindTransfer } from './botStrategies/siracusaSteadDemand.js';
import { withSiracusaCoopExperiment, SIRACUSA_EARLY_FACTORS, SIRACUSA_FOUR_FACTORS, SIRACUSA_OPENING_FACTORS, SIRACUSA_TWO_FACTORS, SIRACUSA_COOP_SELECTED } from './botStrategies/siracusaCoopExperiments.js';
// Core-named recipes are looked up AFTER the opening picker or explicit band commitment has chosen a core.
// This registry deliberately has no selection weights and consumes no random numbers.
import { siracusa } from './botStrategies/siracusa.js';
import { withSiracusaEconomyTrial } from './botStrategies/siracusaEconomyTrials.js';
import { siracusaBoss } from './botStrategies/siracusaBoss.js';
import { withSiracusaFocusedDraft } from './botStrategies/siracusaFocusedDraft.js';
import { withSiracusaMobileArcane } from './botStrategies/siracusaMobileArcane.js';
import { withSiracusaAromaFixed } from './botStrategies/siracusaAromaFixed.js';
import { laterano } from './botStrategies/laterano.js';
import { lateranoObserved } from './botStrategies/lateranoObserved.js';
import { lateranoTactics, lateranoLesson } from './botStrategies/lateranoTactics.js';
import { lateranoFocused } from './botStrategies/lateranoFocused.js';
import { lateranoForecast } from './botStrategies/lateranoForecast.js';
import { LATERANO_EXPERIMENTS } from './botStrategies/lateranoExperiments.js';
import { lateranoEngagement, lateranoContact, lateranoSustain } from './botStrategies/lateranoEngagement.js';
import { lateranoSami, lateranoFocusedSami } from './botStrategies/lateranoSami.js';

export const CORE_STRATEGIES = Object.freeze({ [siracusa.core]: siracusa, [laterano.core]: laterano });

/** Policy boundary for teammate-derived valuations; actual matches still use complete player states. */
export function readsTeammateRoster(m, ps) {
  return m.mode !== 'coop' || m.isSolo || ps.bandId !== 'band_paganini'
    || coreStrategy(m, ps._botFocusId || laterano.core)?.teammateInformation !== 'lp-only';
}

export function coreStrategy(m, core) {
  if (m.botCoreStrategies === false) return null;
  if (core === laterano.core && m.mode === 'coop' && m.opts?.botLateranoCoopExperiment) {
    // Route by original seats, never by the number of surviving teammates.
    const selected = m.opts.botLateranoCoopExperiment === 'coop-two-survival-four-cache'
      ? (m.order?.length === 2 ? 'coop-twenty-two-own-lethal-survival' : 'coop-twenty-two-perf-cache')
      : m.opts.botLateranoCoopExperiment;
    return LATERANO_EXPERIMENTS[selected];
  }
  if (core === laterano.core && m.opts?.botLateranoExperiment) return LATERANO_EXPERIMENTS[m.opts.botLateranoExperiment];
  if (core === siracusa.core && Array.isArray(m.opts?.botSiracusaEngines) && m.opts.botSiracusaEngines.includes('boss')) {
    const retained = withSiracusaKeyValue(withSiracusaMobileArcane(withSiracusaFocusedDraft(withSiracusaAromaFixed(siracusaBoss, m))));
    if (m.mode === 'solo' && m.isSolo && m.difficulty === 'ABYSS') {
      const solo = selectSiracusaSoloPolicy(retained, m.opts.botSiracusaSoloExperiment);
      return m.opts.botSiracusaWindTransferTrial ? withSiracusaWindTransfer(solo) : selectCompatibleTrial(solo, m);
    }
    // The new four-seat adoption leaves the measured two-seat recipe literally unchanged.
    const coopFactor = [SIRACUSA_COOP_SELECTED, 'coop-two-core-pair-four-deputy'].includes(m.opts?.botSiracusaCoopExperiment) && m.order.length !== 4
      ? 'coop-two-r7-core-pair' : m.opts?.botSiracusaCoopExperiment;
    const recipe = m.mode === 'coop' && !m.isSolo && m.round >= 1 && (m.round <= 13
      || ['coop-large-body-coverage', 'coop-lucien-right', 'coop-equipment', 'coop-stealth-contact', 'coop-pre-six-roles', 'coop-gun-contact', 'coop-first-aroma-cash', 'coop-two-early-stead', 'coop-two-missing-core', 'coop-two-distinct-core', 'coop-four-miracle-bridge', 'coop-four-risk-deputy', 'coop-four-vigil-growth', 'coop-two-core-pair-four-deputy', 'coop-four-deputy-vigil', 'coop-two-core-pair-four-deputy-vigil', 'coop-two-vigil-growth'].includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_FOUR_FACTORS.includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_OPENING_FACTORS.includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_TWO_FACTORS.includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_EARLY_FACTORS.includes(m.opts.botSiracusaCoopExperiment) && m.opts.botSiracusaCoopExperiment !== 'coop-early-fireline')
      ? withSiracusaCoopExperiment(retained, coopFactor) : retained;
    const adoptedContact = m.opts.botSiracusaContactAdopted && m.difficulty === 'ABYSS'
      ? m.order.length === 2 ? SIRACUSA_CONTACT_INPUTS_ROLLBACK : m.order.length === 4 ? CONTACT_SAFE_NO_MICRO : false : false;
    const mixedFactor = m.opts.botSiracusaMixedTrial ?? adoptedContact;
    const mixed = m.mode === 'coop' && !m.isSolo && (m.order.length === 2 && !isContactGuard(mixedFactor)
      || m.order.length === 4 && (mixedFactor === SIRACUSA_CONTACT_INPUTS_ROLLBACK || isContactGuard(mixedFactor)))
      ? withSiracusaMixedTrial(recipe, mixedFactor) : recipe;
    const adoptedBoss = m.opts.botSiracusaBossAdopted
      ? m.opts.botSiracusaBossTwoPoolAdopted && m.order.length === 2 ? SIRACUSA_BOSS_POOL_TWO_BONDS
        : m.opts.botSiracusaBossPoolAdopted && m.order.length === 4 ? SIRACUSA_BOSS_POOL_COMBINED : SIRACUSA_BOSS_FOUR : false;
    const bossFactor = m.opts.botSiracusaBossTrial ?? adoptedBoss;
    const boss = m.mode === 'coop' && !m.isSolo && [2, 4].includes(m.order.length) && m.difficulty === 'ABYSS'
      ? withSiracusaCoopBossForecast(mixed, bossFactor) : mixed;
    if (m.mode === 'coop' && !m.isSolo && m.order.length === 2 && m.difficulty === 'ABYSS') {
      if (m.opts.botSiracusaSteadDemandTrial || m.opts.botSiracusaSteadDevelopmentTrial || m.opts.botSiracusaEarlyBridgeTrial || m.opts.botSiracusaEarlyBuildTrial) {
        if (m.opts.botSiracusaHumanFollowup || m.opts.botSiracusaArcaneDraftTrial || m.opts.botSiracusaStableRaidTrial || m.opts.botSiracusaHumanTrial || m.opts.botSiracusaRaidDeploymentTrial) throw Error('Siracusa independent trials cannot be stacked');
        if ([m.opts.botSiracusaSteadDemandTrial, m.opts.botSiracusaSteadDevelopmentTrial, m.opts.botSiracusaEarlyBridgeTrial, m.opts.botSiracusaEarlyBuildTrial].filter(Boolean).length > 1) throw Error('Siracusa independent trials cannot be stacked');
        if (m.opts.botSiracusaEarlyBuildTrial) return withSiracusaEarlyBuild(boss, m.opts.botSiracusaEarlyBuildTrial);
        if (m.opts.botSiracusaEarlyBridgeTrial) return withSiracusaEarlyBridge(boss);
        return m.opts.botSiracusaSteadDevelopmentTrial ? withSiracusaSteadDevelopment(boss) : withSiracusaSteadDemand(boss);
      }
      if (m.opts.botSiracusaHumanFollowup) {
        if (m.opts.botSiracusaArcaneDraftTrial || m.opts.botSiracusaStableRaidTrial || m.opts.botSiracusaHumanTrial || m.opts.botSiracusaRaidDeploymentTrial) throw Error('Siracusa independent trials cannot be stacked');
        return withSiracusaHumanFollowup(boss, m.opts.botSiracusaHumanFollowup);
      }
      if (m.opts.botSiracusaArcaneDraftTrial) {
        if (m.opts.botSiracusaStableRaidTrial || m.opts.botSiracusaHumanTrial || m.opts.botSiracusaRaidDeploymentTrial) throw Error('Siracusa independent trials cannot be stacked');
        return withSiracusaArcaneDraft(boss, m.opts.botSiracusaArcaneDraftTrial);
      }
      if (m.opts.botSiracusaStableRaidTrial && m.opts.botSiracusaHumanTrial) throw Error('Siracusa independent trials cannot be stacked');
      if (m.opts.botSiracusaRaidDeploymentTrial && (m.opts.botSiracusaStableRaidTrial || m.opts.botSiracusaHumanTrial)) throw Error('Siracusa independent trials cannot be stacked');
      const explicit = m.opts.botSiracusaHumanTrial || m.opts.botSiracusaStableRaidTrial || m.opts.botSiracusaRaidDeploymentTrial;
      const selected = withSiracusaRaidDeployment(withSiracusaStableRaid(withSiracusaHumanTrial(boss, m.opts.botSiracusaHumanTrial), m.opts.botSiracusaStableRaidTrial), m.opts.botSiracusaRaidDeploymentTrial);
      return withSiracusaEconomyTrial(selectCompatibleTrial(m.opts.botSiracusaWindAdopted && !explicit ? withSiracusaEarlyBuild(selected, 'wind-elite') : selected, m),
        m.opts.botSiracusaEconomyTrial ?? (m.opts.botSiracusaWithdrawalPairsAdopted ? 'withdrawal-key-pairs' : false), m.opts.botSiracusaEndRewardTrial);
    }
    if (m.mode === 'coop' && !m.isSolo && m.order.length === 4 && m.difficulty === 'ABYSS' && m.opts.botSiracusaWindTransferTrial) return withSiracusaWindTransfer(boss);
    return selectCompatibleTrial(boss, m);
  }
  if (core === laterano.core && Array.isArray(m.opts?.botLateranoLessons) && lateranoLesson(m, 'forecast')) return lateranoForecast;
  if (core === laterano.core && Array.isArray(m.opts?.botLateranoLessons) && lateranoLesson(m, 'engagement')) return lateranoEngagement;
  if (core === laterano.core && Array.isArray(m.opts?.botLateranoLessons) && lateranoLesson(m, 'contact')) return lateranoContact;
  if (core === laterano.core && Array.isArray(m.opts?.botLateranoLessons) && lateranoLesson(m, 'sustain')) return lateranoSustain;
  if (core === laterano.core && m.bossId === 'boss_7' && lateranoLesson(m, 'sami')) {
    return lateranoLesson(m, 'roster') ? lateranoFocusedSami : lateranoSami;
  }
  if (core === laterano.core && lateranoLesson(m, 'roster')) return lateranoFocused;
  if (core === laterano.core && m.opts?.botLateranoLessons) return lateranoTactics;
  if (core === laterano.core && m.opts?.botHumanLessons) return lateranoObserved;
  return CORE_STRATEGIES[core] ?? null;
}
