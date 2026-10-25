// [ASSUMED] Independent late-game retention factor; no additional purchases or forced deployment.
// Preserve one remaining healing option through R14, excluding self-healing and passive regeneration.
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
export const isLateranoHealing = rec => rec?.attackKind === 'heal' || rec?.dmgType === 'heal'
  || ['guardian', 'incantationmedic'].includes(rec?.subProfessionId);

export function lastLateranoHealing(m, ps, rec) {
  if (!m.isSolo || m.round < 12 || m.round > m.gd.bossRound || !isLateranoHealing(rec)) return false;
  const gd = gdOf(m, ps), options = ps.allChess().filter(p => isLateranoHealing(gd.chess(p.id)));
  return options.length === 1 && base(gd, options[0]) === base(gd, rec);
}

export function withLateranoLastHealing(recipe) {
  return Object.freeze({ ...recipe,
    preserve: (m, ps, rec, ...args) => lastLateranoHealing(m, ps, rec) || recipe.preserve(m, ps, rec, ...args),
  });
}
