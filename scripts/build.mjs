import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const pages = ['index.html', 'impressum.html', 'terms.html'];
const html = (await Promise.all(pages.map((file) => readFile(path.join(root, file), 'utf8')))).join('\n');
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
for (const file of [...pages, 'styles.css', 'hero.css', 'footer.css', 'legal.css', 'shop.css', 'shop.js', 'countdown.js', 'translations.js', 'i18n.js', 'auth.js', 'assets', '_headers']) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
// Publish the dictionary and renderer under content-based URLs so cached versions cannot mix.
const scripts = new Map();
for (const name of ['translations', 'i18n']) {
  const bytes = await readFile(path.join(root, name + '.js'));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const versioned = name + '.' + hash + '.js';
  await writeFile(path.join(output, versioned), bytes);
  scripts.set('/' + name + '.js', '/' + versioned);
}
for (const page of pages) {
  const dest = path.join(output, page);
  let markup = await readFile(dest, 'utf8');
  for (const [source, versioned] of scripts) {
    markup = markup.replace('src="' + source + '"', 'src="' + versioned + '"');
  }
  await writeFile(dest, markup);
}
console.log('Cloudflare Pages output ready in dist/');
