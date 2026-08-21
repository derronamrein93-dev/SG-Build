# 13 · The FitOS kiosk on an iPad mini 2 (A1490)

> The pilot puts a 2013 iPad on a pedestal in a store and lets a customer drive
> it. This is what that costs, what it rules out, and what was built.

---

## 0. The device, stated precisely

| | |
| --- | --- |
| Model | iPad mini 2, A1490 (cellular; A1489/A1491 are the same class) |
| SoC | Apple A7, 1 GB RAM |
| Display | 7.9-inch, 2048 × 1536, **4:3** |
| CSS viewport | **768 × 1024** portrait · 1024 × 768 landscape, at DPR 2 |
| Maximum OS | **iPadOS 12.5.7** — the last release Apple shipped for it |
| Browser engine | **WebKit 12.1** (Safari 12.1 feature set) |

Everything below follows from the last two rows. The device is treated as the
**minimum-performance and minimum-capability target** for the pilot: if it works
here it works on anything the retailer is likely to put next to it.

---

## 1. Can the existing FitOS stack run on it?

**Yes — and this was measured, not assumed.**

FitOS is Next.js 15.5 with React 19. The obvious worry is that the framework
emits syntax WebKit 12.1 cannot parse. It does not:

```
$ npm run build
$ npx tsx scripts/legacy-scan.ts .next/static/chunks
17 file(s) scanned · 0 error(s) · 5 warning(s)
```

The scanner parses every emitted chunk with the TypeScript compiler and looks
for syntax Safari 12.1 rejects — optional chaining, nullish coalescing, logical
assignment, private class fields, BigInt, numeric separators. There is none.

The reason is in Next itself. `next/dist/shared/lib/modern-browserslist-target.js`
still reads:

```js
const MODERN_BROWSERSLIST_TARGET = ['chrome 64', 'edge 79', 'firefox 67', 'opera 51', 'safari 12'];
```

So SWC already transpiles the application down to Safari 12 with no
configuration. React 19's published bundles were checked separately and contain
no post-ES2016 syntax either.

The five warnings are `Object.hasOwn` and `Array.prototype.at`, both Safari
15.4. Next inlines guarded polyfills for both into the app chunk
(`Object.hasOwn||(Object.hasOwn=function...)`), so they are covered.

### The one thing that genuinely does not work

`react-server-dom-webpack`'s client reads RSC payloads with
`response.body.getReader()`. **`fetch().body` arrived in Safari 14.1.**

Consequences on the A1490:

- first paint and hydration: fine (the flight data arrives in inline
  `self.__next_f.push()` script tags, no stream needed)
- every client-side navigation after that: **throws**

That is not a syntax problem and it is not something a polyfill fixes cheaply.

### So this is not a stop point, but it does decide the architecture

Two further facts, weighed alongside it:

- React 19 hydration on an A7 with 1 GB of RAM is a cost paid on every cold
  launch — and a kiosk cold-launches constantly, because iOS evicts background
  tabs on this device aggressively.
- The kiosk shows exactly one thing at a time and holds almost no state. It is
  the worst possible case for paying a framework's fixed cost.

**Decision: `/kiosk` is a Next Route Handler that returns a complete HTML
document with no React and no hydration.** Same application, same server, same
`withTenant`, same rules engine, same report. Only the client rendering
strategy differs.

Measured result:

| | Framework page | `/kiosk` |
| --- | --- | --- |
| HTML | ~4 KB | 21 KB (every screen, inline) |
| JavaScript shipped | 103 KB (~35 KB gz) | **36 KB (10.3 KB gz)** |
| CSS | Tailwind build | 18.5 KB (5.1 KB gz) |
| **Total over the wire (gz)** | ~40 KB + framework parse | **~20 KB, no framework parse** |
| `_next/` references in the document | many | **0** — asserted by a test |

### Rejected alternative

A React page plus a `browserslist` override. It fixes nothing that was broken
(the syntax was already fine), still ships 103 KB of framework JS to the A7, and
still depends on `Response.body` for anything past first paint.

---

## 2. Browser-target strategy

### Global: the target is now stated, not inherited

`package.json` gains:

```json
"browserslist": ["chrome 64", "edge 79", "firefox 67", "opera 51", "safari 12", "ios_saf 12.2"]
```

This is **identical to Next's current default**, so it changes not one byte of
today's output. It exists so that a future Next upgrade raising its own default
(Next 16 is expected to) becomes a visible diff rather than a kiosk that stops
booting in a store.

**Scope: global.** Bundle impact: zero, today.

### Kiosk-specific: ES5 by rule, checked by a parser

`public/kiosk/kiosk.js` is written in ES5 syntax — `var`, `function`, no arrows,
no template literals. Not because WebKit 12.1 lacks those (it has most of them),
but because *"ES5"* is a rule a parser can check and *"whatever Safari 12.1
happens to support"* is not.

`src/lib/kiosk/compat.test.ts` runs the scanner over the shipped files on every
test run, and fails the suite on any violation. A syntax error in a `<script>`
is total — the file does not partially run — so this is the difference between a
working kiosk and a blank screen on a pedestal.

### Polyfills: four, ~700 bytes, and none of them are needed today

`public/kiosk/legacy.js` guards `Object.hasOwn`, `Array.prototype.at`,
`String.prototype.replaceAll` and `Promise.allSettled`. WebKit 12.1 already has
everything the kiosk currently uses — `fetch`, `Promise`, `JSON`, `classList`,
`dataset`, `textContent`, `Element.closest`, all of ES5. These four are the
things a future edit is most likely to reach for, guarded so they cost nothing
on a modern browser.

**core-js was deliberately not added.** ~30 KB of parse time on an A7 to solve a
gap that does not exist.

### CSS

Hand-written, 18.5 KB, no Tailwind (the kiosk does not go through the app's
PostCSS pipeline). Ruled out, each asserted by `C09` in the compat test:

| Feature | Available from | Used instead |
| --- | --- | --- |
| `gap` in flexbox | Safari 14.1 | margins — there is no `gap` in the file at all |
| `aspect-ratio` | Safari 15 | fixed heights |
| `dvh`/`svh`/`lvh` | Safari 15.4 | `position: fixed` on the app container |
| `:is()` / `:where()` | Safari 14 | selectors written out |
| `inset` shorthand | Safari 14.1 | `top`/`right`/`bottom`/`left` |
| `clamp()` | Safari 13.1 | one landscape media query |
| `backdrop-filter` | — | flat colour (an A7 cannot afford it anyway) |
| CSS Grid | 10.1, with quirks | flex and block |
| CSS custom properties | 9.1 | literal colours — a literal cannot fail |

Used deliberately, each with a plain declaration before it so the fallback is the
correct rendering rather than a broken one:

- `env(safe-area-inset-*)` — preceded by a fixed value
- `position: sticky` on one element, where the layout is already correct without it

Fonts: the system stack (`-apple-system`), so there is no webfont request on a
cold launch. The associate app's Google Fonts link is untouched and the kiosk
does not inherit it.

---

## 3. The kiosk route

`GET /kiosk` → `src/app/kiosk/route.ts`.

A Route Handler, not a page, for the reason in §1. It decides one thing —
enrolled or not — and serves a static document; everything else the kiosk asks
for over `/api/kiosk/*`. **The document therefore contains no customer data at
any point in its life**, which is what makes it safe to be the thing a stale
back-navigation or a bfcache restore lands on.

Response headers: `no-store`, `X-Frame-Options: DENY`, `Referrer-Policy:
no-referrer`, `X-Content-Type-Options: nosniff`.

Nothing from the associate dashboard is reachable: no sidebar, no navigation, no
customer history, no settings, no debug controls, no outbound link (asserted by
`C08`). The customer sees one panel at a time.

---

## 4. The state machine

`src/lib/kiosk/machine.ts` — a table, and the table is the only way to move.

Transitions are driven by **events**, not target states: `apply(m,
'CONSENT_GRANTED')` either produces the one state that follows or is rejected.
There is no `goTo(state)` for a caller to misuse, so an invalid transition is not
something to remember not to write — it is something there is no way to express.

**The browser is handed the table, not a second copy of the logic.** `/kiosk`
serializes `TRANSITIONS` into the page as JSON and the ES5 client enforces it
generically. One source of truth, tested under `node:test`, running unchanged in
Safari 12.

### States

```
operational      UNENROLLED · ENROLLING · SERVICE
customer flow    IDLE · IDENTIFICATION · CONSENT · INTAKE · HARDWARE_READY ·
                 CAPTURING · PROCESSING · RESULTS · DELIVERY · COMPLETE · RESETTING
error            HARDWARE_OFFLINE · NETWORK_OFFLINE · SCAN_FAILED ·
                 CALIBRATION_REQUIRED · SESSION_TIMEOUT
```

`INTAKE` is one state beyond the brief's minimum set. It is where the existing
three-question quick intake runs — the recommendation engine is fed by those
answers, and duplicating or skipping them would mean either a second intake
implementation or a worse recommendation.

### The normal flow

```
IDLE → IDENTIFICATION → CONSENT → INTAKE → HARDWARE_READY → CAPTURING
     → PROCESSING → RESULTS → DELIVERY → COMPLETE → RESETTING → IDLE
```

### Transition rules

| Rule | Where it comes from |
| --- | --- |
| `RESET` is legal in every state except `RESETTING`, `UNENROLLED`, `ENROLLING` | added uniformly in `build()`, so a new state cannot forget it |
| `RESETTING` is the **only** door into `IDLE` (besides `ENROLL_OK`) | asserted by `K08` |
| `CONSENT_GRANTED` from `CONSENT` is the **only** door into `INTAKE` | asserted by `K04` |
| `CONSENT_DECLINED` → `RESETTING` | a decline is not an error and not a dead end |
| `TIMEOUT` is legal in every customer state **except `PROCESSING`** | the backend is working; standing still is not walking away |
| `NETWORK_LOST` records where it happened; `NETWORK_BACK` returns only there | `resumeFrom`, enforced in `apply()` rather than by a table row |
| `SERVICE_OPEN` from anywhere a person stands; every exit from `SERVICE` leads to `RESETTING` or `UNENROLLED` | an associate must not be able to hand a half-finished fitting back through a door the customer never used |
| `REVOKED` → `UNENROLLED` from anywhere | a revoked credential drops the device out of service immediately |

Two properties are asserted over the whole table rather than case by case,
because they are the ones that stop being true when someone adds a state:

- **every state can reach `IDLE`** (`K06`, breadth-first over the table)
- **every state that can hold customer data can `RESET` in one event** (`K07`)

---

## 5. Customer session lifecycle and the privacy reset

### Nothing is written before consent

`IDENTIFICATION` performs **no writes at all** — not even a phone lookup. A
customer who walks away at the consent screen leaves nothing behind.

`beginSession()` is called on `CONSENT_GRANTED` and at no other point, which is
what makes "nothing customer-linked is stored before consent" a property of the
code rather than of the screen order.

### The membership oracle, and what was done about it

On an unattended kiosk, telling whoever types a phone number whether it belongs
to a customer is a membership oracle: type a neighbour's number, learn they shop
here. So the identification screen asks **everyone** for phone, first name and
last name, and looks identical either way. The lookup happens server-side after
consent; the customer is greeted by name only once they have granted it.

This does not fully close the question — see §12.

### The reset

`resetSession()` in `public/kiosk/kiosk.js` is the **only** way back to `IDLE`.
Every path goes through it: finishing, declining, timing out, an error, an
associate's reset, a bfcache restore, a `popstate`, a reload.

It:

1. tells the server to void the fitting (`POST /api/kiosk/session/abandon` →
   `status='voided'`, `void_reason='customer_withdrew'`) — best effort, never
   awaited
2. replaces the single state object holding **everything** the customer typed,
   chose, or was shown, in one assignment
3. blanks every `<input>` in the document, every rendered list, every text node
   the flow wrote
4. clears every timer and stops hardware polling
5. clears `sessionStorage` (nothing is written there; a stray key from an older
   build would otherwise outlive a deploy)
6. `history.replaceState` back to `/kiosk`

**Navigating to `/kiosk` is not a reset and is never used as one.**

`localStorage` is never touched — asserted by `C07`, which strips comments with
the real parser first so that the file's own explanation of why it avoids
`localStorage` does not read as a use of it.

Device identity persists separately, in an httpOnly cookie the page's JavaScript
cannot read.

---

## 6. Refresh, eviction and crash recovery

The A1490 has 1 GB of RAM. Safari **will** evict this tab.

- Device identity survives — it is a server-read cookie.
- **Nothing about the customer survives**, because nothing about the customer was
  ever written anywhere but a closure.
- There is deliberately **no "resume your fitting" path**. The safe state after an
  unexplained restart is `IDLE`.
- `pageshow` with `event.persisted` (bfcache restore) wipes before the previous
  customer's DOM is on screen for a second time.
- `visibilitychange` to hidden mid-fitting resets — the customer walked off with
  an associate, or Guided Access was exited.
- `popstate` is trapped and pushes back, so an edge swipe cannot leave the kiosk.
- An interrupted fitting is left `voided`, not `in_progress` forever.

---

## 7. Inactivity

`idleTimeoutMs: 90_000`, then a 20-second warning overlay, then a full reset.

The warning is an overlay on the live state rather than a state of its own, so
"I'm Still Here" simply re-arms the clock. `PROCESSING` is exempt in the machine
itself, so a slow recommendation can never be mistaken for an abandoned session.

---

## 8. Hardware

```
ESP32 → bridge → POST /api/hardware/telemetry → device_health_event
                                                       ↓
                     GET /api/kiosk/hardware ← kiosk ←─┘   (2 Hz, only while
                                                            positioning/scanning)
```

**Web Bluetooth was never on the table** — it does not exist in Safari on any iOS
version. Polling over HTTPS was chosen over WebSocket or SSE because it is the
only transport with no version-dependent behaviour on WebKit 12.1, it survives a
flaky store network without a reconnection state machine, and at 2 Hz for the
thirty seconds a customer is being positioned it costs nothing.

### Authentication

The bridge authenticates as the **installation**, not the organization:
`device_installation.ingest_token_hash`, resolved by hash through the service
role. A token lifted off a bench unit cannot speak for a store, and retiring a
unit (`removed_at`) silences it without touching any other credential.

This is a **separate credential from the kiosk's**, deliberately: a kiosk
credential must never be able to forge a hardware frame, because that is exactly
what would let a browser fake readiness.

### Normalized state

```ts
type HardwareStatus = {
  connected, matrixReady, loadCellsReady, calibrationValid,
  leftFootDetected, rightFootDetected, weightStable,
  totalWeight?, lastReadingAt?, secondsSinceReading?,
  firmwareVersion?, calibrationVersion?, serial?, errorCode?,
  health: { link, pressureMatrix, loadCells, calibration }  // healthy|degraded|offline|unknown
}
```

Two rules keep it honest:

- **Silence is not readiness.** No frame within `STALE_AFTER_MS` (12 s) means
  `offline`, and *every claim on a stale frame is dropped* — not just the link. A
  frame dated in the future is also refused; clock skew on a store network is
  real and is not evidence that anyone is standing on the plate.
- **The kiosk is told, not asked.** `/api/kiosk/session/capture` re-reads
  telemetry server-side. The browser's claim that both feet are on the plate is
  not an input.

### Capture

The bridge produces the capture: it holds the frame buffer, decides when a
stance has been stable long enough, and publishes the result on its telemetry
frame. The kiosk asks for the most recent one. **If the current frame carries no
capture block, `/capture` fails as `scan_failed`** — there is no code path in
FitOS that manufactures a `scan` row from a button press.

Derived measurements arrive in the assessment vocabulary FitOS already uses
(`size_left`, `width`, `arch_type`, …) and are written through an allowlist
(`SCAN_ASSESSMENT_FIELDS`). The bridge is a device on a store network; it is not
allowed to name a column.

For desk work, `npm run kiosk:sim -- <ingest-token>` posts real frames to the
real endpoint with a real token. It lives outside the application on purpose:
**a "simulate hardware" switch inside the kiosk is a switch that ships.** With
the simulator not running, the kiosk correctly shows `HARDWARE_OFFLINE`, which is
the true state of a store with no unit plugged in.

---

## 9. Processing happens off the iPad

`POST /api/kiosk/session/complete` runs `finishFitting()` — the same call the
associate app makes, with the same rule set, the same catalog matcher, the same
language composer and the same frozen report snapshot.

The iPad's share of the recommendation is: one POST, and rendering the reply.

It has **no scoring of its own and must never acquire one.** `src/lib/kiosk/view.ts`
computes nothing; it reads `report.content_snapshot` and rearranges it for a
7.9-inch screen, dropping `productModelId` (an internal uuid) and
`ruleRationale` (raw rule strings that have not been through the guardrail
lexicon).

---

## 10. Results delivery — and an honest gap

`POST /api/kiosk/session/deliver` checks `receive_report` consent through the
`hasConsent()` chokepoint, records the request against the report in `audit_log`,
and returns a **masked** destination (`••• ••• 4417`).

The report token minted by `finishFitting()` is reused untouched: already hashed,
already 90-day expiring, already revocable. **It is never returned to the
browser** — the customer's link is a bearer secret and this is a shared device,
so putting it in the page makes it a secret the next customer can press Back to
find.

**There is no send transport in FitOS.** docs/04 §3 specifies an emailed link;
nothing implements it, and inventing an SMS gateway is not this change's job. So
the confirmation says what is true: *"Your fit report is saved. Your associate
will send the link to ••• ••• 4417."* Wiring a real sender is a queue reader over
`kiosk.delivery_requested` audit rows.

---

## 11. Device identity and enrollment

```
Organization
└── Location
    └── kiosk_device          ← the iPad
        └── device            ← the Stride Guide unit (via device_installation)
```

Migration `0016_kiosk_device.sql`.

### The rule the whole design rests on

**The browser never says which tenant it is.** It presents an opaque credential;
organization and location are read off the row that credential resolves to.
There is no parameter on any kiosk function that lets a caller name an
organization, and `resolveKioskDevice` cannot be given one. Same rule
`loadReportByToken` already follows, for the same reason: these are the only two
paths where an unauthenticated party talks to the database, so in both the hash
match **is** the authorization boundary and RLS is not there to catch a mistake.

### Enrollment

1. an operator mints a code: `npm run kiosk:enroll -- code "Northside Front" SG-A19F`
2. `NORTHSIDE-A7KF-9M2Q` — single use, 15 minutes, stored **hashed**
3. the kiosk submits it at `/kiosk` → Enter Device Code
4. the backend resolves by hash, checks expiry and prior use
5. it creates a dedicated `app_user` with role **`kiosk_device`** and no
   `pin_hash` — so a kiosk fitting is attributable but cannot sign in as a person
6. it mints a 256-bit credential, stores the SHA-256, returns the plaintext as an
   httpOnly `SameSite=Strict` cookie
7. the code is marked consumed; a replay gets `already_used`

Revocation clears `credential_hash` outright and deactivates the acting user.
`credential_hash` has **no update grant for `fitos_app`** — a compromised app
process cannot re-mint one.

### Why enrollment is a CLI, not a screen

**FitOS has no authentication yet.** `src/lib/session.ts` returns a seeded
context, and the README says so. A web page that mints kiosk credentials would
be a page anyone who can reach the server can open — worse than a command that
requires database access. When auth lands, this becomes an authorized-admin
screen and the functions it calls do not change: they already take an explicit
tenant context and derive nothing from the caller.

---

## 12. Service mode

Press and hold the wordmark for **5 seconds**. Not a triple-tap or a corner tap —
a customer discovers those by accident; a five-second hold on a screen whose
every other element responds immediately is something only a person who already
knows does.

Then an **associate PIN**, checked against `app_user.pin_hash` — a column that has
existed since migration 0001 and has never had a writer. This change defines its
format: scrypt from `node:crypto` (`scrypt$N$r$p$salt$key`), not a bare digest,
because a four-digit PIN has ten thousand possibilities and a SHA-256 of one is a
rainbow table. Not bcrypt or argon2 either — those are dependencies, and
`node:crypto` already ships a memory-hard KDF.

Scoping: **active associates at this kiosk's own location only.** A PIN that
works in one store does not open the panel in another, even within the same
organization. Kiosk acting-users are excluded twice over — by having no
`pin_hash` and by the role filter.

The panel shows: FitOS API · Kiosk · Stride Guide · ESP32 serial · Pressure
matrix · Load cells · Calibration · Last frame · Last scan · Firmware · FitOS
app · Enrolled. Actions: refresh, reset customer session, return to idle.

No customer list, no fitting history, no settings, no link out.

### Two audiences, one state

| Customer | Associate |
| --- | --- |
| "Stride Guide isn't ready yet. Please ask an associate for help." | "No pressure-matrix frames received for 12.4 seconds (stale after 12s)." |
| "Stride Guide needs a quick setup check." | "Unit is reporting but calibration is invalid (cal-2024-11)." |

Subsystem health is normalized to `healthy` / `degraded` / `offline` / `unknown`.
Calibration is the one subsystem whose bad state is `degraded` rather than
`offline` — the unit is talking, it just cannot be trusted to measure, and that
is the difference between two different sentences on the customer's screen.

---

## 13. Error UX

Every failure returns a **code** from `src/lib/kiosk/errors.ts`, never a message.
`handle()` in `src/lib/kiosk/api.ts` is the only place a kiosk exception becomes
a response; an unrecognised exception becomes `unavailable`, full stop. There is
no branch that reads a message and passes part of it on — that is exactly how a
constraint name ends up on a shop floor.

Never exposed: stack traces, Postgres errors, API payloads, SQL, hardware
exceptions, internal ids.

---

## 14. Performance

| Choice | Why |
| --- | --- |
| Zero framework JS, zero hydration | the single largest cost on an A7 |
| Every screen in the document from the start; state toggles a class | no DOM construction on a transition, no `innerHTML` from server data |
| One delegated `click` listener for the whole document | ~30 individual listeners is ~30 closures held for the life of the process |
| Hardware polling at 2 Hz, and only while positioning or scanning | the matrix runs far faster; the iPad never sees a frame. What a customer needs to know changes about once a second |
| Progress bar is a CSS `width` transition on a 400 ms timer | no per-frame JavaScript, no `requestAnimationFrame` loop |
| Only `opacity` and `transform`/`width` are animated | compositor-friendly; nothing triggers layout |
| System font stack | no webfont request on a cold launch |
| Inline SVG mark, three static PNG icons (616 B – 2.3 KB) | no icon font, no sprite sheet |
| Results capped at three shoes | a 7.9-inch screen showing eight is a catalog, and a catalog is not a decision |

No WebGL, no canvas, no 3D, no animation library, no video, no particle system,
no raw pressure matrix rendering at any frame rate.

---

## 15. Home Screen / PWA

- `public/manifest.webmanifest` — name, short name, `start_url: /kiosk`, scope,
  `display: standalone`, portrait, theme and background colours, three icons
- **iOS 12 ignores the manifest's display mode**, so `/kiosk` also emits the
  legacy keys: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`,
  `apple-touch-icon`
- `viewport-fit=cover`, `user-scalable=no`, `format-detection=telephone=no`
- The root layout gains the same metadata plus an explicit `viewport` export —
  there was none, so Next was supplying its default
- **No service worker.** Offline is not a requirement for this phase and a
  service worker on WebKit 12.1 is a way to serve a stale kiosk to a store with
  no way to force an update.

---

## 16. Guided Access

The physical iPad runs Guided Access. The web app therefore does **not** attempt
to reproduce OS-level lockout in JavaScript, does not fake full-screen security,
and does not fight the browser.

What it does instead: no outbound links (asserted), no new tabs, no navigation,
no admin URL, accidental refresh recovers to `IDLE`, `popstate` trapped,
long-press menus and text selection disabled outside the two name fields.

---

## 17. Future hardware-triggered start

The machine is shaped for it and it is **not implemented**.

```
IDLE → weight detected → position feet → both feet detected → weight stable → capture-ready
```

`HARDWARE_READY` already consumes exactly this state, so the future change is a
poll on `IDLE` plus a transition. It is deliberately not built, because automatic
capture requires consent to already be satisfied — and on the current flow it is
not satisfied until after `IDENTIFICATION`. Starting a fitting because someone
stepped on a plate would be capturing before consent.

---

## 18. Tests

| Suite | Count | What it covers |
| --- | --- | --- |
| `machine.test.ts` | 18 | valid and invalid transitions, reachability of `IDLE`, reset coverage, consent as the only door, timeout exemption for `PROCESSING`, network resume |
| `hardware.test.ts` | 11 | staleness, boundary, future-dated frames, partial frames, degraded vs offline |
| `device.test.ts` | 28 | enrollment, replay, expiry, credential resolution, revocation, cross-location scoping, consent capture, guest, capture refusal, results safety, delivery consent, abandonment, audit PII, PIN, lockout, diagnostics |
| `view.test.ts` | 9 | no internal ids, no rule strings, disclaimer, degradation on an old snapshot |
| `compat.test.ts` | 10 | ES5 syntax of shipped files, the scanner's own coverage, no `localStorage`, no outbound link, CSS feature denylist, build-output syntax |
| `e2e/kiosk-viewport.mjs` | 75 checks | the flow end to end at 768×1024 and 1024×768 |
| `db/test/isolation.sql` | +5 assertions | kiosk rows, credentials, enrollment codes and telemetry across tenants, at the SQL level |

### What the browser suite proves, and what it does not

It runs in **Chromium**. Chromium is not WebKit 12.1. Playwright's bundled WebKit
tracks current Safari, so there is no engine available to this project that
behaves like iPadOS 12.5.

**Passing does not mean the kiosk works on an iPad mini 2.** It means the flow,
the reset guarantee and the scoping behave as designed, the layout fits both
orientations with no horizontal overflow, and every customer-facing button is at
least 48 CSS pixels. The syntax and API half is closed by `compat.test.ts`
against the shipped files. The engine half is closed only by §19.

---

## 19. Manual checklist on the real A1490

Nothing below can be automated from this repository.

1. **Settings → General → About** — confirm iPadOS 12.5.7 and model A1490.
2. Safari → `https://<host>/kiosk`. The setup screen must render.
3. **Share → Add to Home Screen.** Confirm the icon and the name "Stride Guide".
4. Launch from the Home Screen. Confirm **no browser chrome** (this is the
   `apple-mobile-web-app-capable` path; the manifest alone will not do it).
5. Enter the device code. Confirm activation and that the store name appears.
6. Force-quit and relaunch. Confirm it comes back **enrolled and idle**.
7. Walk one full fitting with the hardware connected. Watch for: the keypad
   responding without lag, the readiness ticks turning over, the countdown
   running smoothly, results rendering within a second of the reply.
8. Walk a fitting and **abandon it**. Confirm the timeout warning appears and the
   screen clears.
9. **Press Back / edge-swipe** during a fitting. Confirm it stays in the kiosk.
10. Turn the unit off mid-fitting. Confirm the customer-safe hardware message.
11. Turn Wi-Fi off mid-fitting. Confirm the reconnect strip, then recovery.
12. Rotate to landscape on every screen. Confirm nothing is cut off.
13. Hold the wordmark 5 seconds. Confirm service mode and the PIN gate.
14. Enable **Guided Access** (Settings → Accessibility → Guided Access), triple-
    click Home, start. Confirm the kiosk still works and cannot be left.
15. Leave it running for **two hours** with repeat fittings. Watch for Safari
    reloading the tab under memory pressure — expected, and it must recover to
    `IDLE` cleanly.

---

## 20. Security

| Control | How |
| --- | --- |
| Tenant scope | derived server-side from the credential; no endpoint accepts an organization or location |
| Location scope | `assertOwnedSession` — a kiosk may only touch sessions at its own location opened by its own acting user. `fitting_session`'s RLS policy is org-scoped only, so this closes a gap the schema does not |
| Credential | 256-bit, stored SHA-256, httpOnly + SameSite=Strict, revocable, no `fitos_app` update grant |
| Enrollment code | single use, 15 min, stored hashed, all failures collapse to one message |
| Hardware ingest | separate installation-scoped credential; a kiosk cannot forge a frame |
| RLS | not weakened. `device_health_event` gained a policy it did not have |
| Service role | used only where the caller has no tenant context, keyed by a hash and nothing else |
| PII | no phone number, name or last-four in any audit row; no customer data in `localStorage`; the report token never reaches the browser |
| Customer search | impossible — exact phone match only, after consent, no partial search anywhere |
| Guest | creates no customer record at all |

### One pre-existing bug found and fixed

Migration `0017_customer_number_location_scope.sql`.

`assign_local_customer_number()` computed `max(local_customer_number) + 1` from
`organization_customer` — a table whose policy resolves through
`location_customer_access`, which by default grants the **creating location
only**. So the trigger's `max()` saw only what the inserting location was
authorized to read. Reproduced directly: at Grand Ave it returns 21; at
Lakeview, same organization, it returns null. Creating a customer at a chain's
second door fails on `organization_customer_number_key`, first attempt, every
time.

It has never fired because every existing code path runs at the one seeded
location. **The kiosk is the first thing in FitOS with a per-location identity.**

The function now runs `security definer` as `fitos_svc` with a pinned
`search_path`. The body is fixed SQL with no dynamic statement, reads one
aggregate, writes one integer into `NEW`, and can return nothing to the caller.
The advisory lock from 0010 is unchanged.

---

## 21. Unresolved questions

1. **The membership oracle is narrowed, not closed.** Asking everyone for a name
   means the form reveals nothing, but a determined person can still confirm a
   number by completing a fitting. Fully closing it needs a policy decision —
   staff-assisted identification, or a confirmation step — and it belongs with
   open question 9 in docs/09 §7.
2. **No send transport.** `receive_report` consent is captured and the request
   is recorded; nothing sends. See §10.
3. **Enrollment attempt-rate limiting is not implemented.** The code is 38 bits,
   single use and 15 minutes; the missing control is throttling redemption
   attempts, which belongs with real auth.
4. **PIN lockout is per-process, in memory.** Adequate for one Node instance and
   **not adequate behind more than one** — a second instance has its own empty
   map. The durable version is a counter column or a shared cache.
5. **Cross-location and MyStrideID rules are untouched.** The kiosk is
   location-scoped and `identity_participation` stays `none`. Open questions 11,
   12 and 13 in docs/09 §7 are preserved, not answered.
6. **Feature provenance for scan-derived measurements.** `toObservedFeatures()`
   labels every assessment field `manual`, and a bridge-derived width is now
   written into `assessment`. The `scan` and `scan_derivation` rows carry the
   true provenance, but the feature snapshot does not. Correcting it needs a
   decision about column-level provenance on `assessment`, so it was flagged
   rather than silently changed.
7. **`alter type user_role add value` requires PostgreSQL 12+** inside a
   transaction, and `deploy/schema-bundle.sql` wraps everything in one. Fine on
   Supabase; stated because it is a real prerequisite.

---

## 22. Known limitations of the iPad mini 2

- No client-side navigation in the framework app (`Response.body`, Safari 14.1).
  **The associate app's `/fitting/*` screens should not be expected to work on
  this device.** The kiosk route is the supported surface.
- 1 GB of RAM: Safari evicts the tab. Designed for (§6), not prevented.
- No WebP, no AVIF, no `ResizeObserver`, no Web Animations, no Web Bluetooth, no
  `structuredClone`.
- `100vh` is unreliable outside standalone mode.
- A7-class GPU: blur, backdrop-filter, large shadows and long transitions are
  visibly expensive. None are used.
- No OS updates and no security patches since 2021. **The device should be on a
  segregated store network** and used for nothing but this kiosk.
- Battery health on a 2013 device is unknowable. Assume mains power on the
  pedestal.
