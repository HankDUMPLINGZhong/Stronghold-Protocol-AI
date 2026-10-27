import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
const bundle = dirname(fileURLToPath(import.meta.url));
export async function install(mode, directory, bundleDirectory) {
  const own = existsSync(resolve(bundle, 'common/install.mjs')) ? bundle : (await import('./build.mjs')).build().root;
  const actual = bundleDirectory ? resolve(bundleDirectory) : own;
  const { install: manage } = await import(pathToFileURL(resolve(own, 'common/install.mjs')));
  return manage(mode, directory, actual);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await install(process.argv[2], process.argv[3] || '.', process.argv[4]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
