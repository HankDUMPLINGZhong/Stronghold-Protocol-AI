// Current-wave growth planning only. No real meta dispatch, settlement, RNG or future shop reads.
// [ASSUMED] Valuation, 80% aura target, 12 LP reserve and the 4 LP lifetime risk budget are policy.
import { layerGainRoom } from '../../../../../../shared/constants.js';
import { rotateOffset } from '../../../../../sim/dir.js';
import { pieceBonds } from '../../../../bondsMeta.js';
import { isFormationAnchor } from './botPositioning.js';

const CORE = 'lateranoShip', SKILL = 'skillfulShip';
const avg = (a, key) => a.reduce((s, r) => s + (r[key] || 0), 0) / a.length;
const worst = (a, key) => Math.max(...a.map(r => r[key] || 0));
const floor = (a, key) => Math.min(...a.map(r => r[key] || 0));
const traits = (gd, rec) => (rec?.garrisonIds || []).map(id => gd.garrison(id)).filter(Boolean);
const base = (gd, u) => gd.baseIdOf(u.rec?.chessId || u.id);
const live = u => u.alive && u.deployed;

/** Fixed BEFORE simulations: do not let low damage erase an intended carry from the coverage denominator. */
export function developmentCarries(units) {
  return units.filter(u => !['TANK', 'MEDIC'].includes(u.rec.profession)
    && !['heal', 'none'].includes(u.rec.attackKind) && (u.rec.stats?.atk || 0) > 0)
    .map(u => ({ uid: u.uid, weight: (u.dps ?? ((u.rec.stats.atk || 0) * (u.rec.stats.aspd || 100)
      / (100 * Math.max(.2, u.rec.stats.bat || 1)))) * (u.rec.tier >= 5 ? 1.5 : 1) }))
    .sort((a, b) => b.weight - a.weight || a.uid - b.uid).slice(0, 3);
}

/** Public deterministic positional traits, including a copier's OWN origin/bonds and bounded copy chains.
 * This deliberately projects layer-only handlers; it never executes arbitrary economic/reward effects.
 */
export function prepLayerForecast(gd, units, bonds, event, spent = 0, refreshes = 0) {
  const at = new Map(units.map(u => [u.key, u])), gains = {};
  const neighbour = (u, behind = false) => {
    const [dr, dc] = rotateOffset(0, behind ? -1 : 1, u.dir);
    return at.get(`${u.r + dr},${u.c + dc}`);
  };
  const add = (id, n) => { if (bonds[id]?.active) gains[id] = (gains[id] || 0) + n; };
  for (const u of units) {
    let gs = traits(gd, u.rec).filter(g => g.eventType === event);
    if (gs.some(g => g.effectKey === `SERVER_FRONT_SAME_EFFECT_${event === 'SERVER_PREP_START' ? 'PREP_START' : 'PREP_FIN'}`)) {
      const seen = new Set([u.uid]); let target = neighbour(u);
      gs = [];
      for (let i = 0; i < 8 && target && !seen.has(target.uid); i++) {
        seen.add(target.uid);
        const next = traits(gd, target.rec).filter(g => g.eventType === event);
        if (!next.length) break;
        if (!next.every(g => g.effectKey.startsWith('SERVER_FRONT_SAME_EFFECT_'))) { gs = next; break; }
        target = neighbour(target);
      }
    }
    for (const g of gs) {
      const bb = g.bb || {}, str = g.bbStr || {};
      if (g.effectKey === 'SERVER_ADD_BOND_POSITION') {
        for (const t of [u, neighbour(u, str.dir === 'behind')].filter(Boolean)) {
          for (const id of t.bonds || t.rec.bonds || []) add(id, bb.count || 0);
        }
      }
      if (g.effectKey === 'SERVER_ADD_BOND_ROUND_COIN_COST') for (const id of (str.bond || '').split(',')) {
        add(id, Math.floor(spent / Math.max(1, bb.count || 1)) * (bb.layer || 0));
      }
      if (g.effectKey === 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER') for (const id of (str.bond || '').split(',')) {
        add(id, Math.min(bb.max_layer || Infinity, refreshes * (bb.multiplier || 0)));
      }
    }
  }
  return Object.fromEntries(Object.entries(gains).map(([id, n]) => [id, layerGainRoom(bonds[id]?.layers || 0, n)]));
}

/** Aura union, not a per-provider bonus. Directions affect the layer traits, not the aura footprint. */
export function skillfulCoverage(units, bonds, carries = developmentCarries(units)) {
  if (!bonds[SKILL]?.active || !carries.length) return { weighted: 1, minimum: 1 };
  const providers = units.filter(u => (u.bonds || u.rec.bonds || []).includes(SKILL));
  const wide = (bonds[SKILL].layers || 0) >= 40;
  const hit = uid => {
    const u = units.find(u => u.uid === uid);
    return !!u && providers.some(v => wide ? Math.max(Math.abs(v.r - u.r), Math.abs(v.c - u.c)) <= 1
      : Math.abs(v.r - u.r) + Math.abs(v.c - u.c) <= 1);
  };
  const total = carries.reduce((s, c) => s + c.weight, 0) || 1;
  return { weighted: carries.reduce((s, c) => s + (hit(c.uid) ? c.weight : 0), 0) / total,
    minimum: Math.min(...carries.slice(0, 2).map(c => hit(c.uid) ? 1 : 0)) };
}

/** One comparable utility: useful core/ammo, damage branches, and a realistically reachable Vision payout. */
export function developmentValue(current, gains, coverage, { remaining = 1, lemuen = false, precisionShare = 1 } = {}) {
  const gain = id => layerGainRoom(current[id] || 0, gains[id] || 0);
  // Percent marginal gains from the public bond formulas, with an assumed ammo-uptime discount.
  // A fixed raw-layer weight otherwise overvalues already mature Skillful and starves ammunition/Vision.
  let value = 100 * gain(CORE) * .015 / (1.05 + .015 * (current[CORE] || 0)) * (lemuen ? .3 : .7)
    + 100 * gain('preciShip') * .012 / (1.1 + .012 * (current.preciShip || 0)) * precisionShare;
  const skill = gain(SKILL), before = current[SKILL] || 0;
  value += 100 * skill / (110 + before) * coverage;
  if (before < 40 && before + skill >= 40) value += 5 * coverage;
  const vision = Math.min(Math.max(0, 150 - (current.visiShip || 0)), gain('visiShip'));
  // Every ten layers already produces money; reaching 150 is an extra goal, not the first useful reward.
  // Even R13 income can fund the R14 prep. No unseen shop or future gift is simulated.
  if (vision) {
    value += vision * .3;
    if ((current.visiShip || 0) + vision >= 150) value += 5 * Math.min(1, remaining / 2);
  }
  return value;
}

/** Geometry makes proposals; only complete paired real forecasts select one. */
export function developmentLayoutValue(gd, units, plan, bonds, model, recipe) {
  if (!plan.developmentPhase) return 0;
  const withBonds = units.map(u => ({ ...u, bonds: pieceBonds(gd, plan.ps.find(u.uid)?.piece || { id: u.rec.chessId }) }));
  const fin = prepLayerForecast(gd, withBonds, bonds, 'SERVER_PREP_FIN', plan.ps.round.spent, plan.ps.round.refreshes);
  const effective = Object.fromEntries(Object.entries(bonds).map(([id, b]) => [id, { ...b, layers: b.layers + (fin[id] || 0) }]));
  const aura = skillfulCoverage(withBonds, effective);
  let value = aura.weighted * 2 + aura.minimum * 1.5;
  if (plan.developmentPhase !== 'farm') return value;
  const start = plan.ps.m.round < gd.bossRound - 1 ? prepLayerForecast(gd, withBonds, effective, 'SERVER_PREP_START') : {};
  const growth = Object.fromEntries([...new Set([...Object.keys(fin), ...Object.keys(start)])].map(id => [id, (fin[id] || 0) + (start[id] || 0)]));
  value += Math.min(5, developmentValue(plan.ps.layers, growth, aura.weighted, { remaining: gd.bossRound - plan.ps.m.round }));
  const mostima = units.find(u => base(gd, u) === recipe.ids.mostima);
  if (mostima) for (const u of units) if (u !== mostima && Math.abs(u.r - mostima.r) + Math.abs(u.c - mostima.c) === 1) {
    value += recipe.ammoWeight(u.rec) * recipe.firingShare(units, u, model) * .8;
  }
  const saint = units.find(u => base(gd, u) === recipe.ids.executorAlter);
  if (saint) {
    const share = recipe.firingShare(units, saint, model);
    value += share * 2 - recipe.executorRisk(units, saint, model);
    // Delay competing burst while keeping its existing range/position legal; real previews check cleanup.
    const competitors = units.filter(u => u !== saint && !u.heal && !isFormationAnchor(u.rec));
    const damage = competitors.reduce((s, u) => s + u.dps, 0) || 1;
    value -= competitors.reduce((s, u) => s + u.dps * recipe.firingShare(units, u, model), 0) / damage;
  }
  return value;
}

export function prepareDevelopmentInput(m, ps, chosen, plan, input) {
  if (!m.wave || m.round >= m.gd.bossRound) return input;
  const gd = ps.gd || m.gd;
  const units = chosen.filter(p => plan.has(p.uid)).map(p => {
    const [r, c] = plan.get(p.uid).split(',').map(Number);
    return { uid: p.uid, rec: gd.chess(p.id), bonds: pieceBonds(gd, p), r, c, key: `${r},${c}`, dir: plan.dirOf(p.uid) };
  });
  const fin = prepLayerForecast(gd, units, input.bonds, 'SERVER_PREP_FIN', ps.round.spent, ps.round.refreshes);
  for (const [id, n] of Object.entries(fin)) input.bonds[id].layers += n;
  const next = m.round < m.gd.bossRound - 1 ? prepLayerForecast(gd, units, input.bonds, 'SERVER_PREP_START') : {};
  plan.development = { fin, next, units };
  return input;
}

export function developmentContext(m, ps, chosen, plans, recipe) {
  if (!m.wave || m.round >= m.gd.bossRound) return null;
  const gd = ps.gd || m.gd, units = chosen.map(p => ({ uid: p.uid, rec: gd.chess(p.id) }));
  const carries = developmentCarries(units), protectedUids = new Set(chosen.filter(p =>
    gd.baseIdOf(p.id) === recipe.ids.executorAlter || isFormationAnchor(gd.chess(p.id))).map(p => p.uid));
  const before = ps._botDevelopmentForecast;
  const unexpected = before?.round === m.round - 1 && ps.lp < before.lp - before.worstLoss - 1;
  const precisionShare = !ps.bonds.preciShip?.active ? 0 : carries.reduce((sum, c) => {
    const rec = gd.chess(chosen.find(p => p.uid === c.uid).id);
    return sum + ((rec.bonds.includes('preciShip') || ps.bonds.preciShip.count >= 3 && rec.position === 'RANGED') ? c.weight : 0);
  }, 0) / (carries.reduce((sum, c) => sum + c.weight, 0) || 1);
  return { carries, protectedUids, layers: { ...ps.layers }, round: m.round, remaining: m.gd.bossRound - m.round,
    lp: ps.lp, spent: before?.spent || 0, allowRisk: ps.lp >= 14 && !unexpected,
    skillful: !!ps.bonds[SKILL]?.active, precisionShare,
    lemuen: chosen.some(p => gd.baseIdOf(p.id) === recipe.ids.lemuen), plans };
}

/** Observe actual aura state and protected deaths; no stats or effects are written into the battle. */
export function observeDevelopment(battle, ctx, plan) {
  const units = new Map(), deaths = new Map(), firstDeaths = new Map();
  const get = uid => { if (!units.has(uid)) units.set(uid, { alive: 0, covered: 0, attacks: 0, buffed: 0 }); return units.get(uid); };
  battle.on('attack', ({ attacker: u }) => {
    if (!ctx.carries.some(c => c.uid === u?.uid)) return;
    const r = get(u.uid); r.attacks++; if (u.findBuff('bond:skillfulShip')) r.buffed++;
  });
  battle.on('death', ({ unit: u, reason }) => { if (reason === 'killed' && ctx.protectedUids.has(u?.uid)) {
    deaths.set(u.uid, (deaths.get(u.uid) || 0) + 1); if (!firstDeaths.has(u.uid)) firstDeaths.set(u.uid, battle.time);
  } });
  const sample = () => { for (const u of battle.allyUnits || []) if (ctx.carries.some(c => c.uid === u.uid) && live(u)) {
    const r = get(u.uid); r.alive++; if (u.findBuff('bond:skillfulShip')) r.covered++;
  } };
  battle.on('tick', () => { if (battle.tickCount % 15 === 0) sample(); });
  return pp => {
    const fraction = c => { const r = get(c.uid); return r.attacks ? r.buffed / r.attacks : r.alive ? r.covered / r.alive : 0; };
    const weight = ctx.carries.reduce((s, c) => s + c.weight, 0) || 1;
    const coverage = ctx.skillful && ctx.carries.length ? ctx.carries.reduce((s, c) => s + c.weight * fraction(c), 0) / weight : 1;
    const minimum = ctx.skillful && ctx.carries.length ? Math.min(...ctx.carries.slice(0, 2).map(fraction)) : 1;
    const gains = { ...(pp.layerGains || {}) };
    for (const source of [plan.development?.fin, plan.development?.next]) for (const [id, n] of Object.entries(source || {})) gains[id] = (gains[id] || 0) + n;
    return { growth: developmentValue(ctx.layers, gains, coverage, ctx), coverage, auraMinimum: minimum,
      protectedDeaths: Object.fromEntries(deaths), protectedFirstDeaths: Object.fromEntries(firstDeaths), gains };
  };
}

/** First find the best nonleaking growth option, then charge a significant paired gain for limited extra LP. */
export function selectDevelopmentForecast(plans, outcomes, ctx) {
  const pairs = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = a => a.length === 2 && a.every((r, i) => r.valid && r.sample === i && Number.isFinite(r.growth));
  if (!valid(pairs[0])) return { index: 0, reference: 0, cost: 0 };
  const ids = pairs.map((a, i) => valid(a) ? i : -1).filter(i => i >= 0);
  let reference = 0;
  for (const i of ids) if (worst(pairs[i], 'lost') < worst(pairs[reference], 'lost')
    || worst(pairs[i], 'lost') === worst(pairs[reference], 'lost') && avg(pairs[i], 'lost') < avg(pairs[reference], 'lost')) reference = i;
  const ref = pairs[reference];
  const protectedSafe = rs => rs.every((r, sample) => [...ctx.protectedUids].every(uid =>
    (r.protectedDeaths?.[uid] || 0) <= (ref[sample].protectedDeaths?.[uid] || 0)
    && (r.protectedFirstDeaths?.[uid] ?? Infinity) + 1 >= (ref[sample].protectedFirstDeaths?.[uid] ?? Infinity)));
  const aura = rs => !ctx.skillful || floor(rs, 'auraMinimum') >= .8;
  const safe = ids.filter(i => protectedSafe(pairs[i]) && pairs[i].every((r, sample) =>
    r.lost <= ref[sample].lost && r.leaks <= ref[sample].leaks));
  const covered = safe.filter(i => aura(pairs[i]));
  // If geometry cannot cover both carries, retain the safest layout; never buy coverage with uncontrolled leaks.
  const bestCoverage = Math.max(0, ...safe.map(i => floor(pairs[i], 'auraMinimum')));
  const weightedCoverage = Math.max(0, ...safe.filter(i => floor(pairs[i], 'auraMinimum') >= bestCoverage - .01)
    .map(i => avg(pairs[i], 'coverage')));
  const pool = covered.length || !ctx.skillful ? (covered.length ? covered : safe)
    : safe.filter(i => floor(pairs[i], 'auraMinimum') >= bestCoverage - .01
      && avg(pairs[i], 'coverage') >= weightedCoverage - .01);
  let best = pool[0] ?? reference;
  for (const i of pool) if (avg(pairs[i], 'growth') > avg(pairs[best], 'growth') + .01
    || Math.abs(avg(pairs[i], 'growth') - avg(pairs[best], 'growth')) <= .01 && avg(pairs[i], 'coverage') > avg(pairs[best], 'coverage')) best = i;
  const safestBest = best;
  let cost = 0, bestUtility = avg(pairs[best], 'growth');
  if (ctx.allowRisk && worst(ref, 'lost') === 0 && ctx.spent < 4) for (const i of ids) {
    const rs = pairs[i], delta = rs.map((r, s) => Math.max(0, r.lost - ref[s].lost));
    const mean = delta.reduce((s, n) => s + n, 0) / 2, maximum = Math.max(...delta);
    if (!mean || mean > 1 || maximum > 2 || ctx.spent + maximum > 4 || ctx.lp - worst(rs, 'lost') < 12
      || !protectedSafe(rs) || !aura(rs)) continue;
    const gains = rs.map((r, s) => r.growth - pairs[safestBest][s].growth);
    // Significant in BOTH samples, beyond the best safe growth layout; utility already accounts for coverage/milestones.
    if (Math.min(...gains) < 3 + 3 * maximum) continue;
    const utility = avg(rs, 'growth') - mean * 6;
    if (utility > bestUtility + .01) { best = i; cost = maximum; bestUtility = utility; }
  }
  return { index: best, reference, cost, worstLoss: worst(pairs[best], 'lost'), growth: avg(pairs[best], 'growth'),
    coverage: avg(pairs[best], 'coverage'), auraSatisfied: aura(pairs[best]) };
}

/** Debit only an applied, completed choice, once per round. Forecasts themselves cannot consume the risk budget. */
export function commitDevelopment(m, ps, job) {
  if (!m.wave || !job?.development || !job.done || ps._botDevelopmentForecast?.round === m.round) return;
  if ([...job.best].some(([uid, key]) => ps.find(uid)?.key !== key || ps.find(uid)?.piece.dir !== job.best.dirOf(uid))) return;
  const old = ps._botDevelopmentForecast;
  ps._botDevelopmentForecast = { round: m.round, lp: ps.lp, spent: (old?.spent || 0) + job.development.cost,
    worstLoss: job.development.worstLoss || 0 };
  (ps._botDevelopmentHistory ||= []).push({ round: m.round, ...job.development, lp: ps.lp, spent: ps._botDevelopmentForecast.spent });
  const stats = ps._botRecipeStats ||= {};
  stats.forecastRounds = (stats.forecastRounds || 0) + 1;
  stats.forecastRiskRounds = (stats.forecastRiskRounds || 0) + (job.development.cost > 0 ? 1 : 0);
  stats.forecastRiskBudget = ps._botDevelopmentForecast.spent;
  stats.forecastAuraMisses = (stats.forecastAuraMisses || 0) + (job.development.auraSatisfied === false ? 1 : 0);
}
