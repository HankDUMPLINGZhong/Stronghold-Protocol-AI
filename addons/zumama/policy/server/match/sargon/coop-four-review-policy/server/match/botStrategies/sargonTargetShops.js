import { createForecastBattle, stepForecastBattle } from '../../../../../../../../../../aiCompute/forecast.js';
import {sargonPlanning} from '../botCoopForecast.js';
// [ASSUMED] Requested shopping policy on retained 24/6: target shops instead of spare passive gear.
import { ids } from './sargonPepe.js';
import { isSwiftEngine } from './sargonSwift.js';
import { pieceBonds } from '../../../../../../../../../../bondsMeta.js';
import { GEO } from '../../../../../../../../../../../../shared/constants.js';
import { deriveSeed } from '../../../../../../../../../../../sim/rng.js';
import { withBounties } from '../../../../../../../../../../waves.js';

const CORE='sargonShip',FOOD='chess_item_3_05_e',COMPASS='chess_item_6_07_e',MIMIC='chess_item_5_05_e';
const base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId),is=(r,id)=>r.itemId?.startsWith(id)||r.id?.startsWith(id);
const itemIs=(ps,p,id)=>(typeof p==='string'?p:p.id)?.startsWith(id);
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const native=(ps,p)=>pieceBonds(ps.gd,p).includes(CORE);
const elite=(ps,p)=>ps.gd.isGolden(p.id);
const copies=(ps,p)=>ps.allChess().filter(q=>base(ps,q)===base(ps,p)&&!elite(ps,q));
const mains=new Set([ids.philae,ids.minimalist,ids.gavial4,ids.gavial5,ids.titi,ids.passenger,ids.pepe,ids.leonhardt,ids.kroos]);
const note=(ps,event)=>(ps._sargonFactorHistory||=[]).push({factor:ps.m?.opts.botSargonFactor?.startsWith('roster-mimic-')?'mimic-always':'target-shops',...event});
const keyOf=(m,ps)=>JSON.stringify([m.round,ps.lp,ps.shop.level,ps.allChess().map(p=>[p.uid,p.id,p.items]),
  ps.hand.filter(p=>p?.kind==='item'&&!p.id.startsWith(MIMIC)).map(p=>[p.uid,p.id]),ps.layers,ps.bounties,ps.deviceOverrides]);

export function initialSkillGap(ps,p){
  const r=ps.gd.chess(p.id),skill=r.skill;if(!skill||!(skill.spCost>0))return 0;
  let initial=skill.initSp||0;
  for(const it of p.items||[]){const rec=ps.gd.item(it.id);
    if(itemIs(ps,it,COMPASS))initial+=rec.params?.init_sp||rec.buffs?.[0]?.bb?.init_sp||30;
    if(itemIs(ps,it,FOOD)){
      const mine=pieceBonds(ps.gd,p),n=field(ps).filter(q=>q.uid!==p.uid&&pieceBonds(ps.gd,q).some(b=>mine.includes(b))).length;
      initial+=(rec.params?.sp_each_person||rec.buffs?.[0]?.bb?.sp_each_person||3)*(1+n);
    }
  }
  return Math.max(0,skill.spCost-initial);
}
export function startingSpTarget(ps,owned,{food=true}={}){
  const prefix=food?FOOD:COMPASS;
  const rows=owned.filter(p=>(p.items?.length||0)<ps.gd.equipPerChess&&initialSkillGap(ps,p)>0
    &&!(p.items||[]).some(it=>itemIs(ps,it,prefix)));
  const rank=p=>base(ps,p)===ids.pepe?0:[ids.gavial4,ids.gavial5].includes(base(ps,p))?1:native(ps,p)?2:3;
  return rows.sort((a,b)=>rank(a)-rank(b)||Number(ps.find(b.uid)?.area==='board')-Number(ps.find(a.uid)?.area==='board')
    ||initialSkillGap(ps,b)-initialSkillGap(ps,a)||a.uid-b.uid)[0]||null;
}
export function mimicPairTarget(ps,{eligible=null}={}){
  const rows=ps.allChess().filter(p=>!elite(ps,p)&&(p.items?.length||0)<ps.gd.equipPerChess
    &&copies(ps,p).length>=2&&!ps.allChess().some(q=>base(ps,q)===base(ps,p)&&elite(ps,q))
    &&(eligible?eligible(p):native(ps,p)&&ps.gd.chess(p.id).tier>=4||isSwiftEngine(ps.gd,p)));
  // The real mimic grant ignores stock counts, so an exhausted shop pool does not invalidate this pair.
  return rows.sort((a,b)=>Number(mains.has(base(ps,b)))-Number(mains.has(base(ps,a)))
    ||ps.gd.chess(b.id).tier-ps.gd.chess(a.id).tier||a.uid-b.uid)[0]||null;
}
export function emergencyMimicTarget(m,ps){
  if(ps._sargonMimicRisk?.key!==keyOf(m,ps)||!ps._sargonMimicRisk?.fatal)return null;
  return ps.allChess().filter(p=>!elite(ps,p)&&native(ps,p)&&(p.items?.length||0)<ps.gd.equipPerChess)
    .sort((a,b)=>Number(copies(ps,b).length>=2)-Number(copies(ps,a).length>=2)
      ||Number(pieceBonds(ps.gd,b).length===1)-Number(pieceBonds(ps.gd,a).length===1)
      ||ps.gd.chess(b.id).tier-ps.gd.chess(a.id).tier||a.uid-b.uid)[0]||null;
}

/** Two complete independent current-wave samples. Never read the actual battle seed or settle a preview. */
export function* evaluateMimicRisk(m,ps,input,key){
  const samples=[];
  for(let sample=0;sample<2;sample++){
    const battle=createForecastBattle(m, {seed:deriveSeed(m.seed,`sargon-mimic-risk:${m.round}:${ps.seat}:${sample}`),
      kind:'normal',modeId:m.modeId,round:m.round,stageId:m.stageId,rect:{...GEO.NORMAL_RECT},timeLimit:m.wave.timeLimit,
      players:[structuredClone(input)],spawns:m._sanitizeSpawns(withBounties(m.gd,m.round,m.wave,ps.bounties,ps.playerId)
        .map(s=>({...s,ownerPlayerId:ps.playerId})),ps.playerId),routes:m.wave.routes,sharedBoss:null,
      flags:{...m.gd.dp,layerGainsEnabled:true},fieldId:`r:${ps.playerId}`,enemyOverrides:m.wave.overrides,waveId:m.wave.templateId});
    const cap=Math.ceil(((m.wave.timeLimit||60)+5)*30);
    for(let tick=0;tick<cap&&!battle.finished;tick++){stepForecastBattle(battle);if(tick%120===0)yield;}
    const result=battle.result(),pp=result.perPlayer?.[ps.playerId];
    const valid=battle.finished&&!result.synthetic&&!result.errors&&!!pp;
    const leaks=(pp?.leaked||[]).filter(l=>l.counted!==false).length;
    samples.push({sample,valid,leaks,lost:Math.min(m.gd.lpCapPerRound,leaks)});yield;
  }
  const fatal=samples.every(s=>s.valid&&s.lost>=ps.lp);
  ps._sargonMimicRisk={key,fatal,round:m.round,samples};note(ps,{phase:'mimic-risk',round:m.round,lp:ps.lp,fatal,samples});
}

function lockTargets(m,ps,parent){
  if(m.round>=m.gd.bossRound)return [];
  return ps.shop.slots.filter(s=>s&&!s.sold&&s.kind==='chess'&&(ps.priceOf(s)>ps.funds||!ps.hand.some(p=>!p)))
    .filter(s=>{
      const r=ps.gd.chess(s.id),own=ps.allChess().filter(p=>base(ps,p)===base(ps,s));
      if(own.some(p=>elite(ps,p)))return false;
      const rich=Object.assign(Object.create(ps),{funds:Math.max(ps.funds,ps.priceOf(s)+10)});
      if(!parent.purchaseAllowed(m,rich,r))return false;
      const distinct=new Set(ps.allChess().filter(p=>native(ps,p)).map(p=>base(ps,p))).size;
      return r.bonds.includes(CORE)&&!own.length&&distinct<6||mains.has(base(ps,s))
        ||isSwiftEngine(ps.gd,r)&&(!own.length||ps.completesChessMerge(s.id));
    });
}
export function createTargetShopPolicy(parent){
  const policy={...parent,name:'Sargon target shops, deliberate mimic and starting SP',
    bankRemainder:()=>false,
    purchaseItemAllowed(m,ps,r){
      if(is(r,COMPASS))return ps.allChess().some(p=>native(ps,p));
      if(is(r,MIMIC))return !!(mimicPairTarget(ps)||emergencyMimicTarget(m,ps));
      return parent.purchaseItemAllowed(m,ps,r);
    },
    itemBonus(m,ps,r){return parent.itemBonus(m,ps,r)+(is(r,COMPASS)?14:is(r,MIMIC)&&policy.purchaseItemAllowed(m,ps,r)?24:0);},
    ownedItemTarget(m,ps,r,owned){
      if(is(r,MIMIC))return mimicPairTarget(ps)||emergencyMimicTarget(m,ps);
      if(is(r,FOOD))return startingSpTarget(ps,owned);
      if(is(r,COMPASS))return startingSpTarget(ps,owned,{food:false});
      return parent.ownedItemTarget(m,ps,r,owned);
    },
    holdItem(m,ps,r){return is(r,MIMIC)?!policy.ownedItemTarget(m,ps,r,ps.allChess()):parent.holdItem(m,ps,r);},
    protectItem:(m,ps,r)=>parent.protectItem(m,ps,r)||is(r,FOOD)||is(r,MIMIC),
    holdShop(m,ps){
      const slots=lockTargets(m,ps,parent);if(!slots.length)return false;
      const key=JSON.stringify([m.round,ps.funds,slots.map(s=>s.id)]);
      if(ps._sargonLastLock!==key){ps._sargonLastLock=key;note(ps,{phase:'target-lock',round:m.round,funds:ps.funds,
        targets:slots.map(s=>({id:s.id,price:ps.priceOf(s)}))});}
      return true;
    },
    *shoppingSteps(m,ps,h){
      const offered=ps.shop.slots.some(s=>s&&!s.sold&&s.kind==='item'&&s.id.startsWith(MIMIC)&&ps.priceOf(s)<=ps.funds);
      const held=[...ps.hand,...ps.temp].some(p=>p?.kind==='item'&&p.id.startsWith(MIMIC));
      if(!(m.botRehearsal>0)||m.wave&&ps.lp>m.gd.lpCapPerRound
        ||!m.wave&&(!sargonPlanning(m,ps)||m.round!==m.gd.bossRound)||!(offered||held)
        ||(h.mimicPairTarget?h.mimicPairTarget():mimicPairTarget(ps)))return;
      if(!ps.allChess().some(p=>native(ps,p)&&!elite(ps,p)))return;
      // Resolve already available strengthening before asking whether a purchase is an emergency.
      h.equipItems();
      if(!ps.shop.slots.some(s=>s&&!s.sold&&s.kind==='item'&&s.id.startsWith(MIMIC)&&ps.priceOf(s)<=ps.funds)
        &&![...ps.hand,...ps.temp].some(p=>p?.kind==='item'&&p.id.startsWith(MIMIC)))return;
      const key=keyOf(m,ps);if(ps._sargonMimicRisk?.key===key)return;
      const lineup=h.lineup(),plan=yield* h.planLayoutSteps(lineup);
      if(m.wave){
        const input=yield* h.inputSteps(lineup,plan);yield* evaluateMimicRisk(m,ps,input,key);
      }else{
        const plans=[plan];for(let i=1;i<3;i++)plans.push(yield* h.planLayoutSteps(lineup,i));
        const job=yield* h.bossRiskSteps(lineup,plans);
        const samples=job?.outcomes||[];
        const fatal=samples.length>=4&&samples.every(s=>s.valid&&s.won===0&&s.lp<=0);
        ps._sargonMimicRisk={key,fatal,round:m.round,samples};
        note(ps,{phase:'mimic-risk',round:m.round,boss:true,lp:ps.lp,fatal,samples});
      }
      if(held&&ps._sargonMimicRisk.fatal)h.equipItems();
    },
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      note(ps,{phase:'shop-end',round:m.round,frozen:ps.shop.frozen,funds:ps.funds,
        slots:ps.shop.slots.filter(s=>s&&!s.sold).map(s=>({id:s.id,kind:s.kind,price:ps.priceOf(s)})),
        food:ps.allChess().filter(p=>(p.items||[]).some(it=>itemIs(ps,it,FOOD))).map(p=>({id:p.id,uid:p.uid,area:ps.find(p.uid)?.area}))});
    }};
  return Object.freeze(policy);
}
