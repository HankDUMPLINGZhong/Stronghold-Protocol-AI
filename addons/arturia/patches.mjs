// Explicit, fail-closed edits to upstream 6ab24682. No source files are replaced wholesale.
function replace(source, before, after, file) {
  if (source.split(before).length !== 2) throw new Error(`Unsupported installation: ${file}: anchor must occur exactly once: ${before.slice(0, 75)}`);
  return source.replace(before, after);
}

// Uses the room's existing controls and hooks; grows with the supported elite roster.
const elitePicker = [
  'function ArturiaAvatar(props) {',
  '  useData("assets");',
  '  return html`<${AvatarFrame} ...${props} src=${avatarUrl(data.get("assets"), "char_245_cello", { e2: true })} />`;',
  '}',
  'const ELITE_RECRUITS = Object.freeze([{ id: "arturia", label: () => t("阿尔图罗") }]);',
  'function EliteRecruit({ room, busy, onAdd }) {',
  '  const [open, setOpen] = useState(false), root = useRef(null);',
  '  const unavailable = option => room.seats.some(s => s?.botPersona === option.id);',
  '  const disabled = !!busy || room.difficulty === "FUNNY" || room.content?.vanilla === false || ELITE_RECRUITS.every(unavailable);',
  '  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);',
  '  useEffect(() => {',
  '    if (!open) return;',
  '    root.current?.querySelector("[role=menuitem]:not(:disabled)")?.focus();',
  '    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };',
  '    document.addEventListener("pointerdown", outside);',
  '    return () => document.removeEventListener("pointerdown", outside);',
  '  }, [open]);',
  '  const keydown = e => {',
  '    if (e.key === "Escape" && open) {',
  '      e.preventDefault(); setOpen(false); root.current?.querySelector("[aria-haspopup=menu]")?.focus();',
  '    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {',
  '      e.preventDefault();',
  '      if (!open) { setOpen(true); return; }',
  '      const entries = [...root.current.querySelectorAll("[role=menuitem]:not(:disabled)")];',
  '      if (!entries.length) return;',
  '      const at = entries.indexOf(document.activeElement);',
  '      const next = e.key === "Home" ? 0 : e.key === "End" ? entries.length - 1 : (at + (e.key === "ArrowUp" ? -1 : 1) + entries.length) % entries.length;',
  '      entries[next].focus();',
  '    }',
  '  };',
  '  return html`<div ref=${root} class="elite-recruit" style="width:100%;position:relative" onKeyDown=${keydown}',
  '    onBlur=${e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>',
  '    <${Button} variant="secondary" size="sm" block=${true} disabled=${disabled} aria-haspopup="menu" aria-expanded=${open ? "true" : "false"}',
  '      onClick=${() => setOpen(!open)}>${t("添加精英干员")} <span aria-hidden="true">▾</span><//>',
  '    ${open && html`<div role="menu" aria-label=${t("添加精英干员")} style="display:flex;flex-direction:column;gap:.04rem;margin-top:.04rem;padding:.04rem;border:1px solid var(--line-2);background:var(--bg-1,#0b0e0d)">',
  '      ${ELITE_RECRUITS.map(option => html`<${Button} key=${option.id} role="menuitem" variant="secondary" size="sm" block=${true}',
  '        disabled=${unavailable(option)} onClick=${() => { setOpen(false); onAdd(option.id); }}>${option.label()}<//>`)}',
  '    </div>`}',
  '  </div>`;',
  '}',
  '',
].join('\n');

export function patchFiles(files) {
  const out = new Map(files);
  const edit = (file, before, after) => out.set(file, replace(out.get(file), before, after, file));
  const lobby = 'server/lobby.js', bot = 'server/match/bot.js', phases = 'server/match/match/phases.js';
  const room = 'public/js/screens/room.js';
  // Explicit compatibility branch for the retained 0.2.4 main (before content plugins existed).
  const legacy = !files.get(lobby).includes('room.content?.trusted');
  out.set(room, "import { avatarUrl } from '../assets.js';\nimport { data, useData } from '../data.js';\n" + out.get(room));
  edit('shared/protocol.js', "'room.addBot': {},", "'room.addBot': { persona: optional((v) => v === 'arturia') },");
  edit(lobby, "case 'room.addBot': return this.addBot(session);", "case 'room.addBot': return this.addBot(session, msg);");
  edit(lobby, 'addBot(session) {', "addBot(session, { persona } = {}) {");
  edit(lobby, "    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));", `    if (persona !== undefined && persona !== 'arturia') return fail(ERR.BAD_TARGET);
    if (persona === 'arturia' && room.seats.some(s => s?.botPersona === 'arturia')) return fail(ERR.ALREADY);
    if (persona === 'arturia' && room.difficulty === 'FUNNY') return fail(ERR.BAD_TARGET);
    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));`);
  edit(lobby, "const name = BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`;",
    "const name = persona === 'arturia' ? 'AI·阿尔图罗' : BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`; // i18n-ignore: player name");
  edit(lobby, 'room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false };',
    "room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false, ...(persona ? { botPersona: persona } : {}) };");
  edit(lobby, 'seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected,',
    'seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected, ...(s.botPersona ? { botPersona: s.botPersona } : {}),');
  edit(lobby, '? { seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left' + (legacy ? ' }' : ','),
    '? { seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left, ...(s.botPersona ? { botPersona: s.botPersona } : {})' + (legacy ? ' }' : ','));
  // In standard mode Laterano is statically disabled. Do not silently turn its rules on.
  const difficultyAnchor = legacy ? '    if (room.difficulty !== difficulty) {' : '    // a plugin mode chosen (header "Gameplay plugins") carries its own difficulty: picking one leaves it';
  edit(lobby, difficultyAnchor, `    if (difficulty === 'FUNNY' && room.seats.some(s => s?.botPersona === 'arturia')) return fail(ERR.BAD_TARGET);\n` + difficultyAnchor);
  // Validate against the actual mode/content again before start, including changes made after adding the seat.
  const startAnchor = legacy ? '    const humans = room.activeHumans();\n    for (const s of humans) {' : '    const humans = room.activeHumans();\n    if (room.content?.trusted';
  edit(lobby, startAnchor, `    if (room.seats.some(s => s?.botPersona === 'arturia') && (room.difficulty === 'FUNNY' || room.modded)) return fail(ERR.BAD_TARGET);\n` + startAnchor);

  out.set(bot, "import { isArturia, BAND, pickCard as arturiaPickCard, prepBegin as arturiaPrepBegin, prepEnd as arturiaPrepEnd } from './arturia/index.js';\n" + out.get(bot));
  edit(bot, 'export function botPickBand(m, ps) {', 'export function botPickBand(m, ps) {\n  if (isArturia(m, ps)) return BAND;');
  edit(bot, 'export function botPickCard(m, ps, cards, available) {', 'export function botPickCard(m, ps, cards, available) {\n  if (isArturia(m, ps)) return arturiaPickCard(m, ps, cards, available);');
  const prepAnchor = legacy ? 'export function* botPrepBeginSteps(m, ps) {' : 'export function* botPrepBeginSteps(m, ps, { delegate = false } = {}) {';
  edit(bot, prepAnchor, prepAnchor + '\n  if (isArturia(m, ps)) return yield* arturiaPrepBegin(m, ps);');
  edit(bot, 'export function* botPrepEndSteps(m, ps, job = null) {',
    'export function* botPrepEndSteps(m, ps, job = null) {\n  if (isArturia(m, ps)) return yield* arturiaPrepEnd(m, ps, job);');

  out.set(phases, "import { isArturia, BAND } from '../arturia/index.js';\n" + out.get(phases));
  edit(phases, '    order = this.humansFirst(order);', `    order = this.humansFirst(order);
    // The named teammate commits first, even with aiPicksLast enabled. Other players keep their relative order.
    order = [...order.filter(pid => isArturia(this, this.players.get(pid))), ...order.filter(pid => !isArturia(this, this.players.get(pid)))];`);
  // Reservation protects timeout/default paths as well as explicit human requests.
  edit(phases, '  bandTaken(bandId, playerId) {', `  bandTaken(bandId, playerId) {
    if (bandId === BAND && this.order.some(ps => ps.playerId !== playerId && isArturia(this, ps))) return true;`);
  edit(phases, '  defaultBand(playerId) {', `  defaultBand(playerId) {
    if (isArturia(this, this.players.get(playerId))) return BAND;`);

  edit(room, 'function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick }) {',
    elitePicker + '\nfunction SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onAddElite, onRemoveBot, onKick }) {');
  edit(room, '? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>`',
    '? html`<div style="display:flex;flex-direction:column;gap:.08rem;width:100%"><${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>\n            <${EliteRecruit} room=${room} busy=${busy} onAdd=${onAddElite} /></div>`');
  edit(room, "  const addBot = () => run('add', () => net.request('room.addBot', {}));", "  const addBot = () => run('add', () => net.request('room.addBot', {}));\n  const addElite = persona => run('add', () => net.request('room.addBot', { persona }));");
  edit(room, 'onAddBot=${addBot} onRemoveBot=', 'onAddBot=${addBot} onAddElite=${addElite} onRemoveBot=');
  edit(room, '<${AvatarFrame} size="xl" name=${seat.name} seat=${index}',
    '<${seat.isBot && seat.botPersona === \'arturia\' ? ArturiaAvatar : AvatarFrame} size="xl" name=${seat.name} seat=${index}');
  for (const file of files.keys()) if (file.startsWith('public/i18n/')) {
    const pack = JSON.parse(files.get(file));
    // UI packs are flat maps in upstream; preserve the pack's metadata and existing strings.
    const strings = pack.strings ?? pack;
    const lang = file.split('/').at(-1);
    const translated = {
      'ja.json': ['エリートオペレーターを追加', 'アルトリア'],
      'ko.json': ['정예 오퍼레이터 추가', '아르투리아'],
      'zh-TW.json': ['新增菁英幹員', '阿爾圖羅'],
    }[lang] ?? ['Add elite operator', 'Arturia'];
    strings['添加精英干员'] = translated[0];
    strings['阿尔图罗'] = translated[1];
    out.set(file, JSON.stringify(pack, null, 2) + '\n');
  }
  return out;
}

export const PATCH_PATHS = ['shared/protocol.js', 'server/lobby.js', 'server/match/bot.js',
  'server/match/match/phases.js', 'public/js/screens/room.js'];
