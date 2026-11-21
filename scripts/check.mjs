import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function scripts(directory, nested = true) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && nested) found.push(...await scripts(file));
    else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) found.push(file);
  }
  return found;
}
const files = [...await scripts(root, false)];
for (const directory of ['functions', 'scripts', 'tests']) files.push(...await scripts(path.join(root, directory)));
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (check.status !== 0 || check.error) process.exit(check.status || 1);
}
console.log(`Syntax checked ${files.length} application, server and test scripts.`);
