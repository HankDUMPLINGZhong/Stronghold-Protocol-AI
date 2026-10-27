import { createBossRehearsalSteps } from '../botBossRehearsal.js';
import { healingTiles } from '../botPositioning.js';
import { createRng, deriveSeed } from '../../../../../../sim/rng.js';

// [ASSUMED] Optional Empire R14 geometry refinement over the unchanged economy and roster.
// Independent forecast only; no actual battle result is consulted. Killed Skillful sources keep their aura.
const priority={chess_char_6_13_a:9,chess_char_6_01_a:9,chess_char_5_01_a:5,chess_char_3_21_a:5,
 chess_char_4_02_a:1.5,chess_char_4_01_a:0.5,chess_char_6_09_a:1,chess_char_2_01_a:3};
export function* lateranoLionSpreadSteps(m,ps,helpers,{collect=false}={}){
 if ((!m.isSolo && !(collect && m.mode==='coop')) || m.round !== m.gd.bossRound || m.bossId !== 'boss_6' || m.botRehearsal < 2) return;
 const { LayoutPlan, rangeRec, rangeTiles, fieldModel, bossInputSteps, applyPlanSteps } = helpers;
 const start=performance.now(),chosen=[...ps.board.values()].filter(p=>p.kind==='chess');
 const model=fieldModel(m,ps),body=model.bossBodies.flatMap(x=>x.tiles),center=model.bossBodies[0].center;
 if(chosen.length<2||!body.length)return;
 const rng=createRng(deriveSeed(m.seed,'lion-diagonal-geometry-v1'));
 const records=chosen.map(p=>rangeRec(ps,ps.gd.chess(p.id)));
 const info=chosen.map((p,i)=>{
  const rec=records[i],base=m.gd.baseIdOf(p.id),heal=rec.attackKind==='heal';
  return {base,heal,weight:heal?7:(priority[base]??Math.max(1,rec.tier/2))*(rec.isGolden?1.3:1),
    skill:(rec.bonds||[]).includes('skillfulShip'),noHeal:rec.subProfessionId==='reaper'};
 });
 const skillActive=!!ps.bonds.skillfulShip?.active,skillRadius=(ps.bonds.skillfulShip?.layers||0)>=40?8:4;
 const reserved=collect?new Set([...ps.board].filter(([,p])=>p.kind!=='chess').map(([key])=>key)):new Set();
 const owners=collect?new Set([...ps.board.values()].filter(p=>p.kind==='token').map(p=>p.ownerUid)):new Set();
 const adjacent=(p,q)=>skillRadius===8?Math.max(Math.abs(p.r-q.r),Math.abs(p.c-q.c))<=1:Math.abs(p.r-q.r)+Math.abs(p.c-q.c)<=1;
 const options=chosen.map((p,i)=>{
  const list=[];
  for(let r=9;r<=12;r++)for(let c=2;c<=10;c++)if(ps._legal(p,r,c))for(const dir of ['RIGHT','UP','LEFT','DOWN']){
   const key=r+','+c;
   if(reserved.has(key)||owners.has(p.uid)&&(ps.find(p.uid).key!==key||p.dir!==dir))continue;
   if(!info[i].heal&&!rangeTiles(records[i],r,c,dir).some(k=>body.includes(k)))continue;
   list.push({key,r,c,dir,near:(r-center[0])**2+(c-center[1])**2<=3.4**2,
    heal:info[i].heal?healingTiles(records[i],r,c,dir):null});
  }
  return list;
 });
 if(options.some(list=>!list.length))return;
 function score(layout){
  let value=0;
  const healed=layout.map((p,i)=>!info[i].noHeal&&layout.some((q,j)=>info[j].heal&&q.heal.has(p.key)));
  for(let i=0;i<layout.length;i++){
   const p=layout[i],a=info[i],w=a.weight;
   const risk=p.near||layout.some(q=>q.near&&Math.abs(q.r-p.r)+Math.abs(q.c-p.c)<=1);
   if(skillActive&&layout.some((q,j)=>info[j].skill&&adjacent(p,q)))value+=w*12;
   if(healed[i])value+=w*(a.base==='chess_char_6_13_a'?22:10);
   if(!p.near)value+=w*10;
   if(risk&&!healed[i]&&!a.noHeal)value-=w*18;
   if(a.heal&&risk)value-=w*18;
   if(p.near){
    let sum=0,squares=0;
    for(let j=0;j<layout.length;j++)if(Math.abs(p.r-layout[j].r)+Math.abs(p.c-layout[j].c)<=1){sum+=info[j].weight;squares+=info[j].weight**2;}
    value-=sum*1.2+(sum*sum-squares)*0.45;
   }
  }
  return value;
 }
 const sig=l=>l.map(p=>p.key+':'+p.dir).join('|'),bests=new Map();
 function keep(l,s){const id=sig(l);if(!bests.has(id))bests.set(id,{layout:l.slice(),score:s});
  if(bests.size>80){const min=[...bests].sort((a,b)=>a[1].score-b[1].score)[0][0];bests.delete(min);}}
 restarts: for(let restart=0;restart<14;restart++){
  const used=new Set(),layout=[];
  for(const list of options){
   const free=list.filter(p=>!used.has(p.key));
   if(!free.length)continue restarts;
   const p=free[Math.floor(rng()*free.length)];used.add(p.key);layout.push(p);
  }
  let value=score(layout);
  for(let step=0;step<5000;step++){
   const i=Math.floor(rng()*layout.length),p=options[i][Math.floor(rng()*options[i].length)],old=layout[i];
   if(layout.some((q,j)=>j!==i&&q.key===p.key))continue;
   layout[i]=p;const next=score(layout),temp=step<1500?5:step<3500?1:0.15;
   if(next>=value||rng()<Math.exp((next-value)/temp))value=next;else layout[i]=old;
   if(step>3500)keep(layout,value);
   if(step%200===0)yield;
  }
 }
 const sorted=[...bests.values()].sort((a,b)=>b.score-a.score),selected=[];
 for(const p of sorted){if(selected.some(q=>p.layout.filter((u,i)=>u.key!==q.layout[i].key).length<3))continue;selected.push(p);if(selected.length===2)break;}
 if(selected.length<2)for(const p of sorted){if(selected.some(q=>sig(q.layout)===sig(p.layout)))continue;selected.push(p);if(selected.length===2)break;}
 if(selected.length<2)return;
 const original=new LayoutPlan();for(const [key,p]of ps.board)if(p.kind==='chess'){original.set(p.uid,key);original.dirs.set(p.uid,p.dir);}
 const plans=[original,...selected.map(p=>{const plan=new LayoutPlan();p.layout.forEach((loc,i)=>{plan.set(chosen[i].uid,loc.key);plan.dirs.set(chosen[i].uid,loc.dir);});return plan;})];
 // Co-op owns its team forecast and application; geometry collection never constructs a solo battle.
 if(collect){for(const plan of plans)plan.lineup=chosen;return plans;}
 const job=yield* createBossRehearsalSteps(m,ps,chosen,plans,p=>bossInputSteps(m,ps,chosen,p));
 if(!job)return;while(!job.run(4))yield;
 const before=[...ps.board].filter(([,p])=>p.kind==='chess').map(([key,p])=>({uid:p.uid,id:p.id,key,dir:p.dir}));
 yield* applyPlanSteps(m,ps,chosen,job.best);
 const after=[...ps.board].filter(([,p])=>p.kind==='chess').map(([key,p])=>({uid:p.uid,id:p.id,key,dir:p.dir}));
 if(before.map(x=>x.uid).sort().join()!==after.map(x=>x.uid).sort().join())throw Error('Roster changed');
 ps._botLateranoLionSpread = {before,after,geometryCandidates:selected.map(p=>({score:p.score,positions:p.layout.map((loc,i)=>({id:chosen[i].id,uid:chosen[i].uid,key:loc.key,dir:loc.dir}))})),
  forecastSeed:'boss-rehearse:14:0',outcomes:job.outcomes,selectedIndex:job.bestIndex??0,ms:performance.now()-start};
}

export function withLateranoLionSpread(recipe) {
 return Object.freeze({ ...recipe, finalBoardSteps: lateranoLionSpreadSteps });
}
