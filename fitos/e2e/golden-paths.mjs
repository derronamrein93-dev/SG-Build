/**
 * Browser golden paths — the six flows the tablet actually performs.
 *
 * Deliberately six and not sixty. These exist because 141 unit tests passed
 * while customer creation was broken under RLS: every fixture created data
 * through the service role, so nothing had ever driven the screens an associate
 * uses. This suite drives them, in a browser, at tablet size.
 *
 *   npm run e2e            # against an already-running server on :3000
 *   npm run e2e:full       # reset, build, start, run, stop
 *
 * Not a CI gate — there is no CI here. Run it before a demo and after any change
 * to the fitting flow.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TABLET = { width: 1024, height: 1366 };          // iPad portrait, how it is held
const SEEDED_RETURNING = '612-555-4417';               // Day 5 Card B

const results = [];
let browser;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${detail && !condition ? ` — ${detail}` : ''}`);
}

const uniquePhone = () => '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

async function newPage() {
  const p = await browser.newPage({ viewport: TABLET });
  p.on('pageerror', (e) => check('no uncaught page error', false, e.message));
  return p;
}

/** Lookup → create → land in the fitting. Returns the page, on question 1. */
async function newCustomer(p, phone) {
  await p.goto(`${BASE}/fitting/new?phone=${phone}`, { waitUntil: 'networkidle' });
  await p.fill('input[name="firstName"]', 'Golden');
  await p.fill('input[name="lastName"]', 'Path');
  await p.check('input[name="consent"]');
  await p.click('button:has-text("Start fitting")');
  await p.waitForURL(/\/fitting\/[0-9a-f-]{36}/, { timeout: 20000 });
  await p.waitForTimeout(600);
}

/** Answer every question with one value; returns the prompts seen, in order. */
async function answerAll(p, value) {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const counter = (await p.textContent('.card .overline').catch(() => '')) || '';
    if (!/Question \d+ of \d+/.test(counter)) break;
    const prompt = (await p.textContent('.card h2')).trim();
    if (seen.includes(prompt)) break;                 // last question: no further advance
    seen.push(prompt);

    // Nothing may require typing before the scan.
    const typable = await p.$$eval('.card input[type="text"], .card textarea, .card select',
      (els) => els.length);
    check(`no typing required on "${prompt.slice(0, 40)}…"`, typable === 0, `${typable} field(s)`);

    await p.click(`button[data-answer="${value}"]`);
    await p.waitForTimeout(320);
    // A No advances on its own. A Yes on a question that can expand stays put,
    // so the optional detail is reachable — press Continue to move on.
    const cont = await p.$('button:has-text("Continue")');
    if (cont) { await cont.click(); await p.waitForTimeout(300); }
  }
  return seen;
}

async function toReport(p) {
  await p.click('button:has-text("Start Scan")');
  await p.waitForTimeout(1000);
  await p.click('button:has-text("Recommendation")');
  await p.waitForTimeout(2500);
  await p.click('button:has-text("Create fit report")');
  await p.waitForURL(/\/r\//, { timeout: 20000 });
  await p.waitForTimeout(800);
  return p.url();
}

// ─────────────────────────────────────────────────────────────── the paths ──

async function pathNewCustomer() {
  console.log('\n1 · new customer');
  const p = await newPage();
  await newCustomer(p, uniquePhone());
  const seen = await answerAll(p, 'no');
  check('exactly three questions', seen.length === 3, `saw ${seen.length}`);
  check('Start Scan is offered', Boolean(await p.$('button:has-text("Start Scan")')));
  await p.close();
}

async function pathReturningCustomer() {
  console.log('\n2 · returning customer');
  const p = await newPage();
  await p.goto(`${BASE}/fitting/new?phone=${SEEDED_RETURNING}`, { waitUntil: 'networkidle' });
  const body = await p.textContent('body');
  check('the seeded customer is recognised', /Marisol/i.test(body));
  await p.click('button:has-text("Continue"), button:has-text("Start fitting")');
  await p.waitForURL(/\/fitting\/[0-9a-f-]{36}/, { timeout: 20000 });
  await p.waitForTimeout(600);
  const seen = await answerAll(p, 'no');
  check('exactly two questions', seen.length === 2, `saw ${seen.length}`);
  check('both are framed since the last visit',
    seen.every((s) => /since your last visit/i.test(s)));
  await p.close();
}

async function pathAllNo() {
  console.log('\n3 · all-No intake reaches the scan');
  const p = await newPage();
  await newCustomer(p, uniquePhone());
  await answerAll(p, 'no');
  await p.click('button:has-text("Start Scan")');
  await p.waitForTimeout(1000);
  check('all-No proceeds to measurements', /Scan/.test(await p.textContent('h1')));
  await p.close();
}

async function pathAllYes() {
  console.log('\n4 · all-Yes intake reaches the scan, detail optional');
  const p = await newPage();
  await newCustomer(p, uniquePhone());
  // Answer the first Yes and confirm Add detail appears but is skippable.
  await p.click('button[data-answer="yes"]');
  await p.waitForTimeout(320);
  // A real assertion, not a tautology. The first version of this check was
  // `Boolean(detail) || true`, which passed while Add detail was unreachable:
  // answering Yes advanced past the button that the Yes had just revealed.
  check('Add detail is reachable after a Yes', Boolean(await p.$('button:has-text("Add detail")')));
  check('a Yes does not auto-advance past its own detail option',
    /Question 1 of/.test(await p.textContent('.card .overline')));

  for (let i = 0; i < 3; i++) {
    const cont = await p.$('button:has-text("Continue")');
    if (cont) { await cont.click(); await p.waitForTimeout(300); }
    const yes = await p.$('button[data-answer="yes"]');
    if (yes) { await yes.click(); await p.waitForTimeout(320); }
  }
  const scan = await p.$('button:has-text("Start Scan")');
  check('all-Yes proceeds without entering any detail', Boolean(scan));
  if (scan) { await scan.click(); await p.waitForTimeout(1000); }
  check('all-Yes reaches measurements', /Scan/.test(await p.textContent('h1')));
  await p.close();
}

async function pathReportGeneration() {
  console.log('\n5 · report generation');
  const p = await newPage();
  await newCustomer(p, uniquePhone());
  await answerAll(p, 'yes');
  const url = await toReport(p);
  check('a token report URL is produced', /\/r\/[A-Za-z0-9_-]{16,}/.test(url), url);
  const body = await p.textContent('body');
  check('the report shows What you told us', body.includes('What you told us'));
  check('the report shows the composed paragraph', body.includes('Why this recommendation'));
  check('the quick answers appear', body.includes('Foot discomfort reported'));
  globalThis.__lastReportUrl = url;
  await p.close();
}

async function pathTokenReportOpen() {
  console.log('\n6 · token report opens for a stranger, and only with the token');
  const url = globalThis.__lastReportUrl;
  const p = await newPage();                       // fresh context: no session, no cookies
  const res = await p.goto(url, { waitUntil: 'networkidle' });
  check('a valid token renders', res.status() === 200, `status ${res.status()}`);

  const bogus = await p.goto(`${BASE}/r/not-a-real-token-000000000000`, { waitUntil: 'networkidle' });
  check('a bogus token 404s', bogus.status() === 404, `status ${bogus.status()}`);
  await p.close();
}

// ────────────────────────────────────────────────────────────────── runner ──

browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  await pathNewCustomer();
  await pathReturningCustomer();
  await pathAllNo();
  await pathAllYes();
  await pathReportGeneration();
  await pathTokenReportOpen();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exit(1);
}
