// Build the released policy from this repository's complete source snapshot.
// No access to the former private repository or its Git objects is required.
import { readFileSync,writeFileSync,mkdirSync,copyFileSync } from 'node:fs';
import { resolve,dirname,posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const released=JSON.parse(readFileSync(resolve(repo,'catalog.json'),'utf8')).strategies.arturia;
const frozen=JSON.parse(readFileSync(resolve(repo,released.manifest),'utf8'));
export const POLICY_REF=frozen.policy;
export const UPSTREAM_REF=frozen.upstream;
const sha=x=>createHash('sha256').update(x).digest('hex');

export function build(output=resolve(repo,`dist/AI-Arturia-v${released.version}`), release=released) {
  const frozen=JSON.parse(readFileSync(resolve(repo,release.manifest),'utf8'));
  const root=resolve(output),files={},sources={},seen=new Set();
  if(root===here || root===repo)throw new Error('Build output must be a separate directory');
  const put=(name,text)=>{
    const f=resolve(root,name);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,text);files[name]=sha(text);
  };
  function policy(path) {
    if(seen.has(path))return;seen.add(path);
    const original=readFileSync(resolve(repo,release.sourceRoot,path),'utf8');
    sources[path]=sha(original);
    if(sources[path]!==frozen.sources[path])throw new Error(`Released source changed: ${path}. Create and validate a new release manifest first.`);
    const dest=`server/match/arturia/policy/${path}`;
    const text=original.replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g,(_,prefix,spec,suffix)=>{
      const dependency=posix.normalize(posix.join(posix.dirname(path),spec));
      const local=dependency.startsWith('server/match/bot');
      if(local)policy(dependency);
      const target=local?`server/match/arturia/policy/${dependency}`:dependency;
      let rel=posix.relative(posix.dirname(dest),target);if(!rel.startsWith('.'))rel='./'+rel;
      return prefix+rel+suffix;
    });
    put(`policy/${path}`,text);
  }
  policy('server/match/botDevelopment.js');
  put('runtime.js',readFileSync(release.runtime?resolve(repo,release.runtime):resolve(here,'runtime.js'),'utf8'));
  if(JSON.stringify(files)!==JSON.stringify(frozen.files))throw new Error('Frozen output hashes differ from the release');
  for(const name of ['install.mjs','patches.mjs','README.md','CHANGELOG.md','安装插件.bat','install-windows.ps1'])copyFileSync(resolve(here,name),resolve(root,name));
  copyFileSync(resolve(repo,'LICENSE'),resolve(root,'LICENSE'));
  writeFileSync(resolve(root,'addon.json'),JSON.stringify({...frozen,sources,files},null,2)+'\n');
  return {root,policyFiles:seen.size,policy:frozen.policy};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(build(process.argv[2]));
