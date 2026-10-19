// [ASSUMED] R14 proposals only: shared firing windows, real stationary bodies and directional equipment support.
// Independent of opening, shopping and route selection. Real rehearsal decides whether to use a proposal.
import { siracusa } from './siracusa.js';
import { rotateOffset } from '../../../../../../sim/dir.js';
import { pieceBonds } from '../../../../../bondsMeta.js';

// Owner policy: only the two income dolls, Siracusa Dress and same-bond recruitment phone, normal or elite.
export const siracusaItemAllowed = (rec) => rec?.giveBondId === 'siracusaShip' || !!rec?.buffs?.some((b) => [
  'gain_coin_when_round_start', 'use_equip_gain_coin_when_next_round_start',
  'use_equip_reward_char_chess_with_same_bond',
].includes(b.key));

function damageWeight(gd, u, pieces, bonds) {
  const p = pieces?.get(u.uid), state = bonds?.siracusaShip, bb = gd.bond?.(siracusa.core)?.bb;
  if (!p || !bb || !state?.active || state.count < bb.power_bond_char_cnt || !pieceBonds(gd, p).includes(siracusa.core)) return u.dps;
  const layers = state.layers || 0, stats = u.rec?.stats || {};
  // Nominal long-run proc value, not guaranteed damage or layer growth. Rehearsal handles real PRD/stealth/skills.
  const rate = ((stats.aspd || 100) + bb.base_attack_speed + bb.attack_speed_per_stack * layers) / 100 / (stats.bat || 1.5);
  return u.dps + (bb.base_damage + bb.damage_per_stack * layers) * bb.prob * rate;
}

export function bossSupportValue(gd, units, pieces, bonds) {
  let value = 0;
  for (const u of units) for (const it of pieces?.get(u.uid)?.items || []) {
    const aura = gd.item(it.id)?.buffs?.find((b) => b.bbStr?.key === 'act2autochess_equip_acarm121_ability');
    if (!aura) continue;
    for (const dr of [-1, 1]) {
      const [r, c] = rotateOffset(dr, 0, u.dir), key = `${u.r + r},${u.c + c}`;
      const target = units.find((v) => v.key === key && v.ground && !v.heal);
      if (target) value += (aura.bb?.attack_speed || 0) / 100 * damageWeight(gd, target, pieces, bonds);
    }
  }
  return value;
}

export function bossWindowValue(gd, units, plan, _bonds, model) {
  const dealers = units.filter((u) => u.ground && !u.heal && u.dps > 0);
  const weights = new Map(dealers.map((u) => [u, damageWeight(gd, u, plan.pieces, _bonds)]));
  const sum = dealers.reduce((s, u) => s + weights.get(u), 0);
  if (!sum) return 0;
  const cover = (u) => model.bossBodies?.length && plan.landings?.get(u.uid)?.cover || u.cover;
  const windows = model.bossBodies?.length ? model.bossBodies.map((b) => b.tiles)
    : model.routes.filter((r) => r.dwell > 0).flatMap((r) => r.tiles.map((k) => [k]));
  if (!windows.length) return 0;
  let best = 0;
  for (const tiles of windows) {
    const firing = dealers.filter((u) => tiles.some((k) => cover(u).has(k)));
    const share = firing.reduce((s, u) => s + weights.get(u), 0) / sum;
    // Concentrate ranges on an enemy location, not operators on one location (Lucien has area attacks).
    let value = share * share * 6 + firing.length / dealers.length;
    for (const u of units) {
      const p = plan.pieces?.get(u.uid);
      for (const it of p?.items || []) {
        const aura = gd.item(it.id)?.buffs?.find((b) => b.bbStr?.key === 'act2autochess_equip_acarm121_ability');
        if (!aura) continue;
        for (const dr of [-1, 1]) {
          const [r, c] = rotateOffset(dr, 0, u.dir), key = `${u.r + r},${u.c + c}`;
          const target = firing.find((v) => v.key === key);
          if (target) value += 4 * (aura.bb?.attack_speed || 0) / 100 * weights.get(target) / sum;
        }
      }
    }
    best = Math.max(best, value);
  }
  if (!model.bossBodies?.length) {
    // Isolated early contact can drive a feared leader away before the rest of the team can attack.
    for (const rt of model.routes.filter((r) => r.dwell > 0)) {
      const first = rt.tiles.findIndex((k) => dealers.some((u) => u.cover.has(k)));
      if (first >= 0) {
        const firing = dealers.filter((u) => u.cover.has(rt.tiles[first]));
        if (firing.length === 1) best -= 1.5 * weights.get(firing[0]) / sum;
      }
    }
  }
  return best;
}

export const siracusaBoss = Object.freeze({ ...siracusa,
  // Owner requirement: six distinct real members must deploy whenever current assets/cap allow it.
  // No virtual copies; only a real Dress/Transform pairing grants membership through pieceBonds.
  requiredCoreMembers(m, ps) {
    const gd = ps.gd || m.gd;
    if (ps.deployCap < 6 || gd.modeInactiveBonds.has(siracusa.core)) return 0;
    const bases = new Set(ps.allChess().filter((p) => pieceBonds(gd, p).includes(siracusa.core))
      .map((p) => gd.baseIdOf(p.id)));
    return bases.size >= 6 ? 6 : 0;
  },
  itemAllowed: siracusaItemAllowed,
  bankRemainder: (m, ps) => siracusa.bankRemainder(m, ps, { itemAllowed: siracusaItemAllowed }),
  useEconomy: (m, ps) => siracusa.useEconomy(m, ps, { itemAllowed: siracusaItemAllowed }),
  combatLayoutOnly: (plan) => !!plan.bossFocus,
  layoutValue: (gd, units, plan, bonds) => plan.bossFocus ? 0 : siracusa.layoutValue(gd, units, plan, bonds),
  bossLayoutValue: bossWindowValue, bossSupportValue });
