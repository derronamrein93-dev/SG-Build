/**
 * The kiosk document.
 *
 * -- Why this is a string and not a React component -----------------------------
 *
 * The pilot device is an iPad mini 2 (A1490), which stops at iPadOS 12.5.7 and
 * therefore at WebKit 12.1. Two things follow, and they were measured rather
 * than assumed — see docs/phases/13-kiosk-ipad-mini-2.md for the scan output.
 *
 *   1. Next 15's own default browserslist target is still `safari 12`, so the
 *      SYNTAX Next emits is fine. That was the good news and it is why this
 *      change is not a framework rewrite.
 *
 *   2. The App Router's client runtime reads RSC payloads with
 *      `response.body.getReader()`. `fetch().body` arrived in Safari 14.1. First
 *      paint and hydration would survive; every client-side navigation after it
 *      would not. On top of which, hydrating React 19 on a 2013 A7 with 1 GB of
 *      RAM is a cost paid on every cold launch, for a screen whose entire job is
 *      to show one thing at a time.
 *
 * So `/kiosk` is a Route Handler that returns this document: no React, no
 * hydration, no framework runtime, ~5 KB of hand-written ES5 and a stylesheet.
 * Everything behind it — tenancy, RLS, the rules engine, the report — is the
 * existing application, untouched.
 *
 * -- Why every screen is in the document from the start ------------------------
 *
 * The client toggles a class. It does not build DOM, and it does not assign
 * innerHTML on a state change. On this GPU that is the difference between a
 * transition and a stutter, and it means the markup can be read here rather
 * than reconstructed from string concatenation in a browser file.
 */
import { TRANSITIONS, KIOSK_STATES } from './machine';
import { CUSTOMER_MESSAGES } from './errors';
import { NEW_CUSTOMER_QUESTIONS, RETURNING_CUSTOMER_QUESTIONS } from '../intake/questions';
import { KIOSK_APP_VERSION } from './service';

/** Static asset version. Bumped with the asset, so a kiosk cannot run a stale pair. */
export const KIOSK_ASSET_VERSION = '1';

export interface KioskBootstrap {
  enrolled: boolean;
  appVersion: string;
  deviceName: string | null;
  locationName: string | null;
  hasHardware: boolean;
  config: {
    /** Inactivity before the warning. */
    idleTimeoutMs: number;
    /** Warning countdown before the session is cleared. */
    idleWarningMs: number;
    /** Hardware poll interval — see the phase doc on why this is not faster. */
    hardwarePollMs: number;
    /** Poll interval while the backend is computing. */
    processingPollMs: number;
    /** How long the customer is asked to hold still. */
    captureHoldSeconds: number;
    /** Press-and-hold on the wordmark to reach service mode. */
    serviceHoldMs: number;
  };
}

export const DEFAULT_KIOSK_CONFIG: KioskBootstrap['config'] = {
  idleTimeoutMs: 90_000,
  idleWarningMs: 20_000,
  // 2 Hz. The pressure matrix runs far faster than this and the iPad never sees
  // it: the customer needs to know whether their feet are in the right place,
  // which is a fact that changes about once a second. Polling harder would burn
  // an A7's battery and its main thread to redraw three tick marks.
  hardwarePollMs: 500,
  processingPollMs: 1_000,
  captureHoldSeconds: 3,
  serviceHoldMs: 5_000,
};

/** `</script>` inside a JSON island ends the island. So does U+2028 in old engines. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A full-bleed panel. Exactly one is visible at a time. */
function screen(state: string, inner: string, extraClass = ''): string {
  return `<section class="screen ${extraClass}" data-screen="${state}" aria-hidden="true">${inner}</section>`;
}

/**
 * Rendered on more than one screen, so it carries no id — two elements sharing
 * one made `getElementById` return whichever came first in the document, which
 * was the hidden copy on the setup screen, and the service gesture silently
 * bound to an element nobody could touch.
 */
const WORDMARK =
  `<button type="button" class="wordmark" data-hold="service" aria-label="Stride Guide">` +
  /* The mark from assets/img/favicon.svg, inline: one static path, no request,
     no icon font, and nothing to fail to load on a cold launch. */
  `<svg class="wordmark-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">` +
  `<path d="M9 22.5c3.4 0 5-2.2 5.6-4.6.7-2.7 2.3-4.4 5.4-4.4" fill="none" ` +
  `stroke="#1F9C86" stroke-width="2.6" stroke-linecap="round"/>` +
  `<path d="M12 9.5h8" fill="none" stroke="#24C95A" stroke-width="2.6" stroke-linecap="round"/>` +
  `<circle cx="23.5" cy="22.5" r="1.9" fill="#1F9C86"/></svg>` +
  `<span class="wordmark-text">Stride&nbsp;Guide</span></button>`;

function keypad(): string {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return `<div class="keypad">` + keys.map((k) => {
    if (k === 'clear') return `<button type="button" class="key key-alt" data-key="clear">Clear</button>`;
    if (k === 'back') return `<button type="button" class="key key-alt" data-key="back">⌫</button>`;
    return `<button type="button" class="key" data-key="${k}">${k}</button>`;
  }).join('') + `</div>`;
}

function errorScreen(state: string, code: keyof typeof CUSTOMER_MESSAGES, extra = ''): string {
  const m = CUSTOMER_MESSAGES[code];
  return screen(state, `
    <div class="panel panel-center">
      <div class="glyph glyph-attention" aria-hidden="true"></div>
      <h1 class="h1">${esc(m.title)}</h1>
      <p class="lede">${esc(m.body)}</p>
      ${extra}
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="${state === 'SCAN_FAILED' ? 'retry-scan' : 'reset'}">${esc(m.action)}</button>
      </div>
    </div>`, 'screen-error');
}

export function renderKioskDocument(boot: KioskBootstrap): string {
  const bootstrap = {
    transitions: TRANSITIONS,
    states: KIOSK_STATES,
    messages: CUSTOMER_MESSAGES,
    questions: {
      new: NEW_CUSTOMER_QUESTIONS.map((q) => ({ field: q.field, prompt: q.prompt })),
      returning: RETURNING_CUSTOMER_QUESTIONS.map((q) => ({ field: q.field, prompt: q.prompt })),
    },
    ...boot,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- viewport-fit=cover so env(safe-area-inset-*) is populated. The mini 2 has
     no notch, but the same build runs on newer hardware and a home-indicator
     inset eating the primary button is not a bug worth shipping. -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<!-- iOS 12 reads the legacy apple-mobile-web-app-* keys, not the manifest's
     display mode. Both are present; the manifest is for everything else. -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Stride Guide">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
<meta name="theme-color" content="#0E1214">
<meta name="robots" content="noindex, nofollow">
<title>Stride Guide</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/kiosk/icon-180.png">
<link rel="icon" href="/kiosk/icon-192.png">
<link rel="stylesheet" href="/kiosk/kiosk.css?v=${KIOSK_ASSET_VERSION}">
</head>
<body class="kiosk">
<div class="app" id="app">

${screen('UNENROLLED', `
  <div class="panel panel-center">
    ${WORDMARK}
    <h1 class="h1">Set Up This FitOS Kiosk</h1>
    <p class="lede">An associate can activate this device with a code from FitOS.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="enroll-start">Enter Device Code</button>
    </div>
  </div>`, 'screen-dark')}

${screen('ENROLLING', `
  <div class="panel">
    <h1 class="h1">Device Code</h1>
    <label class="field-label" for="enroll-code">Type the code shown in FitOS</label>
    <input class="field field-code" id="enroll-code" type="text" autocapitalize="characters"
           autocorrect="off" spellcheck="false" placeholder="NORTHSIDE-A7KF-9M2Q">
    <p class="field-error" data-role="enroll-error" hidden></p>
    <div class="actions actions-row">
      <button type="button" class="btn btn-ghost" data-action="enroll-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="enroll-submit">Activate Kiosk</button>
    </div>
  </div>`, 'screen-dark')}

${screen('IDLE', `
  <div class="panel panel-center idle">
    ${WORDMARK}
    <h1 class="display">Find the shoes that fit<br>how you actually move.</h1>
    <p class="lede lede-idle">A two-minute scan. Your results, explained.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary btn-hero" data-action="start">Start My Fit</button>
    </div>
    <p class="footnote" data-role="idle-location"></p>
  </div>`, 'screen-dark')}

${screen('IDENTIFICATION', `
  <div class="panel" data-step="phone">
    <p class="step">Step 1 of 3</p>
    <h1 class="h1">What's your mobile number?</h1>
    <p class="lede">So we can find your fit next time. We never share it.</p>
    <div class="phone-display" data-role="phone-display" aria-live="polite">(&nbsp;&nbsp;&nbsp;)&nbsp;&nbsp;&nbsp;-&nbsp;&nbsp;&nbsp;&nbsp;</div>
    ${keypad()}
    <div class="actions actions-row">
      <button type="button" class="btn btn-ghost" data-action="guest">Skip</button>
      <button type="button" class="btn btn-primary" data-action="phone-next" disabled>Continue</button>
    </div>
  </div>
  <div class="panel" data-step="name" hidden>
    <p class="step">Step 1 of 3</p>
    <h1 class="h1">And your name?</h1>
    <label class="field-label" for="first-name">First name</label>
    <input class="field" id="first-name" type="text" autocapitalize="words" autocorrect="off" autocomplete="off">
    <label class="field-label" for="last-name">Last name</label>
    <input class="field" id="last-name" type="text" autocapitalize="words" autocorrect="off" autocomplete="off">
    <div class="actions actions-row">
      <button type="button" class="btn btn-ghost" data-action="name-back">Back</button>
      <button type="button" class="btn btn-primary" data-action="name-next" disabled>Continue</button>
    </div>
  </div>`)}

${screen('CONSENT', `
  <div class="panel panel-middle">
    <p class="step">Step 2 of 3</p>
    <h1 class="h1">Before we start</h1>
    <ul class="consent-list">
      <li><span class="tick" aria-hidden="true"></span>We measure how you stand and move, and save it to your record at this store.</li>
      <li><span class="tick" aria-hidden="true"></span>It helps us fit you today and remember your fit next time.</li>
      <li><span class="tick" aria-hidden="true"></span>It is not a medical assessment.</li>
      <li><span class="tick" aria-hidden="true"></span>Ask an associate any time to see or delete your record.</li>
    </ul>
    <label class="checkline" data-role="report-consent-line">
      <input type="checkbox" id="consent-report" class="checkbox">
      <span>Also send my fit report to my phone.</span>
    </label>
    <div class="actions actions-row">
      <button type="button" class="btn btn-ghost" data-action="consent-decline">No thanks</button>
      <button type="button" class="btn btn-primary" data-action="consent-accept">I Agree — Continue</button>
    </div>
  </div>`)}

${screen('INTAKE', `
  <div class="panel panel-center">
    <p class="step" data-role="intake-step">Step 3 of 3</p>
    <h1 class="h1 h1-question" data-role="intake-prompt"></h1>
    <div class="actions actions-row actions-wide">
      <button type="button" class="btn btn-answer" data-action="intake-no">No</button>
      <button type="button" class="btn btn-answer btn-answer-yes" data-action="intake-yes">Yes</button>
    </div>
  </div>`)}

${screen('HARDWARE_READY', `
  <div class="panel panel-center">
    <h1 class="h1">Step onto Stride Guide</h1>
    <p class="lede">Place both feet inside the guides and stand naturally.</p>
    <ul class="checklist">
      <li data-check="left"><span class="check-state" aria-hidden="true"></span><span class="check-label">Left foot</span><span class="check-value">Waiting</span></li>
      <li data-check="right"><span class="check-state" aria-hidden="true"></span><span class="check-label">Right foot</span><span class="check-value">Waiting</span></li>
      <li data-check="weight"><span class="check-state" aria-hidden="true"></span><span class="check-label">Weight</span><span class="check-value">Waiting</span></li>
    </ul>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="capture" disabled>Scan My Feet</button>
    </div>
  </div>`, 'screen-dark')}

${screen('CAPTURING', `
  <div class="panel panel-center">
    <h1 class="h1">Hold still…</h1>
    <p class="count" data-role="count" aria-live="assertive">3</p>
    <p class="lede">Keep both feet flat and look straight ahead.</p>
  </div>`, 'screen-dark')}

${screen('PROCESSING', `
  <div class="panel panel-center">
    <h1 class="h1">Analyzing your fit…</h1>
    <div class="bar" aria-hidden="true"><div class="bar-fill" data-role="bar"></div></div>
    <p class="lede" data-role="processing-note">This takes a few seconds.</p>
  </div>`, 'screen-dark')}

${screen('RESULTS', `
  <div class="panel panel-scroll">
    <p class="step">Your fit</p>
    <h1 class="h1" data-role="result-headline"></h1>
    <p class="lede" data-role="result-subhead"></p>
    <dl class="fitrows" data-role="result-profile"></dl>
    <h2 class="h2">Why</h2>
    <p class="prose" data-role="result-why"></p>
    <h2 class="h2" data-role="products-heading" hidden>What to look for</h2>
    <ul class="products" data-role="result-products"></ul>
    <p class="disclaimer" data-role="result-disclaimer"></p>
    <div class="actions actions-row sticky-actions">
      <button type="button" class="btn btn-ghost" data-action="results-done">I'm Done</button>
      <button type="button" class="btn btn-primary" data-action="deliver-open" hidden>Send My Results</button>
    </div>
  </div>`)}

${screen('DELIVERY', `
  <div class="panel panel-center">
    <h1 class="h1">Send my results</h1>
    <p class="lede" data-role="delivery-target"></p>
    <p class="field-error" data-role="delivery-error" hidden></p>
    <div class="actions actions-row">
      <button type="button" class="btn btn-ghost" data-action="deliver-back">Back</button>
      <button type="button" class="btn btn-primary" data-action="deliver-send">Send My Results</button>
    </div>
  </div>`)}

${screen('COMPLETE', `
  <div class="panel panel-center">
    <div class="glyph glyph-done" aria-hidden="true"></div>
    <h1 class="h1">You're all set.</h1>
    <p class="lede" data-role="complete-note">Take your results to an associate — they'll pull your sizes.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="finish">Done</button>
    </div>
  </div>`)}

${screen('RESETTING', `
  <div class="panel panel-center">
    <p class="lede">Thanks.</p>
  </div>`, 'screen-dark')}

${errorScreen('HARDWARE_OFFLINE', 'hardware_offline')}
${errorScreen('CALIBRATION_REQUIRED', 'calibration_required')}
${errorScreen('SCAN_FAILED', 'scan_failed')}
${errorScreen('NETWORK_OFFLINE', 'network')}
${errorScreen('SESSION_TIMEOUT', 'session_expired')}

${screen('SERVICE', `
  <div class="panel panel-scroll service">
    <div class="service-gate" data-role="service-gate">
      <h1 class="h1">Associate PIN</h1>
      <div class="phone-display" data-role="pin-display" aria-live="polite">••••</div>
      ${keypad()}
      <p class="field-error" data-role="pin-error" hidden></p>
      <div class="actions actions-row">
        <button type="button" class="btn btn-ghost" data-action="service-close">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="pin-submit">Unlock</button>
      </div>
    </div>
    <div class="service-panel" data-role="service-panel" hidden>
      <p class="step">FitOS device status</p>
      <h1 class="h1" data-role="service-name"></h1>
      <p class="lede" data-role="service-summary"></p>
      <ul class="diag" data-role="service-rows"></ul>
      <div class="actions actions-col">
        <button type="button" class="btn btn-ghost" data-action="service-refresh">Refresh</button>
        <button type="button" class="btn btn-ghost" data-action="service-reset-session">Reset Customer Session</button>
        <button type="button" class="btn btn-primary" data-action="service-close">Return to Idle</button>
      </div>
    </div>
  </div>`, 'screen-dark')}

  <div class="overlay" id="timeout-overlay" hidden>
    <div class="overlay-card">
      <h2 class="h2">Still there?</h2>
      <p class="lede">This fitting will clear in <span data-role="timeout-count">20</span> seconds.</p>
      <button type="button" class="btn btn-primary" data-action="stay">I'm Still Here</button>
    </div>
  </div>

  <div class="offline-strip" id="offline-strip" hidden>Reconnecting…</div>
</div>

<script type="application/json" id="kiosk-bootstrap">${safeJson(bootstrap)}</script>
<script src="/kiosk/legacy.js?v=${KIOSK_ASSET_VERSION}"></script>
<script src="/kiosk/kiosk.js?v=${KIOSK_ASSET_VERSION}"></script>
</body>
</html>`;
}
