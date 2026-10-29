// R14 only: public, deterministic own prep-finish layer effects, evaluated on isolated candidate views.
// Reuse real effect math; an allowlist and a tiny context exclude rewards, RNG and real mutations.
import {HANDLERS} from '../../../../../../../../../../sim/content/garrisons/meta.js';
import {boardOrder} from '../../../../../../../../../board.js';
import {layerGainRoom} from '../../../../../../../../../../../shared/constants.js';

export const BOSS_PREP_LAYER_KEYS=Object.freeze([
  'SERVER_ADD_BOND','SERVER_ADD_BOND_CHESS_ALL','SERVER_ADD_BOND_METHOD','SERVER_ADD_MULTIPLE_BOND',
  'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER','SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER','SERVER_ADD_BOND_IN_HAND',
  'SERVER_ADD_BOND_POSITION','SERVER_ADD_BOND_ROUND_COIN_COST','SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER',
  'SERVER_FRONT_SAME_EFFECT_PREP_FIN',
]);
const allowed=new Set(BOSS_PREP_LAYER_KEYS),EVENT='SERVER_PREP_FIN';

export function projectBossPrepFinish(gd,ps,plan,input){
  const projected=structuredClone(input),bonds=projected.bonds,selected=new Set(plan.lineup.map(p=>p.uid));
  const board=new Map([...ps.board].filter(([,p])=>p.kind!=='chess'));
  for(const p of plan.lineup)board.set(plan.get(p.uid),{...structuredClone(p),dir:plan.dirs.get(p.uid)});
  const view=(p,area,row,col)=>p?{...structuredClone(p),area,row,col,tier:gd.tierOf(p.id)}:null;
  const boardViews=boardOrder(board).map(({piece,r,c})=>view(piece,'board',r,c));
  const handViews=ps.hand.map(p=>p&&selected.has(p.uid)?null:view(p,'hand'));
  for(const p of ps.board.values())if(p.kind==='chess'&&!selected.has(p.uid))handViews.push(view(p,'hand'));
  const pieces=new Map([...boardViews,...handViews].filter(Boolean).map(p=>[p.uid,p])),gains={};
  const ctx={gd,data:gd.raw,board:()=>boardViews,hand:()=>handViews,piece:uid=>pieces.get(uid)||null,
    chessRecord:id=>gd.chess(id),roundStats:()=>({...ps.round}),shopLevel:()=>ps.shop.level,
    bondActive:id=>!!bonds[id]?.active,layers:id=>bonds[id]?.layers||0,
    addLayers(id,n,{requireActive=false}={}){
      if(!bonds[id]||!gd.bond(id)||requireActive&&!bonds[id].active)return 0;
      const gain=layerGainRoom(bonds[id].layers||0,n);if(!gain)return 0;
      bonds[id].layers=(bonds[id].layers||0)+gain;gains[id]=(gains[id]||0)+gain;return gain;
    },
  };
  let depth=0;
  function run(piece,asPiece=null,triggered=false){
    if(!piece||piece.kind!=='chess'||depth>=16)return 0;
    const self=asPiece||piece;let count=0;depth++;
    try{for(const gid of gd.chess(piece.id)?.garrisonIds||[]){
      const g=gd.garrison(gid);if(g?.eventType!==EVENT||!allowed.has(g.effectKey))continue;
      if(!triggered&&self.area==='hand'&&g.bbStr?.conditionkey==='character_target_inboard')continue;
      const previous=ctx.source;ctx.source={piece:self,copiedFrom:asPiece?piece:null,garrison:g,bb:g.bb||{},bbStr:g.bbStr||{},where:self.area};
      try{HANDLERS[g.effectKey].run(ctx);count++;}finally{ctx.source=previous;}
    }}finally{depth--;}
    return count;
  }
  ctx.triggerGarrisons=(uid,event,{asUid}={})=>event===EVENT?run(pieces.get(uid),asUid==null?null:pieces.get(asUid),true):0;
  for(const p of boardViews)run(p);
  for(const p of handViews)run(p);
  return {input:projected,gains};
}

export function withCoopBossPrepFinish(parent){
  return Object.freeze({...parent,*finalBoardSteps(m,ps,h){
    if(m.mode!=='coop'||m.isSolo||m.wave||m.round!==m.gd.bossRound){
      if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);return;
    }
    const previous=ps._botCoopBossPrepInput,seen=new Set();
    ps._botCoopBossPrepInput=(match,player,plan,input)=>{
      const result=projectBossPrepFinish(player.gd||match.gd,player,plan,input);
      const key=JSON.stringify({units:result.input.units,gains:result.gains,bonds:result.input.bonds});
      if(!seen.has(key)){
        seen.add(key);(player._botCoopBossPrepFinishHistory||=[]).push({round:match.round,gains:result.gains,
          before:Object.fromEntries(Object.keys(result.gains).map(id=>[id,input.bonds[id].layers])),
          after:Object.fromEntries(Object.keys(result.gains).map(id=>[id,result.input.bonds[id].layers]))});
      }
      return result.input;
    };
    try{if(parent.finalBoardSteps)yield* parent.finalBoardSteps(m,ps,h);}
    finally{if(previous===undefined)delete ps._botCoopBossPrepInput;else ps._botCoopBossPrepInput=previous;}
  }});
}
