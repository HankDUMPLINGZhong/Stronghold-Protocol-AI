import { readFile, writeFile, mkdir, readdir, lstat, unlink } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { patchFiles, PATCH_PATHS } from './patches.mjs';

const bundle = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function inside(root, name) {
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Invalid relative path: ${name}`);
  return path;
}
async function safePath(root, name) {
  const path = inside(root, name);
  let at = path;
  while (at !== root) {
    if (await exists(at) && (await lstat(at)).isSymbolicLink()) throw new Error(`Refusing symlink: ${at}`);
    at = dirname(at);
  }
  return path;
}
async function put(root, name, bytes) {
  const path = await safePath(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function install(mode, directory) {
  const root = resolve(directory), stateName = '.arturia-addon/install.json';
  const statePath = await safePath(root, stateName);
  if (mode === 'uninstall') {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    // Check everything before restoring anything. An upstream update must never be overwritten.
    for (const [name, entry] of Object.entries(state.files)) {
      const path = await safePath(root, name);
      const current = await exists(path) ? await readFile(path) : null;
      if (current && hash(current) !== entry.after && (entry.before == null || hash(current) !== hash(Buffer.from(entry.before, 'base64'))))
        throw new Error(`Changed since install; refusing to overwrite: ${name}. Preserve your changes before uninstalling.`);
    }
    for (const [name, entry] of Object.entries(state.files)) {
      if (entry.before != null) await put(root, name, Buffer.from(entry.before, 'base64'));
      else { const path = await safePath(root, name); if (await exists(path)) await unlink(path); }
    }
    await unlink(statePath);
    return { restored: Object.keys(state.files).length };
  }
  if (!['check', 'install'].includes(mode)) throw new Error('Usage: node install.mjs check|install|uninstall <game-directory>');
  if (await exists(statePath)) throw new Error('Already installed (or an interrupted install); use uninstall first.');
  const meta = JSON.parse(await readFile(resolve(bundle, 'addon.json'), 'utf8'));
  const files = new Map();
  for (const name of PATCH_PATHS) files.set(name, (await readFile(await safePath(root, name), 'utf8')).replaceAll('\r\n', '\n'));
  for (const name of await readdir(inside(root, 'public/i18n'))) if (name.endsWith('.json')) {
    files.set(`public/i18n/${name}`, await readFile(await safePath(root, `public/i18n/${name}`), 'utf8'));
  }
  const patched = patchFiles(files);
  const changes = new Map();
  for (const [name, value] of patched) {
    const original = await readFile(await safePath(root, name));
    // Keep the installation's line endings, including in the saved original bytes.
    const text = original.includes(Buffer.from('\r\n')) ? value.replaceAll('\n', '\r\n') : value;
    changes.set(name, { before: original.toString('base64'), bytes: Buffer.from(text) });
  }
  for (const [name, expected] of Object.entries(meta.files)) {
    const bytes = await readFile(await safePath(bundle, name));
    if (hash(bytes) !== expected) throw new Error(`Damaged bundle: ${name}`);
    const target = `server/match/arturia/${name === 'runtime.js' ? 'index.js' : name}`;
    if (await exists(await safePath(root, target))) throw new Error(`Target already exists: ${target}`);
    changes.set(target, { before: null, bytes });
  }
  // Keep the complete portable installer in addons/, so players can remove the unpacked download.
  for (const name of [...Object.keys(meta.files), 'install.mjs', 'patches.mjs', 'addon.json', 'README.md', 'LICENSE', '安装插件.bat', 'install-windows.ps1']) {
    const bytes = await readFile(await safePath(bundle, name));
    const target = `addons/arturia/${name}`, path = await safePath(root, target);
    const before = await exists(path) ? await readFile(path) : null;
    if (before && hash(before) !== hash(bytes)) throw new Error(`Addon directory contains another version: ${target}`);
    // If installing from addons/arturia itself, leave its existing distribution intact on uninstall.
    if (!before) changes.set(target, { before: null, bytes });
  }
  const state = { version: meta.version, upstream: meta.upstream, policy: meta.policy, files: {} };
  for (const [name, change] of changes) state.files[name] = { before: change.before, after: hash(change.bytes) };
  if (mode === 'check') return { compatible: true, upstreamTested: meta.upstream, patched: patched.size, policyFiles: Object.keys(meta.files).length };
  // Save the recovery journal first; uninstall also recovers an interrupted install.
  await put(root, stateName, JSON.stringify(state, null, 2) + '\n');
  try {
    for (const [name, change] of changes) await put(root, name, change.bytes);
  } catch (e) {
    await install('uninstall', root);
    throw e;
  }
  return { installed: meta.version, patched: patched.size, policy: meta.policy };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await install(process.argv[2], process.argv[3] || '.'), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
