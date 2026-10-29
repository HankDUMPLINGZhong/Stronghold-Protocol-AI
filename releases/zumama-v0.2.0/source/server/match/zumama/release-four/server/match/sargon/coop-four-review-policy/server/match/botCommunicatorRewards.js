// Complete only the rewards newly queued by a successful communicator equip.
// Choice order, valuation, inventory repair and decline behavior remain in takeOffers.
export function settleCommunicatorRewards(m, ps, before, takeOffers) {
  const created = ps.offers.filter(o => !before.has(o) && o.source === 'merge');
  if (!created.length) return;
  const event = {factor:'communicator-merge-reward',round:m.round,funds:ps.funds,
    created:created.map(o=>({source:o.source,tier:o.tier,slots:structuredClone(o.slots)})),
    pendingBefore:ps.offers.length,batches:0};
  // One normal takeOffers call handles four choices. Repeat it for merge chains,
  // retaining its FIFO ordering and stopping on a blocked/unchanged queue.
  while (ps.offers.length && event.batches < 64) {
    const head = ps.offers[0], length = ps.offers.length;
    takeOffers(m, ps); event.batches++;
    if (ps.offers[0] === head && ps.offers.length === length) break;
  }
  event.pendingAfter = ps.offers.length;
  (ps._sargonFactorHistory ||= []).push(event);
}

export function patchCommunicatorRewards(text) {
  const needle = '    tryDo(() => ps.equip(item.uid, target.uid, replace));';
  if (text.split(needle).length !== 2) throw Error('Expected exactly one equipment-loop action');
  return "import {settleCommunicatorRewards} from './botCommunicatorRewards.js';\n" + text.replace(needle,
    `    const communicator = itemKey(item.id) === 'chess_item_2_06_e';
    const beforeOffers = communicator ? new Set(ps.offers) : null;
    const equipped = tryDo(() => ps.equip(item.uid, target.uid, replace));
    if (equipped && communicator) settleCommunicatorRewards(m, ps, beforeOffers, takeOffers);`);
}
