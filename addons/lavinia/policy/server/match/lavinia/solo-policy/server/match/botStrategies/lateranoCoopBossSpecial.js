// [ASSUMED] Solo boss geometry as independent co-op R14 candidates. Economics and equipment stay inherited.
// All selection uses the real team geometry/pool/LP and independent common samples; never the live combat result.
import { lateranoLionSpreadSteps } from './lateranoLionSpread.js';
import { mobileBossSteps } from './lateranoMobileBoss.js';
import { controlBossSteps, applyControlPositions } from './lateranoControlBoss.js';
import { bossFormationSnapshot } from './lateranoBossFormation.js';
import { createCoopBossForecast } from './lateranoCoopBoss.js';
import { stealthBattleInput } from './lateranoStealthWave.js';

export const COOP_BOSS_SPECIALS = Object.freeze(['boss_2', 'boss_4', 'boss_5', 'boss_6', 'boss_7']);
const identity = ps => JSON.stringify(ps.allChess().map(p => [p.uid, p.id, p.items?.map(i => i.id) || []]).sort((a,b) => a[0]-b[0]));
const signature = plan => [...plan].sort((a,b) => a[0]-b[0]).map(([uid,key]) => `${uid}@${key}:${plan.dirs.get(uid)}`).join('|');

/** Pure candidate collection: same public geometry as solo, no battles, placement, shopping or RNG mutation. */
export function* coopBossSpecialPlans(m, ps, h, enabled = COOP_BOSS_SPECIALS) {
  if (m.mode !== 'coop' || m.isSolo || m.wave || m.round !== m.gd.bossRound || m.botRehearsal < 2
    || !enabled.includes(m.bossId)) return [];
  const options = { collect: true };
  if (m.bossId === 'boss_6') return (yield* lateranoLionSpreadSteps(m,ps,h,options)) || [];
  if (['boss_2','boss_5'].includes(m.bossId)) return (yield* mobileBossSteps(m,ps,h,[m.bossId],options)) || [];
  return (yield* controlBossSteps(m,ps,h,[m.bossId],options)) || [];
}

export function applyCoopBossSpecial(ps, plan) {
  const before = identity(ps), original = [...ps.board.values()].filter(p => p.kind === 'chess');
  const selected = new Set(plan.lineup.map(p => p.uid));
  const removed = original.filter(p => !selected.has(p.uid));
  const existing = new Set(original.map(p => p.uid));
  const added = plan.lineup.filter(p => !existing.has(p.uid));
  if (added.length !== removed.length) throw Error('Co-op special changed roster size');
  // A hand -> board swap returns the old unit into the medic's freed slot, including with a full bench.
  for (let i=0;i<added.length;i++) {
    const [row,col] = ps.find(removed[i].uid).key.split(',').map(Number);
    const result = ps.move(added[i].uid,{area:'board',row,col},plan.dirs.get(added[i].uid));
    if (result?.error) throw Error(`Co-op elemental medic rejected: ${result.error}`);
  }
  applyControlPositions(ps,plan);
  if (identity(ps) !== before) throw Error('Co-op special changed owned cards/equipment');
}

export function* coopBossSpecialSteps(m, ps, h, enabled = COOP_BOSS_SPECIALS) {
  if (m.mode !== 'coop' || m.isSolo || m.wave || m.round !== m.gd.bossRound || m.botRehearsal < 2
    || !enabled.includes(m.bossId)) return;
  const start = performance.now(), original = bossFormationSnapshot(ps,h), before = identity(ps);
  const candidates = yield* coopBossSpecialPlans(m,ps,h,enabled);
  const plans = [original], seen = new Set([signature(original)]);
  for (const plan of candidates) if (!seen.has(signature(plan))) { seen.add(signature(plan)); plans.push(plan); }
  if (plans.length < 2) return;
  const job = yield* createCoopBossForecast(m,ps,plans,10);
  if (!job) return; while (!job.run(4)) yield;
  const expected = stealthBattleInput(ps,job.best), hadSix = (ps.bonds.lateranoShip?.count || 0) >= 6;
  if (!job.stale) {
    applyCoopBossSpecial(ps,job.best);
    if (JSON.stringify(ps.battleInput()) !== JSON.stringify(expected)) throw Error('Co-op boss special differs from its forecast');
    if (hadSix && (ps.bonds.lateranoShip?.count || 0) < 6) throw Error('Co-op special lost six Laterano');
  }
  if (identity(ps) !== before) throw Error('Co-op special changed inventory');
  (ps._botCoopBossSpecialHistory ||= []).push({ round:m.round,kind:m.bossId,index:job.bestIndex,stale:job.stale,
    changed:!job.stale && signature(job.best)!==signature(original),outcomes:job.outcomes,
    candidates:plans.map(plan=>({lineup:plan.lineup.map(p=>({uid:p.uid,id:p.id})),
      positions:[...plan].map(([uid,key])=>({uid,key,dir:plan.dirs.get(uid)}))})),ms:performance.now()-start });
}

export function withLateranoCoopBossSpecial(recipe, enabled = COOP_BOSS_SPECIALS) {
  const bosses = Object.freeze([...enabled]);
  return Object.freeze({...recipe,*finalBoardSteps(m,ps,h) {
    if (recipe.finalBoardSteps) yield* recipe.finalBoardSteps(m,ps,h);
    yield* coopBossSpecialSteps(m,ps,h,bosses);
  }});
}
