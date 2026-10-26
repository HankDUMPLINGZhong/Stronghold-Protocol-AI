import fs from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';

const repo = resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Release sources and scoring remain frozen; this layer only routes host APIs and packages installers.
export function buildPersona(id, output, release, { record = false } = {}) {
  const frozen = JSON.parse(fs.readFileSync(resolve(repo, release.manifest)));
  const root = resolve(output), here = resolve(repo, 'addons', id);
  if (root === here || root === repo) throw new Error('Build output must be separate');
  const mount = frozen.bridgeMount || `server/match/aiAddons/${id}`;
  const sources = {}, files = {}, seen = new Set();
  const put = (p, bytes) => {
    fs.mkdirSync(dirname(resolve(root, p)), { recursive: true });
    fs.writeFileSync(resolve(root, p), bytes);
  };
  const relative = (from, to) => {
    const p = posix.relative(posix.dirname(from), to);
    return p.startsWith('.') ? p : './' + p;
  };
  function policy(p) {
    if (seen.has(p)) return; seen.add(p);
    const original = fs.readFileSync(resolve(repo, frozen.sourceRoot, p), 'utf8');
    sources[p] = sha(original);
    if (sources[p] !== frozen.sources[p]) throw new Error('Frozen source changed: ' + p);
    const destination = `${mount}/policy/${p}`;
    let text = original.replace(/(\b(?:from|import)\s+['"])(\.[^'"]+)(['"])/g, (_, prefix, spec, suffix) => {
      const dependency = posix.normalize(posix.join(posix.dirname(p), spec));
      const local = id === 'zumama' ? dependency.startsWith('server/match/sargon/') : dependency.startsWith('server/match/bot');
      if (local) policy(dependency);
      const target = local ? `${mount}/policy/${dependency}`
        : dependency === 'server/sim/damage.js' ? `${mount}/compat/settlement.js` : dependency;
      return prefix + relative(destination, target) + suffix;
    });
    if (id === 'zumama') {
      const names = [];
      if (text.includes('m.newBattle(')) { text = text.replaceAll('m.newBattle(', 'createForecastBattle(m, '); names.push('createForecastBattle'); }
      const steps = /\b(trial\.battle|t\.battle|battle|b)\.step\(\)/g;
      if (steps.test(text)) { steps.lastIndex = 0; text = text.replace(steps, (_, b) => `stepForecastBattle(${b})`); names.push('stepForecastBattle'); }
      if (names.length) text = `import { ${names.join(', ')} } from '${relative(destination, 'server/match/aiCompute/forecast.js')}';\n` + text;
    }
    put('policy/' + p, text); files['policy/' + p] = sha(text);
  }
  for (const p of Object.values(frozen.entries || { main: 'server/match/botDevelopment.js' })) policy(p);
  const runtime = fs.readFileSync(resolve(here, 'runtime.js'));
  put('runtime.js', runtime); files['runtime.js'] = sha(runtime);
  const attack = relative(`${mount}/compat/settlement.js`, 'server/sim/attack.js');
  const damage = relative(`${mount}/compat/settlement.js`, 'server/sim/damage.js');
  // Only an absent public entry triggers fallback; broken transitive imports remain visible.
  const settlement = `// Use the host's public settlement API, preserving its damage rules.\n` +
    `let settlement;\ntry { settlement = await import('${attack}'); }\n` +
    `catch (error) {\n  if (error.code !== 'ERR_MODULE_NOT_FOUND' || error.url !== new URL('${attack}', import.meta.url).href) throw error;\n` +
    `  settlement = await import('${damage}');\n}\n` +
    `if (typeof settlement.mitigate !== 'function') throw new Error('Unsupported host settlement API');\nexport const mitigate = settlement.mitigate;\n`;
  put('compat/settlement.js', settlement); files['compat/settlement.js'] = sha(settlement);
  if (!record && JSON.stringify(files) !== JSON.stringify(frozen.files)) throw new Error('Frozen output hashes differ');
  const portableFiles = {}, shared = {};
  for (const name of ['install.mjs', 'patches.mjs', 'extended-host.mjs', 'legacy.mjs']) {
    const bytes = fs.readFileSync(resolve(repo, 'addons/shared', name));
    put('common/' + name, bytes); portableFiles['common/' + name] = sha(bytes);
  }
  for (const name of ['install.mjs', 'README.md', 'CHANGELOG.md', '安装插件.bat', 'install-windows.ps1']) {
    const bytes = fs.readFileSync(resolve(here, name)); put(name, bytes); portableFiles[name] = sha(bytes);
  }
  const license = fs.readFileSync(resolve(repo, 'LICENSE')); put('LICENSE', license); portableFiles.LICENSE = sha(license);
  for (const [name, expected] of Object.entries(frozen.sharedRuntime.files)) {
    const bytes = fs.readFileSync(resolve(repo, 'addons/shared/compute', name));
    if (sha(bytes) !== expected) throw new Error('Shared computation changed: ' + name);
    put('compute/' + name, bytes); shared[name] = sha(bytes);
  }
  const meta = { ...frozen, sources, files, portableFiles, sharedRuntime: { ...frozen.sharedRuntime, files: shared } };
  put('addon.json', JSON.stringify(meta, null, 2) + '\n');
  return { root, policyFiles: seen.size, policy: frozen.policy };
}
