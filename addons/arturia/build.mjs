import fs from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPersona} from '../shared/build.mjs';
import {build as buildLegacy} from './legacy-build.mjs';
const repo=resolve(import.meta.dirname,'../..'),released=JSON.parse(fs.readFileSync(resolve(repo,'catalog.json'))).strategies.arturia;
const frozen=JSON.parse(fs.readFileSync(resolve(repo,released.manifest)));
export const POLICY_REF=frozen.policy, UPSTREAM_REF=frozen.upstream;
export function build(output=resolve(repo,'dist/AI-Arturia-v'+released.version),release=released,options={}) {
  const meta=JSON.parse(fs.readFileSync(resolve(repo,release.manifest)));
  return meta.hostApi===1 && meta.compatibilityFix ? buildPersona('arturia',output,release,options) : buildLegacy(output,release);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(build(process.argv[2]));
