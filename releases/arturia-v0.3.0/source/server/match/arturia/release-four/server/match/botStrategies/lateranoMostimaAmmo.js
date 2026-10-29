// [ASSUMED] Owned ammunition donors may replace a spare during development, never shopping or boss policy.
// Mostima's existing consume-ammo garrison uses cardinal neighbours, not diagonals or projectile counts.
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { healingTiles } from '../botPositioning.js';
import { stealthBattleInput } from './lateranoStealthWave.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { mostimaVisionContext, mostimaVisionUtility } from './lateranoVisionValue.js';

const CORE = 'lateranoShip', DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tank = r => r.profession === 'TANK' && (r.stats?.blockCnt || 0) > 0;
const distance = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);

/** Complete common samples must actually spend ammunition, add layers and preserve current-wave safety. */
export function selectMostimaAmmo(plans, outcomes, { protectVision = false, visionContext } = {}) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === FORECAST_SAMPLES && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(rows[0])) return { index: 0 };
  const gain = rs => rs.reduce((n, r) => n + r.coreGain, 0) / FORECAST_SAMPLES;
  const weighted=protectVision==='value';
  if(weighted&&rows[0].some(r=>mostimaVisionUtility(r,visionContext)==null))return {index:0};
  const utility=rs=>weighted?rs.reduce((s,r)=>s+mostimaVisionUtility(r,visionContext),0)/FORECAST_SAMPLES:gain(rs);
  let index = 0, score = utility(rows[0]);
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, j) => !(r.donorAmmo > 0) || r.lost > rows[0][j].lost
      || r.leaks > rows[0][j].leaks || r.killed < rows[0][j].killed || r.deaths > rows[0][j].deaths
      || r.coreGain < rows[0][j].coreGain)) continue;
    if (protectVision===true && rows[i].some((r, j) => r.visionGain < rows[0][j].visionGain)) continue;
    if(weighted&&rows[i].some((r,j)=>mostimaVisionUtility(r,visionContext)==null
      ||mostimaVisionUtility(r,visionContext)+1e-6<mostimaVisionUtility(rows[0][j],visionContext)))continue;
    const next = utility(rows[i]);
    if (gain(rows[i]) >= gain(rows[0]) + 2 && next > score) { index = i; score = next; }
  }
  return { index };
}

/** Joint legal Mostima/donor positions, with reciprocal swaps for displaced allies. Public routes only. */
export function mostimaAmmoPlans(m, ps, h, recipe, { protectVision = false } = {}) {
  const original = new h.LayoutPlan(); original.lineup = field(ps);
  for (const p of original.lineup) { original.set(p.uid, ps.find(p.uid).key); original.dirs.set(p.uid, p.dir); }
  const mostima = original.lineup.find(p => ps.gd.baseIdOf(p.id) === recipe.ids.mostima);
  if (!mostima) return [original];
  const rec = p => h.rangeRec(ps, ps.gd.chess(p.id)), id = p => ps.gd.baseIdOf(p.id);
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([k]) => k));
  const routes = h.fieldModel(m, ps).routes.filter(r => !r.fallback && r.n > 0);
  if (!routes.length) return [original];
  const donors = ps.allChess().filter(p => p !== mostima && recipe.ammoWeight(rec(p)) > 0)
    .sort((a, b) => Number(id(b) === recipe.ids.insider) - Number(id(a) === recipe.ids.insider)
      || Number(ps.gd.isGolden(b.id)) - Number(ps.gd.isGolden(a.id)) || a.uid - b.uid);
  const protectedIds = [recipe.ids.faith, recipe.ids.executorAlter, recipe.ids.exusiaiAlter, recipe.ids.lemuen, recipe.ids.archetto];
  const proposals = [], total = routes.reduce((n, r) => n + r.n, 0);
  const options = p => {
    const out = [], r = rec(p);
    for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
      const key = `${row},${col}`;
      if (reserved.has(key) || !ps._legal(p, row, col)) continue;
      for (const dir of DIRS) {
        if (owners.has(p.uid) && (original.get(p.uid) !== key || p.dir !== dir)) continue;
        const cover = new Set(h.rangeTiles(r, row, col, dir));
        let contact = 0;
        for (const rt of routes) {
          if (rt.fly && !r.canHitFly) continue;
          const hits = rt.tiles.filter(k => cover.has(k)).length;
          contact += rt.n / total * hits;
        }
        out.push({ key, r: row, c: col, dir, cover, contact });
      }
    }
    return out;
  };
  const mostimaOptions = options(mostima);
  for (const donor of donors.slice(0, 3)) {
    const removals = original.lineup.includes(donor) ? [null] : original.lineup.filter(p => p !== mostima
      && !owners.has(p.uid) && !protectedIds.includes(id(p))
      && (!healer(rec(p)) || original.lineup.some(q => q !== p && healer(rec(q))))
      && (!tank(rec(p)) || original.lineup.some(q => q !== p && tank(rec(q)))));
    for (const removed of removals) {
      const lineup = original.lineup.map(p => p === removed ? donor : p);
      const startKey = original.get((removed || donor).uid);
      if (!startKey || !ps._legal(donor, ...startKey.split(',').map(Number))) continue;
      const initial = new h.LayoutPlan(); initial.lineup = lineup;
      for (const p of lineup) { initial.set(p.uid, p === donor ? startKey : original.get(p.uid)); initial.dirs.set(p.uid, p === donor ? original.dirs.get((removed || donor).uid) : p.dir); }
      const bonds = stealthBattleInput(ps, initial).bonds;
      if (protectVision && ps.bonds.visiShip?.active && !bonds.visiShip?.active) continue;
      if ((bonds[CORE]?.count || 0) < Math.min(6, ps.bonds[CORE]?.count || 0)) continue;
      if (['preciShip', 'skillfulShip'].some(b => ps.bonds[b]?.active && (!bonds[b]?.active
        || bonds[b].count < Math.min(b === 'preciShip' ? 3 : 2, ps.bonds[b].count)))) continue;
      const move = (from, piece, to) => {
        const plan = new h.LayoutPlan(); plan.lineup = lineup;
        for (const p of lineup) { plan.set(p.uid, from.get(p.uid)); plan.dirs.set(p.uid, from.dirs.get(p.uid)); }
        const occupant = lineup.find(p => p !== piece && plan.get(p.uid) === to.key), old = plan.get(piece.uid);
        if (occupant) {
          if (owners.has(occupant.uid) || !ps._legal(occupant, ...old.split(',').map(Number))) return null;
          plan.set(occupant.uid, old);
        }
        plan.set(piece.uid, to.key); plan.dirs.set(piece.uid, to.dir); return plan;
      };
      const donorOptions = options(donor).filter(p => p.contact > 0);
      for (const mp of mostimaOptions) for (const dp of donorOptions) {
        if (distance(mp, dp) !== 1) continue;
        const first = move(initial, mostima, mp); if (!first) continue;
        const plan = move(first, donor, dp); if (!plan || plan.get(mostima.uid) !== mp.key) continue;
        let frontCover = 0, exposed = 0;
        for (const rt of routes) {
          if (rt.fly && !rec(donor).canHitFly) continue;
          const front = lineup.filter(p => tank(rec(p))).map(p => rt.tiles.indexOf(plan.get(p.uid))).filter(n => n >= 0);
          if (!front.length || rt.fly) continue;
          const at = Math.min(...front), d = rt.tiles.indexOf(dp.key);
          if (dp.cover.has(rt.tiles[Math.max(0, at - 1)])) frontCover += rt.n / total;
          if (d >= 0 && d < at) exposed += rt.n / total;
        }
        const healed = lineup.some(p => healer(rec(p)) && healingTiles(rec(p), ...plan.get(p.uid).split(',').map(Number), plan.dirs.get(p.uid)).has(dp.key));
        const changed = lineup.filter(p => plan.get(p.uid) !== initial.get(p.uid)).length;
        const cost = removed ? rec(removed).tier * 2 + (ps.gd.isGolden(removed.id) ? 8 : 0)
          + Math.max(0, recipe.unitBonus(m, ps, rec(removed), { route: ps._botRoute }) || 0) : 0;
        const score = dp.contact * 5 + frontCover * 12 + mp.contact - exposed * 18 + Number(healed) * 3
          - changed * 2 - cost + Number(id(donor) === recipe.ids.insider) * 20;
        plan.donorUid = donor.uid; plan.mostimaUid = mostima.uid;
        proposals.push({ plan, score, donor: donor.uid });
      }
    }
  }
  proposals.sort((a, b) => b.score - a.score);
  const plans = [original], seen = new Set(), formations = new Set();
  for (const { plan } of proposals) {
    const signature = [...plan].map(([u, k]) => `${u}:${k}:${plan.dirs.get(u)}`).join('|');
    const formation = [...plan].map(([u, k]) => `${u}:${k}`).join('|');
    if (seen.has(signature) || formations.has(formation)) continue;
    seen.add(signature); formations.add(formation); plans.push(plan); if (plans.length === 3) break;
  }
  return plans;
}

export function* mostimaAmmoSteps(m, ps, h, recipe, { protectVision = false } = {}) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 3) return;
  const started = performance.now(), plans = mostimaAmmoPlans(m, ps, h, recipe, { protectVision });
  if (plans.length < 2) return;
  function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
  const visionContext=protectVision==='value'?mostimaVisionContext(m,ps,recipe):null;
  const policy = {
    prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
    forecastContext: () => ({}),
    observeForecast: (battle, context, plan) => {
      let donorAmmo = 0;
      battle.on('ammoUsed', ({ unit }) => { if (unit.uid === plan.donorUid) donorAmmo++; });
      return pp => ({ donorAmmo, coreGain: (pp.layerGains?.[CORE] || 0) + (plan.development?.fin?.[CORE] || 0)
        + (plan.development?.next?.[CORE] || 0), ...(protectVision ? { visionGain: (pp.layerGains?.visiShip || 0)
          + (plan.development?.fin?.visiShip || 0) + (plan.development?.next?.visiShip || 0) } : {}) });
    },
    selectForecast: protectVision ? (plans, outcomes) => selectMostimaAmmo(plans, outcomes, { protectVision, visionContext }) : selectMostimaAmmo,
  };
  const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputSteps, policy);
  if (!job) return; while (!job.run(4)) yield;
  if (job.bestIndex) {
    const best = job.best, added = best.lineup.filter(p => !plans[0].lineup.includes(p)), removed = plans[0].lineup.filter(p => !best.lineup.includes(p));
    for (let i = 0; i < added.length; i++) {
      const [row, col] = plans[0].get(removed[i].uid).split(',').map(Number);
      const result = ps.move(added[i].uid, { area: 'board', row, col }, best.dirs.get(added[i].uid));
      if (result?.error) throw Error(`Mostima ammunition substitution rejected: ${result.error}`);
    }
    const expected = stealthBattleInput(ps, best); applyControlPositions(ps, best);
    if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Mostima ammunition layout differs from its forecast');
  }
  (ps._botMostimaAmmoHistory ||= []).push({ round: m.round, index: job.bestIndex, outcomes: job.outcomes,
    ...(visionContext?{visionContext}:{}),
    candidates: job.plans.map(p => ({ donorUid: p.donorUid, mostimaUid: p.mostimaUid,
      positions: p.lineup.map(u => ({ uid: u.uid, id: u.id, key: p.get(u.uid), dir: p.dirs.get(u.uid) })) })), ms: performance.now() - started });
}

export function withLateranoMostimaAmmo(recipe, { protectVision = false } = {}) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, h) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, h);
    yield* mostimaAmmoSteps(m, ps, h, recipe, { protectVision });
  } });
}
