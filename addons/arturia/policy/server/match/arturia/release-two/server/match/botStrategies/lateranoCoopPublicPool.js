// Public round-opening survival count only. No teammate battle input enters this model.
import {bossPoolHp} from '../../../../../../../../../finalAssault.js';
export function publicOpeningBossPool(gd,bossId,aliveCount) {
  if(!Number.isSafeInteger(aliveCount)||aliveCount<1)throw Error('Missing immutable public Boss opening survivor count');
  return bossPoolHp(gd,bossId,aliveCount);
}
