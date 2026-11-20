import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const references = [
  ...html.matchAll(/(?:src|href)="(\/[^"#?]*)"/g),
  ...css.matchAll(/url\("(\/[^"#?]*)"\)/g),
];
for (const [, reference] of references) {
  if (reference === '/') continue;
  const asset = await stat(path.join(root, reference));
  if (!asset.isFile()) throw new Error(`Missing file: ${reference}`);
}

// Only publish the site files, never repository metadata or local tooling.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'countdown.js', 'assets', '_headers']) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
console.log('Cloudflare Pages output ready in dist/');
