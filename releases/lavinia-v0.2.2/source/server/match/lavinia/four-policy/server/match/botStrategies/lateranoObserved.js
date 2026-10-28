// Optional observations from human seeds 22388 / 26871; the previous immutable recipe remains available.
// [ASSUMED] These are conditional valuations, not official mechanics or predictions of future shop/gift rolls.
import { laterano } from './laterano.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../../../../shared/loadoutRecord.js';

const { ids, core: CORE } = laterano;
const gdOf = (m, ps) => ps.gd || m.gd;
const base = (gd, rec) => gd.baseIdOf(rec.id ?? rec.chessId);
const owned = (m, ps, id) => ps.allChess().filter((p) => base(gdOf(m, ps), p) === id);
const engineIds = [ids.mostima, ids.archetto, ids.executorAlter];
const unfinished = (m, ps, id) => {
  const gd = gdOf(m, ps), copies = owned(m, ps, id);
  return !copies.some((p) => gd.isGolden(p.id)) && copies.filter((p) => !gd.isGolden(p.id)).length >= 2;
};

function visionPlan(m, ps) {
  if ((ps.layers.visiShip || 0) >= 150) return 'complete';
  const gd = gdOf(m, ps);
  if (owned(m, ps, ids.executorAlter).some((p) => gd.isGolden(p.id)) && m.round <= 10) return 'executor';
  const executor = owned(m, ps, ids.executorAlter).length > 0;
  // A working ordinary Executor can reach the first income milestone even without an early promotion.
  // Do not abandon such an acquired engine merely because it starts R11 below 80; never assume a future merge.
  const remaining = Math.max(0, gd.bossRound - m.round);
  if (m.round >= gd.bossRound || m.round >= 11 && (ps.layers.visiShip || 0) < 80
    && (!executor || (ps.layers.visiShip || 0) + remaining * 21 < 80)) return 'dormant';
  return executor || [ids.ines, ids.coldshot].some((id) => owned(m, ps, id).length) ? 'team' : 'dormant';
}

function visionBases(m, ps) {
  const gd = gdOf(m, ps);
  const priority = (p) => base(gd, p) === ids.executorAlter ? 100 : base(gd, p) === ids.ines ? 80
    : base(gd, p) === ids.coldshot ? 60 : 10 - gd.chess(p.id).tier;
  return new Set(ps.allChess().filter((p) => gd.chess(p.id).bonds.includes('visiShip'))
    .sort((a, b) => priority(b) - priority(a) || a.uid - b.uid).map((p) => base(gd, p))
    .filter((id, i, a) => a.indexOf(id) === i).slice(0, 2));
}
const keep = (m, ps, rec) => ['executor', 'team'].includes(visionPlan(m, ps)) && visionBases(m, ps).has(base(gdOf(m, ps), rec));
const preserve = (m, ps, rec) => laterano.preserve(m, ps, rec)
  || keep(m, ps, rec) && owned(m, ps, base(gdOf(m, ps), rec)).length === 1;

function buyBonus(m, ps, rec, plan, counts) {
  let value = laterano.buyBonus(m, ps, rec, plan, counts);
  const gd = gdOf(m, ps), id = base(gd, rec), copies = owned(m, ps, id);
  const fresh = !copies.length;
  if (id === ids.astgenne) value += fresh ? 24 : 4;
  // Prefer finishing an actual repeatable engine; never chase extra copies of an already elite engine.
  if (engineIds.includes(id) && !copies.some((p) => gd.isGolden(p.id)) && m.round < gd.bossRound) {
    value += unfinished(m, ps, id) ? 28 : copies.length ? 8 : 0;
  }
  // Start a bounded Foresight project without requiring Executor Alter. One engine and one bench partner suffice.
  if (fresh && id === ids.ines && m.round >= 6 && m.round <= 9 && (counts.get(CORE) || 0) >= 3
    && ![ids.ines, ids.coldshot].some((key) => owned(m, ps, key).length)) value += 12;
  if (fresh && rec.bonds.includes('visiShip') && (counts.get('visiShip') || 0) < 2 && visionPlan(m, ps) === 'team') value += 6;
  return value;
}

function unitBonus(m, ps, rec, plan) {
  let value = laterano.unitBonus(m, ps, rec, plan);
  const id = base(gdOf(m, ps), rec);
  if (id === ids.astgenne) value += m.round < gdOf(m, ps).bossRound ? 18 : 5;
  if (visionPlan(m, ps) === 'team' && [ids.ines, ids.coldshot].includes(id)) value += 6;
  return value;
}

function readyForUpgrade(m, ps) {
  const gd = gdOf(m, ps), records = ps.allChess().map((p) => gd.chess(p.id));
  return m.round <= 3 && ps.lp >= 16 && records.some((r) => (r.stats?.blockCnt || 0) >= 2 && r.position !== 'RANGED')
    && records.some((r) => r.position === 'RANGED' && r.attackKind !== 'heal' && r.attackKind !== 'none');
}

function levelTarget(m, ps) {
  if (m.round === 2 && readyForUpgrade(m, ps)) return 2;
  // A single remaining normal wave justifies one bounded search for the owned pair; R13 always releases it.
  if (m.round === 12 && ps.shop.level === 5 && ps.lp > 8 && unfinished(m, ps, ids.executorAlter)) return 5;
  return laterano.levelTarget(m, ps);
}

function beforeUpgrade(m, ps, plan) {
  const gd = gdOf(m, ps);
  if (m.round < 13 && ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds
    && engineIds.includes(gd.baseIdOf(s.id)) && unfinished(m, ps, gd.baseIdOf(s.id)) && ps.completesChessMerge(s.id))) return false;
  return laterano.beforeUpgrade(m, ps, plan);
}
const priorityLevel = (m, ps) => (readyForUpgrade(m, ps) || m.round > 4 || ps.allChess().length >= ps.deployCap)
  && ps.shop.level < levelTarget(m, ps);
const spendReserve = (m, ps) => priorityLevel(m, ps) && ps.funds >= ps.shop.upgradePrice + laterano.upgradeReserve(m, ps)
  ? Math.max(0, ps.shop.upgradePrice) : 0;

function trainingLineups(m, ps, chosen) {
  const gd = gdOf(m, ps), out = laterano.trainingLineups(m, ps, chosen);
  if (m.round >= gd.bossRound || ps.lp < 12 || !chosen.some((p) => base(gd, p) === ids.executorAlter)) return out;
  const burst = chosen.find((p) => base(gd, p) === ids.exusiaiAlter);
  const chosenBases = new Set(chosen.map((p) => base(gd, p)));
  const substitute = ps.allChess().filter((p) => !chosen.includes(p) && gd.chess(p.id).bonds.includes(CORE)
    && !chosenBases.has(base(gd, p))).sort((a, b) => gd.chess(a.id).tier - gd.chess(b.id).tier || a.uid - b.uid)[0];
  // Keep six distinct members when a lower-burst native is owned; the real rehearsal still vetoes extra leaks/deaths.
  if (burst && substitute) out.unshift(chosen.map((p) => p === burst ? substitute : p));
  return out;
}

function rehearsalValue(m, ps, pp) {
  if (m.round >= gdOf(m, ps).bossRound) return 0;
  const gd = gdOf(m, ps), gain = pp.layerGains || {};
  const lockPhase = owned(m, ps, ids.lemuen).some((p) => {
    const rec = gd.chess(p.id), lo = resolveRecordLoadout(rec, ps.loadoutFor(rec));
    return loadoutRecord(rec, lo).skill?.skillId === 'skchr_lemuen_3';
  });
  const precise = ps._botRoute?.support === 'preciShip';
  return Math.min(50, (gain[CORE] || 0) * (precise && lockPhase ? 0.025 : 0.1)
    + (gain[ps._botRoute?.support] || 0) * (precise ? 0.45 : 0.3)
    + ((ps.layers.visiShip || 0) < 150 ? (gain.visiShip || 0) * 0.6 : 0));
}

export const lateranoObserved = Object.freeze({ ...laterano, buyBonus, unitBonus, visionPlan, readyForUpgrade,
  levelTarget, beforeUpgrade, priorityLevel, spendReserve, trainingLineups, rehearsalValue, keep, preserve });
