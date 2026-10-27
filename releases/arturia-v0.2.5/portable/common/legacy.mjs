// Bridge existing released policies without rewriting their source, runtime or version.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const sha = b => createHash('sha256').update(b).digest('hex');
const encode = b => b.toString('base64');
const identities = {
  'ai-arturia': { id: 'arturia', name: '阿尔图罗', band: 'band_paganini', avatar: 'char_245_cello', priority: 0,
    translations: { en: 'Arturia', ja: 'アルトリア', ko: '아르투리아', 'zh-TW': '阿爾圖羅' } },
  'ai-lavinia': { id: 'lavinia', name: '拉维妮娅', band: 'band_chiave', avatar: 'char_4065_judge', priority: 1,
    translations: { en: 'Lavinia', ja: 'ラヴィニア', ko: '라비니아', 'zh-TW': '拉維妮婭' } },
};
export function bridgeInstaller() {
  return `import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install as manage } from '../../server/match/aiAddons/manage.mjs';
const bundle = dirname(fileURLToPath(import.meta.url));
export const install = (mode, directory) => manage(mode, directory, bundle);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await install(process.argv[2], process.argv[3] || '.'), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
`;
}
export async function legacyBundle(bundle, original, sharedRuntime, safe) {
  const persona = identities[original.id];
  if (!persona || !sharedRuntime) throw new Error('Unsupported legacy addon; install Zumama first to provide the shared host manager.');
  const payload = {}, portable = {};
  for (const [name, hash] of Object.entries(original.files)) {
    const b = await readFile(await safe(bundle, name));
    if (sha(b) !== hash) throw new Error('Damaged legacy policy: ' + name);
    payload[name] = encode(b);
  }
  const portableFiles = {};
  for (const name of ['patches.mjs', 'extended-host.mjs', 'README.md', 'CHANGELOG.md', 'LICENSE', '安装插件.bat', 'install-windows.ps1']) {
    let b;
    try { b = await readFile(await safe(bundle, name)); }
    catch (error) { if (name === 'extended-host.mjs' && error.code === 'ENOENT') continue; throw error; }
    portable[name] = encode(b); portableFiles[name] = sha(b);
  }
  const shim = Buffer.from(bridgeInstaller()); portable['install.mjs'] = encode(shim); portableFiles['install.mjs'] = sha(shim);
  const meta = { ...original, hostApi: 1, persona: { ...persona, e2: true, difficulties: ['NORMAL', 'HARD', 'ABYSS'] },
    bridgeMount: 'server/match/' + persona.id, sharedRuntime, portableFiles };
  portable['addon.json'] = encode(Buffer.from(JSON.stringify(meta, null, 2) + '\n'));
  return { meta, payload, portable, shared: null };
}
export async function migrateLegacy(root, incoming, bytes, safe) {
  const journals = {};
  for (const id of ['arturia', 'lavinia']) {
    const b = await bytes(root, '.' + id + '-addon/install.json');
    if (b) journals[id] = JSON.parse(b);
  }
  if (!Object.keys(journals).length) return null;
  const final = Object.assign({}, ...Object.values(journals).map(j => j.files));
  for (const [name, entry] of Object.entries(final)) {
    const b = await bytes(root, name);
    if (!b || sha(b) !== entry.after) throw new Error('Changed legacy installation: ' + name);
  }
  const base = {}, plugins = {};
  // Reverse overlay order: Arturia's original host takes precedence over Lavinia's layer.
  for (const id of ['lavinia', 'arturia']) if (journals[id]) {
    for (const [name, entry] of Object.entries(journals[id].files)) base[name] = entry.before;
    base['.' + id + '-addon/install.json'] = null;
    const bundle = resolve(root, 'addons', id), meta = JSON.parse(await readFile(await safe(bundle, 'addon.json'), 'utf8'));
    if (meta.version !== journals[id].version || meta.policy !== journals[id].policy) throw new Error('Legacy addon metadata disagrees with its journal');
    const p = await legacyBundle(bundle, meta, incoming.meta.sharedRuntime, safe);
    p.shared = incoming.shared; plugins[p.meta.id] = p;
  }
  return { base, plugins };
}
