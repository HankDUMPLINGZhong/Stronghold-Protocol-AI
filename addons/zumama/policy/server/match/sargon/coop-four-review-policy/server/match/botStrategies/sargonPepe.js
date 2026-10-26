// Solo Pepe/Sargon. Sources: generated chess, bands, bonds and garrisons.
// [ASSUMED] Scores, timing and reserves are AI policy, never game rules.
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { healingTiles, acceptsHealing } from '../botPositioning.js';
import { bankRemainder, releaseSavings, preserveSavings } from '../botSavings.js';
export const CORE = 'sargonShip';
export const ids = Object.freeze({ estelle:'chess_char_1_12_a', papyrus:'chess_char_2_06_a', bubble:'chess_char_2_08_a',
  philae:'chess_char_3_06_a', minimalist:'chess_char_3_13_a', beeswax:'chess_char_4_05_a',
  gavial4:'chess_char_4_23_a', carnelian:'chess_char_4_24_a', titi:'chess_char_5_02_a',
  gavial5:'chess_char_5_18_a', passenger:'chess_char_6_05_a', pepe:'chess_char_6_06_a',
  executor:'chess_char_2_01_a', kroos:'chess_char_4_06_a', leonhardt:'chess_char_4_14_a' });
const gdOf = (m,ps) => ps.gd || m.gd;
const base = (gd,r) => gd.baseIdOf(r.id ?? r.chessId);
const copies = (m,ps,r) => ps.allChess().filter(p => base(gdOf(m,ps),p) === base(gdOf(m,ps),r));
const has = (m,ps,id) => copies(m,ps,{id}).length > 0;
const native = r => r.bonds.includes(CORE);
const precision = r => r.bonds.includes('preciShip');
const front = r => r.position === 'MELEE' && r.stats.blockCnt >= 2;
const heal = r => r.attackKind === 'heal' || ['guardian','incantationmedic'].includes(r.subProfessionId);
const distinct = (m,ps,bond) => new Set(ps.allChess().filter(p => pieceBonds(gdOf(m,ps),p).includes(bond))
  .map(p => base(gdOf(m,ps),p))).size;
const engines = new Set([ids.philae,ids.gavial4,ids.gavial5,ids.titi,ids.passenger,ids.pepe]);
const route = Object.freeze({id:CORE+':pepe-precision',name:'Sargon Precision',strategyName:'Sargon',core:CORE,
  coreMembers:6,support:'preciShip',supports:Object.freeze(['preciShip']),supportMembers:3});
function purchaseAllowed(m,ps,r) {
  const own=copies(m,ps,r),gd=gdOf(m,ps);
  if(own.some(p=>gd.isGolden(p.id))) return false;
  if(native(r)) return true;
  if(precision(r)) return r.tier>=4 || distinct(m,ps,'preciShip')<3 || own.length>=2;
  const rs=ps.allChess().map(p=>gd.chess(p.id));
  if(front(r)&&rs.filter(front).length<2 || heal(r)&&!rs.some(heal)) return true;
  if(m.round<=4&&r.tier<=2) return own.length>=2 || ps.allChess().length<5;
  return r.bonds.includes('skillfulShip')&&has(m,ps,ids.minimalist)
    && !rs.some(x=>!native(x)&&x.bonds.includes('skillfulShip'))&&r.tier<=4;
}
function buyBonus(m,ps,r) {
  const id=base(gdOf(m,ps),r),fresh=!has(m,ps,id);
  let n=native(r)&&fresh&&distinct(m,ps,CORE)<6?45:0;
  n+=({[ids.pepe]:85,[ids.passenger]:100,[ids.titi]:85,[ids.philae]:32,[ids.gavial4]:40,[ids.gavial5]:38,
    [ids.leonhardt]:28,[ids.kroos]:16,[ids.minimalist]:24,[ids.papyrus]:fresh?24:0})[id]||0;
  if(precision(r)) n+=fresh&&distinct(m,ps,'preciShip')<3?32:10;
  return n;
}
const unitBonus=(m,ps,r)=>({[ids.pepe]:42,[ids.passenger]:75,[ids.titi]:50,[ids.gavial4]:28,[ids.gavial5]:30,
  [ids.philae]:20,[ids.papyrus]:10,[ids.leonhardt]:22,[ids.kroos]:14,[ids.minimalist]:14})[base(gdOf(m,ps),r)]||0;
const keep=(m,ps,r)=>native(r)||precision(r)||heal(r)||front(r)&&m.round<=9;
const preserve=(m,ps,r)=>preserveSavings(m,ps,r)||copies(m,ps,r).length===1&&(engines.has(base(gdOf(m,ps),r))
  ||native(r)&&distinct(m,ps,CORE)<=6||precision(r)&&distinct(m,ps,'preciShip')<=3);
function levelTarget(m,_ps) {
  if(['fast','tempo'].includes(m.opts.botSargonVersion)) return m.round<2?1:m.round<4?2:m.round<6?3:m.round<8?4:m.round<10?5:6;
  return m.round<2?1:m.round<4?2:m.round<6?3:m.round<9?4:m.round<11?5:6;
}
const criticalBuy=(m,ps,r)=>purchaseAllowed(m,ps,r)&&(ps.completesChessMerge(r.chessId)
  ||native(r)&&!has(m,ps,base(gdOf(m,ps),r))&&distinct(m,ps,CORE)<6
  ||engines.has(base(gdOf(m,ps),r))&&!has(m,ps,base(gdOf(m,ps),r)));
const readyForUpgrade=(m,ps)=>ps.allChess().length>=Math.min(6,ps.shop.level+1)
  &&ps.allChess().some(p=>front(gdOf(m,ps).chess(p.id)));
const beforeUpgrade=(m,ps)=>readyForUpgrade(m,ps)&&!ps.shop.slots.some(s=>{
  if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return false;
  const r=gdOf(m,ps).chess(s.id);
  if(m.opts.botSargonVersion==='tempo')return r.tier>=3&&engines.has(base(gdOf(m,ps),r))
    &&(!has(m,ps,base(gdOf(m,ps),r))||ps.completesChessMerge(s.id));
  return criticalBuy(m,ps,r);
});
function onLevelUp(m,ps){
  if(m.opts.botSargonVersion==='tempo' && ps.counters['band:pepe:special']>0) ps.refresh();
}
// A special refresh is paid. Budget its refresh and subsequent purchases before upgrading.
const upgradeReserve=(m,ps)=>[1,3,5].includes(ps.shop.level)?(ps.shop.level>=3?5:3):2;
const priorityLevel=(m,ps)=>ps.shop.level<levelTarget(m,ps)&&beforeUpgrade(m,ps);
const spendReserve=(m,ps)=>priorityLevel(m,ps)&&ps.funds>=ps.shop.upgradePrice+upgradeReserve(m,ps)?ps.shop.upgradePrice:0;
function lineupBonus(gd,pieces,bonds) {
  const rs=pieces.map(p=>gd.chess(p.id)),count=bonds[CORE]?.count||0;
  let n=count>=6?280:count>=3?35:0;
  if(bonds.preciShip?.active)n+=40+Math.min(60,(bonds.preciShip.layers||0)/3);
  if(bonds.preciShip?.count>=3)n+=75;
  if(bonds.skillfulShip?.active)n+=20;
  if(!rs.some(front))n-=140;
  if(!rs.some(heal))n-=65;
  if(rs.some(r=>base(gd,r)===ids.titi)&&rs.some(r=>base(gd,r)===ids.pepe))n+=40;
  return n;
}
function layoutValue(gd,units,plan,bonds,model) {
  let n=0;
  for(const u of units)if(heal(u.rec)){
    const tiles=healingTiles(u.rec,u.r,u.c,u.dir);
    for(const v of units)if(v!==u&&front(v.rec)&&acceptsHealing(v.rec))n+=tiles.has(v.key)?1:-0.6;
  }
  for(const u of units)if(base(gd,u.rec)===ids.titi){
    for(const v of units)if(base(gd,v.rec)===ids.pepe&&u.cover.has(v.key))n+=1;
    if(model.routes.some(rt=>rt.tiles.some(k=>u.cover.has(k))))n+=1;
  }
  return n;
}
const effect=(r,k)=>r?.buffs?.some(b=>b.key===k);
const phone=r=>effect(r,'use_equip_reward_special_goods_char_chess');
function ownedItemTarget(m,ps,r,owned){
  const gd=gdOf(m,ps),free=p=>(p.items?.length||0)<gd.equipPerChess;
  if(phone(r)||effect(r,'use_equip_reward_char_chess_with_same_bond'))return owned
    .filter(p=>native(gd.chess(p.id))&&pieceBonds(gd,p).length===1&&free(p))[0]||null;
  if(effect(r,'use_equip_upgrade_char')||effect(r,'equip_round_start_upgrade_char')){
    const order=[ids.passenger,ids.titi,ids.pepe,ids.gavial5,ids.gavial4,ids.philae,ids.minimalist];
    return owned.filter(p=>!gd.isGolden(p.id)&&free(p)&&order.includes(base(gd,p)))
      .sort((a,b)=>order.indexOf(base(gd,a))-order.indexOf(base(gd,b)))[0]||null;
  }
  return undefined;
}
const holdItem=(m,ps,r)=>effect(r,'equip_destory_gain_random_coin')?m.round<gdOf(m,ps).bossRound
  :phone(r)&&ps.shop.level<5&&distinct(m,ps,CORE)>=3&&ps.lp>10;
const itemAllowed=r=>!effect(r,'trap_create_self_choice');
const economyKeys=['gain_coin_when_round_start','use_equip_reward_special_goods_char_chess',
  'use_equip_reward_char_chess_with_same_bond','use_equip_upgrade_char','equip_round_start_upgrade_char',
  'equip_destory_gain_random_coin','equip_destory_deployment_cnt_change'];
const itemBonus=(m,ps,r)=>phone(r)?25:r?.buffs?.some(b=>economyKeys.includes(b.key))?12:0;
function useEconomy(m,ps){
  releaseSavings(m,ps,{current:true});
  for(const item of [...ps.hand].filter(p=>p?.kind==='item')){
    const r=gdOf(m,ps).item(item.id);if(!phone(r)||holdItem(m,ps,r))continue;
    const target=ownedItemTarget(m,ps,r,ps.allChess());if(target)ps.equip(item.uid,target.uid);
  }
}
export const sargonPepe=Object.freeze({name:'Solo Pepe/Sargon experiment',core:CORE,ids,routes:[route],selectRoute:()=>route,
  valuesBond:b=>[CORE,'preciShip','skillfulShip','steadShip'].includes(b),purchaseAllowed,buyBonus,unitBonus,keep,preserve,
  levelTarget,readyForUpgrade,beforeUpgrade,onLevelUp,upgradeReserve,priorityLevel,spendReserve,criticalBuy,importantBuy:criticalBuy,
  lineupBonus,layoutValue,healingFormation:true,formationTrialIndex:0,rewardAllowed:()=>true,
  rewardPriority:(m,ps,s)=>s.kind==='chess'&&purchaseAllowed(m,ps,gdOf(m,ps).chess(s.id))?1:0,
  ownedItemTarget,holdItem,protectItem:(m,ps,r)=>phone(r),itemAllowed,itemBonus,
  purchaseItemAllowed:(m,ps,r)=>itemBonus(m,ps,r)>0,useEconomy,trade:()=>false,cycleValue:()=>0,refreshValue:()=>0,
  shoppingRepair:true,spendAllFunds:true,
  bankRemainder:(m,ps)=>bankRemainder(m,ps,{itemAllowed,chessAllowed:r=>purchaseAllowed(m,ps,r)}),
  bossLayoutValue:()=>0,bossSupportValue:()=>0,bossFocus:true,
  requiredCoreMembers:(m,ps)=>distinct(m,ps,CORE)>=6?6:0});
