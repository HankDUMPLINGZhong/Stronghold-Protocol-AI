// Optional known-Sami counter: Natural Surge applies direct stun, not elemental damage.
// Reuse the Quintus salt acquisition/holding/carrier policy without importing its elemental-medic project.
// [ASSUMED] The 35-point acquisition bonus and tier/elite carrier ordering are AI policy.
import { lateranoTactics, lateranoLesson } from './lateranoTactics.js';
import { lateranoFocused } from './lateranoFocused.js';

const SALT = 'chess_item_4_10_e_a';
const gdOf = (m, ps) => ps.gd || m.gd;
const isSalt = (gd, rec) => gd.baseIdOf(rec.id ?? rec.chessId) === SALT;
const active = m => lateranoLesson(m, 'sami') && m.bossId === 'boss_7' && m.round <= m.gd.bossRound;
const hasSalt = (m, ps) => [...ps.hand, ...ps.temp].some(i => i?.kind === 'item' && isSalt(gdOf(m, ps), i))
  || ps.allChess().some(p => p.items?.some(i => isSalt(gdOf(m, ps), i)));

function withSamiControl(recipe) {
  return Object.freeze({ ...recipe,
    itemBonus(m, ps, rec) {
      if (active(m) && isSalt(gdOf(m, ps), rec) && !hasSalt(m, ps)) return 35;
      return recipe.itemBonus(m, ps, rec);
    },
    itemTarget(m, ps, rec, deployed) {
      const gd = gdOf(m, ps);
      if (active(m) && isSalt(gd, rec)) return deployed.filter(p => !p.items?.some(i => isSalt(gd, i))
        && gd.chess(p.id).attackKind !== 'heal' && (p.items?.length || 0) < gd.equipPerChess)
        .sort((a, b) => gd.chess(b.id).tier - gd.chess(a.id).tier
          || Number(gd.isGolden(b.id)) - Number(gd.isGolden(a.id)) || a.uid - b.uid)[0] || null;
      return recipe.itemTarget(m, ps, rec, deployed);
    },
    holdItem(m, ps, rec) {
      const gd = gdOf(m, ps);
      if (active(m) && isSalt(gd, rec) && m.round < gd.bossRound) return ![...ps.board.values()]
        .some(p => p.kind === 'chess' && gd.chess(p.id).tier >= 5 && (p.items?.length || 0) < gd.equipPerChess);
      return recipe.holdItem(m, ps, rec);
    },
  });
}

export const lateranoSami = withSamiControl(lateranoTactics);
export const lateranoFocusedSami = withSamiControl(lateranoFocused);
