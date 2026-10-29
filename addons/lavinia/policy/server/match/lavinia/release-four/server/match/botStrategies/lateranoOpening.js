// [ASSUMED] Early purchases must contribute to Laterano's existing objectives, rather than an unrelated cheap pair.
const objectives = new Set(['lateranoShip', 'preciShip', 'skillfulShip', 'visiShip', 'steadShip', 'swiftShip']);
export function withLateranoOpening(baseline) {
  return Object.freeze({ ...baseline,
    purchaseAllowed(m, ps, rec) {
      if (m.round <= 8 && !rec.bonds?.some(b => objectives.has(b))) return false;
      // This narrows the original bridge: no new Swift project, extra weight or opening-picker change.
      return baseline.purchaseAllowed(m, ps, rec);
    }
  });
}
