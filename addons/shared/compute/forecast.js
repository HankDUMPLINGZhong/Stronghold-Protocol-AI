// Strategy-independent execution primitives. Callers own seeds, candidates, sampling, budgets and scoring.
// In particular this layer never draws match RNG, settles a battle or applies a winning plan.
export const COMPUTATION_API = 1;
export const createForecastBattle = (match, spec) => match.newBattle(spec);
export const stepForecastBattle = battle => battle.step();

/** Resumable isolated battle; callbacks stay local, so custom observers need no unsafe serialization. */
export function createForecastTrial(match, spec) {
  const battle = createForecastBattle(match, spec);
  let ticks = 0, closed = false;
  return {
    battle,
    get ticks() { return ticks; },
    run({ cap = Infinity, budgetMs = Infinity, checkEvery = 4, afterStep, now = () => performance.now() } = {}) {
      if (closed) return 'closed';
      const started = now(); let steps = 0;
      while (!battle.finished && ticks < cap) {
        stepForecastBattle(battle); ticks++; steps++;
        if (afterStep?.(battle, ticks) === false) return 'stopped';
        if (steps % checkEvery === 0 && now() - started >= budgetMs) return 'yield';
      }
      return battle.finished ? 'complete' : 'cap';
    },
    dispose() { if (!closed) { closed = true; battle.dispose?.(); } },
  };
}
