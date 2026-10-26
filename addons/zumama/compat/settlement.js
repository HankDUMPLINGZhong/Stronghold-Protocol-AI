// Use the host's public settlement API, preserving its damage rules.
let settlement;
try { settlement = await import('../../../../sim/attack.js'); }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || error.url !== new URL('../../../../sim/attack.js', import.meta.url).href) throw error;
  settlement = await import('../../../../sim/damage.js');
}
if (typeof settlement.mitigate !== 'function') throw new Error('Unsupported host settlement API');
export const mitigate = settlement.mitigate;
