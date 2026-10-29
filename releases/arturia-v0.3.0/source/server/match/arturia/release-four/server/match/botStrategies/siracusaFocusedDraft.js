// User policy: two R1 defenders, then core or route-relevant layer engines; one of each investor, three total.
// [ASSUMED] Public-current-wave clearance uses two independent seeds; no unseen rolls or actual combat seed.
import { bankRemainder } from '../botSavings.js';
const CORE = 'siracusaShip', LAPPLAND = 'chess_char_2_16_a';
const EARLY_MERGES = new Set(['chess_char_1_08_a','chess_char_1_07_a']);
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
export const draftFrontline = rec => rec?.position === 'MELEE' && (rec.stats?.blockCnt || 0) >= 1;
const opening = (m,ps) => {
  if (m.round !== 2 && m.round !== 3) return null;
  const hasFront = ps.allChess().some(p => draftFrontline(gdOf(m,ps).chess(p.id)));
  const state = ps._botDraftOpening ||= { startedWithFront: hasFront, filled: false };
  if (!state.startedWithFront && hasFront) state.filled = true;
  return state;
};
const needsFront = (m,ps) => { const st = opening(m,ps); return m.round === 3 && !!st && !st.startedWithFront && !st.filled; };
export function draftShopKey(m,ps,rec) {
  if (!rec) return false;
  const gd=gdOf(m,ps),id=base(gd,rec);
  return id===LAPPLAND || EARLY_MERGES.has(id) && !ps.allChess().some(p=>base(gd,p)===id && gd.isGolden(p.id));
}
export function draftRouteBonds(ps) {
  return ps._botRoute?.id === 'siracusaShip:arcane-raid' ? ['arcaneShip', 'raidShip'] : ['swiftShip'];
}

/** Membership alone does not stack a bond. Read generated server gains and battle layer triggers. */
export function routeLayerEngine(gd, rec, selected) {
  if (!rec?.bonds?.some(b => selected.includes(b))) return false;
  const stack = g => {
    if (!g) return false;
    if (g.effectKey === 'ADD_BOND' && g.bbStr?.give_garrison_id) return stack(gd.garrison(g.bbStr.give_garrison_id));
    if (['SERVER_ADD_BOND_CHESS_ALL', 'SERVER_ADD_BOND_POSITION'].includes(g.effectKey)) return (g.bb?.count || 0) > 0;
    const named = (g.bbStr?.bond || g.bbStr?.bond_id || '').split(',');
    if (g.effectKey?.startsWith('SERVER_ADD_') && g.effectKey.includes('BOND')) return named.some(b => selected.includes(b));
    return (g.bb?.bond_add_count || 0) > 0 && (g.bbStr?.bond_type === 'bond_self' || named.some(b => selected.includes(b)));
  };
  return (rec.garrisonIds || []).some(id => stack(gd.garrison(id)));
}

export function draftAllowed(m, ps, rec, { purchase = true } = {}) {
  if (!rec) return false;
  const gd = gdOf(m, ps), owned = ps.allChess(), id = base(gd, rec);
  if (rec.bonds.includes('investShip')) {
    if (owned.some(p => base(gd, p) === id)) return false;
    const investors = new Set(owned.filter(p => gd.chess(p.id)?.bonds.includes('investShip')).map(p => base(gd,p)));
    if (investors.size >= 3) return false;
  }
  if (m.round === 1) {
    if (owned.length >= 2) return false;
    const options = purchase ? ps.shop.slots : ps.offers?.[0]?.slots || [];
    return rec.bonds.includes(CORE) || !options.some(s => s && !s.sold && s.kind === 'chess'
      && gd.chess(s.id)?.bonds.includes(CORE) && (purchase ? ps.priceOf(s) : s.price || 0) <= ps.funds);
  }
  if (id === 'chess_char_3_04_a' && m.round <= 7) {
    const options = purchase ? ps.shop.slots : ps.offers?.[0]?.slots || [];
    if (options.some(s => s && !s.sold && s.kind === 'chess' && gd.chess(s.id)?.bonds.includes(CORE)
      && (purchase ? ps.priceOf(s) : s.price || 0) <= ps.funds)) return false;
  }
  const native = rec.bonds.includes(CORE);
  const frontFill = needsFront(m,ps) && draftFrontline(rec);
  if (frontFill) return true;
  const allowed = native || rec.bonds.includes('investShip') || routeLayerEngine(gd, rec, draftRouteBonds(ps));
  if (!allowed) return false;
  // Free offers never consume the Lappland search budget. Their whitelist and investor cap still apply.
  if (purchase && ps.shop.level === 2 && ps._botDraftSafety?.round === m.round && ps._botDraftSafety.safe) return draftShopKey(m,ps,rec);
  return true;
}

const cache = new WeakMap();
export function withSiracusaFocusedDraft(baseline) {
  if (!cache.has(baseline)) cache.set(baseline,Object.freeze({ ...baseline,
    focusedDraftSafety: true,
    purchaseAllowed: (m,ps,rec) => draftAllowed(m,ps,rec) && baseline.purchaseAllowed(m,ps,rec),
    rewardAllowed: (m,ps,rec) => draftAllowed(m,ps,rec,{purchase:false}),
    // User's explicit opening overrides the old fill-the-board gate for this one upgrade only.
    levelTarget: (m,ps,opts) => m.round === 2 && ps.shop.level === 1 ? 2 : baseline.levelTarget(m,ps,opts),
    priorityLevel: (m,ps) => m.round === 2 && ps.shop.level === 1 || baseline.priorityLevel(m,ps),
    readyForUpgrade: (m,ps) => m.round === 2 && ps.shop.level === 1 || baseline.readyForUpgrade(m,ps),
    beforeUpgrade: (m,ps,plan) => m.round === 2 && ps.shop.level === 1 || baseline.beforeUpgrade(m,ps,plan),
    upgradeReserve: (m,ps) => m.round === 2 && ps.shop.level === 1 ? 0 : baseline.upgradeReserve(m,ps),
    importantBuy: (m,ps,rec) => draftShopKey(m,ps,rec) || m.round === 1 && rec.bonds.includes(CORE) || needsFront(m,ps) && draftFrontline(rec),
    // User policy: exhaust funds every prep; freeze the final visible shop only after spending finishes.
    freezeAfterSpending: true,
    holdShop: (m,ps) => ps.funds === 0 && ps.shop.slots.some(s=>s && !s.sold && s.kind==='chess' && draftShopKey(m,ps,gdOf(m,ps).chess(s.id))),
    shopLockAudit: (m,ps) => ({frozen:ps.shop.frozen,
      keys:ps.shop.slots.filter(s=>s && !s.sold && s.kind==='chess' && draftShopKey(m,ps,gdOf(m,ps).chess(s.id))).map(s=>s.id),
      hasFront:ps.allChess().some(p=>draftFrontline(gdOf(m,ps).chess(p.id))),frontFillUsed:ps._botDraftOpening?.filled||false}),
    purchaseItemAllowed: (m,ps,rec) => m.round !== 2 && (baseline.purchaseItemAllowed?.(m,ps,rec) ?? true),
    cleanupAcquisitions(m,ps) { baseline.cleanupAcquisitions?.(m,ps); opening(m,ps); },
    afterPurchase(m,ps,slot,before) { baseline.afterPurchase?.(m,ps,slot,before); opening(m,ps); },
    bankRemainder(m,ps) {
      if (m.round===2) return false; // The one fund after upgrading goes to a refresh.
      return bankRemainder(m,ps,{itemAllowed:baseline.itemAllowed,chessAllowed:rec=>draftAllowed(m,ps,rec)});
    },
    buyBonus(m,ps,rec,plan,counts) {
      return baseline.buyBonus(m,ps,rec,plan,counts) + (ps.shop.level === 2 && base(gdOf(m,ps),rec) === LAPPLAND ? 60 : 0)
        + (needsFront(m,ps) && draftFrontline(rec) ? 80 : 0);
    },
  }));
  return cache.get(baseline);
}
