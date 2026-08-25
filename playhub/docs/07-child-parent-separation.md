# 07 — Child / Parent Separation

> **Decision:** two structurally disjoint route trees; the Parent Shell is
> reachable only through a two-factor gate (sustained gesture + biometric/PIN).
> **Status:** proposed. **Reversal cost:** low technically, high in trust.

---

## 1. Why two shells rather than one app with a settings screen

A settings button on a home screen is not a boundary; it is a target. Children
tap everything, twice. The separation must be **structural**, so that no sequence
of taps a child can produce reaches parent surfaces.

```
ChildShell routes                    ParentShell routes
─────────────────                    ──────────────────
/                 home tiles          /parent            hub dashboard
/play/:gameId     game runtime        /parent/profiles
/celebrate        round complete      /parent/screen-time
/collection       sticker book        /parent/audio
/rewards          reward browsing     /parent/quality
/rest             session ended       /parent/rewards    store editor
/switch-profile   avatar picker       /parent/requests   approvals ← badge
                                      /parent/tasks      (optional module)
                                      /parent/subscription
                                      /parent/privacy
                                      /parent/diagnostics
```

There is no route from a `ChildShell` screen to a `ParentShell` route. The only
edge in the graph is `GateScreen → /parent`, and `GateScreen` is only reachable
from a gesture that a young child cannot produce by accident.

Enforced by a test: `child_routes_are_closed_test.dart` walks every registered
child route's widget tree, collects every navigation target, and asserts none of
them is in the parent tree. It runs on every commit.

## 2. The parent gate

Apple requires a gate before purchases and external links in kids' apps, and
explicitly requires it to be something a young child cannot pass. A four-dot
"tap the dots" or single arithmetic problem is weak: many 6-year-olds can do
"3 + 5", and the brief targets up to age 8.

**Recommended gate, two independent steps:**

**Step 1 — sustained gesture (anti-accident).** Press and hold the small,
low-contrast leaf/cloud icon in a *corner* for 3 continuous seconds. A ring fills.
Releasing early resets it silently. This alone eliminates ~all accidental entry
and most curious tapping.

**Step 2 — authentication (anti-child).**
- **Primary: Face ID / Touch ID** via `local_auth`. One glance for the parent, and
  a 6-year-old holding the parent's phone simply cannot pass it. This is the
  single best gate available and it costs the parent nothing.
- **Fallback: 4-digit PIN**, set during onboarding, stored as a PBKDF2-SHA256
  hash (≥ 100 k iterations, per-install random salt) in the **Keychain**, never in
  the database. Rate-limited: 5 attempts, then a 60-second cooldown that doubles.
- **Recovery: device passcode.** `local_auth` with `biometricOnly: false` lets a
  parent who forgot the PIN authenticate with the phone's own passcode and reset
  it. No server, no email, no account, no support ticket — and no bypass for a
  child who doesn't know the phone's passcode.

> **Critique of the brief:** a maths-problem gate is the industry default and I
> recommend against it here specifically because your upper age band is 8. Offer
> it only as a tertiary option for parents on devices without biometrics who
> refuse a PIN, and make it a *typed four-digit* answer (e.g. "sixty-three minus
> nineteen"), not multiple choice.

**Never gated:** the volume mute toggle and the "I'm the parent, end the session"
path must not require full auth in an emergency — mute is available from a
long-press anywhere.

## 3. Child-shell containment rules

| Rule | Implementation |
| --- | --- |
| No external links, ever | `url_launcher` is banned from every package except `core_entitlements` and the Parent Shell, enforced by the boundary checker |
| No text input | No `TextField` may appear in a child route — a lint + widget test enforces this. Nothing a child types can exist, so nothing can be moderated |
| No share sheets, no camera, no photo picker | Those plugins are not imported by child-shell packages |
| No prices, no "buy", no "unlock now" | Locked content shows a padlock and a "ask a grown-up" character. No number, no store, no urgency, no countdown |
| No ads, no cross-promotion, no rating prompts | Absent from the codebase entirely. `SKStoreReviewController` is only ever triggered from the Parent Hub |
| Accidental-exit resistance | Back gestures inside a game require the HUD pause → a hold-to-confirm "leave?" |
| No notifications to the child | The app requests no notification permission at all in the MVP |

**Guided Access advocacy:** the strongest containment on iOS is Apple's own
Guided Access (triple-click to lock the device to one app). We cannot enable it
programmatically, but the onboarding shows a 15-second illustrated card teaching
the parent to turn it on, and the Parent Hub links to it. This is a genuine
differentiator that costs one screen: it turns "hand over the phone" from a leap
of faith into a locked kiosk.

## 4. Profile switching

Switching profiles is a **child-safe** action (an avatar picker — no data can be
lost) but *creating, editing and deleting* profiles is parent-only. A child
switching to a sibling's profile is a nuisance, not a hazard; requiring a gate
for it would make the app annoying for a family with three children, which is
exactly the customer we want. Deleting a profile is gated and requires typing the
nickname to confirm.

## 5. Parent Hub UX bar

The brief asks for "understandable in 30 seconds". Concretely:

- **One screen, six cards**, no tab bar, no nested settings trees: *Children ·
  Screen Time · Sound & Display · Rewards · Requests · Subscription*.
- **Pending approvals surface first**, as a badge and a top card. The failure mode
  that kills this product is a child requesting an ice-cream trip and the parent
  never noticing.
- **Every setting has a plain-language subtitle** and a live preview where
  possible ("Sessions end after 15 minutes · about 3 puzzles").
- **Defaults are correct**, so a parent who changes nothing gets a good product:
  limits off, sound on at 80%, quality AUTO, chores off, rewards on.
- **No configuration is required to start playing.** Onboarding is: name the
  child → pick an avatar → pick an age → done. Thirty seconds, three taps, and the
  PIN prompt comes *after* the first play session, not before it.
