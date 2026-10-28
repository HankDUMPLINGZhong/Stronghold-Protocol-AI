// [ASSUMED] Independent own-field Unite geometry guard for normal-wave farming choices.
// Public escaped templates only: no actual leakers, helper ranking, ally roster, HP or SP valuation.
import { GEO } from '../../../../../../../shared/constants.js';
import { attackRangeGrid, loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';
import { Grid, segmentTiles } from '../../../../../../sim/grid.js';
import { COLS } from '../../../../../../sim/constants.js';
import { rotateOffset } from '../../../../../../sim/dir.js';
import { playerDeviceOverrides } from '../../../../../../sim/content/devices.js';

export const withCoopUnitePath = (recipe, { balanced = false } = {}) => Object.freeze({ ...recipe, coopUnitePath: true,
  ...(balanced ? { coopUnitePathBalance: true } : {}) });
export const unitePathEnabled = (m, ps, plans) => m.mode === 'coop' && !m.isSolo && !!m.wave
  && m.round < m.gd.bossRound && ps.bandId === 'band_paganini' && ps._botFocusId === 'lateranoShip'
  && plans.length > 0 && plans.every(p => p.coopUnitePath === true)
  && m.alivePlayers().some(p => p.playerId !== ps.playerId && p.lp > 0);

/** Fixed public template paths, using the engine flow field and exact crossed ground tile interiors. */
export function uniteRoutes(wave, grid) {
  const grouped = new Map();
  for (const s of wave.spawns) {
    const route = wave.routes[s.routeIndex];
    if (!route) continue;
    const key = JSON.stringify(route), row = grouped.get(key) || { route, n: 0 };
    row.n += s.count || 1; grouped.set(key, row);
  }
  const out = [];
  for (const { route, n } of grouped.values()) {
    const fly = route.motion === 'FLY', nodes = [route.start]; let complete = true;
    for (const dest of [...(route.checkpoints || []), route.end]) {
      if (fly) { nodes.push(dest); continue; }
      const flow = grid.flowField(...dest), seen = new Set(); let key = nodes.at(-1)[0] * COLS + nodes.at(-1)[1];
      while (key !== flow.dest && !seen.has(key)) {
        seen.add(key); key = flow.next[key]; if (key < 0) break;
        nodes.push([Math.floor(key / COLS), key % COLS]);
      }
      if (key !== flow.dest) { complete = false; break; }
    }
    if (!complete) continue;
    const tiles = [nodes[0].join(',')];
    for (let i = 1; i < nodes.length; i++) {
      const [a, b] = nodes[i - 1], [r, c] = nodes[i];
      const steps = Math.max(1, Math.max(Math.abs(r - a), Math.abs(c - b)) * 8);
      const crossed = fly ? Array.from({ length: steps + 1 }, (_, j) =>
        [Math.round(a + (r - a) * j / steps), Math.round(b + (c - b) * j / steps)]) : segmentTiles(nodes[i - 1], nodes[i]);
      for (const p of crossed) if (tiles.at(-1) !== p.join(',')) tiles.push(p.join(','));
    }
    if (tiles.length) out.push({ n, fly, tiles });
  }
  return out;
}

/** Both public helper layouts, with an empty other half. Their routes differ from the normal wave. */
export function unitePathContext(m, ps, input) {
  const gd = ps.gd || m.gd, grid = new Grid(m.stage, GEO.UNITE_RECT);
  const overrides = playerDeviceOverrides({ input, playerEffects: input.playerEffects });
  for (const d of m.stage.devices || []) {
    if (!['crate', 'platform', 'mound'].includes(d.role) || !Array.isArray(d.pos) || !grid.inRect(...d.pos)) continue;
    const active = overrides.has(d.alias) ? overrides.get(d.alias) : typeof d.active === 'boolean' ? d.active : !d.hidden;
    if (active) grid.setObstacle(...d.pos, true, d.role === 'crate' ? 'crate' : 'block');
  }
  const cases = [];
  for (const count of [1, 2]) {
    const tpl = gd.wave(gd.unite.templates[count]);
    if (!tpl) continue;
    const wave = { routes: tpl.routes, spawns: tpl.spawns.map(s => ({ ...s, enemyKey: s.key ?? s.enemyKey })) };
    const routes = uniteRoutes(wave, grid);
    for (const offset of count === 1 ? [0] : [0, 8]) cases.push({ offset, routes });
  }
  const units = input.units.filter(u => u.kind === 'chess').map(u => {
    const body = gd.chess(u.chessId), rec = loadoutRecord(body, resolveRecordLoadout(body, u));
    const range = attackRangeGrid(rec) || rec.rangeGrid || [[0, 0], [0, 1]];
    return { uid: u.uid, r: u.row, c: u.col, dir: u.dir, range, air: !!rec.canHitFly,
      front: rec.position === 'MELEE' && ['TANK', 'WARRIOR'].includes(rec.profession)
        && (rec.stats?.blockCnt || 0) > 0 && gd.baseIdOf(u.chessId) !== 'chess_char_5_01_a',
      damage: ['heal', 'none'].includes(rec.attackKind) ? 0
        : (rec.stats?.atk || 0) * (rec.stats?.aspd || 100) / (100 * Math.max(.3, rec.stats?.bat || 1)) };
  });
  return { grid, cases, units };
}

/** Geometric interception and coverage of the ENEMY-facing square, not the blocker's occupied square. */
export function unitePathValue(ctx, pp) {
  const alive = new Set((pp.unitsEnd || []).filter(u => u.alive).map(u => u.uid));
  const values = ctx.cases.map(({ offset, routes }) => {
    const units = ctx.units.filter(u => alive.has(u.uid)).map(u => ({ ...u, key: `${u.r},${u.c + offset}`,
      cover: new Set(u.range.map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, u.dir); return `${u.r + a},${u.c + offset + b}`; })) }));
    const total = routes.reduce((s, rt) => s + rt.n, 0) || 1;
    const damage = units.reduce((s, u) => s + u.damage, 0) || 1;
    let value = 0;
    for (const rt of routes) {
      const fronts = units.filter(u => !rt.fly && u.front && ctx.grid.blockable(u.r, u.c + offset)
        && ctx.grid.groundPassable(u.r, u.c + offset)).map(u => rt.tiles.indexOf(u.key)).filter(i => i >= 0);
      const stop = fronts.length ? Math.min(...fronts) : rt.tiles.length - 1;
      const ahead = rt.tiles[Math.max(0, stop - 1)];
      const support = units.reduce((s, u) => s + ((!rt.fly || u.air) && u.cover.has(ahead) ? u.damage : 0), 0) / damage;
      const exposure = units.filter(u => !rt.fly || u.air).reduce((s, u) => s + u.damage * Math.min(6,
        rt.tiles.slice(0, stop + 1).filter(k => u.cover.has(k)).length) / 6, 0) / damage;
      value += rt.n / total * ((fronts.length ? 20 : 0) + support * 20 + exposure * 10);
    }
    return value;
  });
  return values.length ? values.reduce((s, n) => s + n, 0) / values.length : 0;
}

/** Preserve own defense first; only equal all-clear farming choices need the geometric guard. */
export function protectUnitePath(outcomes, { balanced = false, urgent = false } = {}) {
  const base = new Map(outcomes.filter(r => r.index === 0).map(r => [r.sample, r]));
  return outcomes.map(r => {
    const b = base.get(r.sample);
    if (!r.index || !r.valid || !b?.valid || r.leaks || b.leaks) return r;
    // [ASSUMED] Buy bounded geometry loss only with a measured common-sample growth gain.
    // At least one ally within one capped round of elimination tightens the additional allowance.
    const gain = balanced && Number.isFinite(r.growth) && Number.isFinite(b.growth)
      ? Math.max(0, (r.growth - b.growth) / Math.max(1, Math.abs(b.growth))) : 0;
    const allowance = .05 + (balanced ? Math.min(urgent ? .05 : .15, gain * (urgent ? .25 : .5)) : 0);
    return Number.isFinite(r.unitePath) && r.unitePath + 1e-6 >= b.unitePath * (1 - allowance) ? r : { ...r, valid: false };
  });
}
