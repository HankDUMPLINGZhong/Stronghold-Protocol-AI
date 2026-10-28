// [ASSUMED] Independent two-seat bounded proactive bridge over retained11/56.
// R1-3 may leak for development; reinforce R4-6 before the R7-8 pressure window.
import { pieceBonds, computeBonds } from '../../../../../../../../../bondsMeta.js';
import { steadDevelopmentBudget } from './siracusaSteadDevelopment.js';
import { enemyTypeInfo } from './lateranoEnemyTypes.js';
const CORE='siracusaShip',STEAD='steadShip',WIND='chess_char_2_11_a',VIGIL='chess_char_3_19_a';
const base=(ps,p)=>ps.gd.baseIdOf(p.id),has=(ps,p,id)=>pieceBonds(ps.gd,p).includes(id);
const kinds=(ps,xs,id)=>new Set(xs.filter(p=>has(ps,p,id)).map(p=>base(ps,p))).size;
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const heal=r=>r.attackKind==='heal'||['guardian','incantationmedic'].includes(r.subProfessionId);

/** Project only the deterministic two-to-one Wind merge. Never draw its random merge reward. */
export function projectEarlyBridgeMerge(view,bundle) {
 if(!bundle.eliteWind)return true;
 const virtual=bundle.virtual[0],old=view.allChess().find(p=>p.uid!==virtual.uid&&base(view,p)==='chess_char_2_11_a');
 if(!old||old.items?.length)return false;
 virtual.id='chess_char_2_11_b';
 for(const [key,p]of view.board)if(p.uid===old.uid)view.board.delete(key);
 view.hand=view.hand.map(p=>p?.uid===old.uid?null:p);view.temp=view.temp.map(p=>p?.uid===old.uid?null:p);
 view.bonds=computeBonds(view.gd,view);return true;
}

export function earlyBridgeBudget(parent,m,ps) {
 const owned=ps.allChess(),development=steadDevelopmentBudget(m,ps),groups=new Map();
 for(const p of owned)if(has(ps,p,CORE)){const id=base(ps,p),v=groups.get(id)||{n:0,elite:false};v.n+=Number(!ps.gd.isGolden(p.id));v.elite ||= ps.gd.isGolden(p.id);groups.set(id,v);}
 const elites=[...groups.values()].filter(v=>v.elite).length;
 const pairs=[...groups].filter(([,v])=>!v.elite&&v.n>=2).map(([id])=>ps.gd.chessPrice(id)).sort((a,b)=>a-b);
 const milestoneReserve=pairs.slice(0,Math.max(1,2-elites)).reduce((a,b)=>a+b,0)+ps.gd.refreshPrice;
 const fee=Math.max(0,ps.shop.upgradePrice),extra=parent.upgradeReserve(m,ps)||0,target=parent.levelTarget(m,ps);
 const ready=owned.length>=(m.round<=4?ps.deployCap:Math.min(ps.deployCap,6))||parent.readyForUpgrade?.(m,ps)===true;
 const executable=ps.shop.level<target&&ps.funds>=fee+extra&&(ready||m.round>=6)&&parent.beforeUpgrade(m,ps,{route:ps._botRoute});
 return{...development,elites,milestoneReserve,reserve:Math.max(development.reserve,milestoneReserve,
  parent.spendReserve(m,ps)||0,parent.purchaseReserve?.(m,ps)||0,executable?fee+extra:0)};
}

export function earlyBridgeBundles(parent,m,ps) {
 if(m.mode!=='coop'||m.isSolo||m.order.length!==2||m.difficulty!=='ABYSS'||!m.wave||ps.bandId!=='band_chiave'||ps._botFocusId!==CORE)return[];
 const owned=ps.allChess(),paid=ps._botSteadDemandPaid||[],spent=ps._botEarlyBridgeGold||0;
 const wind=owned.filter(p=>base(ps,p)===WIND),second=paid.includes(WIND)&&wind.length===1&&!wind.some(p=>ps.gd.isGolden(p.id))&&spent+3<=6;
 if(m.round<4||m.round>(second?7:6)||ps.shop.level>=4||kinds(ps,owned,CORE)<1||kinds(ps,owned,CORE)>=6||paid.length&&!second)return[];
 const budget=earlyBridgeBudget(parent,m,ps);if(budget.defer||budget.giftDistance===1)return[];
 const slots=ps.shop.slots.map((s,index)=>({s,index})).filter(x=>x.s?.kind==='chess'&&!x.s.sold);
 if(slots.some(({s})=>ps.priceOf(s)<=ps.funds&&parent.purchaseAllowed(m,ps,ps.gd.chess(s.id))
  &&(ps.gd.chess(s.id).bonds.includes(CORE)||parent.importantBuy?.(m,ps,ps.gd.chess(s.id))||parent.criticalBuy?.(m,ps,ps.gd.chess(s.id),{route:ps._botRoute}))))return[];
 const members=kinds(ps,owned,STEAD),hasVigil=owned.some(p=>base(ps,p)===VIGIL),missingHeal=!field(ps).some(p=>heal(ps.gd.chess(p.id)));
 const solidFront=field(ps).some(p=>{const r=ps.gd.chess(p.id);return r.position==='MELEE'&&r.stats.blockCnt>=2&&(r.tier>=3||r.isGolden);});
 const threat=enemyTypeInfo(m,ps.gd);
 const out=[];
 for(const e of slots){const id=base(ps,e.s),r=ps.gd.chess(e.s.id),price=ps.priceOf(e.s);
  if(r.isGolden||price>3||ps.funds-price<budget.reserve||!ps.hand.some(p=>!p))continue;
  const existing=owned.some(p=>base(ps,p)===id);let purpose=null,count=0;
  if(second){if(id===WIND)purpose='wind-two-copy-elite';else continue;}
  else if(existing)continue;
  else if(members===2&&r.bonds.includes(STEAD)&&r.tier<=2){purpose='third-stead';count=3;}
  else if(id===WIND&&(hasVigil||!solidFront))purpose=hasVigil?'wind-combat-miracle':'wind-frontline';
  else if(id==='chess_char_1_10_a'&&missingHeal)purpose='tank-heal';
  else if(id==='chess_char_2_18_a'&&threat.total>0&&threat.air/threat.total<=.5)purpose='ground-area';
  if(!purpose)continue;
  out.push({entries:[e],count,price,reserve:budget.reserve,purpose,budget,eliteWind:second});
 }
 return out.sort((a,b)=>Number(b.purpose==='third-stead')-Number(a.purpose==='third-stead')||a.price-b.price||a.entries[0].index-b.entries[0].index).slice(0,4);
}

/** Preserve different natives and deployed growth, except redundant ordinary Lappland stacks from bench. */
export function earlyBridgeLineup(ps,suggested,count,{required=[]}={}) {
 const owned=ps.allChess(),owners=new Set([...ps.board.values(),...ps.hand,...ps.temp].filter(p=>p?.kind==='token').map(p=>p.ownerUid));
 const quality=p=>ps.gd.chess(p.id).tier+Number(ps.gd.isGolden(p.id))*5;
 const ordered=owned.slice().sort((a,b)=>quality(b)-quality(a)||Number(suggested.includes(b))-Number(suggested.includes(a))||a.uid-b.uid),selected=[];
 const add=p=>{if(p&&!selected.includes(p))selected.push(p);};
 for(const p of suggested)if(owners.has(p.uid)||p.items?.length||has(ps,p,'raidShip')||has(ps,p,CORE)&&base(ps,p)!=='chess_char_2_16_a')add(p);
 const target=Math.min(6,kinds(ps,owned,CORE));for(const p of ordered)if(has(ps,p,CORE)&&kinds(ps,selected,CORE)<target&&!selected.some(q=>base(ps,q)===base(ps,p)))add(p);
 for(const p of required)add(p);
 if(count===3)for(const p of ordered)if(has(ps,p,STEAD)&&kinds(ps,selected,STEAD)<3&&!selected.some(q=>base(ps,q)===base(ps,p)))add(p);
 if(suggested.some(p=>heal(ps.gd.chess(p.id)))&&!selected.some(p=>heal(ps.gd.chess(p.id))))add(ordered.find(p=>heal(ps.gd.chess(p.id))));
 if(selected.length>ps.deployCap)return null;
 for(const p of [...suggested,...ordered])if(selected.length<Math.min(ps.deployCap,owned.length))add(p);
 if(selected.length>ps.deployCap||selected.length<field(ps).length||kinds(ps,selected,CORE)<target||count&&kinds(ps,selected,STEAD)<count)return null;
 if(['swiftShip','arcaneShip','raidShip'].some(id=>ps.bonds[id]?.active&&kinds(ps,selected,id)<ps.gd.bond(id).activeCount))return null;
 return selected;
}
