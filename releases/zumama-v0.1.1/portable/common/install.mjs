// Portable, transactional AI addon manager. One journal owns host hooks; each addon owns only its payload.
import { readFile, writeFile, mkdir, lstat, unlink, open } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { patchFiles, PATCH_PATHS, extraPatchPaths } from './patches.mjs';
import { legacyBundle, migrateLegacy } from './legacy.mjs';

const STATE = '.ai-addons/install.json', PENDING = '.ai-addons/transaction.json', LOCK = '.ai-addons/install.lock';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
async function safe(root, name) {
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Invalid relative path: ${name}`);
  for (let at = path; at !== root; at = dirname(at))
    if (await exists(at) && (await lstat(at)).isSymbolicLink()) throw new Error(`Refusing symlink: ${at}`);
  return path;
}
async function bytes(root, name) { const path = await safe(root, name); return await exists(path) ? readFile(path) : null; }
async function put(root, name, value) {
  const path = await safe(root, name);
  if (value == null) { if (await exists(path)) await unlink(path); return; }
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, value);
}
const encode = value => value?.toString('base64') ?? null;
const decode = value => value == null ? null : Buffer.from(value, 'base64');
function version(a, b) {
  for (const x of [a, b]) if (!/^\d+\.\d+\.\d+$/.test(x)) throw new Error(`Unsupported version: ${x}`);
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
function validate(meta) {
  const slug = /^[a-z][a-z0-9-]{0,47}$/;
  if (meta.hostApi !== 1 || !slug.test(meta.id) || !slug.test(meta.persona?.id)
    || typeof meta.persona.name !== 'string' || !meta.persona.name.length || meta.persona.name.length > 64
    || typeof meta.persona.band !== 'string' || !Array.isArray(meta.persona.difficulties)
    || meta.persona.difficulties.some(d => !['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].includes(d))
    || meta.sharedRuntime?.api !== 1 || !meta.files || !meta.sharedRuntime.files)
    throw new Error('Unsupported AI addon manifest/API');
  const nameOK = n => typeof n === 'string' && n.length < 1024 && !isAbsolute(n) && !/[\\:\0]/.test(n)
    && n.split('/').every(p => p && p !== '.' && p !== '..');
  for (const [name, digest] of Object.entries({ ...meta.files, ...meta.portableFiles }))
    if (!nameOK(name) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid addon file/hash: ' + name);
  for (const [name, digest] of Object.entries(meta.sharedRuntime.files))
    if (!/^[A-Za-z][A-Za-z0-9]*\.js$/.test(name) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid computation module/hash: ' + name);
  if (meta.bridgeMount && (!['arturia', 'lavinia'].includes(meta.persona.id) || meta.bridgeMount !== 'server/match/' + meta.persona.id))
    throw new Error('Invalid legacy mount');
  version(meta.version, meta.version); version(meta.sharedRuntime.version, meta.sharedRuntime.version);
}
async function loadBundle(bundle, current) {
  const meta = JSON.parse(await readFile(await safe(bundle, 'addon.json'), 'utf8'));
  if (!meta.hostApi) {
    const runtime = Object.values(current?.plugins || {})[0]?.meta.sharedRuntime;
    const bridged = await legacyBundle(bundle, meta, runtime, safe);
    bridged.shared = Object.values(current.plugins)[0].shared;
    return bridged;
  }
  validate(meta);
  const payload = {}, portable = {}, shared = {};
  const checked = async (name, expected) => {
    const value = await readFile(await safe(bundle, name));
    if (sha(value) !== expected) throw new Error(`Damaged bundle: ${name}`);
    return value;
  };
  for (const [name, hash] of Object.entries(meta.files)) payload[name] = encode(await checked(name, hash));
  for (const [name, hash] of Object.entries(meta.portableFiles || {})) portable[name] = encode(await checked(name, hash));
  for (const [name, hash] of Object.entries(meta.sharedRuntime.files)) shared[name] = encode(await checked('compute/' + name, hash));
  portable['addon.json'] = encode(Buffer.from(JSON.stringify(meta, null, 2) + '\n'));
  const manager = {};
  for (const name of ['install.mjs', 'patches.mjs', 'extended-host.mjs', 'legacy.mjs']) {
    const file = 'common/' + name;
    if (meta.portableFiles?.[file]) manager[name] = encode(await checked(file, meta.portableFiles[file]));
  }
  return { meta, payload, portable, shared, ...(Object.keys(manager).length ? { manager } : {}) };
}

function registry(plugins) {
  const list = Object.values(plugins).sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  const personas = list.map(p => p.meta.persona);
  if (new Set(personas.map(p => p.id)).size !== personas.length) throw new Error('Duplicate AI persona ID');
  const first = list[0];
  for (const p of list) {
    const a = p.meta.sharedRuntime, b = first.meta.sharedRuntime;
    if (a.api !== b.api || a.version !== b.version || Object.keys(a.files).length !== Object.keys(b.files).length
      || Object.entries(a.files).some(([name, hash]) => b.files[name] !== hash))
      throw new Error('Shared computation runtime differs; use compatible bundles before changing the shared runtime.');
  }
  const imports = list.map((p, i) => `import * as addon${i} from '${p.meta.bridgeMount ? '../' + p.meta.persona.id : './' + p.meta.persona.id}/index.js';`).join('\n');
  const entries = list.map((p, i) => `[${JSON.stringify(p.meta.persona.id)}, Object.freeze({...addon${i}, PRIORITY:${p.meta.persona.priority ?? 99}, PREPARE_LAST:${p.meta.persona.prepareLast === true},
    pickCard:(m,ps,...args)=>addon${i}.pickCard(policyMatch(m,ps),ps,...args),
    prepBegin:(m,ps)=>addon${i}.prepBegin(policyMatch(m,ps),ps),
    prepEnd:(m,ps,job)=>addon${i}.prepEnd(policyMatch(m,ps),ps,job)})]`).join(',');
  const source = `${imports}
import { COMPUTATION_OWNER } from '../aiCompute/identity.js';
const views = new WeakMap();
export function policyMatch(m, ps) {
  if (!m.poolGroups || m.poolGroups.length < 2) return m;
  if (!views.has(ps)) views.set(ps,new Proxy(m,{
    get(target,key) {
      if (key === 'pool') return ps.pool;
      if (key === 'itemPool') return target.itemPoolFor(ps.playerId);
      if (key === COMPUTATION_OWNER) return target;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },set:(target,key,value)=>Reflect.set(target,key,value,target),
  }));
  return views.get(ps);
}
const entries = new Map([${entries}]);
export function aiAddon(m, ps) {
  if (!ps?.isBot) return null;
  const seat = m.opts?.seats?.find(s => s.playerId === ps.playerId && s.isBot);
  const addon = entries.get(seat?.botPersona);
  if (addon && !m[COMPUTATION_OWNER]) Object.defineProperty(m, COMPUTATION_OWNER, { value: m });
  return addon || null;
}
// Modern hosts may select adaptive/custom adapters. Named seats always own their hooks;
// every ordinary seat retains the selected adapter and its exact arguments/RNG behavior.
export function withAIAddons(base) {
  return Object.freeze({ ...base,
    pickBand:(m,ps,...args)=>aiAddon(m,ps)?.BAND ?? base.pickBand(m,ps,...args),
    pickCard:(m,ps,...args)=>{const a=aiAddon(m,ps);return a?a.pickCard(m,ps,...args):base.pickCard(m,ps,...args);},
    prepBegin:(m,ps,...args)=>{const a=aiAddon(m,ps);return a?a.prepBegin(m,ps,...args):base.prepBegin(m,ps,...args);},
    prepEnd:(m,ps,...args)=>{const a=aiAddon(m,ps);return a?a.prepEnd(m,ps,...args):base.prepEnd(m,ps,...args);},
    decide:(m,ps,...args)=>aiAddon(m,ps)?false:(base.decide?.(m,ps,...args) ?? false),
  });
}
`;
  return { personas, source, shared: first?.shared };
}

async function recover(root) {
  const value = await bytes(root, PENDING); if (!value) return;
  const pending = JSON.parse(value);
  for (const [name, data] of Object.entries(pending.files)) await put(root, name, decode(data));
  await put(root, PENDING, null);
}

/** check never writes. Install/uninstall serialize across every plugin and recover interrupted transactions. */
export async function install(mode, directory, bundle, { onWrite } = {}) {
  if (!['check', 'install', 'uninstall'].includes(mode)) throw new Error('Usage: install|check|uninstall <game-directory>');
  const root = resolve(directory);
  if (mode === 'check' && await bytes(root, PENDING)) throw new Error('Interrupted addon transaction; run install to recover.');
  let lock;
  if (mode !== 'check') {
    const path = await safe(root, LOCK); await mkdir(dirname(path), { recursive: true });
    try { lock = await open(path, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid;
      try { pid = JSON.parse(await readFile(path, 'utf8')).pid; } catch {}
      let stale = false;
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (error) { stale = error.code === 'ESRCH'; }
      }
      if (!stale) throw new Error('Another AI addon installer is active.');
      await unlink(path); lock = await open(path, 'wx');
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
  }
  try {
    if (mode !== 'check') await recover(root);
    const currentBytes = await bytes(root, STATE), old = currentBytes ? JSON.parse(currentBytes) : null;
    const incoming = await loadBundle(resolve(bundle), old);
    if (old && old.api !== 1) throw new Error('Unsupported installed AI host API');
    for (const [name, entry] of Object.entries(old?.files || {})) {
      const value = await bytes(root, name);
      if ((value == null ? null : sha(value)) !== entry.after) throw new Error(`Changed since install; refusing to overwrite: ${name}`);
    }
    const migrated = old ? null : await migrateLegacy(root, incoming, bytes, safe);
    const plugins = { ...(old?.plugins || migrated?.plugins) }, id = incoming.meta.id, previous = plugins[id];
    if (mode === 'uninstall') {
      if (!previous) return { uninstalled: false, alreadyRemoved: true };
      delete plugins[id];
    } else {
      if (previous && version(incoming.meta.version, previous.meta.version) < 0) throw new Error(`Installed ${previous.meta.version} is newer`);
      if (previous && incoming.meta.version === previous.meta.version) {
        if (JSON.stringify(incoming) !== JSON.stringify(previous)) throw new Error('Same version has different contents; refusing to replace it.');
        return mode === 'check' ? { compatible: true, alreadyInstalled: true } : { installed: incoming.meta.version, alreadyInstalled: true };
      }
      plugins[id] = incoming;
    }
    const base = { ...(old?.base || migrated?.base) };
    const legacyBytes = migrated;
    const manager = incoming.manager || old?.manager;
    const original = async name => {
      if (!Object.hasOwn(base, name)) base[name] = encode(await bytes(root, name));
      return decode(base[name]);
    };
    const desired = new Map(), list = Object.values(plugins);
    if (list.length) {
      const { personas, source, shared } = registry(plugins), host = new Map();
      for (const name of PATCH_PATHS) {
        const value = await original(name); if (!value) throw new Error(`Missing host file: ${name}`);
        host.set(name, value.toString('utf8').replaceAll('\r\n', '\n'));
      }
      for (const name of extraPatchPaths(host)) {
        const value = await original(name); if (!value) throw new Error('Missing host file: ' + name);
        host.set(name, value.toString('utf8').replaceAll('\r\n', '\n'));
      }
      // Read the actual packs, including languages added by the installation.
      const { readdir } = await import('node:fs/promises');
      for (const name of await readdir(await safe(root, 'public/i18n'))) if (name.endsWith('.json'))
        host.set('public/i18n/' + name, (await original('public/i18n/' + name)).toString('utf8'));
      for (const [name, text] of patchFiles(host, personas)) {
        const value = await original(name);
        desired.set(name, Buffer.from(value?.includes(Buffer.from('\r\n')) ? text.replaceAll('\n', '\r\n') : text));
      }
      desired.set('shared/aiAddons.js', Buffer.from('export const ELITE_RECRUITS = Object.freeze(' + JSON.stringify(personas) + ');\n'));
      desired.set('server/match/aiAddons/index.js', Buffer.from(source));
      if (!manager) throw new Error('Missing shared host manager');
      for (const [name, value] of Object.entries(manager))
        desired.set('server/match/aiAddons/' + (name === 'install.mjs' ? 'manage.mjs' : name), decode(value));
      for (const [name, value] of Object.entries(shared)) desired.set('server/match/aiCompute/' + name, decode(value));
      for (const p of list) {
        const folder = p.meta.persona.id;
        for (const [name, value] of Object.entries(p.payload))
          desired.set(`${p.meta.bridgeMount || 'server/match/aiAddons/' + folder}/${name === 'runtime.js' ? 'index.js' : name}`, decode(value));
        for (const [name, value] of Object.entries({ ...p.payload, ...p.portable })) desired.set(`addons/${folder}/${name}`, decode(value));
        for (const [name, value] of Object.entries(p.shared)) desired.set(`addons/${folder}/compute/${name}`, decode(value));
      }
    }
    for (const name of desired.keys()) {
      const value = await original(name);
      if (!old?.files[name] && !legacyBytes && value && !PATCH_PATHS.includes(name) && !['server/match/rewind.js','server/match/Match.js'].includes(name) && !name.startsWith('public/i18n/')
        && !(name.startsWith('addons/') && sha(value) === sha(desired.get(name))))
        throw new Error(`Target already exists: ${name}`);
    }
    const writes = new Map();
    for (const [name, value] of Object.entries(base)) writes.set(name, desired.has(name) ? desired.get(name) : decode(value));
    const state = { api: 1, plugins, base, files: {}, manager };
    for (const [name, value] of writes) state.files[name] = { after: value == null ? null : sha(value) };
    writes.set(STATE, list.length ? Buffer.from(JSON.stringify(state, null, 2) + '\n') : null);
    if (mode === 'check') return { compatible: true, plugins: list.map(p => p.meta.id), sharedRuntime: 1 };
    const snapshot = {};
    for (const name of writes.keys()) snapshot[name] = encode(await bytes(root, name));
    await put(root, PENDING, JSON.stringify({ files: snapshot }) + '\n');
    try {
      for (const [name, value] of writes) { await onWrite?.(name); await put(root, name, value); }
      await put(root, PENDING, null);
    } catch (error) {
      try { await recover(root); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Addon change failed; keep transaction.json and retry to recover.'); }
      throw error;
    }
    return mode === 'uninstall' ? { uninstalled: id, remaining: list.map(p => p.meta.id) }
      : { installed: incoming.meta.version, upgradedFrom: previous?.meta.version, plugins: list.map(p => p.meta.id) };
  } finally {
    if (lock) { await lock.close(); await put(root, LOCK, null); }
  }
}
