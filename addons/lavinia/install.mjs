import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
const bundle = dirname(fileURLToPath(import.meta.url));
export async function install(mode, directory) {
  const actual = existsSync(resolve(bundle, 'common/install.mjs')) ? bundle : (await import('./build.mjs')).build().root;
  const { install: manage } = await import(pathToFileURL(resolve(actual, 'common/install.mjs')));
  return manage(mode, directory, actual);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await install(process.argv[2], process.argv[3] || '.'), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
