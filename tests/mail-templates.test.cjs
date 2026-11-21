const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const site = 'https://dvnclothing.com';
const root = path.join(__dirname, '..');
let workspace;
let build;
let signInMessage;
let bonusMessage;

before(async () => {
  // Run the deploy build in isolation so a test cannot overwrite an existing build.
  workspace = mkdtempSync(path.join(tmpdir(), 'dvn-mail-test-'));
  const inputs = readdirSync(root).filter(name => /\.(?:html|css|js)$/.test(name) ||
    ['_headers', '_redirects', '_routes.json', 'package.json', 'catalog.json', 'scripts', 'functions', 'assets'].includes(name));
  for (const input of inputs) cpSync(path.join(root, input), path.join(workspace, input), { recursive: true });
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: workspace, stdio: 'pipe' });
  build = path.join(workspace, 'dist');
  ({ signInMessage } = await import('../functions/api/auth/email/_message.js'));
  ({ bonusMessage } = await import('../functions/api/account/_bonus-message.js'));
});
after(() => { if (workspace) rmSync(workspace, { recursive: true, force: true }); });

function visibleText(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function urls(message) {
  return [
    ...Array.from(message.html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi), match => match[1]),
    ...(message.text.match(/https?:\/\/[^\s<>()]+/g) || []),
  ];
}

const cases = [
  {
    type: 'login', codes: ['010834', '692031'],
    render: (code, language) => signInMessage(code, language, 600),
    display: code => 'DVN-' + code,
  },
  {
    type: 'bonus', codes: ['DVN-A3CD-EFGH-JKLM-NPQR-STUV', 'DVN-ZYXW-VUTS-RQPN-MLKJ-HGFE'],
    render: (code, language) => bonusMessage(code, 15, language),
    display: code => code,
  },
];

for (const variant of cases) {
  for (const language of ['de', 'en']) {
    test(variant.type + ' ' + language + ' links to a published, code-free browser view', () => {
      const [first, second] = variant.codes.map(code => variant.render(code, language));
      const display = variant.display(variant.codes[0]);
      const browserUrl = site + '/mail/' + variant.type + '/' + language;
      const alternate = language === 'de' ? 'en' : 'de';
      assert.match(first.html, new RegExp('<html\\b[^>]*\\blang=["\']' + language + '["\']', 'i'));
      assert.equal(first.text.split(display).length - 1, 1);
      assert.equal(visibleText(first.html).split(display).length - 1, 1);
      assert.ok(!first.subject.includes(variant.codes[0]));
      assert.equal(first.subject, second.subject);
      const fallbackLinks = Array.from(first.html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi), match => match[1]);
      for (const locale of [language, alternate]) {
        const target = site + '/mail/' + variant.type + '/' + locale;
        assert.ok(fallbackLinks.includes(target));
        assert.ok(first.text.includes(target));
      }
      const radioInputs = first.html.match(/<input\b[^>]*>/gi) || [];
      const selected = radioInputs.filter(input => /\bchecked\b/i.test(input));
      assert.equal(selected.length, 1);
      assert.ok(selected[0].includes('id="dvn-lang-' + language + '"'));
      for (const locale of [language, alternate]) {
        const blocks = Array.from(first.html.matchAll(/<div\b[^>]*\blang="([^"]+)"[^>]*>/gi))
          .filter(match => match[1] === locale);
        assert.ok(blocks.length > 0);
        for (const [tag] of blocks) {
          assert.equal(/display:\s*none/i.test(tag), locale === alternate, 'inline copy fallback when CSS is unavailable');
        }
      }
      assert.deepEqual(urls(first), urls(second), 'mail URLs must be independent of private codes');
      for (const url of urls(first)) assert.ok(!url.includes(variant.codes[0]));

      const images = Array.from(first.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi), match => match[1]);
      assert.ok(images.length > 0);
      for (const source of images) {
        const imageUrl = new URL(source);
        assert.equal(imageUrl.origin, site);
        assert.ok(existsSync(path.join(build, imageUrl.pathname)), 'unpublished mail image ' + imageUrl.pathname);
      }

      const browserPage = readFileSync(path.join(build, new URL(browserUrl).pathname + '.html'), 'utf8');
      assert.match(browserPage, new RegExp('<html\\b[^>]*\\blang=["\']' + language + '["\']', 'i'));
      const copy = visibleText(browserPage);
      const navigation = browserPage.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
      assert.ok(navigation);
      for (const locale of [language, alternate]) {
        assert.ok(navigation.includes('href="/mail/' + variant.type + '/' + locale + '"'));
      }
      assert.match(copy, language === 'de' ? /E-Mail|Postfach/i : /email|e-mail|inbox/i);
      assert.match(copy, /code/i);
      assert.doesNotMatch(browserPage, /DVN-(?:\d{6}|(?:[A-Z2-9]{4}-){4}[A-Z2-9]{4})\b/);
      for (const code of variant.codes) assert.ok(!browserPage.includes(code));
    });
  }
}

test('published static fallback contains only launch; private pages and catalog stay bundled', async () => {
  const fallback=readFileSync(path.join(build,'index.html'),'utf8');
  assert.ok(fallback.includes('launch-password-form'));
  assert.ok(!fallback.includes('products-grid'));
  for(const file of ['product.html','checkout.html','catalog.json','_private-pages.js','functions/_private-pages.js'])assert.equal(existsSync(path.join(build,file)),false,file+' must not be public');
  const {privatePages}=await import(require('node:url').pathToFileURL(path.join(workspace,'functions/_private-pages.js')).href);
  assert.ok(privatePages['/shop'].body.includes('products-grid'));
  assert.equal(JSON.parse(privatePages['/catalog.json'].body).products.length,5);
  const routes=JSON.parse(readFileSync(path.join(build,'_routes.json'),'utf8'));
  for(const route of routes.exclude){assert.ok(!route.includes('*'));assert.ok(existsSync(path.join(build,route)));}
  assert.ok(!routes.exclude.includes('/catalog.json'));
});
