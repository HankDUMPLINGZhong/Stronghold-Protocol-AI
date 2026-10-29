// [ASSUMED] Optional hidden-wave repair after spending: public geometry and owned substitutes propose;
// common independent forecasts accept safety improvements. No shopping, actual result or seed-specific tile.
import { computeBonds } from '../../../../../bondsMeta.js';
import { createForecastSteps, FORECAST_SAMPLES } from '../botForecast.js';
import { prepareDevelopmentInput } from '../botLateranoDevelopment.js';
import { acceptsHealing, healingTiles } from '../botPositioning.js';
import { applyControlPositions } from './lateranoControlBoss.js';
import { windowLayoutValue } from './lateranoWindowRefinement.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';

const CORE = 'lateranoShip', DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const MAIN = new Set(['chess_char_6_13_a', 'chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_21_a']);
const field = ps => [...ps.board.values()].filter(p => p.kind === 'chess');
const base = (gd, p) => gd.baseIdOf(p.id);
const healer = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);
const tank = r => r.profession === 'TANK' && (r.stats?.blockCnt || 0) > 0;
const resolved = (ps, rec) => loadoutRecord(rec, resolveRecordLoadout(rec, ps.loadoutFor?.(rec)));

export function stealthWaveInfo(m, gd) {
  const hidden = (m.wave?.spawns || []).filter(s => gd.enemy(s.enemyKey)?.acTypes?.includes('INVISIBLE'));
  return { count: hidden.reduce((n, s) => n + (s.count || 1), 0),
    ranged: hidden.some(s => gd.enemy(s.enemyKey)?.applyWay === 'RANGED') };
}

/** Ordinary shotprotectors cannot reveal at range. Blocking can still expose an enemy. */
export function stealthRevealer(rec) {
  return rec.subProfessionId === 'shotprotector' && rec.module?.active === true && rec.module.type === 'SPT-X'
    || rec.charId === 'char_4087_ines';
}

function shadow(ps, chosen, plan) {
  const selected = new Set(chosen.map(p => p.uid)), view = Object.assign(Object.create(ps), {
    board: new Map([...ps.board].filter(([, p]) => p.kind !== 'chess')),
    hand: ps.hand.map(p => selected.has(p?.uid) ? null : p),
    temp: ps.temp.filter(p => !selected.has(p?.uid)), _legalityStale: false,
  });
  view.hand.push(...field(ps).filter(p => !selected.has(p.uid)));
  for (const p of chosen) view.board.set(plan.get(p.uid), { ...p, dir: plan.dirs.get(p.uid) });
  view.bonds = computeBonds(ps.gd, view);
  return view;
}

/** Real constructor preserves reading order, loadouts, cultivation, items and pinned tokens. */
export function stealthBattleInput(ps, plan) { return shadow(ps, plan.lineup, plan).battleInput(); }

/** Capped fatal losses must distinguish forty leaks from fifteen, to permit a second contact repair.
 * No displacement of all-clear farming, no regression in either complete common sample.
 */
export function selectStealthRepair(plans, outcomes) {
  const rows = plans.map((_, i) => outcomes.filter(r => r.index === i).sort((a, b) => a.sample - b.sample));
  const valid = rs => rs.length === FORECAST_SAMPLES && rs.every((r, i) => r.valid && r.sample === i);
  if (!valid(rows[0]) || rows[0].every(r => r.leaks === 0)) return { index: 0 };
  const rank = rs => [-Math.max(...rs.map(r => r.lost)), -rs.reduce((n, r) => n + r.lost, 0),
    -Math.max(...rs.map(r => r.leaks)), -rs.reduce((n, r) => n + r.leaks, 0)];
  const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  let index = 0, score = rank(rows[0]);
  for (let i = 1; i < plans.length; i++) {
    if (!valid(rows[i]) || rows[i].some((r, j) => r.lost > rows[0][j].lost || r.leaks > rows[0][j].leaks)) continue;
    const next = rank(rows[i]); if (better(next, score)) { index = i; score = next; }
  }
  return { index };
}

function incumbent(ps, helpers) {
  const plan = new helpers.LayoutPlan(); plan.lineup = field(ps);
  for (const [key, p] of ps.board) if (p.kind === 'chess') { plan.set(p.uid, key); plan.dirs.set(p.uid, p.dir); }
  return plan;
}

/** Retain six/current core membership, carries, existing healing and the last tank; never remove token owners. */
export function stealthRosterPlans(ps, helpers, recipe) {
  const gd = ps.gd, original = incumbent(ps, helpers), chosen = original.lineup;
  const hasTank = chosen.some(p => tank(gd.chess(p.id)));
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const value = p => { const r = helpers.rangeRec(ps, gd.chess(p.id)), id = base(gd, p);
    return r.tier * 4 + (gd.isGolden(p.id) ? 12 : 0) + (MAIN.has(id) ? 70 : 0) + (stealthRevealer(resolved(ps, r)) ? 15 : 0); };
  const additions = ps.allChess().filter(p => !chosen.includes(p) && (MAIN.has(base(gd, p))
    || stealthRevealer(resolved(ps, gd.chess(p.id))) || tank(gd.chess(p.id))));
  const count = ps.bonds[CORE]?.count || 0, proposals = [];
  for (const added of additions) for (const removed of chosen) {
    const r = gd.chess(removed.id), id = base(gd, removed), a = gd.chess(added.id);
    if (owners.has(removed.uid) || MAIN.has(id) || id === recipe.ids.mostima) continue;
    if (healer(r) && !chosen.some(p => p !== removed && healer(gd.chess(p.id))) && !healer(a)) continue;
    if (tank(r) && !chosen.some(p => p !== removed && tank(gd.chess(p.id))) && !tank(a)) continue;
    const key = original.get(removed.uid), [row, col] = key.split(',').map(Number);
    if (!ps._legal(added, row, col)) continue;
    const plan = new helpers.LayoutPlan(); plan.lineup = chosen.map(p => p === removed ? added : p);
    for (const p of plan.lineup) { plan.set(p.uid, p === added ? key : original.get(p.uid)); plan.dirs.set(p.uid, p === added ? original.dirs.get(removed.uid) : p.dir); }
    if ((shadow(ps, plan.lineup, plan).bonds[CORE]?.count || 0) < Math.min(6, count)) continue;
    const score = value(added) - value(removed) + (!hasTank && tank(a) ? 35 : 0); if (score <= 0) continue;
    proposals.push({ plan, score, uid: added.uid, removed: removed.uid, addsTank: tank(a) });
  }
  proposals.sort((a, b) => b.score - a.score || a.uid - b.uid || a.removed - b.removed);
  const selected = proposals.slice(0, 2);
  if (!hasTank && proposals.some(p => p.addsTank) && !selected.some(p => p.addsTank)) selected[1] = proposals.find(p => p.addsTank);
  return [original, ...selected.map(p => p.plan)];
}

/** Two public proposals: shared firing window and earlier interception before hidden ranged units hit the backline. */
export function stealthContactPlans(m, ps, helpers) {
  const original = incumbent(ps, helpers), chosen = original.lineup, model = helpers.fieldModel(m, ps);
  const recs = chosen.map(p => helpers.rangeRec(ps, ps.gd.chess(p.id)));
  const owners = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const reserved = new Set([...ps.board].filter(([, p]) => p.kind !== 'chess').map(([key]) => key));
  const options = chosen.map((p, i) => {
    const out = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      const key = `${r},${c}`; if (reserved.has(key) || !ps._legal(p, r, c)) continue;
      for (const dir of DIRS) {
        if (owners.has(p.uid) && (key !== original.get(p.uid) || dir !== original.dirs.get(p.uid))) continue;
        out.push({ key, r, c, dir, cover: new Set(helpers.rangeTiles(recs[i], r, c, dir)), heal: healingTiles(recs[i], r, c, dir) });
      }
    }
    return out;
  });
  const layout = chosen.map((p, i) => options[i].find(o => o.key === original.get(p.uid) && o.dir === p.dir));
  if (layout.some(p => !p)) return [original];
  const info = recs.map((r, i) => ({ weight: MAIN.has(base(ps.gd, chosen[i])) ? 9 : tank(r) ? 1 : Math.max(1, r.tier / 2),
    primary: MAIN.has(base(ps.gd, chosen[i])), front: tank(r), healer: healer(r), healable: acceptsHealing(r),
    dealer: !['heal', 'none'].includes(r.attackKind) && r.subProfessionId !== 'bard', air: !!r.canHitFly,
    skill: r.bonds?.includes('skillfulShip'), mostima: false }));
  const ctx = { info, routes: model.routes.filter(r => !r.fallback && r.n > 0), bodies: [], normal: true,
    skillActive: !!ps.bonds.skillfulShip?.active, diagonal: (ps.layers.skillfulShip || 0) >= 40 };
  const fronts = chosen.map((p, i) => ({ p, i, rec: recs[i] })).filter(x => tank(x.rec) && !owners.has(x.p.uid))
    .sort((a, b) => b.rec.tier - a.rec.tier || (b.rec.stats?.def || 0) - (a.rec.stats?.def || 0)).slice(0, 2);
  const proposals = [];
  for (const { i } of fronts) for (const next of options[i]) {
    const j = layout.findIndex((o, n) => n !== i && o.key === next.key), trial = layout.slice(); trial[i] = next;
    if (j >= 0) {
      const swap = options[j].find(o => o.key === layout[i].key && o.dir === layout[j].dir); if (!swap) continue;
      trial[j] = swap;
    }
    if (trial.every((o, k) => o.key === layout[k].key && o.dir === layout[k].dir)) continue;
    let early = 0;
    for (const rt of ctx.routes.filter(r => !r.fly)) {
      const at = rt.tiles.indexOf(next.key); if (at < 0) continue;
      const ahead = rt.tiles[Math.max(0, at - 1)];
      const support = trial.reduce((n, p, k) => n + (info[k].dealer && p.cover.has(ahead) ? info[k].weight : 0), 0);
      early += rt.n * ((rt.tiles.length - at) * 4 + (next.cover.has(ahead) ? 8 : -8) + Math.min(18, support));
    }
    proposals.push({ trial, shared: windowLayoutValue(trial, ctx), early });
  }
  if (!proposals.length) return [original];
  const best = proposals.slice().sort((a, b) => b.shared - a.shared)[0];
  const forward = proposals.slice().sort((a, b) => b.early - a.early || b.shared - a.shared)[0];
  const plans = [original], seen = new Set();
  for (const proposal of [best, forward]) {
    const sig = proposal.trial.map(p => `${p.key}:${p.dir}`).join('|'); if (seen.has(sig)) continue; seen.add(sig);
    const p = new helpers.LayoutPlan(); p.lineup = chosen;
    proposal.trial.forEach((o, i) => { p.set(chosen[i].uid, o.key); p.dirs.set(chosen[i].uid, o.dir); }); plans.push(p);
  }
  return plans;
}

export function* lateranoStealthSteps(m, ps, helpers, recipe) {
  if (!m.isSolo || !m.wave || m.round >= m.gd.bossRound || m.botRehearsal < 2
    || !stealthWaveInfo(m, ps.gd).count || field(ps).length < 3) return;
  const start = performance.now(), batches = [];
  for (const stage of ['roster', 'contact']) {
    const plans = stage === 'roster' ? stealthRosterPlans(ps, helpers, recipe) : stealthContactPlans(m, ps, helpers);
    if (plans.length < 2) continue;
    const policy = { prepareForecastInput: (m, ps, chosen, plan, input) => prepareDevelopmentInput(m, ps, plan.lineup, plan, input),
      forecastContext: () => ({}), observeForecast: () => () => ({}), selectForecast: selectStealthRepair };
    function* inputSteps(plan) { yield; return stealthBattleInput(ps, plan); }
    const job = yield* createForecastSteps(m, ps, plans[0].lineup, plans, inputSteps, policy);
    if (!job) continue; while (!job.run(4)) yield;
    if (job.bestIndex) {
      const best = job.best, added = best.lineup.filter(p => !plans[0].lineup.includes(p)), removed = plans[0].lineup.filter(p => !best.lineup.includes(p));
      for (let i = 0; i < added.length; i++) {
        const [row, col] = plans[0].get(removed[i].uid).split(',').map(Number);
        const result = ps.move(added[i].uid, { area: 'board', row, col }, best.dirs.get(added[i].uid));
        if (result?.error) throw Error(`Stealth roster swap rejected: ${result.error}`);
      }
      applyControlPositions(ps, best);
      for (const [uid, key] of best) if (ps.find(uid)?.key !== key || ps.find(uid)?.piece.dir !== best.dirs.get(uid))
        throw Error('Stealth placement did not match its forecast');
    }
    batches.push({ stage, index: job.bestIndex, outcomes: job.outcomes, candidates: plans.map(plan => ({
      positions: [...plan].map(([uid, key]) => ({ uid, key, dir: plan.dirs.get(uid) })) })) });
  }
  (ps._botStealthHistory ||= []).push({ round: m.round, batches, ms: performance.now() - start });
}

export function withLateranoStealthWave(recipe) {
  return Object.freeze({ ...recipe, *finalBoardSteps(m, ps, helpers) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m, ps, helpers);
    yield* lateranoStealthSteps(m, ps, helpers, recipe);
  } });
}
