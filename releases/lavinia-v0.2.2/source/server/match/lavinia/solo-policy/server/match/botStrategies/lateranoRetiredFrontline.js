// [ASSUMED] Release an unequipped bench transition only after deployed Faith can take over.
// Never sell to fund a speculative refresh. Existing core/pair/Vision/healing guards remain authoritative.
import { normalizeLegendEntry } from '../../../../../../sim/grid.js';
import { pieceBonds } from '../../../../../bondsMeta.js';
import { isFormationAnchor } from '../botPositioning.js';
import { LATERANO_KEY_VALUATION } from './lateranoKeyValue.js';
import { withLateranoKeyLiquidity } from './lateranoKeyLiquidity.js';

const base = (gd, p) => gd.baseIdOf(p.id ?? p.chessId);
function blockingOnBoard(m, ps, p) {
  const loc = ps.find(p.uid);
  if (loc?.area !== 'board' || ps.deployMap().get(loc.key) !== 'melee') return false;
  const [r, c] = loc.key.split(',').map(Number), stage = ps.gd.stage(m.stageId), glyph = stage?.rows?.[r]?.[c];
  if (!glyph) return false;
  const tile = normalizeLegendEntry(glyph, stage.tiles?.[glyph]);
  const paths = (m.stage?.groundPathsWithDevices || m.stage?.groundPaths || stage.groundPaths || {});
  const onPath = Object.values(paths).some(path => path.some(([row, col]) => row === r && col === c));
  return tile.pass === 'ALL' && onPath && isFormationAnchor(ps.gd.chess(p.id));
}

export function retiredLateranoFrontline(m, ps, recipe, p, remaining = ps.allChess()) {
  if (m.round < 6 || m.round >= m.gd.bossRound || !p || p.items?.length || !['hand', 'temp'].includes(ps.find(p.uid)?.area)) return false;
  const gd = ps.gd, rec = gd.chess(p.id), bonds = pieceBonds(gd, p);
  if (!isFormationAnchor(rec) || rec.tier > 3 || rec.subProfessionId === 'guardian' || !bonds.includes('steadShip')
    || bonds.some(b => ['lateranoShip', 'preciShip', 'skillfulShip', 'visiShip', 'maniShip'].includes(b))) return false;
  if (!gd.isGolden(p.id) && remaining.filter(q => base(gd, q) === base(gd, p) && !gd.isGolden(q.id)).length >= 2) return false;
  const blockers = remaining.filter(q => blockingOnBoard(m, ps, q));
  const faith = blockers.find(q => base(gd, q) === recipe.ids.faith);
  return !!faith && (gd.isGolden(faith.id) || (ps.layers.lateranoShip || 0) >= 120 || blockers.length >= 2);
}

export function withLateranoRetiredFrontline(recipe) {
  const earlyWhite = (m, ps, rec) => m.round >= 6 && m.round < m.gd.bossRound
    && [recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].includes(base(ps.gd, rec))
    && recipe.purchaseAllowed(m, ps, rec) !== false
    && !ps.allChess().some(p => [recipe.ids.ptilopsis4, recipe.ids.ptilopsis5].includes(base(ps.gd, p)))
    && ps.allChess().some(p => base(ps.gd, p) === recipe.ids.archetto)
    && ps.allChess().some(p => retiredLateranoFrontline(m, ps, recipe, p));
  const valuation = Object.freeze({ ...LATERANO_KEY_VALUATION,
    saleRank: (m, ps, r, p, remaining) => retiredLateranoFrontline(m, ps, r, p, remaining) ? 1 : null,
    targetRank: (m, ps, r, slot, rank) => earlyWhite(m, ps, ps.gd.chess(slot.id)) ? Math.max(rank, 850) : rank,
    accept(m, ps, r, plan) {
      const accepted = LATERANO_KEY_VALUATION.accept(m, ps, r, plan);
      plan.valuation.retiredDonors = plan.sales.filter(s => retiredLateranoFrontline(m, ps, r, ps.find(s.uid)?.piece)).map(s => s.uid);
      if (!earlyWhite(m, ps, ps.gd.chess(plan.slot.id))) return accepted;
      if (!plan.valuation.retiredDonors.length) return false;
      plan.valuation.value = 8;
      plan.valuation.retiredFrontline = true;
      return plan.valuation.value >= plan.valuation.cost + 3;
    },
  });
  return withLateranoKeyLiquidity(recipe, valuation);
}
