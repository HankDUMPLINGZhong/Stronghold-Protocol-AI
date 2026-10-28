// [ASSUMED] Release idle transfer scopes only after the final roster and facings are fixed.
// The real scope checks Euclidean centre distance >= radius; a large body's range intersection is separate.
const SCOPE = 'chess_item_3_02_e_a';

export function scopeBossExposure(model, cover, row, col, radius) {
  const far = ([r, c]) => (r - row) ** 2 + (c - col) ** 2 >= radius ** 2 - 1e-6;
  let seconds = 0;
  for (const body of model.bossBodies || []) {
    if (far(body.center) && body.tiles.some(k => cover.has(k))) seconds += 30;
  }
  for (const route of model.routes || []) {
    if (!route.dwell) continue; // Only the publicly specified leader route, not its guards.
    for (let i = 0; i < route.tiles.length; i++) {
      const key = route.tiles[i];
      if (cover.has(key) && far(key.split(',').map(Number))) seconds += route.tileTime + (i < 2 ? route.dwell : 0);
    }
  }
  return seconds;
}

export function withLateranoPrecisionFallback(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    const gd = ps.gd || m.gd;
    if (m.round !== gd.bossRound) return;
    const scopes = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item' && gd.baseIdOf(p.id) === SCOPE);
    if (!scopes.length) return;
    const model = helpers.fieldModel(m, ps);
    for (const item of scopes) {
      const rec = gd.item(item.id);
      // Preserve an available real sphere transfer; only consume equipment the parent still holds idle.
      if (!recipe.holdItem(m, ps, rec)) continue;
      const candidates = ps.allChess().filter(p => ps.find(p.uid)?.area === 'board' && (p.items?.length || 0) < gd.equipPerChess)
        .map(p => {
          const unit = helpers.rangeRec(ps, gd.chess(p.id)), [row, col] = ps.find(p.uid).key.split(',').map(Number);
          if (!unit || unit.profession === 'MEDIC' || unit.profession === 'TANK' || unit.attackKind === 'heal' || unit.dmgType === 'heal') return null;
          const seconds = scopeBossExposure(model, new Set(helpers.rangeTiles(unit, row, col, p.dir)), row, col, Number(rec.params?.radius) || 3);
          const stats = unit.stats || {}, dps = (stats.atk || 0) * (stats.aspd || 100) / 100 / Math.max(0.1, stats.bat || 1);
          const main = [recipe.ids.exusiaiAlter, recipe.ids.lemuen].includes(gd.baseIdOf(p.id));
          return seconds > 0 && dps > 0 ? { p, seconds, value: seconds * dps * (main ? 2 : 1) } : null;
        }).filter(Boolean).sort((a, b) => b.value - a.value || a.p.uid - b.p.uid);
      const target = candidates[0];
      const ok = target ? !!ps.equip(item.uid, target.p.uid)?.ok : false;
      (ps._botPrecisionFallbackHistory ||= []).push({ round: m.round, item: item.id, uid: item.uid,
        target: ok ? target.p.uid : null, targetId: ok ? target.p.id : null,
        candidates: candidates.map(c => ({ uid: c.p.uid, id: c.p.id, key: ps.find(c.p.uid).key, dir: c.p.dir, seconds: c.seconds, value: c.value })) });
      if (ok) yield;
    }
  } });
}
