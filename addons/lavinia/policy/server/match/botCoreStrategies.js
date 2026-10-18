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

export function coreStrategy(m, core) {
  if (m.botCoreStrategies === false) return null;
  if (core === laterano.core && m.opts?.botLateranoExperiment) return LATERANO_EXPERIMENTS[m.opts.botLateranoExperiment];
  if (core === siracusa.core && Array.isArray(m.opts?.botSiracusaEngines) && m.opts.botSiracusaEngines.includes('boss')) return withSiracusaMobileArcane(withSiracusaFocusedDraft(withSiracusaAromaFixed(siracusaBoss, m)));
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
