// [ASSUMED] Independent four-seat revision of contact-coverage. Preserve own growth and actual Raid first jumps
// in the same two detached current-wave samples. Never inspect a real result, seed-specific history or future shop.
import { siracusaContactPlans, applySiracusaContact } from './siracusaCoopTactics.js';
import { siracusaCoopSnapshot } from './siracusaCoopExperiments.js';
import { probeContactRollback } from './siracusaContactRollback.js';
import { CONTACT_SAFE_NO_MICRO, contactGuardContext, selectGuardedContact } from './siracusaContactGuards.js';
import { siracusaVigilTokensLegal } from './siracusaCommunityTrials.js';
import { raidDeploymentGain, observeRaidDeployment, selectRaidDeployment } from './siracusaRaidDeployment.js';
import { raidFrontlinePlans } from './siracusaRaidFrontline.js';

export const HUMAN_CONTACT_REVISED = 'contact-coverage-revised';
export const HUMAN_CONTACT_RAID_ONLY = 'contact-coverage-raid-only';
export const HUMAN_CONTACT_JOINT_RAID = 'contact-coverage-joint-raid';
const scope = (m, ps) => m.mode === 'coop' && !m.isSolo && m.order.length === 4 && m.difficulty === 'ABYSS'
  && m.round >= 5 && m.round <= 13 && !!m.wave && ps.bandId === 'band_chiave' && ps._botFocusId === 'siracusaShip';

/** Reuse the real Raid redeploy/buff observer. It includes both in-range suppression and unavailable landings:
 * an empty-looking home or an estimated jump is never credited as a successful redeployment. */
export function observeHumanContactGrowth(battle, ctx) {
  const raid = observeRaidDeployment(battle, ctx); let vigilCoreGain = 0;
  battle.on('layerGain', ({source, bondId, n}) => {
    if (bondId === 'siracusaShip' && source?.ownerId === ctx.playerId && ctx.vigil.has(source.uid)) vigilCoreGain += n;
  });
  return pp => ({ ...raid(pp), vigilCoreGain });
}

const complete = (rows, ctx) => rows.length === 2 && rows.every((r, sample) => r.valid && r.sample === sample
  && (ctx.protectVigil === false || Number.isFinite(r.vigilCoreGain)) && r.raidProgress && ctx.sources.every(s => {
    const p = r.raidProgress[s.uid];
    return p && ['deploys', 'jumps', 'raidGain'].every(k => Number.isFinite(p[k]))
      && (p.firstJump === null || Number.isFinite(p.firstJump));
  }));

/** Nonfatal small savings cannot spend Vigil growth, lose the first deployment jump, or reduce deployment layers.
 * [ASSUMED] One second tolerates four Raid polls. A strict paired rescue from predicted elimination may trade growth.
 * The inherited no-micro and per-sample LP/leak guards still apply, including in that emergency exception. */
export function selectHumanContactGrowth(plans, outcomes, ctx) {
  const rows = plans.map((_, index) => outcomes.filter(r => r.index === index).sort((a, b) => a.sample - b.sample));
  if (!complete(rows[0], ctx)) return { index: 0, rejected: [], reason: 'incomplete-growth-reference' };
  const rejected = [];
  for (let index = 1; index < plans.length; index++) {
    const rs = rows[index]; let reason = null;
    if (!complete(rs, ctx)) reason = 'incomplete-growth';
    else {
      const rescue = rows[0].every(r => r.lost >= ctx.lp) && rs.every((r, s) => r.lost < ctx.lp && r.lost < rows[0][s].lost);
      if (!rescue) {
        if (ctx.protectVigil !== false && rs.some((r, s) => r.vigilCoreGain < rows[0][s].vigilCoreGain)) reason = 'vigil-growth';
        for (const source of ctx.sources) {
          if (rs.some((r, s) => {
            const p = r.raidProgress[source.uid], b = rows[0][s].raidProgress[source.uid];
            return p.raidGain < b.raidGain || Math.min(2, p.deploys) < Math.min(2, b.deploys)
              || b.jumps > 0 && (p.jumps === 0 || p.firstJump === null || p.firstJump > b.firstJump + 1);
          })) reason = reason ? reason + '+raid-first-jump-or-growth' : 'raid-first-jump-or-growth';
        }
      }
    }
    if (reason) rejected.push({ index, reason });
  }
  const vetoes = new Set(rejected.map(r => r.index));
  const decision = selectGuardedContact(plans, outcomes.filter(r => !vetoes.has(r.index)), ctx);
  return { ...decision, rejected: [...rejected, ...decision.rejected] };
}

/** Equal defense may improve real second deployments even when the incumbent already predicts zero leaks.
 * Keep the original per-sample safety and Raid growth guards; damage alone never changes the formation.
 */
export function selectJointRaidContact(plans, outcomes, ctx) {
  const base = outcomes.filter(r => r.index === 0).sort((a, b) => a.sample - b.sample);
  const unsafe = new Set(outcomes.filter(r => r.index && base[r.sample] && r.deaths > base[r.sample].deaths).map(r => r.index));
  outcomes = outcomes.filter(r => !unsafe.has(r.index));
  const defense = selectHumanContactGrowth(plans, outcomes, ctx);
  defense.rejected.push(...[...unsafe].map(index => ({ index, reason: 'paired-deaths' })));
  if (!ctx.sources.length) return defense;
  const vetoes = new Set(defense.rejected.filter(r => r.reason.includes('raid-first') || r.reason.startsWith('incomplete')).map(r => r.index));
  const eligible = outcomes.filter(r => !vetoes.has(r.index));
  const growth = selectRaidDeployment(plans, eligible, ctx);
  if (!growth.index) return defense;
  const rows = index => outcomes.filter(r => r.index === index).sort((a, b) => a.sample - b.sample);
  const current = rows(defense.index), candidate = rows(growth.index);
  const rank = rs => [-Math.max(...rs.map(r => r.lost)), -rs.reduce((n, r) => n + r.lost, 0),
    -Math.max(...rs.map(r => r.leaks)), -rs.reduce((n, r) => n + r.leaks, 0)];
  const a = rank(candidate), b = rank(current);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? { ...defense, index: growth.index, raidImprovement: true } : defense;
  return { ...defense, index: growth.index, raidImprovement: true };
}

export function withHumanContactRevised(parent, { protectVigil = true, jointRaid = false } = {}) {
  return Object.freeze({ ...parent, *finalBoardSteps(m, ps, h) {
    if (parent.finalBoardSteps) yield* parent.finalBoardSteps(m, ps, h);
    if (!scope(m, ps)) return;
    let plans = siracusaContactPlans(m, ps, h, siracusaCoopSnapshot, { endurance: true, radius: 4, limit: 3 })
      .filter((p, i) => !i || siracusaVigilTokensLegal(ps, p));
    const sources = ps.bonds.raidShip?.active ? plans[0].lineup.filter(p => raidDeploymentGain(ps.gd, p) > 0).map(p => ({ uid: p.uid })) : [];
    if (jointRaid) plans = raidFrontlinePlans(m, ps, h, plans, sources).filter((p, i) => !i || siracusaVigilTokensLegal(ps, p));
    if (plans.length < 2) return;
    const context = { ...contactGuardContext(m, ps, h, plans, CONTACT_SAFE_NO_MICRO), playerId: ps.playerId, protectVigil,
      vigil: new Set(plans[0].lineup.filter(p => ps.gd.baseIdOf(p.id) === 'chess_char_3_19_a').map(p => p.uid)),
      sources };
    const result = yield* probeContactRollback(m, ps, h, plans, { corrected: true, context,
      observe: observeHumanContactGrowth, select: jointRaid ? selectJointRaidContact : selectHumanContactGrowth });
    if (!result) return;
    const index = result.stale ? 0 : result.job.bestIndex;
    if (index) applySiracusaContact(ps, plans[index]);
    (ps._botHuman84259History ||= []).push({ factor: jointRaid ? HUMAN_CONTACT_JOINT_RAID : protectVigil ? HUMAN_CONTACT_REVISED : HUMAN_CONTACT_RAID_ONLY,
      round: m.round, index, stale: result.stale,
      sources: context.sources, outcomes: result.job.outcomes, decision: result.job.decision,
      plans: plans.map(p => [...p].map(([uid, key]) => ({ uid, key, dir: p.dirs.get(uid) }))) });
  } });
}
