// [ASSUMED] Independent co-op reserve-value repair, without acquisition or upgrade changes.
export function coopCriticalReserve(m, ps, rec, recipe) {
  if (m.mode !== 'coop' || m.isSolo || m.round > m.gd.bossRound) return false;
  const gd = ps.gd, base = gd.baseIdOf(rec.chessId || rec.id);
  const copies = ps.allChess().filter(p => gd.baseIdOf(p.id) === base);
  // The first native tank remains an owned deployment option even when six natives are already active.
  if (base === recipe.ids.faith) return copies.length === 1;
  // Preserve the actual precision component until its first elite, including the single copy before a pair.
  // Ordinary excess copies after an elite are not protected by this factor.
  return base === recipe.ids.leonhardt && !gd.isGolden(rec.chessId || rec.id)
    && copies.length > 0 && !copies.some(p => gd.isGolden(p.id))
    && ps.allChess().some(p => [recipe.ids.executor, recipe.ids.lemuen].includes(gd.baseIdOf(p.id)));
}

export function withCoopReserveRepair(parent) {
  return Object.freeze({ ...parent,
    keep(m, ps, rec) { return coopCriticalReserve(m, ps, rec, parent) || parent.keep(m, ps, rec); },
    preserve(m, ps, rec) { return coopCriticalReserve(m, ps, rec, parent) || parent.preserve(m, ps, rec); },
  });
}
