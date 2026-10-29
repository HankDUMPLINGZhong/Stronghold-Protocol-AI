// [ASSUMED] Research stability gate. Independent common samples only, no actual combat or teammate roster.
export function allowBossChallenger(reference, challenger) {
  if (reference.length !== 4 || challenger.length !== 4) return false;
  const mean = rows => rows.reduce((n, r) => n + r.bossDamage, 0) / rows.length;
  const before = mean(reference), after = mean(challenger);
  if (after > before + Math.max(1e-6, before * .02)) return true;
  if (after < before - 1e-6) return false;
  // A small improvement needs every common sample to support it. Predicted clears may tie on capped damage.
  return challenger.every((r, i) => r.bossDamage + 1e-6 >= reference[i].bossDamage);
}
