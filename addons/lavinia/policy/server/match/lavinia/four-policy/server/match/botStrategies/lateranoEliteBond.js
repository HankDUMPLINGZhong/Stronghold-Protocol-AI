// [ASSUMED] Independent lineup-only experiment: price the automatic elite bond like an ordinary auxiliary bond.
// Laterano's acquisition whitelist deliberately excludes unrelated routes; it also hides suntShip from the generic
// lineup bond loop. Restore only that loop's nine points per active tier, without widening purchasing objectives.
export function eliteBondValue(bonds) {
  return Math.min(2, Math.max(0, bonds.suntShip?.tier || 0)) * 9;
}

export function withLateranoEliteBond(recipe) {
  return Object.freeze({ ...recipe,
    lineupBonus(gd, pieces, bonds, plan) {
      return recipe.lineupBonus(gd, pieces, bonds, plan) + eliteBondValue(bonds);
    },
  });
}
