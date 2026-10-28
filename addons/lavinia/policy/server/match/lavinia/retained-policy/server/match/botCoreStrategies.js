import { withSiracusaKeyValue } from './botStrategies/siracusaKeyValue.js';
import { selectSiracusaSoloPolicy } from './botStrategies/siracusaSoloTransfer.js';
import { withSiracusaCoopExperiment, SIRACUSA_EARLY_FACTORS, SIRACUSA_FOUR_FACTORS, SIRACUSA_OPENING_FACTORS, SIRACUSA_TWO_FACTORS } from './botStrategies/siracusaCoopExperiments.js';
// Core-named recipes are looked up AFTER the opening picker or explicit band commitment has chosen a core.
// This registry deliberately has no selection weights and consumes no random numbers.
import { siracusa } from './botStrategies/siracusa.js';
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
  if (core === laterano.core && m.mode === 'coop' && m.opts?.botLateranoCoopExperiment)
    return LATERANO_EXPERIMENTS[m.opts.botLateranoCoopExperiment];
  if (core === laterano.core && m.opts?.botLateranoExperiment) return LATERANO_EXPERIMENTS[m.opts.botLateranoExperiment];
  if (core === siracusa.core && Array.isArray(m.opts?.botSiracusaEngines) && m.opts.botSiracusaEngines.includes('boss')) {
    const retained = withSiracusaKeyValue(withSiracusaMobileArcane(withSiracusaFocusedDraft(withSiracusaAromaFixed(siracusaBoss, m))));
    if (m.mode === 'solo' && m.isSolo && m.difficulty === 'ABYSS') return selectSiracusaSoloPolicy(retained, m.opts.botSiracusaSoloExperiment);
    return m.mode === 'coop' && !m.isSolo && m.round >= 1 && (m.round <= 13
      || ['coop-large-body-coverage', 'coop-lucien-right', 'coop-equipment', 'coop-stealth-contact', 'coop-pre-six-roles', 'coop-gun-contact', 'coop-first-aroma-cash'].includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_FOUR_FACTORS.includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_OPENING_FACTORS.includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_TWO_FACTORS.includes(m.opts.botSiracusaCoopExperiment)
      || SIRACUSA_EARLY_FACTORS.includes(m.opts.botSiracusaCoopExperiment) && m.opts.botSiracusaCoopExperiment !== 'coop-early-fireline')
      ? withSiracusaCoopExperiment(retained, m.opts.botSiracusaCoopExperiment) : retained;
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
