// [ASSUMED] Optional co-op economy over the cautious14/56 development candidate; no baseline replacement.
// Vision80 + owned Astgenne cycles ordinary Swire; Vision150 cycles real0/1 prices and cash-neutral Flametail gifts.
const VISION='visiShip',SWIRE='chess_char_3_03_a',STAR='chess_char_6_16_a',FLAME='chess_char_4_19_a',COIN='chess_item_1_03_e_a';
const free=ps=>ps.hand.filter(p=>!p).length;
const effects=(gd,rec)=>(rec.garrisonIds||[]).map(id=>gd.garrison(id)).filter(Boolean);

/** A slot is visited once per invocation and a real purchase marks it sold. No synthetic rerolls or RNG peeks. */
export function tradeCoopVision(m,ps,{retain=()=>false}={}) {
  if(m.mode!=='coop'||m.isSolo||(ps.layers[VISION]||0)<80||ps._botCoopVisionTrading)return;
  const gd=ps.gd||m.gd,star=ps.allChess().some(p=>gd.baseIdOf(p.id)===STAR);
  ps._botCoopVisionTrading=true;
  try{
    for(const [index,slot] of ps.shop.slots.entries()){
      if(!slot||slot.sold||slot.kind!=='chess')continue;
      const rec=gd.chess(slot.id),base=gd.baseIdOf(slot.id),price=ps.priceOf(slot),layers=ps.layers[VISION]||0;
      if(!rec||rec.isGolden||ps.completesChessMerge(slot.id)||retain(m,ps,rec)||price>ps.funds)continue;
      const swire=base===SWIRE&&star,flame=base===FLAME&&layers>=150,cheap=layers>=150&&price<=1;
      if(!swire&&!flame&&!cheap)continue;
      const es=effects(gd,rec),coins=es.filter(g=>g.eventType==='SERVER_GAIN'&&g.effectKey==='SERVER_GAIN_EQUIP'
        &&g.bbStr?.chess===COIN).reduce((sum,g)=>sum+(g.bb.count||0),0);
      if(coins&&(!m.itemPool.canGain(COIN)||ps.completesItemMerge(COIN)))continue;
      let giftIds=[];
      if(flame){
        const g=es.find(g=>g.eventType==='SERVER_GAIN'&&g.effectKey==='SERVER_POOL_CHAR');
        const pool=gd.choices?.pools?.[g?.bbStr?.pool];
        giftIds=(pool?.items||pool?.weighted?.map(([id])=>id)||[]).filter(id=>{
          const p=ps.poolOf(gd.baseIdOf(id));return !p.has(id)||p.left(id)>0;
        });
        // A gift completing an owned pair is reinforcement, not a disposable cash-cycle asset.
        if(!giftIds.length||giftIds.some(id=>ps.completesChessMerge(id)||retain(m,ps,gd.chess(id))))continue;
      }
      const refund=gd.sellPrice(slot.id),minGift=flame?Math.min(...giftIds.map(id=>gd.sellPrice(id))):0;
      if(price>refund+coins+minGift||free(ps)<1+coins+Number(flame))continue;
      const pool=ps.poolOf(base);if(pool.has(base)&&pool.left(base)<1)continue;
      const before=new Set(ps.allChess().map(p=>p.uid));
      const oldItems=new Set([...ps.hand,...ps.temp].filter(p=>p?.kind==='item').map(p=>p.uid));
      const funds=ps.funds,spent=ps.round.spent,vision=ps.layers[VISION]||0;
      if(!ps.buy(index)?.ok)continue;
      const gained=ps.allChess().filter(p=>!before.has(p.uid));
      const primary=gained.find(p=>p.id===slot.id);
      if(!primary||primary.items?.length)throw Error('Vision trade primary changed unexpectedly');
      let redeemed=0;
      if(coins)for(const item of [...ps.hand,...ps.temp]){
        if(item?.kind!=='item'||oldItems.has(item.uid)||gd.baseIdOf(item.id)!==COIN)continue;
        const previous=ps.funds;
        if(!ps.equip(item.uid,primary.uid)?.ok)throw Error('Vision trade could not redeem its new coin');
        redeemed+=ps.funds-previous;
      }
      const gifts=flame?gained.filter(p=>p!==primary&&giftIds.includes(p.id)&&!gd.isGolden(p.id)):[];
      if(flame&&gifts.length!==1)throw Error('Vision trade expected one actual Flametail gift');
      // Only sell units created by this purchase. Earlier representatives, pairs and equipment stay intact.
      const sold=[];
      for(const piece of [...gifts,primary]){
        if(piece.items?.length||ps.find(piece.uid)?.area==='board'||!ps.sell(piece.uid)?.ok)
          throw Error('Vision trade could not sell its new disposable unit');
        sold.push({uid:piece.uid,id:piece.id});
      }
      if(ps.funds<funds)throw Error('Vision trade lost cash');
      (ps._botCoopVisionTrades||=[]).push({round:m.round,level:ps.shop.level,id:slot.id,
        kind:flame?'flametail':swire?'swire':'cheap',vision,price,refund,redeemed,
        netCash:ps.funds-funds,spent:ps.round.spent-spent,visionGain:(ps.layers[VISION]||0)-vision,sold,
        starOwned:star,starDeployed:[...ps.board.values()].some(p=>p.kind==='chess'&&gd.baseIdOf(p.id)===STAR)});
    }
  }finally{ps._botCoopVisionTrading=false;}
}

export function withLateranoCoopVisionTrade(recipe) {
  const cycle=(m,ps)=>tradeCoopVision(m,ps,{retain:(m,ps,rec)=>recipe.importantBuy(m,ps,rec)||recipe.criticalBuy(m,ps,rec)});
  return Object.freeze({...recipe,
    useEconomy(m,ps){recipe.useEconomy(m,ps);cycle(m,ps);},
    liquidity(m,ps){cycle(m,ps);return recipe.liquidity?.(m,ps);},
  });
}
