// Exact structural adaptation for the pinned extended.9 host; unknown anchors fail before writes.
const PHASES = 'server/match/match/phases.js', ROOM = 'public/js/screens/room.js';
const signature = 'function SeatCard({ seat, index, room, facts, myId, busy, online, onKick, onInvite, onAddBot, onRemoveBot, searching, portraits, onPickCard = null }) {';
const ordinarySignature = 'function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick }) {';
const button = '? html`<${Button} size="sm" icon="robot" class="rseat__bot-add" disabled=${!!busy || !online}\n          data-testid="add-bot" onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>`';
const ordinaryButton = '? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>`';
const avatar = '<${AvatarFrame} size="sm" name=${seat.name} src=${cardAvatarUrl(seat.card, seat.cardSkin, portraits.m) || seatAccount?.avatar || undefined} seat=${index}';
const ordinaryAvatar = '<${AvatarFrame} size="xl" name=${seat.name} seat=${index}';
const MARKER = '    order = this.humansFirst(order);', INITIAL = '        this.prioritizeDraftOrder(order, 0, true);';
const once = (s, before, after, file) => {
  if (s.split(before).length !== 2) throw new Error('Unsupported extended host: ' + file + ': ' + before.slice(0, 70));
  return s.replace(before, after);
};
export const isExtendedHost = files => files.get(PHASES).includes('installDraftFacade') && files.get(PHASES).includes('makeDraftGroups(');
export function patchExtendedHost(files, patch) {
  const normalized = new Map(files);
  normalized.set(PHASES, once(files.get(PHASES), INITIAL, MARKER, PHASES));
  let room = files.get(ROOM);
  room = once(room, signature, ordinarySignature, ROOM);
  room = once(room, button, ordinaryButton, ROOM);
  room = once(room, "  const addBot = () => run('add-bot', () => net.request('room.addBot', {}));", "  const addBot = () => run('add', () => net.request('room.addBot', {}));", ROOM);
  room = once(room, avatar, ordinaryAvatar, ROOM);
  room = once(room, "import { data, useData } from '../data.js';\n", '', ROOM);
  normalized.set(ROOM, room);
  const out = patch(normalized);
  let phases = out.get(PHASES);
  phases = phases.replace(/\n    \/\/ The named teammate commits first[^\n]+\n    order = order\.slice\(\)\.sort\([^\n]+\);/, '');
  phases = once(phases, MARKER, INITIAL, PHASES);
  const ranker = `  prioritizeDraftOrder(order, from = 0, initial = false) {
    const changed = this.sharedHostDraftPriority(order, from, initial);
    if (this.phase !== PHASE.BAND_DRAFT) return changed;
    const pending = order.slice(from), next = pending.slice().sort((a, b) =>
      (aiAddon(this, this.players.get(a))?.PRIORITY ?? 99) - (aiAddon(this, this.players.get(b))?.PRIORITY ?? 99));
    if (next.every((pid, i) => pid === pending[i])) return changed;
    order.splice(from, pending.length, ...next); return true;
  }

`;
  phases = once(phases, '  prioritizeDraftOrder(order, from = 0, initial = false) {', ranker + '  sharedHostDraftPriority(order, from = 0, initial = false) {', PHASES);
  phases = phases.replace('this.order.some(ps => ps.playerId !== playerId && aiAddon(this, ps)?.BAND === bandId)', 'this.order.some(ps => ps.playerId !== playerId && this.draftGroup(playerId)?.playerIds.includes(ps.playerId) && aiAddon(this, ps)?.BAND === bandId)');
  out.set(PHASES, phases);
  room = out.get(ROOM);
  room = once(room, ordinarySignature.replace('onAddBot,', 'onAddBot, onAddElite,'), signature.replace('onAddBot,', 'onAddBot, onAddElite,'), ROOM);
  room = once(room, ordinaryButton.slice(7, -1), button.slice(7, -1), ROOM);
  room = once(room, "  const addBot = () => run('add', () => net.request('room.addBot', {}));", "  const addBot = () => run('add-bot', () => net.request('room.addBot', {}));", ROOM);
  // The generic elite Avatar component gets the original player's fallback via its own slot.
  room = once(room, 'size="xl" name=${seat.name} seat=${index}', 'size="sm" name=${seat.name} src=${cardAvatarUrl(seat.card, seat.cardSkin, portraits.m) || seatAccount?.avatar || undefined} seat=${index}', ROOM);
  out.set(ROOM, room);
  const lobby = 'server/lobby.js';
  out.set(lobby, once(out.get(lobby), 'seats: restored?.seats || seats,', 'seats: restored?.seats?.map(s => { const persona = room.seats.find(r => r?.playerId === s.playerId && r.isBot)?.botPersona; return { ...s, ...(s.isBot && ELITE_RECRUITS.some(p => p.id === persona) ? { botPersona: persona } : {}) }; }) || seats,', lobby));
  const rewind = 'server/match/rewind.js';
  out.set(rewind, once(out.get(rewind), "if (!PS_SKIP.has(k) && typeof ps[k] !== 'function') o[k] = ps[k];", "if (!PS_SKIP.has(k) && k !== '_botFocus' && typeof ps[k] !== 'function') o[k] = ps[k];", rewind));
  return out;
}
