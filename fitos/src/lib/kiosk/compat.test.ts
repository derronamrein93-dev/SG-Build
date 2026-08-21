/**
 * Legacy-browser compatibility, asserted rather than hoped for.
 *
 * -- What this proves, and what it does not ------------------------------------
 *
 * It proves that the JavaScript the kiosk ships contains no syntax WebKit 12.1
 * cannot parse and calls no runtime API it does not have. That is worth
 * asserting because a syntax error in a `<script>` is total — the file does not
 * partially run, it does not run — so this is the difference between a working
 * kiosk and a blank screen on a pedestal.
 *
 * It does NOT prove the kiosk works on an iPad mini 2. Only an iPad mini 2 can
 * prove that. There is no WebKit 12.1 available to this project: Playwright's
 * bundled WebKit tracks current Safari, and Chromium proves nothing about
 * Safari at all. The manual checks in docs/phases/13 are the other half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { scanSource, scanFile, jsFilesIn, optionsFor, stripComments } from '../../../scripts/legacy-scan';

const KIOSK_ASSETS = join(process.cwd(), 'public', 'kiosk');
const BUILD_CHUNKS = join(process.cwd(), '.next', 'static', 'chunks');

test('C01 the kiosk client is ES5, with no API newer than WebKit 12.1', () => {
  const findings = scanFile(join(KIOSK_ASSETS, 'kiosk.js'), optionsFor('public/kiosk/kiosk.js'));
  assert.deepEqual(findings, [], findings.map((f) => `${f.line}: ${f.detail}`).join('\n'));
});

test('C02 the shim file is ES5 (it is allowed to name the APIs it defines)', () => {
  const findings = scanFile(join(KIOSK_ASSETS, 'legacy.js'), { syntax: 'es5', apis: 'off' });
  assert.deepEqual(findings, [], findings.map((f) => `${f.line}: ${f.detail}`).join('\n'));
});

test('C03 the scanner catches what it claims to catch', () => {
  // A scanner that passes everything passes a broken file too. Each of these is
  // a real reason a kiosk would show a blank screen on the pilot device.
  const cases: Array<[string, string]> = [
    ['var x = a?.b;', 'optional-chaining'],
    ['var x = a ?? b;', 'nullish-coalescing'],
    ['a ||= b;', 'logical-assignment'],
    ['class A { #x = 1; }', 'private-class-field'],
    ['var n = 1_000;', 'numeric-separator'],
    ['var n = 1n;', 'bigint'],
  ];
  for (const [source, kind] of cases) {
    const found = scanSource('t.js', source, { syntax: 'safari12', apis: 'off' });
    assert.ok(found.some((f) => f.kind === kind), `${source} was not flagged as ${kind}`);
  }
});

test('C04 the ES5 mode catches ES2015 that Safari 12 does happen to support', () => {
  // Held to ES5 not because WebKit 12.1 lacks `const`, but because "ES5" is a
  // rule a parser can check and "whatever Safari 12.1 happens to support" is not.
  for (const [source, kind] of [
    ['const x = 1;', 'const'],
    ['let x = 1;', 'let'],
    ['var f = () => 1;', 'arrow-function'],
    ['var s = `hi`;', 'template-literal'],
    ['var o = { ...a };', 'spread'],
    ['for (var v of xs) {}', 'for-of'],
    ['async function f() {}', 'async'],
  ] as Array<[string, string]>) {
    const found = scanSource('t.js', source, { syntax: 'es5', apis: 'off' });
    assert.ok(found.some((f) => f.kind === kind), `${source} was not flagged as ${kind}`);
  }
});

test('C05 the scanner does not trip over a property named like a builtin', () => {
  // The first run of this scanner reported every `hasOwnProperty` call as a
  // missing API, because the lookup table was a plain object.
  const findings = scanSource('t.js',
    'var t = Object.prototype.hasOwnProperty.call(o, k);', { syntax: 'es5', apis: 'error' });
  assert.deepEqual(findings, []);
});

test('C06 the scanner does not read syntax out of string literals', () => {
  const findings = scanSource('t.js', 'var s = "a?.b ?? c";', { syntax: 'safari12', apis: 'off' });
  assert.deepEqual(findings, []);
});

test('C07 the kiosk client never writes customer data to persistent storage', () => {
  // Comments stripped by the parser: the file explains at length why it does
  // not use localStorage, and that explanation must not read as a use of it.
  const source = stripComments(readFileSync(join(KIOSK_ASSETS, 'kiosk.js'), 'utf8'));
  // sessionStorage.clear() in the reset routine is the one permitted mention,
  // and it is a wipe rather than a write. localStorage must not appear at all:
  // a phone number in localStorage outlives the customer, the session, and the
  // browser restart.
  assert.equal(/localStorage/.test(source), false, 'kiosk.js references localStorage');
  const writes = source.match(/sessionStorage\.(setItem|[a-z]+\s*=)/g);
  assert.equal(writes, null, `kiosk.js writes to sessionStorage: ${writes}`);
});

test('C08 the kiosk client contains no outbound link', () => {
  // Guided Access does not stop a link, and a customer who follows one out of
  // the kiosk has left the product and cannot get back without an associate.
  const source = stripComments(readFileSync(join(KIOSK_ASSETS, 'kiosk.js'), 'utf8'));
  assert.equal(/https?:\/\/(?!127\.0\.0\.1)/.test(source), false, 'kiosk.js contains an absolute URL');
  assert.equal(/window\.open|target\s*=\s*['"]_blank/.test(source), false, 'kiosk.js opens a new context');
});

test('C09 the kiosk stylesheet avoids the features WebKit 12.1 lacks', () => {
  const css = readFileSync(join(KIOSK_ASSETS, 'kiosk.css'), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');   // the header explains them; ignore it
  const banned: Array<[RegExp, string]> = [
    [/(^|[;{\s])gap\s*:/m, 'flex gap — Safari 14.1'],
    [/(^|[;{\s])(row-gap|column-gap)\s*:/m, 'row/column-gap — Safari 14.1'],
    [/aspect-ratio\s*:/, 'aspect-ratio — Safari 15'],
    [/\b\d+(dvh|svh|lvh|dvw|svw|lvw)\b/, 'dynamic viewport units — Safari 15.4'],
    [/:is\(|:where\(/, ':is()/:where() — Safari 14'],
    [/(^|[;{\s])inset\s*:/m, 'inset shorthand — Safari 14.1'],
    [/backdrop-filter/, 'backdrop-filter — expensive on an A7 even where supported'],
    [/\bclamp\(/, 'clamp() — Safari 13.1'],
    [/@container|@layer|@supports\s+selector/, 'container queries / cascade layers'],
    [/accent-color|color-mix\(|:has\(/, 'modern colour and selector features'],
  ];
  for (const [pattern, why] of banned) {
    assert.equal(pattern.test(rules), false, `kiosk.css uses ${why}`);
  }
});

test('C10 the built kiosk bundles parse on the target engine', (t) => {
  if (!existsSync(BUILD_CHUNKS)) {
    t.skip('no build output — run `npm run build` first, or `npm run verify`');
    return;
  }
  const errors = jsFilesIn(BUILD_CHUNKS)
    .flatMap((file) => scanFile(file, optionsFor(file)))
    .filter((f) => f.severity === 'error');
  assert.deepEqual(errors, [],
    errors.map((f) => `${f.file}:${f.line} ${f.detail}`).join('\n'));
});
