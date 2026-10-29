// [ASSUMED] Independent 2026 guide trials. Never composed or enabled by the default recipe.
import { FORECAST_SAMPLES } from '../botForecast.js';
import { developmentValue } from '../botLateranoDevelopment.js';
import { mostimaVisionUtility } from './lateranoVisionValue.js';
import { fieldModel, rangeTiles } from '../botDevelopment.js';
import { immuneSet } from '../../../../../../../../../../sim/simdata.js';
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';

export const GUIDE_ITEMS = Object.freeze({ circle: 'chess_item_3_08_e_a', packaging: 'chess_item_5_07_e_a' });
const CORE = 'lateranoShip', VISION = 'visiShip', PREC = 'preciShip', SKILL = 'skillfulShip';
const scoped = (m, ps) => m.mode === 'coop' && !m.isSolo && ps.bandId === 'band_paganini' && ps._botFocusId === CORE;
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const log = (ps, row) => (ps._botCoopFactorHistory ||= []).push(row);

/** Same complete samples/candidates and safety; bounded core sacrifice must repay in useful secondary gains. */
export function selectGuideSupply(plans, outcomes, ctx) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = a => a.length === FORECAST_SAMPLES && a.every((r, i) => r.valid && r.sample === i
    && ['coreGain', 'visionGain', 'precisionGain', 'skillfulGain', 'coverage', 'precisionShare', 'lost', 'leaks',
      'killed', 'deaths', 'criticalDown', 'entryReady', 'skillfulCovered'].every(k => Number.isFinite(r[k])));
  if (!valid(rows[0])) return { index: 0 };
  const value = r => mostimaVisionUtility(r, ctx) + developmentValue(
    { [PREC]: ctx.precision, [SKILL]: ctx.skillful }, { [PREC]: r.precisionGain, [SKILL]: r.skillfulGain },
    r.coverage, { remaining: ctx.remaining, precisionShare: r.precisionShare });
  if (rows[0].some(r => !Number.isFinite(value(r)))) return { index: 0 };
  const mean = a => a.reduce((n, r) => n + value(r), 0) / FORECAST_SAMPLES;
  const baseline = mean(rows[0]);
  let index = 0, score = baseline;
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, j) => {
      const b = rows[0][j];
      return !(r.donorAmmo > 0) || r.lost > b.lost || r.leaks > b.leaks || r.killed < b.killed
        || r.deaths > b.deaths || r.criticalDown > b.criticalDown || r.skillfulCovered < b.skillfulCovered
        || !ctx.growthFirst && r.entryReady + 1e-6 < b.entryReady
        || r.coreGain < b.coreGain - Math.min(6, Math.max(0, b.coreGain) * .2)
        || value(r) + 1e-6 < value(b);
    })) continue;
    const next = mean(rows[i]);
    if (next > baseline + .5 && next > score + 1e-6) { index = i; score = next; }
  }
  return { index, marginalValue: score };
}

export function withCoopGuideSupply(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    const before = ps._botCoopGuideSupply;
    if (scoped(m, ps) && m.wave && m.round < m.gd.bossRound) ps._botCoopGuideSupply = true;
    try { if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h); }
    finally { if (before === undefined) delete ps._botCoopGuideSupply; else ps._botCoopGuideSupply = before; }
  } });
}

/** Current-wave public traits only; immunity uses the engine's parser. */
export function guideReflectionCount(m, ps) {
  return (m.wave?.spawns || []).reduce((n, s) => {
    const e = ps.gd.enemy(s.enemyKey), st = e?.stats || {};
    const immune = immuneSet(st.immunities ?? e?.immune ?? e?.immunities, st.otherImmunities ?? e?.otherImmunities);
    return n + (e?.acTypes?.includes('REFLECTION') && !immune.has('silence') ? s.count || 1 : 0);
  }, 0);
}

/** Preserve visible critical purchases and an affordable upgrade; never sell to fund this equipment. */
export function guideSpareFunds(m, ps, recipe) {
  const critical = ps.shop.slots.filter(s => s && !s.sold && s.kind === 'chess'
    && (recipe.criticalBuy?.(m, ps, ps.gd.chess(s.id)) || ps.completesChessMerge(s.id)))
    .reduce((n, s) => n + ps.priceOf(s), 0);
  const upgrade = recipe.priorityLevel?.(m, ps) && ps.funds >= ps.shop.upgradePrice ? ps.shop.upgradePrice : 0;
  return Math.max(0, ps.funds - critical - upgrade);
}

function circleCarrier(m, ps) {
  if (!guideReflectionCount(m, ps)) return null;
  const model = fieldModel(m, ps);
  const starts = new Set((m.wave?.spawns || []).filter(s => {
    const e = ps.gd.enemy(s.enemyKey), st = e?.stats || {};
    return e?.acTypes?.includes('REFLECTION')
      && !immuneSet(st.immunities ?? e?.immune ?? e?.immunities, st.otherImmunities ?? e?.otherImmunities).has('silence');
  }).flatMap(s => {
    const rt = m.wave.routes?.[s.routeIndex];if (!rt?.start || !rt?.end) return [];
    const key = `${rt.start[0]},${rt.start[1]}->${rt.end[0]},${rt.end[1]}`;
    const paths = m.stage.groundPathsWithDevices || m.stage.groundPaths || {};
    return (paths[key] || [rt.start]).map(p => p.join(','));
  }));
  const routes = (model.routes || []).filter(rt => starts.has(rt.tiles[0]));
  return field(ps).map(p => {
    const r = ps.gd.chess(p.id), pos = ps.find(p.uid);
    if (!r || ['heal', 'none'].includes(r.attackKind) || r.subProfessionId === 'bard'
      || (p.items?.length || 0) >= ps.gd.equipPerChess) return null;
    const cover = new Set(rangeTiles(r, ...pos.key.split(',').map(Number), p.dir));
    const contact = routes.reduce((n, rt) => n + (rt.fly && !r.canHitFly ? 0
      : rt.tiles.filter(k => cover.has(k)).length * rt.n), 0);
    return contact > 0 ? { p, score: contact * (r.stats?.aspd || 100) / Math.max(.3, r.stats?.bat || 1) } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.p.uid - b.p.uid)[0]?.p || null;
}

function packagingCarrier(ps) {
  return ps.allChess().filter(p => pieceBonds(ps.gd, p).includes(CORE)
    && (p.items?.length || 0) < ps.gd.equipPerChess)
    .sort((a, b) => pieceBonds(ps.gd, a).length - pieceBonds(ps.gd, b).length
      || Number(ps.gd.isGolden(b.id)) - Number(ps.gd.isGolden(a.id))
      || ps.gd.tierOf(b.id) - ps.gd.tierOf(a.id) || a.uid - b.uid)[0] || null;
}

function packagingReady(m, ps, recipe) {
  const layers = ps.layers[VISION] || 0;
  if (m.round > 12 || layers < 80 || !packagingCarrier(ps) || ps.hand.filter(p => !p).length < 3) return false;
  const star = ps.allChess().some(p => base(ps, p) === 'chess_char_6_16_a');
  // One currently executable sale plus time to reach eight. No future shops or RNG are inspected.
  return ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess' && !ps.gd.isGolden(s.id)
    && !ps.completesChessMerge(s.id) && !recipe.importantBuy?.(m, ps, ps.gd.chess(s.id))
    && !recipe.criticalBuy?.(m, ps, ps.gd.chess(s.id)) && ps.priceOf(s) <= ps.funds - 3
    && (layers >= 150 && ps.priceOf(s) <= 1 || star && base(ps, s) === 'chess_char_3_03_a'));
}

/** Buy one copy with surplus money; immediately equip without replacing gear. Existing arbitration stays inherited. */
export function withCoopGuideEquipment(recipe, kind) {
  if (!Object.hasOwn(GUIDE_ITEMS, kind)) throw Error('Unknown guide equipment factor');
  const id = GUIDE_ITEMS[kind];
  const owned = ps => [...ps.hand, ...ps.temp, ...ps.allChess().flatMap(p => p.items || [])]
    .filter(p => p?.kind === 'item' && base(ps, p) === id);
  function equip(m, ps) {
    for (const item of [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item' && base(ps, p) === id)) {
      const p = kind === 'circle' ? circleCarrier(m, ps) : packagingCarrier(ps);
      if (p && ps.equip(item.uid, p.uid)?.ok) log(ps, { factor: 'guide-' + kind, action: 'equip', round: m.round, uid: p.uid, id: p.id });
    }
  }
  function run(m, ps, hook) {
      if (scoped(m, ps)) {
        equip(m, ps);
        const index = ps.shop.slots.findIndex(s => s && !s.sold && s.kind === 'item' && base(ps, s) === id);
        if (index >= 0 && !owned(ps).length && m.round < m.gd.bossRound) {
          const slot = ps.shop.slots[index], price = ps.priceOf(slot), spare = guideSpareFunds(m, ps, recipe);
          const target = kind === 'circle' ? circleCarrier(m, ps) : packagingReady(m, ps, recipe) && packagingCarrier(ps);
          const seen = (ps._botCoopGuideItemSeen ||= new Set()), key = `${kind}:${m.round}:${ps.round.refreshes}:${index}`;
          if (!seen.has(key)) {
            seen.add(key);log(ps, { factor: 'guide-' + kind, action: 'offer', round: m.round,
              price, spare, eligible: !!target, capacity: ps.hand.some(p => !p), vision: ps.layers[VISION] || 0 });
          }
          if (target && price <= spare && ps.hand.some(p => !p) && ps.buy(index)?.ok) {
            log(ps, { factor: 'guide-' + kind, action: 'buy', round: m.round, price, spare, vision: ps.layers[VISION] || 0 });
            equip(m, ps);
          }
        }
      }
      const before = kind === 'packaging' && owned(ps).length ? new Set(ps.allChess().map(p => p.uid)) : null;
      const result = recipe[hook]?.(m, ps);
      if (before) for (const p of ps.allChess().filter(p => !before.has(p.uid)))
        log(ps, { factor: 'guide-packaging', action: 'post-cycle-gain', round: m.round, id: p.id, uid: p.uid });
      return result;
  }
  const out = { ...recipe,
    useEconomy(m, ps) { return run(m, ps, 'useEconomy'); },
    liquidity(m, ps) { return run(m, ps, 'liquidity'); },
    protectItem(m, ps, rec) { return scoped(m, ps) && base(ps, rec) === id || recipe.protectItem?.(m, ps, rec); },
  };
  return Object.freeze(out);
}
