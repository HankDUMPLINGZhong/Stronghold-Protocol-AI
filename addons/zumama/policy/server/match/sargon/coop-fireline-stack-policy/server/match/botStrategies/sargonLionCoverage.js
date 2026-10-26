import {sargonPlanning} from '../botCoopForecast.js';
// [ASSUMED] Transfer Laterano's whole-roster Empire geometry to selected solo Sargon 28/10.
// All-cover matching is retained; the balanced child also compares a safe medical layout covering the core dealers.
// Independent planning RNG and paired forecasts only: no actual battle seed, result, future shop or fixed case coordinates.
import {createRng,deriveSeed} from '../../../../../../../../../../../sim/rng.js';
import {DIRS} from '../../../../../../../../../../../sim/dir.js';
import {healingTiles,acceptsHealing} from '../botPositioning.js';
import {createForecastSteps} from '../botForecast.js';
import {selectPapyrusForecast} from './sargonRound13.js';
import {swiftPrepGains} from './sargonSwift.js';
import {ids} from './sargonPepe.js';

const position=key=>key.split(',').map(Number);
const priority=new Map([[ids.pepe,5],[ids.passenger,5],[ids.titi,5],[ids.gavial4,3],[ids.gavial5,3],[ids.minimalist,3]]);
const signature=layout=>layout.map(p=>`${p.key}:${p.dir}`).join('|');
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'lion-coverage-round31',...e});
const manhattan=(a,b)=>Math.abs(a.r-b.r)+Math.abs(a.c-b.c);
const shuffle=(rows,rng)=>{const out=rows.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;};

/** Weighted simultaneous hits use the real five-cell cross around a selectable occupied target, not an entire row. */
export function lionLayoutMetrics(layout,info,medic){
  const heal=layout[medic].heal,covered=info.filter((u,i)=>i!==medic&&u.healable&&heal.has(layout[i].key)).length;
  const healable=info.filter((u,i)=>i!==medic&&u.healable).length;
  let exposure=0,maxSplash=0,pairedSplash=0;
  const papyrusRisk=layout[medic].near||layout.some(p=>p.near&&manhattan(p,layout[medic])<=1);
  for(let i=0;i<layout.length;i++){
    const p=layout[i],u=info[i];
    if(p.near)exposure+=u.weight*(i===medic?4:1);
    if(!p.near)continue;
    const hit=layout.map((q,j)=>manhattan(p,q)<=1?info[j].weight:0);
    const sum=hit.reduce((n,w)=>n+w,0),squares=hit.reduce((n,w)=>n+w*w,0);
    maxSplash=Math.max(maxSplash,sum);pairedSplash+=(sum*sum-squares)/2;
  }
  return {covered,healable,fullCoverage:covered===healable,papyrusRisk,exposure,maxSplash,pairedSplash};
}

/** Complete tile matching avoids greedy dead ends; choosing facing never relaxes legal terrain or boss contact. */
function initialLayout(lists,medic,anchor,rng){
  const keys=lists.map(list=>shuffle([...new Set(list.map(p=>p.key))],rng));
  const owner=new Map([[anchor.key,medic]]),assigned=new Map([[medic,anchor.key]]);
  function visit(i,seen){
    for(const key of keys[i]){
      if(key===anchor.key||seen.has(key))continue;seen.add(key);
      const old=owner.get(key);
      if(old===undefined||visit(old,seen)){owner.set(key,i);assigned.set(i,key);return true;}
    }
    return false;
  }
  const order=lists.map((_,i)=>i).filter(i=>i!==medic).sort((a,b)=>keys[a].length-keys[b].length||a-b);
  if(order.some(i=>!visit(i,new Set())))return null;
  return lists.map((list,i)=>{if(i===medic)return anchor;
    const choices=list.filter(p=>p.key===assigned.get(i));return choices[Math.floor(rng()*choices.length)];});
}

export function* lionCoveragePlans(m,ps,h,original,{balanced=false}={}){
  const lineup=original.lineup,gd=ps.gd,model=h.fieldModel(m,ps),body=model.bossBodies?.flatMap(b=>b.tiles)||[];
  const centers=model.bossBodies?.map(b=>b.center)||[];
  const medic=lineup.findIndex(p=>gd.baseIdOf(p.id)===ids.papyrus);
  if(medic<0||!body.length||!centers.length)return {plans:[],proposals:[],reason:'no-papyrus-or-public-boss-body'};
  const wave=m.bossGroupOf?.(ps)?.wave,boss=wave?.spawns.find(s=>s.tag==='boss');
  const radius=gd.enemy(boss?.enemyKey)?.stats?.rangeRadius||3.4,radius2=radius*radius;
  const reserved=new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([key])=>key));
  const fixedOwners=new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid));
  const records=lineup.map(p=>h.rangeRec(ps,gd.chess(p.id)));
  const info=lineup.map((p,i)=>({uid:p.uid,id:p.id,healable:acceptsHealing(records[i]),
    weight:(i===medic?7:priority.get(gd.baseIdOf(p.id))||Math.max(1,records[i].tier/2))*(gd.isGolden(p.id)?1.3:1)}));
  const options=lineup.map((p,i)=>{
    const rec=records[i],dealer=rec.attackKind!=='heal'&&rec.dmgType!=='heal'
      &&(rec.attackKind!=='none'||balanced&&rec.subProfessionId==='phalanx')&&(rec.stats?.atk||0)>0,list=[];
    for(const [key]of ps.deployMap()){
      const [r,c]=position(key);if(reserved.has(key)||!ps._legal(p,r,c))continue;
      for(const dir of DIRS){
        if(fixedOwners.has(p.uid)&&(original.get(p.uid)!==key||original.dirs.get(p.uid)!==dir))continue;
        if(dealer&&!h.rangeTiles(rec,r,c,dir).some(k=>body.includes(k)))continue;
        list.push({key,r,c,dir,near:centers.some(([a,b])=>(r-a)*(r-a)+(c-b)*(c-b)<=radius2),
          heal:i===medic?healingTiles(rec,r,c,dir):null});
      }
    }
    return list;
  });
  if(options.some(list=>!list.length))return {plans:[],proposals:[],reason:'no-legal-boss-contact-assignment'};
  const rng=createRng(deriveSeed(m.seed,'sargon-lion-papyrus-whole-board-v1'));
  const anchors=[];
  for(const anchor of options[medic]){
    const lists=options.map((list,i)=>i===medic?[anchor]:list.filter(p=>p.key!==anchor.key&&(!info[i].healable||anchor.heal.has(p.key))));
    if(lists.some(list=>!list.length))continue;
    const layout=initialLayout(lists,medic,anchor,rng);if(!layout)continue;
    const bound=lists.reduce((n,list,i)=>n+info[i].weight*(list.some(p=>!p.near)?0:1),anchor.near?50:0);
    anchors.push({anchor,lists,layout,bound,full:true});
  }
  // Full mode falls back only when impossible. Balanced mode preserves both the all-cover and medical-safety families.
  if(!anchors.length||balanced)for(const anchor of options[medic]){
    const lists=options.map((list,i)=>i===medic?[anchor]:list.filter(p=>p.key!==anchor.key
      &&(!balanced||!priority.has(gd.baseIdOf(lineup[i].id))||!info[i].healable||anchor.heal.has(p.key))));
    if(lists.some(list=>!list.length))continue;
    const layout=initialLayout(lists,medic,anchor,rng);if(!layout)continue;
    const possible=lists.reduce((n,list,i)=>n+(info[i].healable&&list.some(p=>anchor.heal.has(p.key))?info[i].weight:0),0);
    anchors.push({anchor,lists,layout,bound:(anchor.near?50:0)-possible*20,full:false});
  }
  if(!anchors.length)return {plans:[],proposals:[],reason:'no-complete-legal-layout'};
  anchors.sort((a,b)=>a.bound-b.bound||a.anchor.key.localeCompare(b.anchor.key)||a.anchor.dir.localeCompare(b.anchor.dir));
  const selectedAnchors=[],perCell=new Map();
  for(const family of balanced?[true,false]:[null])for(const a of anchors){
    if(family!==null&&a.full!==family)continue;
    const key=`${family}:${a.anchor.key}`;if((perCell.get(key)||0)>=2)continue;
    selectedAnchors.push(a);perCell.set(key,(perCell.get(key)||0)+1);
    if(selectedAnchors.filter(a=>family===null||a.full===family).length>=(balanced?4:8))break;
  }
  const score=(layout,full=true)=>{
    const metrics=lionLayoutMetrics(layout,info,medic);
    const uncovered=layout.reduce((n,p,i)=>n+(i!==medic&&info[i].healable&&!layout[medic].heal.has(p.key)?info[i].weight:0),0);
    return -uncovered*(balanced&&!full?30:100)-metrics.exposure*8-metrics.maxSplash*3-metrics.pairedSplash*.65-(metrics.papyrusRisk?80:0);
  };
  const bests=new Map();
  const keep=(layout,value,full)=>{
    const key=(balanced?`${full}:`:'')+signature(layout);if(bests.has(key))return;
    bests.set(key,{layout:layout.slice(),score:value,full});
    const family=balanced?[...bests].filter(([,row])=>row.full===full):[...bests];
    if(family.length>(balanced?24:48)){const worst=family.sort((a,b)=>a[1].score-b[1].score||a[0].localeCompare(b[0]))[0][0];bests.delete(worst);}
  };
  for(const a of selectedAnchors){
    const byKey=a.lists.map(list=>{const map=new Map();for(const p of list){const rows=map.get(p.key)||[];rows.push(p);map.set(p.key,rows);}return map;});
    for(let restart=0;restart<4;restart++){
      const layout=restart===0?a.layout.slice():initialLayout(a.lists,medic,a.anchor,rng);if(!layout)continue;
      let value=score(layout,a.full);keep(layout,value,a.full);
      for(let step=0;step<1500;step++){
        let i=Math.floor(rng()*layout.length);if(i===medic)i=(i+1)%layout.length;
        const p=a.lists[i][Math.floor(rng()*a.lists[i].length)],old=layout[i],j=layout.findIndex((q,k)=>k!==i&&q.key===p.key);
        if(j===medic)continue;
        const other=j>=0?layout[j]:null;
        const swapped=other&&byKey[j].get(old.key);if(other&&!swapped?.length)continue;
        layout[i]=p;
        if(other)layout[j]=swapped.find(q=>q.dir===other.dir)||swapped[Math.floor(rng()*swapped.length)];
        const next=score(layout,a.full),temperature=step<500?5:step<1100?1:.15;
        if(next>=value||rng()<Math.exp((next-value)/temperature))value=next;
        else{layout[i]=old;if(other)layout[j]=other;}
        if(step>1000)keep(layout,value,a.full);
        if(step%150===0)yield;
      }
    }
  }
  const sorted=[...bests.values()].sort((a,b)=>b.score-a.score||signature(a.layout).localeCompare(signature(b.layout))),selected=[];
  if(balanced){
    const full=sorted.find(r=>r.full);if(full)selected.push(full);
    const soft=sorted.find(r=>!r.full&&selected.every(other=>r.layout.filter((p,i)=>p.key!==other.layout[i].key).length>=3))
      ||sorted.find(r=>!r.full&&selected.every(other=>signature(r.layout)!==signature(other.layout)));
    if(soft)selected.push(soft);
  }
  for(const row of sorted){
    if(selected.length===2)break;
    if(selected.some(other=>row.layout.filter((p,i)=>p.key!==other.layout[i].key).length<3))continue;
    selected.push(row);if(selected.length===2)break;
  }
  if(selected.length<2)for(const row of sorted){if(selected.includes(row))continue;selected.push(row);if(selected.length===2)break;}
  const plans=selected.map(row=>{const plan=new h.LayoutPlan();plan.lineup=lineup;
    row.layout.forEach((p,i)=>{plan.set(lineup[i].uid,p.key);plan.dirs.set(lineup[i].uid,p.dir);});return plan;});
  return {plans,proposals:selected.map(row=>({score:row.score,allCoverFeasible:row.full,...lionLayoutMetrics(row.layout,info,medic)})),
    medicUid:lineup[medic].uid,radius,completeAllCoverAnchors:anchors.filter(a=>a.full).length};
}

export function createLionCoveragePolicy(parent,{balanced=false}={}){
  return Object.freeze({...parent,name:'28/10: Papyrus whole-team healing and Empire cross spread',
    *finalBoardSteps(m,ps,h){
      yield* parent.finalBoardSteps(m,ps,h);
      if(m.difficulty!=='ABYSS'||!sargonPlanning(m,ps)||m.wave||m.round!==m.gd.bossRound||m.bossId!=='boss_6'||m.botRehearsal<2)return;
      const original=new h.LayoutPlan();original.lineup=[];
      for(const [key,p]of ps.board)if(p.kind==='chess'){original.lineup.push(p);original.set(p.uid,key);original.dirs.set(p.uid,p.dir||'RIGHT');}
      const result=yield* lionCoveragePlans(m,ps,h,original,{balanced}),{plans}=result;
      if(!plans.length){note(ps,{round:m.round,phase:'gate',...result,simulations:0});return;}
      function* input(plan){const snapshot=yield* h.bossInputSteps(m,ps,original.lineup,plan,{keepWithdrawn:true});
        const gains=swiftPrepGains(ps,original.lineup,plan,snapshot.bonds);plan.prepGains=gains;
        for(const [id,n]of Object.entries(gains))if(snapshot.bonds[id])snapshot.bonds[id].layers+=n;return snapshot;}
      const candidates=[original,...plans],job=yield* createForecastSteps(m,ps,original.lineup,candidates,input,{
        forecastContext:()=>({boss:true}),selectForecast:selectPapyrusForecast,includeBossMetrics:true,
        observeForecast:battle=>{const firstDeaths={};battle.on('death',({unit})=>{
          if(unit?.kind==='op'&&unit.ownerId===ps.playerId)firstDeaths[unit.uid]??=battle.time;});
          return pp=>({unitStats:pp.unitStats,firstDeaths});}});
      if(!job)return;while(!job.run(4))yield;
      if(job.bestIndex){yield* h.applyPlanSteps(m,ps,original.lineup,job.best);
        if([...job.best].some(([uid,key])=>ps.find(uid)?.key!==key||ps.find(uid)?.piece.dir!==job.best.dirs.get(uid)))throw Error('Lion full-roster plan rejected');}
      note(ps,{round:m.round,phase:'comparison',balanced,index:job.bestIndex,simulations:job.outcomes.length,
        medicUid:result.medicUid,radius:result.radius,completeAllCoverAnchors:result.completeAllCoverAnchors,proposals:result.proposals,
        candidates:candidates.map(p=>({roster:p.lineup.map(u=>({uid:u.uid,id:u.id})),tiles:[...p],dirs:[...p.dirs],prepGains:p.prepGains})),outcomes:job.outcomes});
    }});
}
