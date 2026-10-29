// [ASSUMED] One single-copy off-core Skillful bridge. Ptilopsis replaces it as the final medic, Archetto is native.
import { pieceBonds } from '../../../../../bondsMeta.js';

const CORE='lateranoShip', SKILL='skillfulShip', GREY='chess_char_1_14_a';
const gdOf=(m,ps)=>ps.gd||m.gd;
const base=(gd,p)=>gd.baseIdOf(p.id??p.chessId);

export function withLateranoSingleSkill(recipe) {
  const {ids}=recipe, white=(gd,p)=>[ids.ptilopsis4,ids.ptilopsis5].includes(base(gd,p));
  const auxiliary=rec=>rec.bonds.includes(SKILL)&&!rec.bonds.includes(CORE);
  const helpers=(gd,ps)=>ps.allChess().filter(p=>auxiliary(gd.chess(p.id)));
  const primary=(gd,ps)=>helpers(gd,ps).sort((a,b)=>{
    const rank=p=>white(gd,p)?1000:base(gd,p)===ids.ayerscarpe?800:base(gd,p)===GREY?600
      :base(gd,p)===ids.minimalist?500:gd.tierOf(p.id)*10;
    return rank(b)-rank(a)||Number(gd.isGolden(b.id))-Number(gd.isGolden(a.id))||a.uid-b.uid;
  })[0]||null;
  function purchaseAllowed(m,ps,rec) {
    const gd=gdOf(m,ps),id=base(gd,rec);
    if(!auxiliary(rec)||white(gd,rec))return recipe.purchaseAllowed(m,ps,rec);
    if(gd.modeInactiveBonds.has(SKILL)||helpers(gd,ps).some(p=>base(gd,p)===id)||(ps._botMedicChainBuys?.[id]||0)>=1)return false;
    const existing=primary(gd,ps);
    if(existing){
      // Ayerscarpe's repeatable prep layers upgrade an existing low-tier bridge; the medic upgrades Ayerscarpe.
      if(id!==ids.ayerscarpe||white(gd,existing)||base(gd,existing)===ids.ayerscarpe||gd.tierOf(existing.id)>4)return false;
    }
    return recipe.purchaseAllowed(m,ps,rec);
  }
  function outdated(m,ps,rec) {
    const gd=gdOf(m,ps),p=primary(gd,ps);
    return auxiliary(rec)&&!white(gd,rec)&&p&&base(gd,p)!==base(gd,rec);
  }
  function cleanupAcquisitions(m,ps) {
    recipe.cleanupAcquisitions?.(m,ps);
    const gd=gdOf(m,ps);
    // Complete the same medical replacement when the old body is still deployed in an under-filled early team.
    if(ps.allChess().some(p=>base(gd,p)==='chess_char_2_02_a'||white(gd,p)))for(const p of ps.allChess().slice()){
      if(base(gd,p)!=='chess_char_2_14_a'||p.items?.length||pieceBonds(gd,p).includes(CORE))continue;
      if(ps.sell(p.uid).ok){const stats=ps._botRecipeStats||={};stats.medicBridgeSales=(stats.medicBridgeSales||0)+1;}
    }
    const selected=primary(gd,ps);if(!selected)return;
    for(const p of ps.allChess().slice()){
      const rec=gd.chess(p.id);
      if(!auxiliary(rec)||white(gd,rec)||p.items?.length||pieceBonds(gd,p).includes(CORE))continue;
      if(p.uid===selected.uid)continue;
      // Replacement is already owned. Use the ordinary PREP sell action even if Greyy is still deployed.
      const result=ps.sell(p.uid);
      if(result.ok){const stats=ps._botRecipeStats||={};stats.skillfulBridgeSales=(stats.skillfulBridgeSales||0)+1;}
    }
  }
  return Object.freeze({...recipe,purchaseAllowed,cleanupAcquisitions,
    importantBuy:(m,ps,rec)=>purchaseAllowed(m,ps,rec)&&recipe.importantBuy(m,ps,rec),
    criticalBuy:(m,ps,rec)=>purchaseAllowed(m,ps,rec)&&recipe.criticalBuy(m,ps,rec),
    keep:(m,ps,rec)=>!outdated(m,ps,rec)&&recipe.keep(m,ps,rec),
    preserve:(m,ps,rec)=>!outdated(m,ps,rec)&&recipe.preserve(m,ps,rec),
    unitBonus:(m,ps,rec,plan)=>recipe.unitBonus(m,ps,rec,plan)-(outdated(m,ps,rec)?60:0),
  });
}
