import {sargonPlanning} from '../botCoopForecast.js';
// [ASSUMED] Four independent 28/13 economic experiments. Thresholds are policy, never game rules.
// Forecasts use public current-wave inputs and independent samples; imaginary acquisitions never settle effects.
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {createForecastSteps} from '../botForecast.js';
import {previewLineupOf,planLayoutSteps,bossInputSteps,LAYOUT_PARAMS,buyScoreOf} from '../botDevelopment.js';
import {swiftPrepGains} from './sargonSwift.js';
import {ids} from './sargonPepe.js';
const CORE='sargonShip',base=(ps,p)=>ps.gd.baseIdOf(p.id??p.chessId);
const finish=gen=>{let r;do{r=gen.next();}while(!r.done);return r.value;};
const note=(ps,mode,e)=>(ps._sargonFactorHistory||=[]).push({factor:'economy-round34',mode,...e});
const key=(m,ps)=>JSON.stringify([m.round,ps.lp,ps.funds,ps.shop,ps.layers,ps.allChess(),[...ps.board.keys()]]);
const pairs=(out,index)=>out.filter(r=>r.index===index).sort((a,b)=>a.sample-b.sample);
const valid=rows=>rows.length===2&&rows.every((r,i)=>r.valid&&r.sample===i);

export function economyShadow(ps){
  const s=Object.create(Object.getPrototypeOf(ps));
  for(const [k,v]of Object.entries(ps)){
    if(['gd','m'].includes(k)){s[k]=v;continue;}
    try{s[k]=structuredClone(v);}catch{s[k]=v;}
  }
  return s;
}
function addPlain(ps,id,uid){const p={kind:'chess',id,uid,items:[],dir:'RIGHT',poolCopies:0};ps.hand.push(p);return p;}
function eliteShadow(ps,id){
  const s=economyShadow(ps),matches=p=>p?.kind==='chess'&&base(s,p)===id&&!s.gd.isGolden(p.id);
  const items=s.allChess().filter(matches).flatMap(p=>p.items||[]);
  s.board=new Map([...s.board].filter(([,p])=>!matches(p)));s.hand=s.hand.map(p=>matches(p)?null:p);s.temp=s.temp.filter(p=>!matches(p));
  s.hand.push(...items);addPlain(s,s.gd.goldenIdOf(id),-20000);return s;
}
function forecast(m,ps,shadows,tag){
  const plans=shadows.map((s,i)=>{
    const lineup=previewLineupOf(m,s),plan=finish(planLayoutSteps(m,s,lineup,LAYOUT_PARAMS,{formationRoles:true,fireControl:true,
      rng:createRng(deriveSeed(m.seed,`economy34-layout:${m.round}:${ps.seat}:${tag}`))}));
    plan.lineup=lineup;plan.shadow=s;plan.arm=i;
    plan.assignments=[{item:{uid:JSON.stringify(s.allChess().map(p=>[p.uid,p.id,p.items]))},target:{uid:0}}];return plan;
  });
  const job=finish(createForecastSteps(m,ps,plans[0].lineup,plans,function*(plan){
    const input=yield* bossInputSteps(m,plan.shadow,plan.lineup,plan,{keepWithdrawn:true});
    const gains=swiftPrepGains(plan.shadow,plan.lineup,plan,input.bonds);
    for(const [id,n]of Object.entries(gains))if(input.bonds[id])input.bonds[id].layers+=n;
    return input;
  },{singlePlanProbe:true,equipmentAlternatives:true,forecastContext:()=>({}),selectForecast:()=>({index:0}),
    observeForecast(battle){
      const casts={},deaths={},gains={};
      battle.on('skillStart',({unit})=>{if(unit?.ownerId===ps.playerId&&unit.kind==='op')casts[unit.uid]=(casts[unit.uid]||0)+1;});
      battle.on('death',({unit,reason})=>{if(reason==='killed'&&unit?.ownerId===ps.playerId)deaths[unit.uid]=(deaths[unit.uid]||0)+1;});
      const add=battle.addLayers.bind(battle);battle.addLayers=(pid,bond,n,reason,opts)=>{
        const got=add(pid,bond,n,reason,opts);
        if(got&&pid===ps.playerId&&bond===CORE&&opts?.source?.defId&&ps.gd.baseIdOf(opts.source.defId)===ids.gavial4)
          gains[opts.source.uid]=(gains[opts.source.uid]||0)+got;
        return got;
      };
      return pp=>({casts,unitDeaths:deaths,gavialLayers:Object.values(gains).reduce((a,b)=>a+b,0),coreLayers:pp.layerGains?.[CORE]||0});
    }}));
  if(job)job.run(Infinity);
  // Deduplication may collapse identical inventories/layouts. Map by the retained plan's declared arm.
  const outcomes=job?.outcomes.map(r=>({...r,index:job.plans[r.index].arm}))||[];
  for(let i=0;i<plans.length;i++)if(!outcomes.some(r=>r.index===i)){
    const prior=plans.findIndex((p,j)=>j<i&&JSON.stringify([...p])===JSON.stringify([...plans[i]])
      &&JSON.stringify([...p.dirs])===JSON.stringify([...plans[i].dirs])&&JSON.stringify(p.assignments)===JSON.stringify(plans[i].assignments));
    if(prior>=0)outcomes.push(...pairs(outcomes,prior).map(r=>({...r,index:i,reused:true})));
  }
  return {plans:plans.map(p=>({arm:p.arm,roster:p.lineup.map(p=>({uid:p.uid,id:p.id})),tiles:[...p],dirs:[...p.dirs]})),
    outcomes,simulations:job?.outcomes.length||0};
}
const heal=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);
const front=r=>r.position==='MELEE'&&(r.stats?.blockCnt||0)>=2;
export function visibleUpgradePriority(parent,m,ps){
  const owned=ps.allChess().map(p=>ps.gd.chess(p.id));
  return ps.shop.slots.flatMap((s,index)=>{
    if(!s||s.sold||s.kind!=='chess'||ps.priceOf(s)>ps.funds)return [];
    const r=ps.gd.chess(s.id);if(!parent.purchaseAllowed(m,ps,r))return [];
    return parent.importantBuy(m,ps,r)||ps.completesChessMerge(s.id)
      ||heal(r)&&!owned.some(heal)||front(r)&&!owned.some(front)?[{index,id:s.id,price:ps.priceOf(s)}]:[];
  });
}
export function acceptEarlyForecast(rows,lp,cap,risk=false){
  const current=pairs(rows,0),reference=pairs(rows,1);
  if(!valid(current)||!valid(reference))return false;
  return current.every((r,i)=>lp-r.lost>=8&&(risk?r.lost<=cap:r.lost<=reference[i].lost&&r.leaks<=reference[i].leaks
    &&r.deaths<=reference[i].deaths));
}
function visibleReference(parent,m,ps){
  const s=economyShadow(ps);
  const offers=s.shop.slots.flatMap((p,index)=>p&&!p.sold&&p.kind==='chess'&&s.priceOf(p)<=s.funds
    &&parent.purchaseAllowed(m,s,s.gd.chess(p.id))&&!s.completesChessMerge(p.id)
    ?[{id:p.id,index,score:buyScoreOf(m,s,p.id)-s.priceOf(p)}]:[]).sort((a,b)=>b.score-a.score||a.index-b.index);
  if(offers[0]&&offers[0].score>0)addPlain(s,offers[0].id,-10000-offers[0].index);
  return s;
}
export function createEarlyReservePolicy(parent,mode){
  if(!['two','four','four-risk'].includes(mode))throw Error('Unknown early reserve mode');
  const from=mode==='two'?1:3,state=ps=>ps._sargonEarly34;
  const ready=(m,ps)=>ps.shop.level===from&&state(ps)?.key===key(m,ps)&&state(ps)?.accepted;
  const lock=(m,ps)=>{
    const s=state(ps);if(!s?.upgraded||s.rolled!==m.round||s.slots!==ps.shop.slots)return false;
    const targets=ps.shop.slots.filter(p=>p&&!p.sold&&p.kind==='chess'&&ps.priceOf(p)>ps.funds
      &&parent.purchaseAllowed(m,ps,ps.gd.chess(p.id))&&parent.importantBuy(m,ps,ps.gd.chess(p.id)));
    if(!targets.length)return false;if(!ps.shop.frozen)ps.freeze();return true;
  };
  return Object.freeze({...parent,name:`28/13 low reserve ${mode}`,
    preparePurchases(m,ps,h={}){
      parent.preparePurchases?.(m,ps,h);lock(m,ps);
      if(!sargonPlanning(m,ps)||!m.wave||m.botRehearsal<2||ps.shop.level!==from||m.round>=m.gd.bossRound
        ||parent.levelTarget(m,ps)<=from||!parent.beforeUpgrade(m,ps)||ps.lp<8
        ||ps.funds<ps.shop.upgradePrice+1||ps.funds>=ps.shop.upgradePrice+parent.upgradeReserve(m,ps))return;
      const k=key(m,ps);if(state(ps)?.key===k)return;
      const visible=visibleUpgradePriority(parent,m,ps);
      if(visible.length){ps._sargonEarly34={key:k,accepted:false};
        note(ps,mode,{phase:'probe',round:m.round,accepted:false,reason:'visible-priority',visible});return;}
      // Strict/risk four must share candidates; only the acceptance of a one-round combat loss differs.
      const probe=forecast(m,ps,[economyShadow(ps),visibleReference(parent,m,ps)],from===3?'four':mode);
      const accepted=acceptEarlyForecast(probe.outcomes,ps.lp,m.gd.lpCapPerRound,mode==='four-risk');
      ps._sargonEarly34={key:k,accepted,round:m.round};
      note(ps,mode,{phase:'probe',round:m.round,accepted,lp:ps.lp,funds:ps.funds,price:ps.shop.upgradePrice,...probe});
    },
    upgradeReserve:(m,ps)=>ready(m,ps)?1:parent.upgradeReserve(m,ps),
    spendReserve:(m,ps)=>ready(m,ps)&&parent.priorityLevel(m,ps)?Math.max(0,ps.shop.upgradePrice):parent.spendReserve(m,ps),
    onLevelUp(m,ps,h={}){
      const released=ps.shop.level===from+1&&state(ps)?.accepted&&state(ps)?.round===m.round;
      const before=ps.counters['band:pepe:special']||0;parent.onLevelUp(m,ps,h);
      if(!released)return;
      const s=state(ps);s.upgraded=true;s.rolled=m.round;s.slots=ps.shop.slots;
      lock(m,ps);note(ps,mode,{phase:'upgrade',round:m.round,level:ps.shop.level,funds:ps.funds,
        specialBefore:before,specialAfter:ps.counters['band:pepe:special']||0,frozen:ps.shop.frozen});
    },
    beforeShopRefresh:(m,ps,h)=>lock(m,ps)?false:parent.beforeShopRefresh?.(m,ps,h)
  });
}

export function gavialGrowthEstimate(rows,remaining,probability,third=false){
  const ref=pairs(rows,0),now=pairs(rows,1),elite=pairs(rows,2);
  if(!valid(ref)||!valid(now)||!valid(elite))return {eligible:false,expected:0};
  const safe=now.every((r,i)=>r.lost<=ref[i].lost&&r.leaks<=ref[i].leaks&&r.deaths<=ref[i].deaths);
  const immediate=Math.max(0,Math.min(...now.map((r,i)=>r.gavialLayers-ref[i].gavialLayers)));
  const future=Math.max(0,Math.min(...elite.map((r,i)=>r.gavialLayers-now[i].gavialLayers)));
  const expected=immediate*remaining+(third?0:probability*future*Math.max(0,remaining-1)/2);
  const deployed=now.some(r=>Object.values(r.casts||{}).some(n=>n>0));
  return {eligible:safe&&deployed&&remaining>0&&expected>=(third?4:8),expected,immediate,future,probability};
}
export function createGavialPairPolicy(parent){
  const estimate=(m,ps,r)=>{
    if(!sargonPlanning(m,ps)||!m.wave||m.round>=m.gd.bossRound||base(ps,r)!==ids.gavial4||ps.gd.isGolden(r.chessId??r.id))return null;
    const own=ps.allChess().filter(p=>base(ps,p)===ids.gavial4);
    if(![1,2].includes(own.length)||own.some(p=>ps.gd.isGolden(p.id))||!parent.purchaseAllowed(m,ps,r))return null;
    const k=key(m,ps);ps._sargonGavial34||={};const cache=ps._sargonGavial34;
    if(cache.key===k)return cache.estimate;cache.key=k;
    const before=economyShadow(ps),after=economyShadow(ps);addPlain(after,r.chessId??r.id,-10001);
    const third=ps.completesChessMerge(r.chessId??r.id),actual=third?eliteShadow(after,ids.gavial4):after;
    const probe=forecast(m,ps,[before,actual,eliteShadow(after,ids.gavial4)],'gavial');
    const left=Math.max(0,(m.pool.entries.get(ids.gavial4)?.left||0)-1),total=[...m.pool.entries.values()]
      .filter(e=>e.tier<=ps.shop.level).reduce((n,e)=>n+Math.max(0,e.left),0);
    const remaining=m.gd.bossRound-m.round;
    const probability=1-(1-left/Math.max(1,total))**(ps.gd.shopSlots(ps.shop.level).chess*Math.min(6,remaining));
    const value=gavialGrowthEstimate(probe.outcomes,remaining,probability,third);
    // Need the actual purchased/merged Gavial to be deployed and cast; a different operator's casts do not qualify.
    const ownUids=new Set(probe.plans[1].roster.filter(p=>base(ps,p)===ids.gavial4).map(p=>p.uid));
    value.eligible&&=ownUids.size>0&&pairs(probe.outcomes,1).every(row=>[...ownUids].some(uid=>(row.casts[uid]||0)>0));
    cache.estimate={...value,third,remaining};
    note(ps,'gavial',{phase:'estimate',round:m.round,...cache.estimate,...probe});return cache.estimate;
  };
  const budget=(m,ps)=>{
    const level=parent.levelTarget(m,ps)>ps.shop.level&&ps.funds>=Math.max(0,ps.shop.upgradePrice)+parent.upgradeReserve(m,ps)
      ?Math.max(0,ps.shop.upgradePrice)+parent.upgradeReserve(m,ps):0;
    const mains=ps.shop.slots.filter(s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)!==ids.gavial4
      &&([ids.pepe,ids.passenger,ids.titi].includes(base(ps,s))||ps.gd.chess(s.id).bonds.includes(CORE)&&ps.gd.chess(s.id).tier>=4
        &&!ps.allChess().some(p=>base(ps,p)===base(ps,s)))&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id)))
      .reduce((n,s)=>n+ps.priceOf(s),0);
    return Math.max(level,mains);
  };
  return Object.freeze({...parent,name:'28/13 IV Gavial pair measured development return',
    preparePurchases(m,ps,h={}){
      parent.preparePurchases?.(m,ps,h);
      const slot=ps.shop.slots.findIndex(s=>s&&!s.sold&&s.kind==='chess'&&base(ps,s)===ids.gavial4);
      if(slot<0)return;const p=ps.shop.slots[slot],price=ps.priceOf(p),reserve=budget(m,ps);
      if(ps.funds-price<reserve||!ps.hand.some(p=>!p))return;
      const v=estimate(m,ps,ps.gd.chess(p.id));if(!v?.eligible)return;
      const funds=ps.funds,before=new Set(ps.allChess().map(p=>p.uid));
      if(!ps.buy(slot)?.ok)return;parent.afterPurchase?.(m,ps,p,before);
      note(ps,'gavial',{phase:'buy',round:m.round,id:p.id,third:v.third,expected:v.expected,reserve,fundsBefore:funds,fundsAfter:ps.funds});
    }
  });
}
