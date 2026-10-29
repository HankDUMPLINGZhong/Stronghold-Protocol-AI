// [ASSUMED] Independent solo ABYSS transfers; no seed-specific routing or adopted baseline changes.
export const SOLO_MULTI_TRANSFERS=Object.freeze({
 'solo-budget-lp':Object.freeze({budget:true,lp:true}),
 'solo-multi-lp':Object.freeze({lp:true}),
 'solo-multi-budget':Object.freeze({budget:true}),
 'solo-multi-native-second':Object.freeze({nativeSecond:true}),
 'solo-multi-late-companion':Object.freeze({lateCompanion:true}),
 'solo-multi-stead':Object.freeze({stead:'dynamic'}),
 'solo-multi-faces':Object.freeze({fireline:'faces'}),
 'solo-multi-joint':Object.freeze({fireline:'joint'}),
 'solo-multi-fireline':Object.freeze({fireline:'combined'}),
 'solo-multi-margin':Object.freeze({fireline:'combined',margin:true}),
});
export const transferOption=(m,key)=>m.isSolo&&m.difficulty==='ABYSS'?SOLO_MULTI_TRANSFERS[m.opts.botSargonFactor]?.[key]:undefined;
