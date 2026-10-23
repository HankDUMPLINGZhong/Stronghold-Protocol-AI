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

const UPGRADE = '.lavinia-addon/upgrade.json';
async function restoreUpgrade(root) {
  const path = await safePath(root, UPGRADE);
  const recovery = JSON.parse(await readFile(path, 'utf8'));
  for (const [name, bytes] of Object.entries(recovery.files)) {
    const target = await safePath(root, name);
    if (bytes == null) { if (await exists(target)) await unlink(target); }
    else await put(root, name, Buffer.from(bytes, 'base64'));
  }
  await put(root, '.lavinia-addon/install.json', Buffer.from(recovery.journal, 'base64'));
  await unlink(path);
}

function versionNumber(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unsupported installed version: ${version}`);
  return version.split('.').map(Number);
}
function compareVersion(a, b) {
  const x = versionNumber(a), y = versionNumber(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export async function install(mode, directory) {
  const root = resolve(directory), stateName = '.lavinia-addon/install.json';
  const statePath = await safePath(root, stateName);
  if (await exists(await safePath(root, UPGRADE))) {
    if (mode === 'check') throw new Error('Interrupted upgrade; run install to restore the previous version and retry.');
    await restoreUpgrade(root);
  }
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
  const meta = JSON.parse(await readFile(resolve(bundle, 'addon.json'), 'utf8'));
  const oldJournal = await exists(statePath) ? await readFile(statePath) : null;
  const old = oldJournal ? JSON.parse(oldJournal.toString('utf8')) : null;
  const previous = new Map();
  if (old) {
    if (compareVersion(meta.version, old.version) < 0) throw new Error(`Installed ${old.version} is newer; uninstall explicitly before downgrading.`);
    for (const [name, entry] of Object.entries(old.files)) {
      const path = await safePath(root, name), bytes = await exists(path) ? await readFile(path) : null;
      if (!bytes || hash(bytes) !== entry.after) throw new Error(`Changed since install; refusing to upgrade: ${name}. Preserve your changes or recover with the previous installer.`);
      previous.set(name, bytes);
    }
    if (meta.version === old.version) {
      if (meta.policy !== old.policy) throw new Error('Same version has different policy; refusing to replace a released version.');
      return mode === 'check' ? { compatible: true, alreadyInstalled: true, version: meta.version }
        : { installed: meta.version, alreadyInstalled: true, policy: meta.policy };
    }
  }
  // Plan against the original host bytes without uninstalling the running version first.
  const original = async name => {
    const path = await safePath(root, name);
    if (old && Object.hasOwn(old.files, name)) {
      const before = old.files[name].before;
      return before == null ? null : Buffer.from(before, 'base64');
    }
    return await exists(path) ? await readFile(path) : null;
  };
  const files = new Map();
  for (const name of PATCH_PATHS) files.set(name, (await original(name)).toString('utf8').replaceAll('\r\n', '\n'));
  for (const name of await readdir(inside(root, 'public/i18n'))) if (name.endsWith('.json')) {
    files.set(`public/i18n/${name}`, (await original(`public/i18n/${name}`)).toString('utf8'));
  }
  const patched = patchFiles(files);
  const changes = new Map();
  for (const [name, value] of patched) {
    const before = await original(name);
    // Keep the installation's line endings, including in the saved original bytes.
    const text = before.includes(Buffer.from('\r\n')) ? value.replaceAll('\n', '\r\n') : value;
    changes.set(name, { before: before.toString('base64'), bytes: Buffer.from(text) });
  }
  for (const [name, expected] of Object.entries(meta.files)) {
    const bytes = await readFile(await safePath(bundle, name));
    if (hash(bytes) !== expected) throw new Error(`Damaged bundle: ${name}`);
    const target = `server/match/lavinia/${name === 'runtime.js' ? 'index.js' : name}`;
    if (await original(target)) throw new Error(`Target already exists: ${target}`);
    changes.set(target, { before: null, bytes });
  }
  // Keep the complete portable installer in addons/, so players can remove the unpacked download.
  for (const name of [...Object.keys(meta.files), 'install.mjs', 'patches.mjs', 'addon.json', 'README.md', 'CHANGELOG.md', 'LICENSE', '安装插件.bat', 'install-windows.ps1']) {
    const bytes = await readFile(await safePath(bundle, name));
    const target = `addons/lavinia/${name}`;
    const before = await original(target);
    if (before && hash(before) !== hash(bytes)) throw new Error(`Addon directory contains another version: ${target}`);
    // If installing from addons/lavinia itself, leave its existing distribution intact on uninstall.
    if (!before) changes.set(target, { before: null, bytes });
  }
  const state = { version: meta.version, upstream: meta.upstream, policy: meta.policy, files: {} };
  for (const [name, change] of changes) state.files[name] = { before: change.before, after: hash(change.bytes) };
  if (mode === 'check') return { compatible: true, upstreamTested: meta.upstream, patched: patched.size, policyFiles: Object.keys(meta.files).length };
  if (old) {
    const writes = new Map();
    for (const [name, entry] of Object.entries(old.files)) if (!changes.has(name))
      writes.set(name, entry.before == null ? null : Buffer.from(entry.before, 'base64'));
    for (const [name, change] of changes) writes.set(name, change.bytes);
    for (const name of writes.keys()) if (!previous.has(name)) {
      const path = await safePath(root, name);
      previous.set(name, await exists(path) ? await readFile(path) : null);
    }
    // Persistent rollback also handles power loss: the next install restores this exact old installation first.
    await put(root, UPGRADE, JSON.stringify({ journal: oldJournal.toString('base64'),
      files: Object.fromEntries([...previous].map(([name, bytes]) => [name, bytes?.toString('base64') ?? null])) }) + '\n');
    try {
      await put(root, stateName, JSON.stringify(state, null, 2) + '\n');
      for (const [name, bytes] of writes) {
        if (bytes == null) { const path = await safePath(root, name); if (await exists(path)) await unlink(path); }
        else await put(root, name, bytes);
      }
      await unlink(await safePath(root, UPGRADE));
    } catch (error) {
      try { await restoreUpgrade(root); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Upgrade failed; rollback is incomplete. Keep .lavinia-addon/upgrade.json and retry with this installer.'); }
      throw error;
    }
    return { installed: meta.version, upgradedFrom: old.version, patched: patched.size, policy: meta.policy };
  }
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
