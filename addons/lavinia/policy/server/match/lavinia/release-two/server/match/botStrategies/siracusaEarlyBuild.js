// [ASSUMED] Independent early construction trials, never enabled by the retained recipe.
// Own visible shop/assets only. No future offers, combat seeds, sales or extra refreshes.
import { pieceBonds } from '../../../../../../../../../bondsMeta.js';
import { earlyBridgeBudget } from './siracusaEarlyBridge.js';
import { stealthBattleInput } from './lateranoStealthWave.js';

export const SIRACUSA_EARLY_BUILDS = Object.freeze(['wind-elite', 'stead-build']);
const CORE = 'siracusaShip', STEAD = 'steadShip', WIND = 'chess_char_2_11_a';
const STEADS = ['chess_char_1_10_a', 'chess_char_2_18_a', 'chess_char_1_02_a', 'chess_char_2_08_a', 'chess_char_2_17_a'];
const base = (ps, p) => ps.gd.baseIdOf(p.id);
const has = (ps, p, id) => pieceBonds(ps.gd, p).includes(id);
const kinds = (ps, xs, id) => new Set(xs.filter(p => has(ps, p, id)).map(p => base(ps, p))).size;
const heal = r => r.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(r.subProfessionId);

export const earlyBuildScope = (m, ps, transfer = false) => m.difficulty === 'ABYSS' && !!m.wave
  && ps.bandId === 'band_chiave' && ps._botFocusId === CORE && (transfer
    ? m.mode === 'solo' && m.isSolo && m.order.length === 1 || m.mode === 'coop' && !m.isSolo && m.order.length === 4
    : m.mode === 'coop' && !m.isSolo && m.order.length === 2);

/** One real visible component at a time; allow neutral current-wave results to invest in completion. */
export function earlyBuildBundles(parent, m, ps, mode, { transfer = false } = {}) {
  if (!SIRACUSA_EARLY_BUILDS.includes(mode) || !earlyBuildScope(m, ps, transfer) || transfer && mode !== 'wind-elite'
    || m.round < 4 || m.round > 7 || ps.shop.level >= 4 || !ps.hand.some(p => !p)) return [];
  const owned = ps.allChess(), nativeCount = kinds(ps, owned, CORE), wind = owned.filter(p => base(ps, p) === WIND);
  const held = new Set(owned.filter(p => has(ps, p, STEAD)).map(p => base(ps, p)));
  const paid = new Set(ps._botSteadDemandPaid || []), spent = ps._botEarlyBridgeGold || 0;
  if (!nativeCount || nativeCount >= 6 || mode === 'wind-elite' && (wind.some(p => ps.gd.isGolden(p.id)) || m.round === 7 && !wind.length)
    || mode === 'stead-build' && (held.size >= 3 || ps.gd.modeInactiveBonds.has(STEAD))) return [];
  const budget = earlyBridgeBudget(parent, m, ps);
  if (budget.defer || budget.giftDistance === 1) return [];
  const slots = ps.shop.slots.map((s, index) => ({ s, index })).filter(x => x.s?.kind === 'chess' && !x.s.sold);
  if (slots.some(({ s }) => ps.priceOf(s) <= ps.funds && parent.purchaseAllowed(m, ps, ps.gd.chess(s.id))
    && (ps.gd.chess(s.id).bonds.includes(CORE) || parent.importantBuy?.(m, ps, ps.gd.chess(s.id))
      || parent.criticalBuy?.(m, ps, ps.gd.chess(s.id), { route: ps._botRoute })))) return [];
  return slots.filter(({ s }) => {
    const id = base(ps, s), price = ps.priceOf(s);
    return !ps.gd.isGolden(s.id) && price <= 3 && spent + price <= (mode === 'wind-elite' ? 6 : 8)
      && ps.funds - price >= budget.reserve && (mode === 'wind-elite' ? id === WIND
        : STEADS.includes(id) && !held.has(id) && !paid.has(id));
  }).sort((a, b) => (mode === 'stead-build' ? STEADS.indexOf(base(ps, a.s)) - STEADS.indexOf(base(ps, b.s)) : 0)
    || a.index - b.index).slice(0, 3).map(e => ({ entries: [e], count: mode === 'stead-build' ? held.size + 1 : 0,
    price: ps.priceOf(e.s), reserve: budget.reserve, budget, purpose: mode === 'wind-elite'
      ? wind.length ? 'wind-two-copy-elite' : 'wind-first-component' : 'stead-component-' + (held.size + 1),
    eliteWind: mode === 'wind-elite' && wind.length === 1 }));
}

/** Keep every available native KIND and its strongest copy; duplicate growth may bench, never sell. */
export function earlyBuildLineup(ps, suggested, count, { required = [] } = {}) {
  const owned = ps.allChess(), selected = [], add = p => { if (p && !selected.includes(p)) selected.push(p); };
  const quality = p => ps.gd.chess(p.id).tier + Number(ps.gd.isGolden(p.id)) * 5;
  const ordered = owned.slice().sort((a, b) => quality(b) - quality(a) || Number(suggested.includes(b)) - Number(suggested.includes(a)) || a.uid - b.uid);
  const owners = new Set([...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'token').map(p => p.ownerUid));
  for (const p of [...ps.board.values()].filter(p => p.kind === 'chess'))
    if (owners.has(p.uid) || p.items?.length || base(ps, p) === 'chess_char_4_10_a' || ps.bonds.raidShip?.active && has(ps, p, 'raidShip')) add(p);
  const target = Math.min(6, kinds(ps, owned, CORE));
  for (const p of ordered) if (has(ps, p, CORE) && kinds(ps, selected, CORE) < target && !selected.some(q => base(ps, q) === base(ps, p))) add(p);
  for (const p of required) add(p);
  if (count) for (const p of ordered) if (has(ps, p, STEAD) && kinds(ps, selected, STEAD) < count && !selected.some(q => base(ps, q) === base(ps, p))) add(p);
  if (suggested.some(p => heal(ps.gd.chess(p.id))) && !selected.some(p => heal(ps.gd.chess(p.id)))) add(ordered.find(p => heal(ps.gd.chess(p.id))));
  if (selected.length > ps.deployCap) return null;
  for (const p of [...suggested, ...ordered]) if (selected.length < Math.min(ps.deployCap, owned.length)) add(p);
  if (selected.length > ps.deployCap || selected.length < [...ps.board.values()].filter(p => p.kind === 'chess').length
    || kinds(ps, selected, CORE) < target || count && kinds(ps, selected, STEAD) < count) return null;
  if (['swiftShip', 'arcaneShip', 'raidShip'].some(id => ps.bonds[id]?.active && kinds(ps, selected, id) < ps.gd.bond(id).activeCount)) return null;
  return selected;
}

/** A legal final roster need not have a legal reciprocal floor/high-ground entry swap.
 * Plan the real moves before paying. A spare bench slot breaks mixed-placement cycles;
 * occupied bench slots are never overwritten and unsupported temp auto-fill is rejected.
 * No PlayerState method, live piece, counter or RNG is mutated during this dry run.
 */
export function earlyBuildMoves(ps, plan) {
  if (ps.temp.some(Boolean)) return null;
  const pieces = new Map(ps.allChess().map(p => [p.uid, p])), board = new Map(), hand = ps.hand.map(p => p?.uid ?? null);
  const loc = new Map(), dirs = new Map(), blocked = new Set(), actions = [];
  for (const [key, p] of ps.board) {
    if (p.kind !== 'chess') { blocked.add(key); continue; }
    board.set(key, p.uid); loc.set(p.uid, { area: 'board', key }); dirs.set(p.uid, p.dir);
  }
  ps.hand.forEach((p, index) => { if (p?.kind === 'chess') loc.set(p.uid, { area: 'hand', index }); });
  const legal = (uid, key) => ps._legal(pieces.get(uid), ...key.split(',').map(Number));
  const act = (uid, to, dir) => {
    const from = loc.get(uid); if (!from) return false;
    if (to.area === 'hand') {
      if (from.area !== 'board' || hand[to.index] !== null) return false;
      board.delete(from.key); hand[to.index] = uid; loc.set(uid, to);
    } else {
      if (blocked.has(to.key) || !legal(uid, to.key)) return false;
      const other = board.get(to.key);
      if (other !== undefined && other !== uid && from.area === 'board' && !legal(other, from.key)) return false;
      if (from.area === 'hand' && other === undefined && board.size >= ps.deployCap) return false;
      if (from.area === 'board') { board.delete(from.key); if (other !== undefined && other !== uid) { board.set(from.key, other); loc.set(other, from); } }
      else { hand[from.index] = other ?? null; if (other !== undefined) loc.set(other, from); }
      board.set(to.key, uid); loc.set(uid, to); dirs.set(uid, dir);
    }
    actions.push({ uid, to, dir }); return true;
  };
  const selected = new Set(plan.lineup.map(p => p.uid));
  for (let pass = 0; pass < 4 * (plan.lineup.length + board.size + 1); pass++) {
    const outgoing = [...board.values()].find(uid => !selected.has(uid)), freeHand = hand.indexOf(null);
    if (outgoing !== undefined && freeHand >= 0 && act(outgoing, { area: 'hand', index: freeHand })) continue;
    const pending = plan.lineup.filter(p => loc.get(p.uid)?.area !== 'board' || loc.get(p.uid)?.key !== plan.get(p.uid));
    if (!pending.length) {
      if ([...board.values()].some(uid => !selected.has(uid))) return null;
      for (const p of plan.lineup) if (dirs.get(p.uid) !== plan.dirs.get(p.uid)
        && !act(p.uid, { area: 'board', key: plan.get(p.uid) }, plan.dirs.get(p.uid))) return null;
      return actions;
    }
    // Empty final cells first; bench -> occupied final cell safely takes its occupant to that bench slot.
    const ordered = pending.slice().sort((a, b) => Number(board.has(plan.get(a.uid))) - Number(board.has(plan.get(b.uid)))
      || Number(loc.get(a.uid)?.area === 'board') - Number(loc.get(b.uid)?.area === 'board'));
    let progress = false;
    for (const p of ordered) if (act(p.uid, { area: 'board', key: plan.get(p.uid) }, plan.dirs.get(p.uid))) { progress = true; break; }
    if (progress) continue;
    const free = hand.indexOf(null), moving = pending.find(p => loc.get(p.uid)?.area === 'board')
      || [...board.values()].filter(uid => !selected.has(uid)).map(uid => pieces.get(uid))[0];
    if (free < 0 || !moving || !act(moving.uid, { area: 'hand', index: free })) return null;
  }
  return null;
}

export function applyEarlyBuildPlan(ps, plan) {
  const actions = earlyBuildMoves(ps, plan); if (!actions) throw Error('Unvalidated early construction move path');
  const identity = () => JSON.stringify(ps.allChess().map(p => [p.uid, p.id, p.items]).sort((a, b) => a[0] - b[0]));
  const before = identity(), expected = stealthBattleInput(ps, plan);
  for (const { uid, to, dir } of actions) {
    const dest = to.area === 'board' ? { area: 'board', row: +to.key.split(',')[0], col: +to.key.split(',')[1] } : { area: 'hand', idx: to.index };
    if (!ps.move(uid, dest, dir)?.ok) throw Error('Validated early construction move rejected');
  }
  if (identity() !== before || JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Early construction differs from forecast');
}
