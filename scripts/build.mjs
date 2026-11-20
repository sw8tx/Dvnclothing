import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeMailViews } from './mail-views.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const pages = ['index.html', 'impressum.html', 'terms.html', 'privacy.html'];
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
// Use content-based URLs for styles and client code so each release loads matching assets.
const stylesheets = Array.from(html.matchAll(/\bhref="(\/(?!\/)[^"?#]+\.css)(?:[?#][^"]*)?"/g), match => match[1]);
const versionedAssets = new Map();
for (const source of new Set([...stylesheets, '/translations.js', '/i18n.js', '/auth.js', '/shop.js'])) {
  const bytes = await readFile(path.join(root, source));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const extension = path.extname(source);
  const versioned = source.slice(0, -extension.length) + '.' + hash + extension;
  const destination = path.join(output, versioned);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  // Keep the legal stylesheet available at its longstanding path. Its content
  // version still changes on every edit, without risking a cached SPA fallback
  // for a newly introduced filename during a deployment.
  versionedAssets.set(source, source === '/legal.css' ? `${source}?v=${hash}` : versioned);
}
for (const page of pages) {
  const dest = path.join(output, page);
  const markup = await readFile(dest, 'utf8');
  const rewritten = markup.replace(/\b(href|src)="(\/(?!\/)[^"?#]+)(?:[?#][^"]*)?"/g, (original, attribute, source) =>
    versionedAssets.has(source) ? attribute + '="' + versionedAssets.get(source) + '"' : original);
  await writeFile(dest, rewritten);
}
await writeMailViews(output);
console.log('Cloudflare Pages output ready in dist/');
