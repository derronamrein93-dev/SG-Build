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

/** Leave the optional concern screen if it is showing. */
async function passConcernScreen(p, { select = [], skip = false } = {}) {
  const here = await p.$('button:has-text("Continue to Scan")');
  if (!here) return false;
  for (const v of select) {
    await p.click(`button[data-concern="${v}"]`);
    await p.waitForTimeout(150);
  }
  await p.click(skip ? 'button:has-text("Skip")' : 'button:has-text("Continue to Scan")');
  await p.waitForTimeout(900);
  return true;
}

async function toReport(p) {
  // Either the concern screen is showing (and leaving it enters the scan), or
  // Start Scan is on the last question. Both land on measurements.
  if (!(await passConcernScreen(p, { skip: true }))) {
    const scan = await p.$('button:has-text("Start Scan")');
    if (scan) await scan.click();
  }
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
  check('all-No is never shown the concern screen',
    !(await p.$('button:has-text("Continue to Scan")')));
  await p.click('button:has-text("Start Scan")');
  await p.waitForTimeout(1000);
  check('all-No proceeds to measurements', /Scan/.test(await p.textContent('h1')));
  await p.close();
}

async function pathAllYes() {
  console.log('\n4 · all-Yes intake reaches the scan, detail optional');
  const p = await newPage();
  await newCustomer(p, uniquePhone());

  await p.click('button[data-answer="yes"]');
  await p.waitForTimeout(320);
  // A real assertion, not a tautology. The first version of this check was
  // `Boolean(detail) || true`, which passed while Add detail was unreachable:
  // answering Yes advanced past the button that the Yes had just revealed.
  check('Add detail is reachable after a Yes', Boolean(await p.$('button:has-text("Add detail")')));
  check('a Yes does not auto-advance past its own detail option',
    /Question 1 of/.test(await p.textContent('.card .overline')));

  await p.click('button:has-text("Continue")');
  await p.waitForTimeout(300);
  await answerAll(p, 'yes');            // remaining questions, Continue handled

  check('all-Yes reaches the optional concern screen',
    Boolean(await p.$('button:has-text("Continue to Scan")')));
  // Skip goes straight into the scan — there is no intermediate Start Scan
  // button, because a skipped optional screen should not cost an extra tap.
  // (An earlier version of this check looked for one and failed while the
  // product was behaving correctly.)
  await passConcernScreen(p, { skip: true });
  check('all-Yes proceeds without entering any detail',
    /Scan/.test(await p.textContent('h1')));
  check('nothing was typed anywhere in the all-Yes path',
    (await p.$$eval('input[type="text"]', (els) => els.filter((e) => e.value).length)) === 0);
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

async function pathReportedConcerns() {
  console.log('\n7 · reported concerns: Q1 Yes, select two, continue, scan, report');
  const p = await newPage();
  await newCustomer(p, uniquePhone());

  await p.click('button[data-answer="yes"]');           // Q1 Yes
  await p.waitForTimeout(320);
  await p.click('button:has-text("Continue")');         // past the detail offer
  await p.waitForTimeout(300);
  await p.click('button[data-answer="no"]');            // Q2
  await p.waitForTimeout(320);
  await p.click('button[data-answer="no"]');            // Q3
  await p.waitForTimeout(320);
  await p.click('button:has-text("Continue")');         // leave the questions
  await p.waitForTimeout(900);

  check('the concern screen appears after a Yes',
    Boolean(await p.$('button:has-text("Continue to Scan")')));
  const chips = await p.$$eval('button[data-concern]', (els) => els.length);
  check('all twelve concern chips are present', chips === 12, `saw ${chips}`);

  // Selection state must be obvious, and a second tap must clear it.
  await p.click('button[data-concern="plantar_fasciitis"]');
  await p.waitForTimeout(150);
  check('a selected chip is marked pressed',
    (await p.getAttribute('button[data-concern="plantar_fasciitis"]', 'aria-pressed')) === 'true');
  await p.click('button[data-concern="plantar_fasciitis"]');
  await p.waitForTimeout(150);
  check('a second tap deselects',
    (await p.getAttribute('button[data-concern="plantar_fasciitis"]', 'aria-pressed')) === 'false');

  await p.click('button[data-concern="plantar_fasciitis"]');
  await p.click('button[data-concern="heel_pain"]');
  await p.waitForTimeout(200);

  // Nothing on this screen requires typing unless Other is chosen.
  const typable = await p.$$eval('.card input[type="text"], .card textarea, .card select',
    (els) => els.length);
  check('no typing required to continue', typable === 0, `${typable} field(s)`);

  await p.click('button:has-text("Continue to Scan")');
  await p.waitForTimeout(1200);
  const scanBtn = await p.$('button:has-text("Start Scan")');
  if (scanBtn) { await scanBtn.click(); await p.waitForTimeout(1000); }
  check('continues into the scan', /Scan/.test(await p.textContent('h1')));

  await p.click('button:has-text("Recommendation")');
  await p.waitForTimeout(2500);
  await p.click('button:has-text("Create fit report")');
  await p.waitForURL(/\/r\//, { timeout: 20000 });
  await p.waitForTimeout(800);

  const body = await p.textContent('body');
  check('the report attributes the concerns to the customer',
    body.includes('Customer-reported concerns'));
  check('the selected concerns persisted to the report',
    body.includes('Plantar fasciitis') && body.includes('Heel pain'));
  // The boundary, in the artifact the customer takes home.
  //
  // Checking for the WORD "diagnosis" was wrong and failed here on the first
  // run: the report's own disclaimer says "not a medical assessment, diagnosis,
  // or treatment recommendation", which is the opposite of a violation. What
  // matters is whether Stride Guide makes a claim, so these look for claims.
  for (const claim of [/stride guide (detected|diagnosed|found|determined)/i,
                       /you have (plantar|a neuroma|bunions|arthritis)/i,
                       /we (diagnosed|detected|treat)/i,
                       /(recommended|suggested) treatment/i]) {
    check(`the report makes no claim matching ${claim}`, !claim.test(body));
  }
  check('the report carries its non-medical disclaimer',
    /not a medical assessment, diagnosis, or treatment recommendation/i.test(body));
  // And the condition name appears only as the customer's own words.
  const pfIndex = body.indexOf('Plantar fasciitis');
  const labelIndex = body.indexOf('Customer-reported concerns');
  check('the condition name sits under the customer-reported label',
    pfIndex > -1 && labelIndex > -1 && pfIndex > labelIndex);
  await p.close();
}


/* ── catalog helpers ────────────────────────────────────────────────────── */

/** The synthetic wall this store is seeded with. Fictional brands, every one. */
const SYNTHETIC_BRANDS = ['Meridian', 'Corvid', 'Northmoor', 'Alder', 'Selby', 'Kestrel', 'Fallow'];

/** Tap a chip inside one labelled group. Values repeat across groups. */
async function chip(p, group, value) {
  await p.click(`[data-chip-group="${group}"] button[data-chip="${value}"]`);
  await p.waitForTimeout(120);
}

/** Step a size stepper to a target, half-size at a time. */
async function setSize(p, which, target) {
  for (let i = 0; i < 40; i++) {
    const now = Number(await p.getAttribute(`[data-stepper="${which}"] [data-size]`, 'data-size'));
    if (Math.abs(now - target) < 1e-9) return true;
    await p.click(`[data-stepper="${which}"] button[data-step="${now < target ? 'up' : 'down'}"]`);
    await p.waitForTimeout(60);
  }
  return false;
}

/** Read one Why? panel into plain data. Nothing here recomputes anything. */
async function readWhy(p, productModelId) {
  await p.click(`button[data-why-open="${productModelId}"]`);
  await p.waitForSelector('[data-why-panel]', { timeout: 5000 });
  await p.click('[data-why-breakdown]');
  await p.waitForTimeout(200);
  const panel = await p.$('[data-why-panel]');
  const data = {
    text: await panel.textContent(),
    reasons: await p.$$eval('[data-why-reason]', (e) => e.map((x) => x.textContent.trim())),
    considerations: await p.$$eval('[data-why-consideration]', (e) => e.map((x) => x.textContent.trim())),
    unknowns: await p.$$eval('[data-why-unknown]', (e) => e.map((x) => x.textContent.trim())),
    overall: await p.getAttribute('[data-why-overall]', 'data-why-overall'),
    rows: await p.$$eval('[data-why-row]', (els) => els.map((el) => ({
      dimension: el.getAttribute('data-why-row'),
      score: el.getAttribute('data-why-score'),
      cells: [...el.querySelectorAll('td')].map((td) => td.textContent.trim()),
    }))),
  };
  await p.click('[data-why-close]');
  await p.waitForTimeout(200);
  return data;
}

/** Claims Stride Guide must never make, in any surface. */
const MEDICAL_CLAIMS = [/stride guide (detected|diagnosed|found|determined)/i,
                        /you have (plantar|a neuroma|bunions|arthritis)/i,
                        /we (diagnosed|detected|treat)/i,
                        /(recommended|suggested) treatment/i,
                        /fitos (diagnos|treat)/i];

/* ── the catalog paths ──────────────────────────────────────────────────── */

async function pathCatalogWhy() {
  console.log('\n8 · catalog recommendation and the Why? panel');
  const p = await newPage();
  await newCustomer(p, uniquePhone());

  // Quick intake: a Yes on discomfort so the concern screen appears.
  await p.click('button[data-answer="yes"]');
  await p.waitForTimeout(320);
  await p.click('button:has-text("Continue")');
  await p.waitForTimeout(300);
  await p.click('button[data-answer="no"]');
  await p.waitForTimeout(320);
  await p.click('button[data-answer="no"]');
  await p.waitForTimeout(320);
  await p.click('button:has-text("Continue")');
  await p.waitForTimeout(900);

  // Two customer-reported concerns, then measurements.
  await p.click('button[data-concern="bunion"]');
  await p.click('button[data-concern="heel_pain"]');
  await p.waitForTimeout(200);
  await p.click('button:has-text("Continue to Scan")');
  await p.waitForTimeout(1200);
  const scan = await p.$('button:has-text("Start Scan")');
  if (scan) { await scan.click(); await p.waitForTimeout(1000); }

  // A measured wide foot at size 10. Width is the dimension whose provenance
  // must outrank the reported concerns.
  await chip(p, 'width', 'wide');
  check('measured size is 10.0/10.0',
    (await setSize(p, 'left', 10)) && (await setSize(p, 'right', 10)));

  await p.click('button:has-text("Recommendation")');
  await p.waitForTimeout(3000);

  // 1 · actual candidate cards
  const cards = await p.$$eval('[data-candidate]', (els) => els.map((el) => ({
    id: el.getAttribute('data-candidate'),
    text: el.textContent.trim(),
  })));
  check('1 · candidate cards appear', cards.length > 0, `saw ${cards.length}`);

  // 2 · everything shown came off this store's wall. The evaluated count is the
  // whole local inventory: RLS on location_inventory is what scopes it, so if a
  // card appeared from outside that set the totals would not add up.
  const evaluated = Number(await p.getAttribute('[data-evaluated-count]', 'data-evaluated-count'));
  const ruledOut = Number(await p.getAttribute('[data-eliminated-count]', 'data-eliminated-count'));
  check('2 · every candidate is locally stocked',
    evaluated > 0 && cards.length <= evaluated - ruledOut
      && cards.every((c) => SYNTHETIC_BRANDS.some((b) => c.text.startsWith(b))),
    `evaluated ${evaluated}, ruled out ${ruledOut}, shown ${cards.length}`);

  const whys = [];
  for (const c of cards) whys.push(await readWhy(p, c.id));

  // 5 · Why? opens at all
  check('5 · Why? opens for every candidate',
    whys.length === cards.length && whys.every((w) => w.text.includes('Why FitOS recommended')));

  // 3 · the size hard constraint is shown as having been applied and passed
  check('3 · size hard constraint is respected on every shown candidate',
    whys.every((w) => {
      const size = w.rows.find((r) => r.dimension === 'size');
      return size && /Pass/.test(size.cells[1]) && /hard constraint/.test(size.cells[2]);
    }));

  // 6 · every stated reason traces to a dimension that actually scored well.
  // A reason with no scored row behind it would be invented prose.
  const LABELS = { 'intended use': 'use_case', cushioning: 'cushioning', support: 'support',
    width: 'width_fit', 'toe-box room': 'forefoot_room', volume: 'volume',
    'heel hold': 'heel_hold', 'orthotic accommodation': 'orthotic_compatibility',
    flexibility: 'flexibility' };
  let orphanReason = null;
  for (const w of whys) {
    for (const r of w.reasons) {
      const key = Object.keys(LABELS).find((k) => r.toLowerCase().startsWith(k));
      const row = key && w.rows.find((x) => x.dimension === LABELS[key]);
      if (!row || Number(String(row.score).replace('%', '')) < 85) { orphanReason = r; break; }
    }
    if (orphanReason) break;
  }
  check('6 · every Why? reason is backed by a scored dimension at 85% or better',
    orphanReason === null, orphanReason ?? '');

  // 7 · the headline and the breakdown are the same number, and the headline
  // sits inside the range of the dimensions that produced it.
  let mismatch = null;
  for (const w of whys) {
    const scored = w.rows.filter((r) => r.score).map((r) => Number(r.score.replace('%', '')));
    const overall = Number(String(w.overall).replace('%', ''));
    const foot = w.rows.length && w.text.match(/Overall match — (\d+)%/);
    if (!foot || Number(foot[1]) !== overall) { mismatch = `${w.overall} vs headline`; break; }
    if (overall > Math.max(...scored) || overall < Math.min(...scored)) {
      mismatch = `overall ${overall} outside [${Math.min(...scored)}, ${Math.max(...scored)}]`; break;
    }
    if (scored.length < 3) { mismatch = `overall shown on only ${scored.length} dimension(s)`; break; }
  }
  check('7 · score breakdown reconciles with the stored overall', mismatch === null, mismatch ?? '');

  // 8 · the one-step boundary. A symmetric one-step gap scores exactly 0.70,
  // and the threshold is <= 0.70, so it must surface as a consideration. An
  // earlier `< 0.70` dropped every one of these silently.
  const seventy = [];
  for (const w of whys) {
    for (const r of w.rows.filter((x) => x.score === '70%')) {
      const label = r.cells[0].toLowerCase();
      seventy.push({ label, matched: w.considerations.some((c) => c.toLowerCase().startsWith(label)) });
    }
  }
  check('8 · a one-step gap at exactly 70% is present in this fixture',
    seventy.length > 0, 'the fixture no longer produces a 0.70 dimension');
  check('8 · every 70% dimension appears under Things to consider',
    seventy.length > 0 && seventy.every((s) => s.matched),
    seventy.filter((s) => !s.matched).map((s) => s.label).join(', '));

  // 12 · measured evidence keeps its own label, and 13 · a reported concern
  // does not relabel a measured dimension.
  const widthRows = whys.map((w) => w.rows.find((r) => r.dimension === 'width_fit')).filter(Boolean);
  check('12 · the measured width is labelled Measured today',
    widthRows.length > 0 && widthRows.every((r) => /Measured today/.test(r.cells[2])),
    widthRows.map((r) => r.cells[2]).join(' | '));
  check('13 · no measured geometry is attributed to the customer report',
    whys.every((w) => w.rows.filter((r) => ['width_fit', 'forefoot_room', 'volume'].includes(r.dimension))
      .every((r) => !/Customer reported/.test(r.cells[2]))));

  // 14 · the language boundary, inside the panel this time.
  for (const claim of MEDICAL_CLAIMS) {
    check(`14 · Why? makes no claim matching ${claim}`, whys.every((w) => !claim.test(w.text)));
  }
  check('14 · the panel carries its own non-medical line',
    whys.every((w) => /Not a medical assessment/i.test(w.text)));

  // 15 · and the fitting still finishes.
  await p.click('button:has-text("Create fit report")');
  await p.waitForURL(/\/r\//, { timeout: 20000 });
  await p.waitForTimeout(800);
  const body = await p.textContent('body');
  check('15 · the report still completes', /\/r\/[A-Za-z0-9_-]{16,}/.test(p.url()), p.url());
  for (const claim of MEDICAL_CLAIMS) {
    check(`14 · the report makes no claim matching ${claim}`, !claim.test(body));
  }
  await p.close();
}

async function pathEvidenceQuality() {
  console.log('\n9 · unknown vs. low-confidence evidence');
  const p = await newPage();
  await newCustomer(p, uniquePhone());

  // All three Yes, concern screen skipped. This ranking puts the deliberately
  // under-documented demonstration model into the visible three.
  await p.click('button[data-answer="yes"]');
  await p.waitForTimeout(320);
  await p.click('button:has-text("Continue")');
  await p.waitForTimeout(300);
  await answerAll(p, 'yes');
  await passConcernScreen(p, { skip: true });
  await chip(p, 'width', 'wide');
  await setSize(p, 'left', 10);
  await setSize(p, 'right', 10);
  await p.click('button:has-text("Recommendation")');
  await p.waitForTimeout(3000);

  const cards = await p.$$eval('[data-candidate]', (els) => els.map((el) => ({
    id: el.getAttribute('data-candidate'), text: el.textContent.trim() })));
  const degraded = cards.find((c) => c.text.includes('Claim Runner'));
  check('9 · the under-documented demonstration model reaches the shortlist',
    Boolean(degraded), cards.map((c) => c.text.split('\n')[0]).join(' / '));
  if (!degraded) { await p.close(); return; }

  const w = await readWhy(p, degraded.id);

  // 9 · a dimension with nothing behind it says so, and never appears as a score
  const scoredDims = w.rows.map((r) => r.dimension);
  check('9 · unknown dimensions are named, not invented',
    w.unknowns.length > 0 && w.unknowns.every((u) =>
      /No verified value available|below the confidence required/i.test(u)),
    w.unknowns.join(' | '));
  check('9 · an unknown dimension never also appears as a score',
    w.unknowns.every((u) => {
      const label = u.split('—')[0].trim().toLowerCase();
      return !w.rows.some((r) => r.cells[0] && r.cells[0].toLowerCase() === label);
    }));

  // 10 · the two kinds of unknown are told apart in words
  check('10 · missing evidence reads as no verified value',
    w.unknowns.some((u) => /No verified value available/i.test(u)), w.unknowns.join(' | '));
  check('10 · low-confidence evidence reads as below the required confidence',
    w.unknowns.some((u) => /below the confidence required/i.test(u)), w.unknowns.join(' | '));
  check('10 · the two are distinguishable, not the same sentence twice',
    new Set(w.unknowns.map((u) => u.split('—')[1]?.trim())).size >= 2);

  // The overall is still shown, because enough dimensions did score.
  check('10 · a partly-documented model still reports what it could score',
    w.overall !== 'suppressed' && w.rows.filter((r) => r.score).length >= 3,
    `${w.overall}, ${w.rows.filter((r) => r.score).length} scored`);

  await p.close();
}

async function pathUnstockedSize() {
  console.log('\n10 · a size nobody stocks cannot rank');
  const p = await newPage();
  await newCustomer(p, uniquePhone());
  await answerAll(p, 'no');
  await p.click('button:has-text("Start Scan")');
  await p.waitForTimeout(1000);

  check('the stepper reaches size 16',
    (await setSize(p, 'left', 16)) && (await setSize(p, 'right', 16)));
  await p.click('button:has-text("Recommendation")');
  await p.waitForTimeout(3000);

  const cards = await p.$$eval('[data-candidate]', (els) => els.length);
  const evaluated = Number(await p.getAttribute('[data-evaluated-count]', 'data-evaluated-count'));
  const ruledOut = Number(await p.getAttribute('[data-eliminated-count]', 'data-eliminated-count'));
  check('4 · an unavailable required size cannot rank', cards === 0, `${cards} card(s) shown`);
  check('11 · every model was ruled out, and the count says so',
    evaluated > 0 && ruledOut === evaluated, `${ruledOut}/${evaluated}`);
  check('11 · the screen says plainly that nothing cleared',
    Boolean(await p.$('[data-no-candidates]')));

  // The fitting must still be finishable — a store with no match in stock is a
  // normal Tuesday, not an error state.
  await p.click('button:has-text("Create fit report")');
  await p.waitForURL(/\/r\//, { timeout: 20000 });
  check('15 · the report completes even when nothing ranked', /\/r\//.test(p.url()));
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
  await pathReportedConcerns();
  await pathCatalogWhy();
  await pathEvidenceQuality();
  await pathUnstockedSize();
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
