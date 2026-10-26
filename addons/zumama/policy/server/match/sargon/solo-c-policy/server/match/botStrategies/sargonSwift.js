// [ASSUMED] One joint development factor: acquire recurring engines, farm safely, cash out at the final assault.
// Rule sources: generated garrisons 51/79/56, bonds, pieceBonds and the actual current board/hand only.
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { rotateOffset } from '../../../../../../../../../../../sim/dir.js';
import { layerGainRoom } from '../../../../../../../../../../../../shared/constants.js';
import { ids } from './sargonPepe.js';

const CORE='sargonShip', PRECI='preciShip', SWIFT='swiftShip';
export const swiftIds=Object.freeze({leonhardt:ids.leonhardt,thorns:'chess_char_5_15_a',nymph:'chess_char_5_22_a',nymphHidden:'chess_char_6_10_a'});
const engines=new Set(Object.values(swiftIds));
const base=(gd,p)=>gd.baseIdOf(p.id??p.chessId);
const copies=(ps,r)=>ps.allChess().filter(p=>base(ps.gd,p)===base(ps.gd,r));
const has=(ps,p,b)=>pieceBonds(ps.gd,p).includes(b);
const distinct=(ps,b)=>new Set(ps.allChess().filter(p=>has(ps,p,b)).map(p=>base(ps.gd,p))).size;
const nymph=id=>[swiftIds.nymph,swiftIds.nymphHidden].includes(id);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
export const isSwiftEngine=(gd,p)=>engines.has(base(gd,p));

/** Positional layer-only projection of these three engines. Never dispatch economy or on-gain effects. */
export function swiftPrepGains(ps,lineup,plan,bonds){
  const gd=ps.gd,at=new Map(lineup.map(p=>[plan.get(p.uid),p])),selected=new Set(lineup.map(p=>p.uid));
  const handCount=ps.hand.filter(p=>p?.kind==='chess'&&!selected.has(p.uid)).length
    +field(ps).filter(p=>!selected.has(p.uid)).length;
  const gains={},add=(id,n)=>{if(bonds[id]?.active)gains[id]=(gains[id]||0)+n;};
  for(const p of lineup){
    if(!isSwiftEngine(gd,p))continue;
    for(const gid of gd.chess(p.id).garrisonIds||[]){
      const g=gd.garrison(gid);if(g?.eventType!=='SERVER_PREP_FIN')continue;
      if(g.effectKey==='SERVER_ADD_BOND_CHESS_ALL')for(const id of pieceBonds(gd,p))add(id,g.bb.count);
      if(g.effectKey==='SERVER_ADD_BOND_POSITION'){
        const [r,c]=plan.get(p.uid).split(',').map(Number),[dr,dc]=rotateOffset(0,1,plan.dirs.get(p.uid)||'RIGHT');
        for(const target of [p,at.get(`${r+dr},${c+dc}`)].filter(Boolean))for(const id of pieceBonds(gd,target))add(id,g.bb.count);
      }
      if(g.effectKey==='SERVER_ADD_BOND_METHOD'&&g.bbStr.add_method==='hand_count')add(SWIFT,handCount*g.bb.multi);
    }
  }
  return Object.fromEntries(Object.entries(gains).map(([id,n])=>[id,layerGainRoom(bonds[id]?.layers||0,n)]));
}

/** Marginal utility uses each bond's own formula; raw layer totals are not interchangeable. */
export function swiftGrowthValue(layers,gains){
  const swift=layerGainRoom(layers[SWIFT]||0,gains[SWIFT]||0),before=layers[SWIFT]||0;
  let value=100*.0035*swift*(before>=40?2:1);
  if(before<40&&before+swift>=40)value+=15;
  value+=100*.012*(gains[PRECI]||0)/(1.1+.012*(layers[PRECI]||0));
  value+=Math.min(4,(gains[CORE]||0)*.2);
  return value;
}

/** Optional engine spending cannot displace a visible core engine or the parent's affordable level conversion. */
export function swiftPurchaseRoom(m,ps,r,parent){
  const id=base(ps.gd,r),own=copies(ps,r);
  if(own.some(p=>ps.gd.isGolden(p.id)))return false;
  // Leo is already a preferred Precision engine in 23/6. An additive development factor must not veto it.
  if(id===ids.leonhardt)return parent.purchaseAllowed(m,ps,r);
  if(own.length&&id!==ids.leonhardt)return own.length>=2; // no paid pair-building for the expensive compromises
  if(m.round>=m.gd.bossRound-1)return own.length>=2||id===ids.leonhardt;
  if(distinct(ps,CORE)<3)return false;
  if(nymph(id)&&(ps.allChess().some(p=>base(ps.gd,p)===swiftIds.thorns)||distinct(ps,SWIFT)<1
    ||ps.hand.filter(p=>p?.kind==='chess').length<2))return false;
  const slot=ps.shop.slots.find(s=>s&&!s.sold&&s.kind==='chess'&&s.id===r.chessId),price=slot?ps.priceOf(slot):r.price;
  if(ps.funds<price)return false;
  const conversion=ps.shop.upgradePrice+parent.upgradeReserve(m,ps);
  if(parent.priorityLevel(m,ps)&&ps.funds>=conversion&&ps.funds-price<conversion)return false;
  return !ps.shop.slots.some(s=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return false;
    const c=ps.gd.chess(s.id);
    return c.bonds.includes(CORE)&&c.tier>=3&&parent.criticalBuy(m,ps,c);
  });
}

/** Complete samples only. Safe growth may replace a clear control; final assault ranks actual paired combat. */
export function selectSwiftForecast(plans,outcomes,context){
  const rows=plans.map((_,i)=>outcomes.filter(r=>r.index===i).sort((a,b)=>a.sample-b.sample));
  const valid=rs=>rs.length===2&&rs.every((r,i)=>r.valid&&r.sample===i);
  if(!valid(rows[0]))return {index:0};
  const rank=rs=>context.boss?[Math.min(...rs.map(r=>r.won)),rs.reduce((s,r)=>s+r.won,0),
    Math.min(...rs.map(r=>r.damageShare)),rs.reduce((s,r)=>s+r.damageShare,0),Math.min(...rs.map(r=>r.lp))]
    :[-Math.max(...rs.map(r=>r.lost)),-rs.reduce((s,r)=>s+r.lost,0),-rs.reduce((s,r)=>s+r.leaks,0),
      rs.reduce((s,r)=>s+(r.growth||0),0)];
  const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]>b[i];return false;};
  let index=0,best=rank(rows[0]);
  for(let i=1;i<rows.length;i++){
    if(!valid(rows[i]))continue;
    if(!context.boss&&rows[i].some((r,j)=>{
      const ref=rows[0][j];
      return r.lost>ref.lost||r.leaks>ref.leaks||r.killed<ref.killed||r.deaths>ref.deaths
        ||[...context.protectedUids].some(uid=>(r.protectedDeaths?.[uid]||0)>(ref.protectedDeaths?.[uid]||0));
    }))continue;
    const score=rank(rows[i]);if(better(score,best)){index=i;best=score;}
  }
  return {index};
}

export function swiftForecastPolicy(m,ps,plans,bondsFor){
  return {
    prepareForecastInput(m,ps,chosen,plan,input){
      const gains=swiftPrepGains(ps,plan.lineup,plan,bondsFor(plan.lineup));plan.swiftGains=gains;
      for(const [id,n]of Object.entries(gains))if(input.bonds[id])input.bonds[id].layers+=n;
      return input;
    },
    forecastContext:()=>({boss:!m.wave,protectedUids:new Set(field(ps).filter(p=>[ids.passenger,ids.titi,ids.pepe].includes(base(ps.gd,p))).map(p=>p.uid))}),
    observeForecast(battle,context,plan){
      const deaths={};battle.on('death',({unit,reason})=>{if(reason==='killed'&&context.protectedUids.has(unit?.uid))deaths[unit.uid]=(deaths[unit.uid]||0)+1;});
      return pp=>{
        const gains={...pp.layerGains};for(const [id,n]of Object.entries(plan.swiftGains||{}))gains[id]=(gains[id]||0)+n;
        return {growth:swiftGrowthValue(ps.layers,gains),gains,protectedDeaths:deaths};
      };
    },selectForecast:selectSwiftForecast
  };
}

/** Pair real items on a real engine to compress a Core/Precision slot. No virtual conversion or replaced equipment. */
export function swiftTransferTarget(m,ps,r,owned){
  const gd=ps.gd,signature=it=>[CORE,PRECI].includes(it?.giveBondId),bag=ps.hand.filter(p=>p?.kind==='item').map(p=>gd.item(p.id));
  if(!r.canGiveBond&&!signature(r))return undefined;
  const candidates=owned.filter(p=>isSwiftEngine(gd,p)||base(gd,p)===ids.passenger).filter(p=>{
    const worn=(p.items||[]).map(i=>gd.item(i.id)),needed=r.canGiveBond?[...worn,...bag].find(i=>signature(i)&&!has(ps,p,i.giveBondId))
      :!has(ps,p,r.giveBondId)&&[...worn,...bag].find(i=>i.canGiveBond);
    return needed&&(p.items?.length||0)+(worn.includes(needed)?1:2)<=gd.equipPerChess;
  });
  candidates.sort((a,b)=>Number(ps.find(b.uid)?.area==='board')-Number(ps.find(a.uid)?.area==='board')
    ||Number(base(gd,b)===swiftIds.thorns)-Number(base(gd,a)===swiftIds.thorns)||a.uid-b.uid);
  return candidates[0]||(r.canGiveBond?null:undefined);
}

export function createSwiftPolicy(parent,finalBoardSteps){
  return Object.freeze({...parent,name:'Sargon recurring Swift development',finalBoardSteps,
    purchaseAllowed(m,ps,r){return isSwiftEngine(ps.gd,r)?swiftPurchaseRoom(m,ps,r,parent):parent.purchaseAllowed(m,ps,r);},
    buyBonus(m,ps,r){const id=base(ps.gd,r),fresh=!copies(ps,r).length;
      return parent.buyBonus(m,ps,r)+(fresh?({[ids.leonhardt]:38,[swiftIds.thorns]:48,[swiftIds.nymph]:18,[swiftIds.nymphHidden]:18}[id]||0):0);},
    unitBonus(m,ps,r){return parent.unitBonus(m,ps,r)+(isSwiftEngine(ps.gd,r)&&m.round<m.gd.bossRound?18:0);},
    // Preserve the last real alternative until the final forecast, even when the combat roster drops Swift.
    keep:(m,ps,r)=>parent.keep(m,ps,r)||isSwiftEngine(ps.gd,r)&&m.round<=m.gd.bossRound,
    preserve:(m,ps,r)=>parent.preserve(m,ps,r)||isSwiftEngine(ps.gd,r)&&copies(ps,r).length===1&&m.round<=m.gd.bossRound,
    importantBuy:(m,ps,r)=>parent.importantBuy(m,ps,r)||isSwiftEngine(ps.gd,r)&&!copies(ps,r).length&&swiftPurchaseRoom(m,ps,r,parent),
    lineupBonus(gd,pieces,bonds,ctx){
      let n=parent.lineupBonus(gd,pieces,bonds,ctx);
      if(bonds[SWIFT]?.active&&bonds[PRECI]?.active&&(pieces.some(p=>isSwiftEngine(gd,p))||(bonds[SWIFT].layers||0)>=40)){
        const developing=(ctx?.ps?.m?.round||gd.bossRound)>=gd.bossRound?false:pieces.some(p=>isSwiftEngine(gd,p));
        n+=developing?125:20+Math.min(20,(bonds[SWIFT].layers||0)*.07)+((bonds[SWIFT].layers||0)>=40?60:0);
      }
      return n;
    },
    layoutValue(gd,units,plan,bonds,model){
      let n=parent.layoutValue(gd,units,plan,bonds,model);
      for(const u of units)if(base(gd,u.rec)===swiftIds.thorns){
        const [dr,dc]=rotateOffset(0,1,u.dir),target=units.find(v=>v.r===u.r+dr&&v.c===u.c+dc);
        if(target)n+=Math.min(3,(target.rec.bonds||[]).filter(b=>bonds[b]?.active&&[CORE,PRECI,SWIFT].includes(b)).length)*1.2;
      }
      return n;
    },
    ownedItemTarget(m,ps,r,owned){const target=swiftTransferTarget(m,ps,r,owned);return target===undefined?parent.ownedItemTarget(m,ps,r,owned):target;},
    purchaseItemAllowed:(m,ps,r)=>parent.purchaseItemAllowed(m,ps,r)||swiftTransferTarget(m,ps,r,ps.allChess())!=null,
    itemBonus(m,ps,r){return parent.itemBonus(m,ps,r)+(swiftTransferTarget(m,ps,r,ps.allChess())?18:0);}
  });
}
