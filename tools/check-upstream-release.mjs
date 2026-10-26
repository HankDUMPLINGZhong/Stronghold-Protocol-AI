import fs from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const base='https://api.github.com/repos/sganggs/Stronghold-Protocol';
const headers={'Accept':'application/vnd.github+json','User-Agent':'stronghold-ai-release-check'};
if(process.env.GH_TOKEN)headers.Authorization='Bearer '+process.env.GH_TOKEN;
async function get(path){
  const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Upstream release check: HTTP ${response.status}`);
  return response.json();
}
const release=await get('/releases/latest');
const commit=await get('/commits/'+encodeURIComponent(release.tag_name));
const compatibility=JSON.parse(fs.readFileSync(resolve(import.meta.dirname,'../compatibility.json')));
assert.ok(compatibility.hosts.some(h=>h.ref===release.tag_name&&h.commit===commit.sha),
  `Upstream ${release.tag_name} (${commit.sha}) has not been verified: add its exact source and release-package regressions before publishing.`);
assert.ok(compatibility.requiredReleaseCiHosts.includes(commit.sha),'Latest upstream commit is missing from required release CI');
console.log(`Latest official upstream ${release.tag_name} (${commit.sha}) is covered by release CI.`);
