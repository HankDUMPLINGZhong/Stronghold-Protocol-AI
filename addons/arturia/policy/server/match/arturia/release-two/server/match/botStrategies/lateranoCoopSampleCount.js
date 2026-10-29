// [ASSUMED] Independent R14-only common-sample count; inherited candidates, seeds and budgets stay intact.
export const coopBossSampleCount = (ps, requested = 10) => ps._botCoopBossSampleCount ?? requested;

export function withCoopBossSampleCount(parent, samples) {
  if (![2, 4, 6, 8, 10].includes(samples)) throw Error('Unsupported co-op Boss sample count');
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (m.mode !== 'coop' || m.isSolo || m.wave || m.round !== m.gd.bossRound) {
      if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
      return;
    }
    const previous = ps._botCoopBossSampleCount;
    ps._botCoopBossSampleCount = samples;
    try { if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h); }
    finally {
      if (previous === undefined) delete ps._botCoopBossSampleCount;
      else ps._botCoopBossSampleCount = previous;
    }
  } });
}
