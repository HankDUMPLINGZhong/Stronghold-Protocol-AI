// [ASSUMED] User-directed two-player experiment. Only own units and the current wave are inspected.
import {computeBonds} from '../../../../../../../../../../../../../../bondsMeta.js';
import {createForecastSteps} from '../botForecast.js';
import {bossInputSteps,buyScoreOf,itemTarget} from '../botDevelopment.js';
const field=ps=>[...ps.board.values()].filter(p=>p.kind==='chess');
const finish=g=>{let r;do{r=g.next();}while(!r.done);return r.value;};
const note=(ps,e)=>(ps._sargonFactorHistory||=[]).push({factor:'pair-field-safety',...e});
const room=ps=>ps.hand.some(p=>!p);
function shadowAfterSale(ps,p){
  const s=Object.assign(Object.create(Object.getPrototypeOf(ps)),ps,{
    board:new Map([...ps.board].filter(([,q])=>q.uid!==p.uid&&q.ownerUid!==p.uid)),
    hand:ps.hand.map(q=>q?.uid===p.uid||q?.ownerUid===p.uid?null:q),
    temp:ps.temp.filter(q=>q?.uid!==p.uid&&q?.ownerUid!==p.uid),funds:ps.funds+ps.gd.sellPrice(p.id)});
  for(const item of p.items||[]){const at=s.hand.indexOf(null);if(at>=0)s.hand[at]=item;else s.temp.push(item);}
  s.bonds=computeBonds(s.gd,s);return s;
}
/** Preflight the whole transaction. Bench funding is allowed; at most one deployed unit can cover the last coin,
 * including on an underfilled board. The caller must first authorize that sale with a zero-leak probe. */
export function pairFundingPlan(parent,m,ps,offer,candidates){
  let s=ps;const sales=[];let reason='no-legal-funding';
  for(let n=0;n<40;n++){
    if(s.funds>=offer.price&&room(s))return {ok:true,sales};
    const all=candidates(parent,m,s,offer.id),legal=all.filter(x=>{
      if(m.round>4&&x.onBoard&&(offer.price-s.funds!==1||sales.some(q=>q.onBoard))){reason='more-than-one-field-coin';return false;}
      const freed=s.hand.filter(q=>!q||q.kind==='token'&&q.ownerUid===x.p.uid).length
        +s.temp.filter(q=>!q||q.kind==='token'&&q.ownerUid===x.p.uid).length+Number(s.find(x.p.uid)?.area!=='board');
      return (x.p.items||[]).length<=freed;
    });
    if(!legal.length)return {ok:false,sales:[],reason,proposed:sales.map(x=>x.p.uid)};
    const sale=legal[0];sales.push(sale);s=shadowAfterSale(s,sale.p);
  }
  return {ok:false,sales:[],reason:'funding-limit'};
}
export function currentPairLeakProbe(parent,m,ps){
  if(!m.wave||m.round>=m.gd.bossRound)return {safe:false,reason:'no-normal-wave',outcomes:[],steps:0};
  const key=JSON.stringify([m.round,ps.layers,ps.bounties,ps.battleInput(),ps.allChess()]);
  if(ps._sargonPairLeakProbe?.key===key)return ps._sargonPairLeakProbe.result;
  const lineup=field(ps),plan=new Map([...ps.board].filter(([,p])=>p.kind==='chess').map(([k,p])=>[p.uid,k]));
  plan.dirs=new Map(lineup.map(p=>[p.uid,p.dir||'RIGHT']));plan.reserved=new Set();plan.lineup=lineup;
  let steps=0;
  const job=finish(createForecastSteps(m,ps,lineup,[plan],function*(p){
    const input=yield* bossInputSteps(m,ps,lineup,p,{keepWithdrawn:true});
    return parent.prepareForecastInput?.(m,ps,lineup,p,input)||input;
  },{singlePlanProbe:true,forecastContext:()=>({}),selectForecast:()=>({index:0}),
    observeForecast(b){const step=b.step.bind(b);b.step=()=>{steps++;return step();};return ()=>({});}}));
  if(job)job.run(Infinity);
  const outcomes=job?.outcomes||[],safe=outcomes.length===2&&outcomes.every((r,i)=>r.valid&&r.sample===i&&r.leaks===0);
  const result={safe,reason:safe?'current-board-no-leaks':'current-board-leaks-or-invalid',outcomes,steps,
    board:lineup.map(p=>({uid:p.uid,id:p.id,tile:plan.get(p.uid),dir:p.dir||'RIGHT'}))};
  ps._sargonPairLeakProbe={key,result};note(ps,{phase:'probe',round:m.round,...result});return result;
}
/** Spend only the locked shop's remaining offers; never sell another unit or refresh the held third away. */
export function spendLockedPairRemainder(parent,m,ps,h={}){
  let changed=false;
  for(let n=0;n<12&&ps.funds>0&&room(ps);n++){
    const picks=ps.shop.slots.flatMap((slot,index)=>{
      if(!slot||slot.sold||ps.priceOf(slot)>ps.funds)return [];
      const price=ps.priceOf(slot),r=slot.kind==='chess'?ps.gd.chess(slot.id):ps.gd.item(slot.id);
      if(slot.kind==='chess'){
        if(parent.purchaseAllowed?.(m,ps,r)===false||ps._sargonEarlyPairCanBuy?.(slot)===false)return [];
        const score=buyScoreOf(m,ps,slot.id)-price;
        return score>0?[{slot,index,price,score,important:!!parent.importantBuy?.(m,ps,r)}]:[];
      }
      if(parent.itemAllowed?.(r)===false||parent.purchaseItemAllowed?.(m,ps,r)===false)return [];
      const target=itemTarget(m,ps,{id:slot.id,kind:'item'});
      if(!target)return [];
      return [{slot,index,price,score:6+(r.tier||1)*3-price+(parent.purchaseItemBonus?.(m,ps,r)||0),
        important:!!parent.importantItem?.(m,ps,r)}];
    }).sort((a,b)=>Number(b.important)-Number(a.important)||b.score-a.score||a.index-b.index);
    const pick=picks[0];if(!pick)break;
    const before=new Set(ps.allChess().map(p=>p.uid)),funds=ps.funds;
    if(!ps.buy(pick.index)?.ok)break;
    if(pick.slot.kind==='chess')parent.afterPurchase?.(m,ps,pick.slot,before);
    h.takeOffers?.();parent.useEconomy?.(m,ps);changed=true;
    note(ps,{phase:'locked-remainder-buy',round:m.round,id:pick.slot.id,kind:pick.slot.kind,
      fundsBefore:funds,fundsAfter:ps.funds,frozen:ps.shop.frozen});
  }
  return changed;
}
