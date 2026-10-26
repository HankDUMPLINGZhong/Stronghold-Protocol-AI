import fs from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const sha = x => createHash('sha256').update(x).digest('hex');
export function build(output = resolve(repo, 'dist/AI-Zumama-v0.1.0')) {
  const frozen = JSON.parse(fs.readFileSync(resolve(repo, 'releases/zumama-v0.1.0.json')));
  const files = {}, sources = {}, seen = new Set(), root = resolve(output);
  if (root === here || root === repo) throw new Error('Build output must be separate');
  const put = (name, bytes) => { fs.mkdirSync(dirname(resolve(root, name)), { recursive: true }); fs.writeFileSync(resolve(root, name), bytes); };
  function policy(p) {
    if (seen.has(p)) return; seen.add(p);
    const original = fs.readFileSync(resolve(repo, frozen.sourceRoot, p), 'utf8');
    sources[p] = sha(original); if (sources[p] !== frozen.sources[p]) throw new Error('Frozen source changed: ' + p);
    const dest = 'server/match/aiAddons/zumama/policy/' + p;
    const relative = target => { const rel = posix.relative(posix.dirname(dest), target); return rel.startsWith('.') ? rel : './' + rel; };
    let text = original.replace(/(\b(?:from|import)\s+['"])(\.[^'"]+)(['"])/g, (_, a, spec, b) => {
      const dep = posix.normalize(posix.join(posix.dirname(p), spec)), local = dep.startsWith('server/match/sargon/');
      if (local) policy(dep);
      return a + relative(local ? 'server/match/aiAddons/zumama/policy/' + dep : dep) + b;
    });
    const names = [];
    if (text.includes('m.newBattle(')) { text = text.replaceAll('m.newBattle(', 'createForecastBattle(m, '); names.push('createForecastBattle'); }
    const steps = /\b(trial\.battle|t\.battle|battle|b)\.step\(\)/g;
    if (steps.test(text)) { steps.lastIndex = 0; text = text.replace(steps, (_, b) => `stepForecastBattle(${b})`); names.push('stepForecastBattle'); }
    if (names.length) text = `import { ${names.join(', ')} } from '${relative('server/match/aiCompute/forecast.js')}';\n` + text;
    put('policy/' + p, text); files['policy/' + p] = sha(text);
  }
  for (const p of Object.values(frozen.entries)) policy(p);
  const runtime = fs.readFileSync(resolve(here, 'runtime.js'), 'utf8'); put('runtime.js', runtime); files['runtime.js'] = sha(runtime);
  if (JSON.stringify(files) !== JSON.stringify(frozen.files)) throw new Error('Frozen output hashes differ');
  const portableFiles = {}, shared = {};
  for (const name of ['install.mjs', 'patches.mjs', 'extended-host.mjs', 'legacy.mjs']) {
    const bytes = fs.readFileSync(resolve(here, '../shared', name)); put('common/' + name, bytes); portableFiles['common/' + name] = sha(bytes);
  }
  for (const name of ['install.mjs', 'README.md', 'CHANGELOG.md', '安装插件.bat', 'install-windows.ps1']) {
    const bytes = fs.readFileSync(resolve(here, name)); put(name, bytes); portableFiles[name] = sha(bytes);
  }
  const license = fs.readFileSync(resolve(repo, 'LICENSE')); put('LICENSE', license); portableFiles.LICENSE = sha(license);
  for (const name of Object.keys(frozen.sharedRuntime.files)) {
    const bytes = fs.readFileSync(resolve(here, '../shared/compute', name));
    if (sha(bytes) !== frozen.sharedRuntime.files[name]) throw new Error('Shared computation runtime changed: ' + name);
    put('compute/' + name, bytes); shared[name] = sha(bytes);
  }
  const meta = { ...frozen, sources, files, portableFiles, sharedRuntime: { ...frozen.sharedRuntime, files: shared } };
  put('addon.json', JSON.stringify(meta, null, 2) + '\n');
  return { root, policyFiles: seen.size, policy: frozen.policy };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(build(process.argv[2]));
