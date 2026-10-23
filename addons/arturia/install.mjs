import { readFile, writeFile, mkdir, readdir, lstat, unlink, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { patchFiles, PATCH_PATHS, extraPatchPaths } from './patches.mjs';

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

const UPGRADE = '.arturia-addon/upgrade.json';
async function restoreUpgrade(root) {
  const path = await safePath(root, UPGRADE);
  const recovery = JSON.parse(await readFile(path, 'utf8'));
  for (const [name, bytes] of Object.entries(recovery.files)) {
    const target = await safePath(root, name);
    if (bytes == null) { if (await exists(target)) await unlink(target); }
    else await put(root, name, Buffer.from(bytes, 'base64'));
  }
  await put(root, '.arturia-addon/install.json', Buffer.from(recovery.journal, 'base64'));
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

const COEXIST = '.arturia-addon/coexist-upgrade.json';
async function restoreCoexist(root) {
  const recovery = JSON.parse(await readFile(await safePath(root, COEXIST), 'utf8'));
  for (const [name, bytes] of Object.entries(recovery.files)) {
    if (bytes != null) await put(root, name, Buffer.from(bytes, 'base64'));
    else { const path = await safePath(root, name); if (await exists(path)) await unlink(path); }
  }
  await unlink(await safePath(root, COEXIST));
}

// Plan the complete layered installation in a temporary host before touching the real one.
// Reinstalling the exact companion rebases its original-byte journal onto the new Arturia.
async function installWithLavinia(mode, root) {
  if (await exists(await safePath(root, '.lavinia-addon/upgrade.json')))
    throw new Error('Interrupted Lavinia upgrade; recover it with the Lavinia installer first.');
  const companionState = '.lavinia-addon/install.json', ownState = '.arturia-addon/install.json';
  const companion = JSON.parse(await readFile(await safePath(root, companionState), 'utf8'));
  const own = await exists(await safePath(root, ownState))
    ? JSON.parse(await readFile(await safePath(root, ownState), 'utf8')) : null;
  const names = new Set([companionState, ownState, ...PATCH_PATHS,
    ...Object.keys(companion.files), ...Object.keys(own?.files || {})]);
  // Include optional host integration files before staging either standalone installer.
  if (await exists(await safePath(root, 'server/match/rewind.js'))) names.add('server/match/rewind.js');
  for (const name of await readdir(await safePath(root, 'public/i18n')))
    if (name.endsWith('.json')) names.add(`public/i18n/${name}`);
  for (const addon of ['arturia', 'lavinia']) {
    const directory = await safePath(root, `addons/${addon}`);
    if (await exists(directory)) for (const name of await readdir(directory, { recursive: true })) {
      const relativeName = `addons/${addon}/${name}`.replaceAll('\\', '/');
      if ((await lstat(await safePath(root, relativeName))).isFile()) names.add(relativeName);
    }
  }
  const before = new Map();
  for (const name of names) {
    const path = await safePath(root, name);
    before.set(name, await exists(path) ? await readFile(path) : null);
  }
  for (const [name, entry] of Object.entries(companion.files))
    if (!before.get(name) || hash(before.get(name)) !== entry.after)
      throw new Error(`Changed since install; refusing companion upgrade: ${name}`);
  const temp = await mkdtemp(resolve(tmpdir(), 'arturia-coexist-'));
  try {
    const staged = resolve(temp, 'game'), preserved = resolve(temp, 'lavinia');
    await mkdir(staged); await mkdir(preserved);
    for (const [name, bytes] of before) if (bytes != null) await put(staged, name, bytes);
    // Preserve the installed distribution before its staged uninstall removes addons/lavinia.
    for (const name of await readdir(await safePath(root, 'addons/lavinia'), { recursive: true })) {
      const path = await safePath(root, `addons/lavinia/${name}`);
      if ((await lstat(path)).isFile()) await put(preserved, name, await readFile(path));
    }
    const lavinia = await import(pathToFileURL(resolve(preserved, 'install.mjs')));
    await lavinia.install('uninstall', staged);
    const result = await install('install', staged);
    await lavinia.install('install', staged);
    await lavinia.install('check', staged);
    for (const state of [ownState, companionState]) {
      const journal = JSON.parse(await readFile(await safePath(staged, state), 'utf8'));
      for (const name of Object.keys(journal.files)) names.add(name);
    }
    const writes = new Map();
    for (const name of names) {
      const path = await safePath(staged, name), bytes = await exists(path) ? await readFile(path) : null;
      if (!before.has(name)) {
        const current = await safePath(root, name);
        if (await exists(current)) throw new Error(`Target already exists: ${name}`);
        before.set(name, null);
      }
      if (!Buffer.from(before.get(name) || []).equals(Buffer.from(bytes || []))
        || (before.get(name) == null) !== (bytes == null)) writes.set(name, bytes);
    }
    if (mode === 'check') return { compatible: true, version: result.installed, companionPreserved: companion.version };
    if (!writes.size) return { ...result, companionPreserved: companion.version };
    for (const [name, bytes] of before) {
      const path = await safePath(root, name), current = await exists(path) ? await readFile(path) : null;
      if ((current == null) !== (bytes == null) || (current && !current.equals(bytes)))
        throw new Error(`Changed during upgrade planning: ${name}`);
    }
    // Both journals and every changed file roll back together, including after process interruption.
    await put(root, COEXIST, JSON.stringify({ files: Object.fromEntries([...before]
      .map(([name, bytes]) => [name, bytes?.toString('base64') ?? null])) }) + '\n');
    try {
      for (const [name, bytes] of writes.entries()) {
        if (bytes == null) { const path = await safePath(root, name); if (await exists(path)) await unlink(path); }
        else await put(root, name, bytes);
      }
      await unlink(await safePath(root, COEXIST));
    } catch (error) {
      try { await restoreCoexist(root); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Coexistence upgrade failed; keep .arturia-addon/coexist-upgrade.json and retry with this installer.'); }
      throw error;
    }
    return { ...result, companionPreserved: companion.version };
  } finally {
    // temp is the absolute directory returned by mkdtemp, outside the installation.
    if (relative(resolve(tmpdir()), temp).startsWith('arturia-coexist-')) await rm(temp, { recursive: true, force: true });
  }
}

export async function install(mode, directory) {
  const root = resolve(directory), stateName = '.arturia-addon/install.json';
  const statePath = await safePath(root, stateName);
  if (await exists(await safePath(root, COEXIST))) {
    if (mode === 'check') throw new Error('Interrupted coexistence upgrade; run install to restore both plugins and retry.');
    await restoreCoexist(root);
  }
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
  if (await exists(await safePath(root, '.lavinia-addon/install.json'))) return installWithLavinia(mode, root);
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
  for (const name of extraPatchPaths(files)) files.set(name, (await original(name)).toString('utf8').replaceAll('\r\n', '\n'));
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
    const target = `server/match/arturia/${name === 'runtime.js' ? 'index.js' : name}`;
    if (await original(target)) throw new Error(`Target already exists: ${target}`);
    changes.set(target, { before: null, bytes });
  }
  // Keep the complete portable installer in addons/, so players can remove the unpacked download.
  for (const name of [...Object.keys(meta.files), 'install.mjs', 'patches.mjs', 'extended-host.mjs', 'addon.json', 'README.md', 'CHANGELOG.md', 'LICENSE', '安装插件.bat', 'install-windows.ps1']) {
    const bytes = await readFile(await safePath(bundle, name));
    const target = `addons/arturia/${name}`;
    const before = await original(target);
    if (before && hash(before) !== hash(bytes)) throw new Error(`Addon directory contains another version: ${target}`);
    // If installing from addons/arturia itself, leave its existing distribution intact on uninstall.
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
      catch (rollback) { throw new AggregateError([error, rollback], 'Upgrade failed; rollback is incomplete. Keep .arturia-addon/upgrade.json and retry with this installer.'); }
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
