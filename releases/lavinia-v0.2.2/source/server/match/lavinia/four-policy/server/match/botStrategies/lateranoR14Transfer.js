// [ASSUMED] Spend an idle sphere on a visible R14 transfer that improves the complete retained lineup score.
// Shadow membership uses real item records. No future shop, live combat result or game RNG is queried.
import { computeBonds, pieceBonds } from '../../../../../bondsMeta.js';

const SPHERE = 'chess_item_6_09_e_a', CORE = 'lateranoShip', PRECI = 'preciShip', STEAD = 'steadShip';
const SIGNATURES = ['chess_item_3_02_e_a', 'chess_item_4_08_e_a', 'chess_item_1_02_e_a'];
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
const loose = ps => [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');
const healing = rec => rec.attackKind === 'heal' || ['guardian', 'incantationmedic'].includes(rec.subProfessionId)
  || (rec.chessId || rec.id)?.replace(/_b$/, '_a') === 'chess_char_5_02_a';

/** Read-only player view; cache/route writes by inherited scoring cannot leak back to the real player. */
function shadow(ps, owned, removedItems = new Set()) {
  const copies = new Map(owned.map(p => [p.uid, { ...p, items: (p.items || []).filter(i => !removedItems.has(i.uid)) }]));
  const view = Object.assign(Object.create(Object.getPrototypeOf(ps)), ps, {
    board: new Map([...ps.board].filter(([, p]) => p.kind !== 'chess' || copies.has(p.uid)).map(([k, p]) => [k, copies.get(p.uid) || p])),
    hand: ps.hand.map(p => p && (removedItems.has(p.uid) ? null : p.kind === 'chess' ? copies.get(p.uid) || null : p)),
    temp: ps.temp.map(p => p && (removedItems.has(p.uid) ? null : p.kind === 'chess' ? copies.get(p.uid) || null : p)),
    _botRouteHistory: (ps._botRouteHistory || []).slice(), _botRecipeStats: { ...ps._botRecipeStats },
  });
  view.allChess = () => [...copies.values()];
  view.bonds = computeBonds(view.gd, view);
  return view;
}

function qualified(gd, p, bond) {
  const rec = gd.chess(p.id);
  if (pieceBonds(gd, p).includes(bond)) return false;
  if (bond === PRECI) return rec.tier >= 4 && !['TANK', 'MEDIC'].includes(rec.profession) && !['heal', 'none'].includes(rec.attackKind);
  if (bond === CORE) return rec.tier >= 4 && rec.bonds.some(b => ['skillfulShip', PRECI, STEAD].includes(b));
  return bond === STEAD && rec.tier >= 4 && ['TANK', 'WARRIOR', 'PIONEER'].includes(rec.profession) && rec.stats.blockCnt > 0 && rec.stats.def >= 250;
}

function funding(m, ps, carrier, price, protectedRoster) {
  const gd = gdOf(m, ps), owned = ps.allChess();
  const needed = new Set(protectedRoster.map(p => p.uid)), remaining = owned.slice();
  const critical = new Set(['chess_char_4_02_a', 'chess_char_5_01_a', 'chess_char_6_13_a', 'chess_char_6_01_a',
    'chess_char_3_21_a', 'chess_char_4_01_a', 'chess_char_4_21_a', 'chess_char_5_16_a', 'chess_char_5_02_a', 'chess_char_6_16_a']);
  const candidates = owned.filter(p => ['hand', 'temp'].includes(ps.find(p.uid)?.area) && p.uid !== carrier.uid && !p.items?.length
    && !needed.has(p.uid) && !critical.has(base(gd, p)) && !pieceBonds(gd, p).some(b => [CORE, 'maniShip'].includes(b))
    && !(gd.tierOf(p.id) >= 5 && pieceBonds(gd, p).some(b => [PRECI, 'skillfulShip'].includes(b)))
    && !(m.bossId === 'boss_4' && gd.chess(p.id).subProfessionId === 'wandermedic'))
    .sort((a, b) => Number(gd.isGolden(a.id)) - Number(gd.isGolden(b.id)) || gd.tierOf(a.id) - gd.tierOf(b.id) || a.uid - b.uid);
  const sales = []; let funds = ps.funds;
  const needsRoom = () => price > 0 && [...ps.hand, ...ps.temp].filter(Boolean).length - sales.length - 1 >= gd.benchSize;
  while ((funds < price || needsRoom()) && candidates.length) {
    const p = candidates.shift(), after = remaining.filter(q => q.uid !== p.uid);
    if (healing(gd.chess(p.id)) && !after.some(q => healing(gd.chess(q.id)))) continue;
    const partner = q => base(gd, q) !== 'chess_char_5_01_a' && pieceBonds(gd, q).includes('visiShip');
    if (remaining.some(q => base(gd, q) === 'chess_char_5_01_a') && partner(p) && !after.some(partner)) continue;
    const future = computeBonds(gd, { ...ps, hand: ps.hand.filter(q => q && after.some(x => x.uid === q.uid)) });
    if (ps.bonds.visiShip?.active && !future.visiShip?.active) continue;
    sales.push(p); remaining.splice(remaining.indexOf(p), 1); funds += gd.sellPrice(p.id);
  }
  return funds >= price && !needsRoom() ? sales : null;
}

function safeRoster(gd, ps, before, after, carrier) {
  if (!after.some(p => p.uid === carrier.uid)) return false;
  const bonds = pieces => computeBonds(gd, { ...ps, board: new Map(pieces.map(p => [p.uid, p])), hand: ps.allChess().filter(p => !pieces.some(q => p.uid === q.uid)) });
  const old = bonds(before), next = bonds(after);
  if ((next[CORE]?.count || 0) < Math.min(6, old[CORE]?.count || 0)) return false;
  if ((old[PRECI]?.count || 0) >= 3 && (next[PRECI]?.count || 0) < 3) return false;
  for (const id of ['chess_char_6_13_a', 'chess_char_6_01_a']) if (before.some(p => base(gd, p) === id) && !after.some(p => base(gd, p) === id)) return false;
  if (before.some(p => healing(gd.chess(p.id))) && !after.some(p => healing(gd.chess(p.id)))) return false;
  if (before.some(p => gd.chess(p.id).profession === 'TANK') && !after.some(p => gd.chess(p.id).profession === 'TANK')) return false;
  return true;
}

/** Existing signatures and visible shop signatures compete; an existing three-Precision roster is not a veto. */
export function lateranoR14TransferPlan(m, ps, tools) {
  const gd = gdOf(m, ps);
  if (m.round !== gd.bossRound || !tools?.lineupFor) return null;
  const sphere = loose(ps).find(p => base(gd, p) === SPHERE);
  if (!sphere) return null;
  const owned = ps.allChess(), inventory = loose(ps), onItems = owned.flatMap(p => (p.items || []).map(item => ({ item, holder: p.uid })));
  const options = [
    ...inventory.filter(p => SIGNATURES.includes(base(gd, p))).map(item => ({ item, holder: null, price: 0 })),
    ...onItems.filter(({ item }) => SIGNATURES.includes(base(gd, item))).map(x => ({ ...x, price: 0 })),
    ...ps.shop.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot?.kind === 'item' && !slot.sold && SIGNATURES.includes(base(gd, slot)))
      .map(({ slot, index }) => ({ item: { id: slot.id, uid: -1 }, slot, index, price: ps.priceOf(slot) })),
  ];
  if (!options.length) return null;
  const original = tools.lineupFor(shadow(ps, owned));
  const plans = [];
  for (const option of options) {
    const bond = gd.item(option.item.id).giveBondId;
    for (const carrier of owned) {
      if (option.holder != null && option.holder !== carrier.uid || !qualified(gd, carrier, bond)) continue;
      const sales = funding(m, ps, carrier, option.price, original.set); if (!sales) continue;
      const removed = new Set([sphere.uid]), donor = option.slot && !gd.item(option.item.id).isGolden
        ? [...inventory, ...onItems.map(x => x.item)].find(i => i.id === option.item.id) : null;
      // Buying a second ordinary item really merges and unloads the old one; predict that same membership.
      if (donor) removed.add(donor.uid);
      if (option.holder == null && option.item.uid !== -1) removed.add(option.item.uid);
      const view = shadow(ps, owned.filter(p => !sales.includes(p)), removed), target = view.allChess().find(p => p.uid === carrier.uid);
      if (!target) continue;
      const signature = donor ? { id: gd.item(option.item.id).upgradeChessId, uid: -2 } : option.item;
      const added = [sphere, ...(option.holder == null ? [signature] : [])];
      if (target.items.length + added.length > gd.equipPerChess) continue;
      target.items.push(...added); view.bonds = computeBonds(gd, view);
      const next = tools.lineupFor(view);
      if (!safeRoster(gd, view, original.set, next.set, target)) continue;
      // New item slots alone score +5 each in the shared heuristic. Require actual bond/roster utility beyond that.
      const itemDifference = next.set.reduce((s, p) => s + p.items.length, 0) - original.set.reduce((s, p) => s + (p.items?.length || 0), 0);
      const gain = next.score - original.score - itemDifference * 5;
      if (!(gain > option.price * 2 + sales.length * 2 + 0.5)) continue;
      plans.push({ ...option, sphere, carrier, bond, sales, gain, mergedId: signature.id,
        before: original.set.map(p => p.uid), after: next.set.map(p => p.uid), beforeScore: original.score, afterScore: next.score });
    }
  }
  const primary = p => ['chess_char_6_13_a', 'chess_char_6_01_a'].includes(base(gd, p));
  return plans.sort((a, b) => b.gain - a.gain || a.price - b.price || Number(primary(b.carrier)) - Number(primary(a.carrier)) || a.carrier.uid - b.carrier.uid)[0] || null;
}

const committed = (m, ps) => {
  const state = ps._botR14SphereTransfer;
  return state && m.round >= m.gd.bossRound ? ps.allChess().find(p => (p.items || []).some(i => i.uid === state.sphereUid)
    && pieceBonds(gdOf(m, ps), p).includes(state.bond)) : null;
};

export function withLateranoR14Transfer(recipe) {
  return Object.freeze({ ...recipe,
    trade(m, ps, ctx, tools) {
      if (recipe.trade(m, ps, ctx, tools)) return true;
      const plan = lateranoR14TransferPlan(m, ps, tools); if (!plan) return false;
      const audit = { round: m.round, target: plan.carrier.id, targetUid: plan.carrier.uid, bond: plan.bond,
        item: plan.item.id, price: plan.price, funds: ps.funds, gain: plan.gain, before: plan.before, after: plan.after,
        sales: [], bought: false, equipped: false };
      (ps._botR14TransferHistory ||= []).push(audit);
      for (const sale of plan.sales) { if (!ps.sell(sale.uid)?.ok) return false; audit.sales.push({ uid: sale.uid, id: sale.id }); }
      if (plan.slot) {
        // Equip the sphere first to free one hand slot; it is guaranteed to fit and reserved for this carrier.
        if (!ps.hand.some(p => !p) && !ps.equip(plan.sphere.uid, plan.carrier.uid)?.ok) return false;
        if (!ps.hand.some(p => !p)) return false;
        const settled = recipe.observeSpend?.(m, ps), result = ps.buy(plan.index); settled?.();
        audit.bought = !!result?.ok; if (!result?.ok) return false;
      }
      const sig = plan.holder === plan.carrier.uid ? plan.item : loose(ps).find(i => i.id === plan.mergedId);
      if (!sig) return false;
      const equip = (item, p) => ps.find(item.uid)?.area === 'equipped' || !!ps.equip(item.uid, p.uid)?.ok;
      if (!equip(plan.sphere, plan.carrier) || !equip(sig, plan.carrier)) return false;
      audit.equipped = true;
      ps._botR14SphereTransfer = { sphereUid: plan.sphere.uid, bond: plan.bond, signature: base(gdOf(m, ps), sig) };
      recipe.useEconomy(m, ps);
      return true;
    },
    lineupBonus(gd, pieces, bonds, plan) {
      const target = committed(plan.ps.m, plan.ps);
      return recipe.lineupBonus(gd, pieces, bonds, plan) - (target && !pieces.some(p => p.uid === target.uid) ? 5000 : 0);
    },
    preserve(m, ps, rec) {
      const target = committed(m, ps);
      return target && base(gdOf(m, ps), rec) === base(gdOf(m, ps), target) || recipe.preserve(m, ps, rec);
    },
    purchaseItemAllowed(m, ps, rec) {
      const target = committed(m, ps);
      if (target && base(gdOf(m, ps), rec) === ps._botR14SphereTransfer.signature) return false;
      return recipe.purchaseItemAllowed(m, ps, rec);
    },
    itemReplacement(m, ps, rec, p) {
      if (committed(m, ps)?.uid === p.uid && p.items.length >= gdOf(m, ps).equipPerChess) return false;
      return recipe.itemReplacement?.(m, ps, rec, p);
    },
  });
}
