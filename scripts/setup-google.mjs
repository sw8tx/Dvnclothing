import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = 'dvnclothing';
const accountId = '19c22c3dff85cd28e6351907c5e70b9a';
const redirect = 'https://dvnclothing.com/api/auth/callback';
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
const wrangler = 'wrangler@4.165.0';

async function readGoogleClient(filename) {
  const realFile = await realpath(filename);
  const relative = path.relative(await realpath(root), realFile);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
    throw Error('Speichere die heruntergeladene Clientdatei außerhalb des Repositorys.');
  }
  const info = await stat(realFile);
  if (!info.isFile() || info.size > 65536) throw Error('Google-Web-Clientdatei ungültig.');
  let data;
  try { data = JSON.parse(await readFile(realFile, 'utf8')); }
  catch { throw Error('Die Google-Clientdatei muss gültiges JSON enthalten.'); }
  const client = data?.web;
  if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(client?.client_id)
    || typeof client?.client_secret !== 'string' || client.client_secret.trim().length < 12) {
    throw Error('Eine heruntergeladene Google-OAuth-Clientdatei vom Typ Webanwendung wird benötigt.');
  }
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirect)) {
    throw Error('Trage ' + redirect + ' in Google Auth Platform ein und lade die Clientdatei erneut herunter.');
  }
  return client;
}

function pagesSecret(command, secretInput) {
  // Both commands use fixed arguments. The client file and its secret never enter argv or stdout.
  const result = spawnSync(process.execPath, [npm, 'exec', '--yes', '--package=' + wrangler, '--',
    'wrangler', 'pages', 'secret', command, '--project-name', project, '--env', 'production'], {
    cwd: root, encoding: 'utf8', input: secretInput ?? '', shell: false,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, NO_COLOR: '1', FORCE_COLOR: '0',
      WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'info', WRANGLER_LOG_SANITIZE: 'true' },
  });
  if (result.error || result.status !== 0) {
    throw Error('Wrangler konnte die Produktions-Secrets für dvnclothing nicht ' +
      (command === 'list' ? 'auflisten.' : 'speichern.') +
      ' Prüfe die Cloudflare-Anmeldung, Pages-Schreibrechte und die Netzwerkverbindung.');
  }
  return result.stdout;
}

async function setup() {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length || !npm) throw Error('Aufruf: npm run setup:google -- "Pfad/zur/Google-Clientdatei.json"');
  const client = await readGoogleClient(file);
  const existing = pagesSecret('list');
  if (!existing.includes('environment of your Pages project') || !existing.includes(project)) {
    throw Error('Der Produktionsstatus ließ sich nicht eindeutig prüfen. Es wurde nichts geschrieben.');
  }
  if (/\b(?:GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|AUTH_COOKIE_SECRET)\b/.test(existing)) {
    throw Error('Es existieren bereits Login-Secrets. Diese Ersteinrichtung überschreibt sie nicht. Prüfe die vorhandenen Bindungen in Cloudflare Pages.');
  }
  pagesSecret('bulk', JSON.stringify({
    GOOGLE_CLIENT_ID: client.client_id,
    GOOGLE_CLIENT_SECRET: client.client_secret,
    AUTH_COOKIE_SECRET: randomBytes(48).toString('base64url'),
  }));
  console.log('Die drei Secrets sind in Cloudflare Pages gespeichert. Starte jetzt den letzten Produktionsbuild erneut und prüfe /api/auth/session.');
}

setup().catch(error => {
  console.error(error.code === 'ENOENT' ? 'Die Google-Clientdatei wurde nicht gefunden.' : error.message);
  process.exitCode = 1;
});
