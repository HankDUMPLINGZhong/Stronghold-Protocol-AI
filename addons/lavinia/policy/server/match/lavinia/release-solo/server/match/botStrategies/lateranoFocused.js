// User constraint: Laterano develops Precision / Skillful, optional Vision, and temporary early Steadfast.
// Arcane / Raid are never acquisition, pair or layer objectives. Native and useful overlapping members remain legal.
// [ASSUMED] Opening bridge / R8 Steadfast deadlines and duplicate caps are policy, not game mechanics.
import { lateranoTactics, lateranoLesson } from './lateranoTactics.js';
import { lateranoObserved } from './lateranoObserved.js';
import { economyChessBonus } from '../botEconomy.js';

const CORE = lateranoTactics.core;
const objectives = new Set([CORE, 'preciShip', 'skillfulShip', 'visiShip', 'steadShip']);
const permanent = new Set([CORE, 'preciShip', 'skillfulShip', 'visiShip']);
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, rec) => gd.baseIdOf(rec.id ?? rec.chessId);
const copies = (m, ps, rec) => ps.allChess().filter(p => base(gdOf(m, ps), p) === base(gdOf(m, ps), rec));
const planned = rec => rec.bonds?.some(b => permanent.has(b));
const counter = (m, rec) => lateranoLesson(m, 'quintus') && m.bossId === 'boss_4'
  && m.round <= m.gd.bossRound && rec.subProfessionId === 'wandermedic';
const steadfast = rec => rec.bonds?.includes('steadShip');
// Fill an opening board with low-cost combat/healing bodies; this is not a new bond or high-tier project.
const openingBridge = (m, rec) => m.round <= 5 && rec.tier <= 2
  && !rec.bonds?.some(b => b === 'arcaneShip' || b === 'raidShip');

function purchaseAllowed(m, ps, rec) {
  if (planned(rec) || counter(m, rec)) return true;
  if (economyChessBonus(m, ps, rec, { purchase: true }) > 0) return true;
  if (openingBridge(m, rec)) return true;
  if (!steadfast(rec) || m.round > 8) return false;
  const gd = gdOf(m, ps), own = copies(m, ps, rec);
  // Cheap early tanks can still merge and generate a reward; expensive off-route tanks are single-copy bridges.
  if (own.length) return rec.tier <= 2 && !own.some(p => gd.isGolden(p.id));
  const members = new Set(ps.allChess().filter(p => steadfast(gd.chess(p.id))).map(p => base(gd, p)));
  // Saria may replace a cheap guardian: an upgrade in healing/frontline quality, not a third tank project.
  const guardianUpgrade = rec.subProfessionId === 'guardian' && !ps.allChess().some(p => {
    const r = gd.chess(p.id); return r.subProfessionId === 'guardian' && r.tier >= rec.tier;
  });
  return members.size < 2 || guardianUpgrade;
}

function keep(m, ps, rec) {
  return (planned(rec) || counter(m, rec) || steadfast(rec) && rec.tier <= 2 && m.round <= 8)
    && lateranoTactics.keep(m, ps, rec);
}

function preserve(m, ps, rec) {
  return (planned(rec) || steadfast(rec) || counter(m, rec)) && lateranoTactics.preserve(m, ps, rec);
}

function cleanupAcquisitions(m, ps) {
  if (m.round < 5 || ps.deployCount < 6) return;
  const gd = gdOf(m, ps);
  // All-invalid free offers may still yield an asset; don't turn exclusive Arcane/Raid into a bench project.
  // Never discard equipped assets here; existing real sale/equipment checks remain authoritative.
  for (const piece of [...ps.hand, ...ps.temp]) if (piece?.kind === 'chess') {
    const rec = gd.chess(piece.id);
    if (!piece.items?.length && !planned(rec) && !steadfast(rec) && !counter(m, rec)
      && rec.bonds?.some(b => b === 'arcaneShip' || b === 'raidShip')) ps.sell(piece.uid);
  }
}

function readyForUpgrade(m, ps) {
  if (lateranoObserved.readyForUpgrade(m, ps)) return true;
  if (m.round > 5 || ps.lp < 12 || ps.allChess().length < 4) return false;
  const records = ps.allChess().map(p => gdOf(m, ps).chess(p.id));
  return records.some(r => r.position !== 'RANGED' && r.stats.blockCnt >= 2)
    && records.some(r => r.position === 'RANGED' && r.attackKind !== 'heal' && r.attackKind !== 'none');
}
function levelTarget(m, ps) {
  if (m.round === 2 && readyForUpgrade(m, ps)) return 2;
  return lateranoTactics.levelTarget(m, ps);
}
const priorityLevel = (m, ps) => (readyForUpgrade(m, ps) || m.round > 4 || ps.allChess().length >= ps.deployCap)
  && ps.shop.level < levelTarget(m, ps);
const spendReserve = (m, ps) => priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice + lateranoTactics.upgradeReserve(m, ps)
  ? Math.max(0, ps.shop.upgradePrice) : 0;

export const lateranoFocused = Object.freeze({ ...lateranoTactics, purchaseAllowed, keep, preserve, cleanupAcquisitions,
  readyForUpgrade, levelTarget, priorityLevel, spendReserve,
  valuesBond: id => objectives.has(id) });
