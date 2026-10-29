// [ASSUMED] Public difficulty selects an already measured Foresight policy.
// Keep the common acquisition hooks and delegate the complete final pass exactly once.
export function withLateranoDifficultyVision(strict, conservative) {
  return Object.freeze({ ...strict, *finalBoardSteps(m, ps, h) {
    const recipe = m.difficulty === 'ABYSS' ? conservative : strict;
    yield* recipe.finalBoardSteps(m, ps, h);
  } });
}
