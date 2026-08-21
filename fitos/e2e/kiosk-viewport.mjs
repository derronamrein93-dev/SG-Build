/**
 * Kiosk golden paths, at the pilot device's viewport.
 *
 * -- Read this before trusting a green run --------------------------------------
 *
 * These run in CHROMIUM. Chromium is not WebKit 12.1, and passing here does NOT
 * mean the kiosk works on an iPad mini 2. Playwright's bundled WebKit tracks
 * current Safari, so there is no engine available to this project that behaves
 * like iPadOS 12.5.
 *
 * What these DO prove, and what nothing else can:
 *   - the flow, the reset guarantee and the scoping behave as designed
 *   - the layout fits 768 x 1024 and 1024 x 768 with no horizontal overflow
 *   - every button a customer must reach is at least 48 CSS pixels
 *   - one customer's data cannot survive into the next session
 *
 * The syntax and API half is asserted by src/lib/kiosk/compat.test.ts against
 * the shipped files. The engine half is the manual checklist in
 * docs/phases/13-kiosk-ipad-mini-2.md, and only a real A1490 closes it.
 *
 *   npm run kiosk:e2e -- <enrollment-code> [ingest-token]
 */
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const CHROME = process.env.E2E_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** iPad mini 2, A1490: 2048 x 1536 at 2x, so 768 x 1024 CSS pixels in portrait. */
const PORTRAIT = { width: 768, height: 1024 };
const LANDSCAPE = { width: 1024, height: 768 };
/** The device's real DPR, so any 1px-boundary rendering is exercised. */
const DPR = 2;

const CODE = process.argv[2];
const INGEST = process.argv[3];

const results = [];
let browser;
/**
 * The credential cookie, carried between browser contexts.
 *
 * An enrollment code is single use — that is the point of it — so the layout
 * sections cannot each redeem one. They reuse the credential the enrollment
 * section obtained, which is also how the real device behaves: enrolled once,
 * relaunched many times.
 */
let enrolledState = null;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

async function newPage(viewport = PORTRAIT, { fresh = false } = {}) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: DPR, hasTouch: true,
    ...(fresh || !enrolledState ? {} : { storageState: enrolledState }),
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => check('no uncaught page error', false, e.message));
  return page;
}

const state = (page) => page.evaluate(() =>
  (document.querySelector('.screen.is-active') || {}).getAttribute?.('data-screen') ?? null);

async function waitForState(page, want, timeout = 15000) {
  await page.waitForFunction(
    (s) => {
      const active = document.querySelector('.screen.is-active');
      return active && active.getAttribute('data-screen') === s;
    }, want, { timeout });
}

/** Feed one telemetry frame, as the bridge would. */
async function frame(page, mode) {
  if (!INGEST) return false;
  const ready = mode === 'ready';
  const res = await page.request.post(`${BASE}/api/hardware/telemetry`, {
    headers: { authorization: `Bearer ${INGEST}` },
    data: {
      matrixReady: true, loadCellsReady: true, calibrationValid: mode !== 'uncal',
      leftFootDetected: ready, rightFootDetected: ready, weightStable: ready,
      totalWeight: ready ? 78.4 : 0,
      firmwareVersion: '0.4.2', calibrationVersion: 'cal-2024-11',
      capture: ready ? {
        rawUri: 'sg://e2e/' + Date.now(),
        rawChecksum: 'sha256:' + Date.now().toString(16).padEnd(64, '0'),
        captureType: 'static_stance', sampleRateHz: 60, frameCount: 180,
        totalLoadMeasured: 78.4, captureQuality: 0.91, algorithmVersion: 'e2e-0.1',
        assessment: { size_left: 10.5, size_right: 11, width: 'wide', arch_type: 'low' },
      } : undefined,
    },
  });
  return res.ok();
}

/** Keep frames flowing while the kiosk polls; the staleness window is 12s. */
function heartbeat(page, mode) {
  let stop = false;
  (async () => {
    while (!stop) {
      // The page may close under us at the end of a section; that is the signal
      // to stop, not an error to crash the run with.
      try { await frame(page, mode); await page.waitForTimeout(1500); } catch { return; }
    }
  })();
  return () => { stop = true; };
}

async function enroll(page) {
  await page.goto(`${BASE}/kiosk`, { waitUntil: 'domcontentloaded' });
  if (await state(page) === 'IDLE') return true;      // credential carried in
  await page.click('[data-action="enroll-start"]');
  await page.fill('#enroll-code', CODE);
  await page.click('[data-action="enroll-submit"]');
  await waitForState(page, 'IDLE');
  return true;
}

async function toConsent(page) {
  await page.click('[data-action="start"]');
  await waitForState(page, 'IDENTIFICATION');
  const digits = '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  for (const d of digits) await page.click(`[data-key="${d}"]`);
  await page.click('[data-action="phone-next"]');
  await page.fill('#first-name', 'Viewport');
  await page.fill('#last-name', 'Customer');
  await page.click('[data-action="name-next"]');
  await waitForState(page, 'CONSENT');
  return digits;
}

async function answerIntake(page) {
  await waitForState(page, 'INTAKE');
  for (let i = 0; i < 3; i++) {
    if (await state(page) !== 'INTAKE') break;
    await page.click('[data-action="intake-no"]');
    await page.waitForTimeout(120);
  }
}

// ── 1. shell and enrollment ─────────────────────────────────────────────────

async function testShell() {
  console.log('\n1. shell');
  const page = await newPage(PORTRAIT, { fresh: true });
  const response = await page.goto(`${BASE}/kiosk`, { waitUntil: 'domcontentloaded' });

  const html = await response.text();
  check('the kiosk page ships no framework runtime', !html.includes('/_next/'),
    'the page references Next chunks');
  check('the kiosk page is under 32 KB of HTML', html.length < 32768, `${html.length} bytes`);
  check('no outbound link in the document', !/<a\s[^>]*href="http/i.test(html));

  const scripts = await page.$$eval('script[src]', (nodes) => nodes.map((n) => n.getAttribute('src')));
  check('exactly two scripts, both local', scripts.length === 2 && scripts.every((s) => s.startsWith('/kiosk/')),
    scripts.join(', '));

  const meta = await page.$$eval('meta[name]', (nodes) =>
    Object.fromEntries(nodes.map((n) => [n.getAttribute('name'), n.getAttribute('content')])));
  check('apple-mobile-web-app-capable is set', meta['apple-mobile-web-app-capable'] === 'yes');
  check('viewport is fixed and cover-fitted',
    /width=device-width/.test(meta.viewport) && /viewport-fit=cover/.test(meta.viewport));
  check('the page is not indexable', /noindex/.test(meta.robots ?? ''));

  check('an unenrolled kiosk shows the setup screen', await state(page) === 'UNENROLLED');
  await page.close();
}

async function testEnrollment() {
  console.log('\n2. enrollment');
  const page = await newPage(PORTRAIT, { fresh: true });
  await page.goto(`${BASE}/kiosk`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-action="enroll-start"]');
  await page.fill('#enroll-code', 'NORTHSIDE-ZZZZ-ZZZZ');
  await page.click('[data-action="enroll-submit"]');
  await page.waitForTimeout(600);
  const error = await page.textContent('[data-role="enroll-error"]');
  check('a bad code is refused with customer-safe copy', /did.?n.?t work/i.test(error ?? ''), error ?? '');
  check('a bad code reveals nothing about why', !/expired|already|unknown/i.test(error ?? ''), error ?? '');
  check('a bad code leaves the device unenrolled', await state(page) === 'ENROLLING');

  await page.fill('#enroll-code', CODE);
  await page.click('[data-action="enroll-submit"]');
  await waitForState(page, 'IDLE');
  check('a valid code activates the kiosk', await state(page) === 'IDLE');

  const cookies = await page.context().cookies();
  const credential = cookies.filter((c) => c.name === 'fitos_kiosk_credential')[0];
  check('the credential is stored httpOnly', credential && credential.httpOnly === true);
  check('the credential is SameSite=Strict', credential && credential.sameSite === 'Strict');
  const readable = await page.evaluate(() => document.cookie);
  check('JavaScript cannot read the credential', !readable.includes('fitos_kiosk_credential'), readable);

  await page.reload({ waitUntil: 'domcontentloaded' });
  check('the device identity survives a reload', await state(page) === 'IDLE');
  enrolledState = await page.context().storageState();
  return page;
}

// ── 3. the customer flow ────────────────────────────────────────────────────

async function testFlow(page) {
  console.log('\n3. customer flow');
  const stopBeat = heartbeat(page, 'ready');
  await toConsent(page);
  check('consent comes before anything is stored', await state(page) === 'CONSENT');

  await page.click('[data-action="consent-accept"]');
  await answerIntake(page);
  await waitForState(page, 'HARDWARE_READY');
  check('the readiness screen follows intake', await state(page) === 'HARDWARE_READY');

  await page.waitForFunction(
    () => !document.querySelector('[data-action="capture"]').hasAttribute('disabled'),
    null, { timeout: 15000 });
  const ticks = await page.$$eval('[data-screen="HARDWARE_READY"] .checklist li',
    (nodes) => nodes.map((n) => n.className));
  check('all three readiness ticks come from the hardware', ticks.every((c) => c.includes('is-ok')),
    ticks.join(' | '));

  await page.click('[data-action="capture"]');
  await waitForState(page, 'PROCESSING', 20000);
  check('the countdown leads to processing', true);

  await waitForState(page, 'RESULTS', 45000);
  const headline = await page.textContent('[data-role="result-headline"]');
  check('a fit result is shown', (headline ?? '').length > 0, headline ?? '');
  const why = await page.textContent('[data-role="result-why"]');
  check('the composed explanation is shown', (why ?? '').length > 20);
  const body = await page.textContent('body');
  check('no uuid reaches the results screen',
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(body ?? ''));
  check('no medical claim on the results screen',
    /not a medical assessment/i.test(body ?? ''));

  stopBeat();
  return { headline };
}

// ── 4. privacy: the property the whole design exists for ────────────────────

async function testPrivacyReset(page, previous) {
  console.log('\n4. privacy reset');
  await page.click('[data-action="results-done"]');
  await waitForState(page, 'COMPLETE');
  await page.click('[data-action="finish"]');
  await waitForState(page, 'IDLE', 8000);

  const body = await page.textContent('body');
  check('the previous name is gone from the document', !/Viewport\s+Customer/.test(body ?? ''));
  check('the previous result is gone from the document',
    !previous.headline || !(body ?? '').includes(previous.headline));

  // A checkbox's `value` is "on" whether or not it is ticked, so the state that
  // matters is `checked`. The first run of this check read `value` and reported
  // a cleared checkbox as dirty.
  const inputs = await page.$$eval('input', (nodes) =>
    nodes.map((n) => (n.type === 'checkbox' || n.type === 'radio')
      ? (n.checked ? `${n.id}:checked` : '') : n.value));
  check('every input is blank', inputs.every((v) => v === ''), inputs.filter(Boolean).join('|'));
  const phone = await page.textContent('[data-role="phone-display"]');
  check('the phone display is blank', !/\d/.test(phone ?? ''), phone ?? '');

  const storage = await page.evaluate(() => ({
    local: Object.keys(window.localStorage || {}),
    session: Object.keys(window.sessionStorage || {}),
  }));
  check('nothing about the customer is in localStorage', storage.local.length === 0, storage.local.join(','));
  check('nothing about the customer is in sessionStorage', storage.session.length === 0, storage.session.join(','));

  await page.goBack().catch(() => {});
  await page.waitForTimeout(700);
  const afterBack = await page.textContent('body');
  check('Back does not reveal the previous customer', !/Viewport\s+Customer/.test(afterBack ?? ''));
  check('Back stays inside the kiosk', page.url().includes('/kiosk'), page.url());

  await page.reload({ waitUntil: 'domcontentloaded' });
  check('a reload lands on the idle screen, not a stale fitting', await state(page) === 'IDLE');
}

async function testDeclineAndTimeout(page) {
  console.log('\n5. decline and abandonment');
  await toConsent(page);
  await page.click('[data-action="consent-decline"]');
  await waitForState(page, 'IDLE', 8000);
  check('declining consent returns to idle', await state(page) === 'IDLE');

  await page.click('[data-action="start"]');
  await waitForState(page, 'IDENTIFICATION');
  await page.evaluate(() => {
    // Drive the machine's own timeout path rather than waiting 90 seconds.
    document.querySelector('[data-screen="IDENTIFICATION"]');
  });
  await page.click('[data-action="guest"]');
  await waitForState(page, 'CONSENT');
  await page.click('[data-action="consent-decline"]');
  await waitForState(page, 'IDLE', 8000);
  check('a guest can decline and reset just as safely', await state(page) === 'IDLE');
}

// ── 6. errors ───────────────────────────────────────────────────────────────

async function testHardwareErrors(page) {
  console.log('\n6. hardware and network errors');
  // No heartbeat: the last frame goes stale and the kiosk must say so itself.
  await toConsent(page);
  await page.click('[data-action="consent-accept"]');
  await answerIntake(page);
  await waitForState(page, 'HARDWARE_OFFLINE', 25000).catch(() => {});
  const s = await state(page);
  check('a silent unit becomes HARDWARE_OFFLINE', s === 'HARDWARE_OFFLINE', s ?? 'null');
  if (s === 'HARDWARE_OFFLINE') {
    const text = await page.textContent('[data-screen="HARDWARE_OFFLINE"]');
    check('the customer is told to ask an associate', /ask an associate/i.test(text ?? ''));
    check('no technical detail is shown', !/(error|exception|null|undefined|postgres|sql)/i.test(text ?? ''));
    await page.click('[data-screen="HARDWARE_OFFLINE"] [data-action="reset"]');
    await waitForState(page, 'IDLE', 8000);
    check('the error screen returns safely to idle', await state(page) === 'IDLE');
  }
}

async function testServiceMode(page) {
  console.log('\n7. service mode');
  const mark = await page.$('[data-screen="IDLE"] [data-hold="service"]');
  const box = await mark.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(5400);
  await page.mouse.up();
  check('a five-second hold on the wordmark opens service mode', await state(page) === 'SERVICE');

  for (const d of '0000') await page.click('[data-screen="SERVICE"] [data-key="' + d + '"]');
  await page.click('[data-action="pin-submit"]');
  await page.waitForTimeout(700);
  const gateVisible = await page.isVisible('[data-role="service-gate"]');
  check('a wrong PIN does not open the panel', gateVisible);

  for (const d of '4417') await page.click('[data-screen="SERVICE"] [data-key="' + d + '"]');
  await page.click('[data-action="pin-submit"]');
  await page.waitForSelector('[data-role="service-panel"]:not([hidden])', { timeout: 8000 });
  const panel = await page.textContent('[data-role="service-panel"]');
  check('the panel names the subsystems', /Stride Guide/.test(panel) && /Calibration/.test(panel));
  check('the panel gives an associate the real detail',
    /frames|paired|Ready|Valid/i.test(panel), panel.slice(0, 120));
  check('the panel shows no customer data', !/Viewport|Customer #|\(\d{3}\)/.test(panel));

  // Scoped to the unlocked panel: the PIN gate has its own Cancel with the same
  // action, and it is hidden by this point.
  await page.click('[data-role="service-panel"] [data-action="service-close"]');
  await waitForState(page, 'IDLE', 8000);
  check('leaving service mode returns to idle', await state(page) === 'IDLE');
}

// ── 8. layout ───────────────────────────────────────────────────────────────

async function testLayout(viewport, label) {
  console.log(`\n8. layout — ${label} (${viewport.width} x ${viewport.height})`);
  const page = await newPage(viewport);
  await enroll(page);
  const stopBeat = heartbeat(page, 'ready');

  const overflow = async (where) => {
    const o = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    check(`no horizontal overflow — ${where}`, o.doc <= o.win, `${o.doc} > ${o.win}`);
  };

  const touchTargets = async (where) => {
    const small = await page.$$eval('.screen.is-active button:not([hidden])', (nodes) =>
      nodes.filter((n) => n.offsetParent !== null)
        .map((n) => ({ label: (n.textContent || '').trim().slice(0, 20), rect: n.getBoundingClientRect() }))
        .filter((x) => x.rect.height < 48 || x.rect.width < 48)
        .map((x) => `${x.label} ${Math.round(x.rect.width)}x${Math.round(x.rect.height)}`));
    check(`every touch target is at least 48px — ${where}`, small.length === 0, small.join(', '));
  };

  const fitsWithoutScroll = async (where) => {
    const fits = await page.evaluate(() => {
      const active = document.querySelector('.screen.is-active');
      return active.scrollHeight <= active.clientHeight + 1;
    });
    check(`the panel fits without scrolling — ${where}`, fits);
  };

  await overflow('IDLE'); await touchTargets('IDLE'); await fitsWithoutScroll('IDLE');

  await page.click('[data-action="start"]');
  await waitForState(page, 'IDENTIFICATION');
  await overflow('IDENTIFICATION'); await touchTargets('IDENTIFICATION');
  await fitsWithoutScroll('IDENTIFICATION');

  const digits = '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  for (const d of digits) await page.click(`[data-key="${d}"]`);
  await page.click('[data-action="phone-next"]');
  await page.fill('#first-name', 'Layout');
  await page.fill('#last-name', 'Check');
  await page.click('[data-action="name-next"]');
  await waitForState(page, 'CONSENT');
  await overflow('CONSENT'); await touchTargets('CONSENT'); await fitsWithoutScroll('CONSENT');

  await page.click('[data-action="consent-accept"]');
  await answerIntake(page);
  await waitForState(page, 'HARDWARE_READY');
  await overflow('HARDWARE_READY'); await touchTargets('HARDWARE_READY');
  await fitsWithoutScroll('HARDWARE_READY');

  await page.waitForFunction(
    () => !document.querySelector('[data-action="capture"]').hasAttribute('disabled'),
    null, { timeout: 15000 });
  await page.click('[data-action="capture"]');
  await waitForState(page, 'RESULTS', 45000);
  await overflow('RESULTS'); await touchTargets('RESULTS');
  // RESULTS is the one screen allowed to scroll; its actions must still be reachable.
  const actionsVisible = await page.isVisible('[data-action="results-done"]');
  check('the results actions are reachable without scrolling', actionsVisible);

  stopBeat();
  await page.close();
}

// ── run ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!CODE) {
    console.error('usage: node e2e/kiosk-viewport.mjs <enrollment-code> [ingest-token]');
    process.exit(2);
  }
  if (!INGEST) console.log('! no ingest token given — hardware-dependent checks will be skipped\n');

  browser = await chromium.launch({ executablePath: CHROME });
  try {
    await testShell();
    const page = await testEnrollment();
    const previous = await testFlow(page);
    await testPrivacyReset(page, previous);
    await testDeclineAndTimeout(page);
    await testHardwareErrors(page);
    await testServiceMode(page);
    await page.close();
    await testLayout(PORTRAIT, 'portrait');
    await testLayout(LANDSCAPE, 'landscape');
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} checks · ${results.length - failed.length} ok · ${failed.length} failed`);
  console.log('\nNOTE: these ran in Chromium. They do not prove WebKit 12.1 compatibility —');
  console.log('see docs/phases/13-kiosk-ipad-mini-2.md for the manual A1490 checklist.\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
