// One host integration for every AI persona. Rebuilt from journalled host originals on registry changes.
import { isExtendedHost, patchExtendedHost } from './extended-host.mjs';
const modernHost = files => files.get('server/match/bot.js')?.includes('export function* botPrepBeginSteps(m, ps, options = {}) {');
export const extraPatchPaths = files => [
  ...(isExtendedHost(files) ? ['server/match/rewind.js'] : []),
  'server/match/Match.js',
];
function replace(source, before, after, file) {
  if (source.split(before).length !== 2) throw new Error(`Unsupported installation: ${file}: anchor must occur exactly once: ${before.slice(0, 75)}`);
  return source.replace(before, after);
}

// Uses the room's existing controls and hooks; grows with the supported elite roster.
const elitePicker = [
  'function EliteAvatar({ persona, ...props }) {',
  '  useData("assets");',
  '  const option = ELITE_RECRUITS.find(o => o.id === persona);',
  '  return html`<${AvatarFrame} ...${props} src=${option?.avatar ? avatarUrl(data.get("assets"), option.avatar, { e2: option.e2 === true }) : undefined} />`;',
  '}',
  'function EliteRecruit({ room, busy, onAdd }) {',
  '  const [open, setOpen] = useState(false), root = useRef(null);',
  '  const unavailable = option => room.seats.some(s => s?.botPersona === option.id) || !option.difficulties.includes(room.difficulty) || room.content?.vanilla === false || (room.version && room.version !== "act2autochess") || (room.versionVote?.version && room.versionVote.version !== "act2autochess");',
  '  const disabled = !!busy || ELITE_RECRUITS.every(unavailable);',
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
  '    ${open && html`<div role="menu" aria-label=${t("添加精英干员")} style="display:grid;grid-auto-rows:2.5em;gap:.04rem;max-height:calc(5em + .04rem);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;box-sizing:content-box;margin-top:.04rem;padding:.04rem;border:1px solid var(--line-2);background:var(--bg-1,#0b0e0d)">',
  '      ${ELITE_RECRUITS.map(option => html`<${Button} key=${option.id} role="menuitem" variant="secondary" size="sm" block=${true}',
  '        style="min-height:0;height:100%;white-space:nowrap" disabled=${unavailable(option)} onClick=${() => { setOpen(false); onAdd(option.id); }}>${t(option.name)}<//>`)}',
  '    </div>`}',
  '  </div>`;',
  '}',
  '',
].join('\n');

export function patchFiles(files, personas, normalized = false) {
  if (!normalized && isExtendedHost(files)) return patchExtendedHost(files, source => patchFiles(source, personas, true));
  const out = new Map(files);
  const edit = (file, before, after) => out.set(file, replace(out.get(file), before, after, file));
  const lobby = 'server/lobby.js', bot = 'server/match/bot.js', phases = 'server/match/match/phases.js';
  const room = 'public/js/screens/room.js';
  // Explicit compatibility branch for the retained 0.2.4 main (before content plugins existed).
  const legacy = !files.get(lobby).includes('room.content?.trusted');
  const dataImport = /import \{[^\n]*\bdata\b[^\n]*\buseData\b[^\n]*\} from '\.\.\/data\.js';/.test(out.get(room))
    ? '' : "import { data, useData } from '../data.js';\n";
  out.set(room, "import { ELITE_RECRUITS } from '../../../shared/aiAddons.js';\nimport { avatarUrl } from '../assets.js';\n" + dataImport + out.get(room));
  out.set('shared/protocol.js', "import { ELITE_RECRUITS } from './aiAddons.js';\n" + out.get('shared/protocol.js'));
  out.set(lobby, "import { ELITE_RECRUITS } from '../shared/aiAddons.js';\n" + out.get(lobby));
  edit('shared/protocol.js', "'room.addBot': {},", "'room.addBot': { persona: optional((v) => ELITE_RECRUITS.some(p => p.id === v)) },");
  edit(lobby, "case 'room.addBot': return this.addBot(session);", "case 'room.addBot': return this.addBot(session, msg);");
  edit(lobby, 'addBot(session) {', "addBot(session, { persona } = {}) {");
  edit(lobby, "    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));", `    const elite = ELITE_RECRUITS.find(p => p.id === persona);
    if (persona !== undefined && !elite) return fail(ERR.BAD_TARGET);
    if (elite && room.seats.some(s => s?.botPersona === persona || ELITE_RECRUITS.find(p => p.id === s?.botPersona)?.band === elite.band)) return fail(ERR.ALREADY);
    if (elite && (!elite.difficulties.includes(room.difficulty) || room.modded || (room.version && room.version !== 'act2autochess') || (room.versionVote?.version && room.versionVote.version !== 'act2autochess'))) return fail(ERR.BAD_TARGET);
    const used = new Set(room.seats.filter((s) => s && s.isBot).map((s) => s.name));`);
  edit(lobby, "const name = BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`;",
    "const name = elite ? `AI·${elite.name}` : BOT_NAMES.find((n) => !used.has(n)) || `AI·${idx + 1}`; // i18n-ignore: player name");
  edit(lobby, 'room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false };',
    "room.seats[idx] = { seat: idx, playerId, name, isBot: true, ready: true, connected: true, left: false, ...(persona ? { botPersona: persona } : {}) };");
  edit(lobby, 'seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected,',
    'seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, connected: s.connected, ...(s.botPersona ? { botPersona: s.botPersona } : {}),');
  edit(lobby, '? { seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left' + (legacy ? ' }' : ','),
    '? { seat: s.seat, playerId: s.playerId, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected && !s.left, ...(s.botPersona ? { botPersona: s.botPersona } : {})' + (legacy ? ' }' : ','));
  // In standard mode Laterano is statically disabled. Do not silently turn its rules on.
  const difficultyAnchor = legacy ? '    if (room.difficulty !== difficulty) {' : '    // a plugin mode chosen (header "Gameplay plugins") carries its own difficulty: picking one leaves it';
  edit(lobby, difficultyAnchor, `    if (room.seats.some(s => s?.botPersona && !ELITE_RECRUITS.find(p => p.id === s.botPersona)?.difficulties.includes(difficulty))) return fail(ERR.BAD_TARGET);\n` + difficultyAnchor);
  // Validate against the actual mode/content again before start, including changes made after adding the seat.
  const startAnchor = legacy ? '    const humans = room.activeHumans();\n    for (const s of humans) {' : '    const humans = room.activeHumans();\n    if (room.content?.trusted';
  edit(lobby, startAnchor, `    if (room.seats.some(s => s?.botPersona && (!ELITE_RECRUITS.find(p => p.id === s.botPersona)?.difficulties.includes(room.difficulty) || room.modded || (room.version && room.version !== 'act2autochess')))) return fail(ERR.BAD_TARGET);\n` + startAnchor);
  if (modernHost(files)) edit(lobby, '    if (version === room.version) return fail(ERR.ALREADY);',
    "    if (version !== DEFAULT_VERSION && room.seats.some(s => s?.botPersona && ELITE_RECRUITS.some(p => p.id === s.botPersona))) return fail(ERR.VERSION_UNSUPPORTED);\n    if (version === room.version) return fail(ERR.ALREADY);");

  out.set(bot, "import { aiAddon } from './aiAddons/index.js';\n" + out.get(bot));
  edit(bot, 'export function botPickBand(m, ps) {', 'export function botPickBand(m, ps) {\n  const addon = aiAddon(m, ps); if (addon) return addon.BAND;');
  edit(bot, 'export function botPickCard(m, ps, cards, available) {', 'export function botPickCard(m, ps, cards, available) {\n  const addon = aiAddon(m, ps); if (addon) return addon.pickCard(m, ps, cards, available);');
  const prepAnchor = legacy ? 'export function* botPrepBeginSteps(m, ps) {'
    : modernHost(files) ? 'export function* botPrepBeginSteps(m, ps, options = {}) {'
    : 'export function* botPrepBeginSteps(m, ps, { delegate = false } = {}) {';
  edit(bot, prepAnchor, prepAnchor + '\n  const addon = aiAddon(m, ps); if (addon) return yield* addon.prepBegin(m, ps);');
  edit(bot, 'export function* botPrepEndSteps(m, ps, job = null) {',
    'export function* botPrepEndSteps(m, ps, job = null) {\n  const addon = aiAddon(m, ps); if (addon) return yield* addon.prepEnd(m, ps, job);');

  if (out.get('server/match/Match.js').includes('this.bot = getBotStrategy(')) {
    const match = 'server/match/Match.js';
    out.set(match, "import { withAIAddons } from './aiAddons/index.js';\n" + out.get(match));
    edit(match, "this.bot = getBotStrategy(opts.botStrategy ?? env('SP_BOT_STRATEGY'));",
      "this.bot = withAIAddons(getBotStrategy(opts.botStrategy ?? env('SP_BOT_STRATEGY')));");
  }

  out.set(phases, "import { aiAddon } from '../aiAddons/index.js';\n" + out.get(phases));
  edit(phases, '    order = this.humansFirst(order);', `    order = this.humansFirst(order);
    // The named teammate commits first, even with aiPicksLast enabled. Other players keep their relative order.
    order = order.slice().sort((a, b) => (aiAddon(this, this.players.get(a))?.PRIORITY ?? 99) - (aiAddon(this, this.players.get(b))?.PRIORITY ?? 99));`);
  // Reservation protects timeout/default paths as well as explicit human requests.
  edit(phases, '  bandTaken(bandId, playerId) {', `  bandTaken(bandId, playerId) {
    if (this.order.some(ps => ps.playerId !== playerId && aiAddon(this, ps)?.BAND === bandId)) return true;`);
  edit(phases, '  defaultBand(playerId) {', `  defaultBand(playerId) {
    const addon = aiAddon(this, this.players.get(playerId)); if (addon) return addon.BAND;`);

  edit(room, 'function SeatCard({ seat, index, room, facts, myId, busy, onAddBot,',
    elitePicker + '\nfunction SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onAddElite,');
  if (modernHost(files)) {
    edit(room, '<${Button} variant="secondary" size="sm" icon="robot" class="rseat__add" loading=${busy === \'add\'} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>',
      '<div class="rseat__add" style="display:flex;flex-direction:column;gap:.08rem;width:calc(100% - .12rem);padding:0"><${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === \'add\'} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//><${EliteRecruit} room=${room} busy=${busy} onAdd=${onAddElite} /></div>');
  } else {
    edit(room, '? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>`',
      '? html`<div style="display:flex;flex-direction:column;gap:.08rem;width:100%"><${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t(\'添加 AI 队友\')}<//>\n            <${EliteRecruit} room=${room} busy=${busy} onAdd=${onAddElite} /></div>`');
  }
  edit(room, "  const addBot = () => run('add', () => net.request('room.addBot', {}));", "  const addBot = () => run('add', () => net.request('room.addBot', {}));\n  const addElite = persona => run('add', () => net.request('room.addBot', { persona }));");
  edit(room, 'onAddBot=${addBot} onRemoveBot=', 'onAddBot=${addBot} onAddElite=${addElite} onRemoveBot=');
  edit(room, '<${AvatarFrame} size="xl" name=${seat.name} seat=${index}',
    '<${seat.isBot && ELITE_RECRUITS.some(p => p.id === seat.botPersona) ? EliteAvatar : AvatarFrame} persona=${seat.botPersona} size="xl" name=${seat.name} seat=${index}');
  if (modernHost(files)) edit(room, '<${AvatarFrame} size="sm" name=${seat.name} seat=${index}',
    '<${seat.isBot && ELITE_RECRUITS.some(p => p.id === seat.botPersona) ? EliteAvatar : AvatarFrame} persona=${seat.botPersona} size="sm" name=${seat.name} seat=${index}');
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
    for (const persona of personas) strings[persona.name] = persona.translations?.[lang.replace('.json', '')] || persona.name;
    out.set(file, JSON.stringify(pack, null, 2) + '\n');
  }
  const prep = 'server/match/match/prep.js', platform = 'server/match/match/platform.js';
  for (const path of [prep, platform]) out.set(path, "import { cancelForecastScopes } from '../aiCompute/scopes.js';\n" + out.get(path));
  out.set(prep, "import { aiAddon } from '../aiAddons/index.js';\n" + out.get(prep));
  edit(prep, '  scheduleBotPrep(ps, i = 0) {', `  scheduleBotPrep(ps, i = 0) {
    if (aiAddon(this, ps)?.PREPARE_LAST) {
      const round = this.round;
      const waiting = this.alivePlayers().some(p => p !== ps && p.botControlled && !p.ready && !aiAddon(this, p)?.PREPARE_LAST);
      if (waiting) { this.later(Math.max(5, this.scaled(25)), () => { if (this.phase === PHASE.PREP && this.round === round && ps.alive && !ps.ready) this.scheduleBotPrep(ps, i); }); return; }
    }`);
  edit(prep, '!r.done && !(', '!r.done && !ps._botCoopWorkerWaiting && !(');
  edit(prep, '  onReadyChanged(ps) {', '  onReadyChanged(ps) {\n    if (ps.ready) cancelForecastScopes(this, ps);');
  edit(prep, '  endPrep() {', '  endPrep() {\n    cancelForecastScopes(this);');
  edit(platform, '  dispose() {', '  dispose() {\n    cancelForecastScopes(this);');
  return out;
}

export const PATCH_PATHS = ['shared/protocol.js', 'server/lobby.js', 'server/match/bot.js',
  'server/match/match/phases.js', 'public/js/screens/room.js', 'server/match/match/prep.js', 'server/match/match/platform.js'];
