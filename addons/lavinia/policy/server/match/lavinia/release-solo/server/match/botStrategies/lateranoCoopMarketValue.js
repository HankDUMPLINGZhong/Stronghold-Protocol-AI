// [ASSUMED] Co-op market-value trial: acquire the missing native frontline; mature damage tiers need not yield to roles.
// Keep the 13/56 role-first object callable. No seed, future shop or real battle outcome enters decisions.
import {withLateranoCoopMarketRepair} from './lateranoCoopMarketRepair.js';

const scoped=m=>m.mode==='coop'&&!m.isSolo&&m.round>=4&&m.round<=m.gd.bossRound;
export function coopMarketKeyRank(m,ps,recipe,rec){
  if(!scoped(m)||!rec||rec.isGolden||recipe.purchaseAllowed(m,ps,rec)===false)return 0;
  const gd=ps.gd||m.gd,id=gd.baseIdOf(rec.chessId||rec.id);
  // R14 complete native pairs before a newly discovered secondary bridge consumes their budget.
  if(m.round===gd.bossRound&&rec.bonds.includes('lateranoShip')&&ps.completesChessMerge(rec.chessId||rec.id))return 100;
  // The last two normal waves are a bounded catch-up window. Earlier spending and final carry budgets stay with
  // the inherited evaluator: buying a tank at every opportunity can delay core promotions or displace mature DPS.
  if(m.wave&&m.round>=gd.bossRound-2&&m.round<gd.bossRound
    &&id===recipe.ids.faith&&!ps.allChess().some(p=>gd.baseIdOf(p.id)===id))return 90;
  return 0;
}

export function withLateranoCoopMarketValue(recipe){
  const repaired=withLateranoCoopMarketRepair(recipe,{roleFirst:false});
  const key=(m,ps,r)=>coopMarketKeyRank(m,ps,recipe,r)>0;
  return Object.freeze({...repaired,
    importantBuy:(m,ps,r,...xs)=>key(m,ps,r)||repaired.importantBuy(m,ps,r,...xs),
    criticalBuy:(m,ps,r,...xs)=>key(m,ps,r)||repaired.criticalBuy(m,ps,r,...xs),
    buyBonus:(m,ps,r,...xs)=>repaired.buyBonus(m,ps,r,...xs)+(key(m,ps,r)?35:0),
    trade(m,ps,ctx,h){
      const gd=ps.gd||m.gd;
      const target=ps.hand.some(p=>!p)?ps.shop.slots.map((s,index)=>({s,index,
        rank:s&&!s.sold&&s.kind==='chess'?coopMarketKeyRank(m,ps,recipe,gd.chess(s.id)):0}))
        .filter(x=>x.rank&&ps.priceOf(x.s)<=ps.funds).sort((a,b)=>b.rank-a.rank||a.index-b.index)[0]:null;
      if(target){
        const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
        if(ps.buy(target.index)?.ok){
          recipe.afterPurchase?.(m,ps,target.s,before);recipe.useEconomy(m,ps);
          (ps._botCoopMarketValueHistory||=[]).push({round:m.round,kind:target.rank===100?'native-third':'first-Mixer',
            id:target.s.id,fundsBefore:funds,fundsAfter:ps.funds});
          return true;
        }
      }
      return repaired.trade(m,ps,ctx,h);
    },
  });
}
