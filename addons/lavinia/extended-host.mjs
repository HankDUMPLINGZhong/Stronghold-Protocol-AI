// zhewang448 extended.9: normalize only known integration anchors, then reuse the upstream patch.
// Every substitution is exact and planned in memory; unknown layouts never reach installer writes.
const PHASES = 'server/match/match/phases.js', ROOM = 'public/js/screens/room.js';
const signature = 'function SeatCard({ seat, index, room, facts, myId, busy, online, onKick, onInvite, onAddBot, onRemoveBot, searching, portraits, onPickCard = null }) {';
const ordinarySignature = 'function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick }) {';
const extendedButton = '? html`<${Button} size="sm" icon="robot" class="rseat__bot-add" disabled=${!!busy || !online}\n          data-testid="add-bot" onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>`';
const ordinaryButton = '? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>`';
const extendedAvatar = '<${AvatarFrame} size="sm" name=${seat.name} src=${cardAvatarUrl(seat.card, seat.cardSkin, portraits.m) || seatAccount?.avatar || undefined} seat=${index}';
const ordinaryAvatar = '<${AvatarFrame} size="xl" name=${seat.name} seat=${index}';
const MARKER = '    order = this.humansFirst(order);';
const INITIAL = '        this.prioritizeDraftOrder(order, 0, true);';
const RANKER = `  // Only strategy turns gain elite priority; special drafts keep the host's ordering.
  prioritizeDraftOrder(order, from = 0, initial = false) {
    const changed = this.extendedHostDraftPriority(order, from, initial);
    if (this.phase !== PHASE.BAND_DRAFT) return changed;
    const rank = pid => {
      const seat = this.opts.seats.find(s => s.playerId === pid && s.isBot);
      return seat?.botPersona === 'arturia' ? 0 : seat?.botPersona === 'lavinia' ? 1 : 2;
    };
    const pending = order.slice(from), next = pending.slice().sort((a, b) => rank(a) - rank(b));
    if (next.every((pid, i) => pid === pending[i])) return changed;
    order.splice(from, pending.length, ...next);
    return true;
  }

`;
const POOL_VIEW = `// Frozen policies read m.pool / m.itemPool; the extended host owns separate pools per group.
const extendedPolicyViews = new WeakMap();
export function extendedPolicyMatch(m, ps) {
  if (m.poolGroups.length < 2) return m;
  if (!extendedPolicyViews.has(ps)) extendedPolicyViews.set(ps, new Proxy(m, {
    get(target, key) {
      if (key === 'pool') return ps.pool;
      if (key === 'itemPool') return target.itemPoolFor(ps.playerId);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  }));
  return extendedPolicyViews.get(ps);
}

`;
function once(source, before, after, file) {
  if (source.split(before).length !== 2) throw new Error(`Unsupported extended host: ${file}: ${before.slice(0, 80)}`);
  return source.replace(before, after);
}
export function isExtendedHost(files) {
  const source = files.get(PHASES);
  return source.includes('installDraftFacade') && source.includes('makeDraftGroups(');
}
export function patchExtendedHost(files, patch) {
  const normalized = new Map(files), dual = files.get(ROOM).includes('const ELITE_RECRUITS =');
  let phases = files.get(PHASES);
  phases = once(phases, INITIAL, MARKER, PHASES);
  normalized.set(PHASES, phases);
  if (!dual) {
    let room = files.get(ROOM);
    room = once(room, signature, ordinarySignature, ROOM);
    room = once(room, extendedButton, ordinaryButton, ROOM);
    room = once(room, "  const addBot = () => run('add-bot', () => net.request('room.addBot', {}));", "  const addBot = () => run('add', () => net.request('room.addBot', {}));", ROOM);
    room = once(room, extendedAvatar, ordinaryAvatar, ROOM);
    room = once(room, "import { data, useData } from '../data.js';\n", '', ROOM);
    normalized.set(ROOM, room);
  }
  const out = patch(normalized);
  const bot = 'server/match/bot.js';
  let botSource = out.get(bot);
  if (!dual) botSource = POOL_VIEW + botSource;
  for (const prefix of ['arturia', 'lavinia']) for (const action of ['PickCard', 'PrepBegin', 'PrepEnd'])
    botSource = botSource.replaceAll(`${prefix}${action}(m, ps`, `${prefix}${action}(extendedPolicyMatch(m, ps), ps`);
  out.set(bot, botSource);
  phases = out.get(PHASES);
  // Strip the legacy single-list partitions; the extended host reprioritizes each group on every turn.
  phases = phases.replace(/\n    \/\/ The named teammate commits first, even with aiPicksLast enabled\. Other players keep their relative order\./g, '');
  phases = phases.replace(/\n    order = \[\.\.\.order\.filter\(pid => is(?:Arturia|Lavinia)\(this, this\.players\.get\(pid\)\)\), \.\.\.order\.filter\(pid => !is(?:Arturia|Lavinia)\(this, this\.players\.get\(pid\)\)\)\];/g, '');
  phases = once(phases, MARKER, INITIAL, PHASES);
  if (!dual) phases = once(phases, '  prioritizeDraftOrder(order, from = 0, initial = false) {', RANKER + '  extendedHostDraftPriority(order, from = 0, initial = false) {', PHASES);
  // Reserved bands belong to a fixed pool group, not the whole 20-seat room.
  phases = phases.replaceAll('this.order.some(ps => ps.playerId !== playerId && isArturia(this, ps))', 'this.order.some(ps => ps.playerId !== playerId && this.draftGroup(playerId)?.playerIds.includes(ps.playerId) && isArturia(this, ps))');
  phases = phases.replaceAll('this.order.some(ps => ps.playerId !== playerId && isLavinia(this, ps))', 'this.order.some(ps => ps.playerId !== playerId && this.draftGroup(playerId)?.playerIds.includes(ps.playerId) && isLavinia(this, ps))');
  out.set(PHASES, phases);
  if (!dual) {
    let room = out.get(ROOM);
    room = once(room, ordinarySignature.replace('onAddBot,', 'onAddBot, onAddElite,'), signature.replace('onAddBot,', 'onAddBot, onAddElite,'), ROOM);
    room = once(room, ordinaryButton.slice(7, -1), extendedButton.slice(7, -1), ROOM);
    room = once(room, "  const addBot = () => run('add', () => net.request('room.addBot', {}));", "  const addBot = () => run('add-bot', () => net.request('room.addBot', {}));", ROOM);
    room = once(room, 'size="xl" name=${seat.name} seat=${index}', 'size="sm" name=${seat.name} src=${cardAvatarUrl(seat.card, seat.cardSkin, portraits.m) || seatAccount?.avatar || undefined} seat=${index}', ROOM);
    out.set(ROOM, room);
    // Persistent recovery reconstructs Match from a reduced seat list. Recover identity from the saved room.
    const lobby = 'server/lobby.js';
    out.set(lobby, once(out.get(lobby), 'seats: restored?.seats || seats,', "seats: restored?.seats?.map(s => { const persona = room.seats.find(r => r?.playerId === s.playerId && r.isBot)?.botPersona; return { ...s, ...(s.isBot && ['arturia', 'lavinia'].includes(persona) ? { botPersona: persona } : {}) }; }) || seats,", lobby));
    const rewind = 'server/match/rewind.js';
    // This derived cache holds immutable strategy functions. Recompute it after rewind; retain actual AI state.
    out.set(rewind, once(out.get(rewind), "if (!PS_SKIP.has(k) && typeof ps[k] !== 'function') o[k] = ps[k];", "if (!PS_SKIP.has(k) && k !== '_botFocus' && typeof ps[k] !== 'function') o[k] = ps[k];", rewind));
  }
  return out;
}
