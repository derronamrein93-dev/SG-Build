# 13 — Privacy & Child-Safety Architecture

> **Decision:** the MVP transmits **nothing**. Zero third-party SDKs, zero
> analytics endpoints, zero crash-reporting SDKs, zero identifiers.
> **Status:** proposed. **Reversal cost:** reputationally high — "we collect
> nothing" is a claim you can only make once.

---

## 1. The position

Apple's Kids Category expectation is explicit: *"no personally identifiable
information or device information be transmitted to third parties."* The cheapest,
safest and most marketable way to satisfy that is not to be careful about
transmission — it is **not to transmit**.

So the MVP has:

| | |
| --- | --- |
| Backend servers | none |
| Accounts, logins, emails | none |
| Third-party SDKs of any kind | **none** |
| Analytics SDK (Firebase, Amplitude, Mixpanel…) | **none** |
| Crash-reporting SDK (Crashlytics, Sentry…) | **none** — see §3 |
| Attribution / ad SDKs | none |
| ATT prompt | not needed — nothing is tracked |
| Identifiers collected (IDFA, IDFV, device id) | none |
| Network calls in the child experience | none |
| Camera, microphone, location, contacts, photos-read | not requested |
| Notification permission | not requested in the MVP |

**App Store privacy label: "Data Not Collected."** That is a genuine competitive
advantage in this category and it should be on the screenshots.

## 2. What is stored, and where

All of it is on-device, inside the app sandbox, and deleted with the app:

- a nickname the parent typed (a first name or "Bunny" — we never ask for a
  surname and the field's placeholder says "a nickname is fine"),
- an age band (and optionally an age in years) — **never a birthdate**,
- avatar choice from a bundled set — **never a camera-roll photo of the child**,
- play history, stars, achievements, settings,
- optional reward images the parent attaches: copied into the sandbox, downscaled,
  **EXIF stripped** (removing GPS), never read back out, never shared.

File protection: `NSFileProtectionCompleteUntilFirstUserAuthentication` on the
database. The parent PIN is stored only as a PBKDF2 hash in the Keychain.

## 3. Why no crash-reporting SDK — the unconventional call

Every mobile-engineering instinct says "add Crashlytics on day one". In a Kids
Category app, that instinct is wrong:

1. A crash SDK is by definition a third party receiving device information from a
   children's app — exactly the thing the guideline warns about.
2. It forces your privacy label from "Data Not Collected" to "Diagnostics
   collected", losing the cleanest thing about the product.
3. It adds a legal surface (a DPA, a sub-processor, a COPPA analysis) for a
   one-person company.
4. **Apple already gives you crash reports for free.** Xcode Organizer and App
   Store Connect Metrics deliver symbolicated crashes, hangs, disk writes, launch
   times and battery — from users who opted into sharing with developers at the OS
   level, aggregated and anonymised, with no SDK and no label impact.

Add a local `AppLogger` (ring buffer + capped rotating file, never transmitted)
and a Parent Hub "diagnostics" screen with an explicit **"send this to support"**
button that opens the share sheet with a file the parent can read first. That is
more transparent than any SDK, and it's parent-initiated consent by construction.

**Revisit only if** Xcode's aggregate data proves insufficient to chase a real
crash — and then evaluate an EU/US-hosted, no-SDK, parent-consented option, not
a default-on analytics platform.

## 4. Analytics that actually answer your business questions

Your brief lists: game started, game completed, session duration, crashes,
performance, game popularity, theme popularity, subscription conversion. Here is
where each comes from with **zero collection**:

| Question | Source | Cost |
| --- | --- | --- |
| Installs, retention (D1/D7/D30), sessions/device, session length | **App Store Connect App Analytics** | free, no SDK |
| Crashes, hangs, launch time, battery, memory | **Xcode Organizer / App Store Connect Metrics** | free, no SDK |
| Subscription conversion, trial→paid, churn, ARPU, refunds | **App Store Connect Subscriptions reports** | free, no SDK |
| Which games/themes are popular | see below | |

Only the last one isn't covered, and it does not justify building a data pipeline
about children. Answer it with:

- **the beta cohort**: 15–30 families in TestFlight who let you look at the
  in-app "Play summary" screen and talk to you. Qualitative, richer, and legal.
- **a parent-initiated, opt-in, fully-visible export**: the Parent Hub can show
  the parent their own child's play summary, with a share button. If a parent
  chooses to send it, that's consent with the data visible in front of them.
- **revealed preference**: which theme packs sell.

`core_analytics` still ships the abstraction (`Telemetry` + `TelemetrySink`) with
a `LocalOnlySink` writing to the ring-buffered `telemetry_events` table, so a
future sink is a one-class change. **The abstraction exists; the pipe does not.**

## 5. Regulatory posture

Not legal advice — retain a lawyer before launch. But the architecture is designed
so that the honest answer to each regime is "not applicable":

| Regime | Position |
| --- | --- |
| **COPPA** (US) | No personal information is collected from anyone, so no verifiable parental consent is required. A nickname stored only on-device is not "collected". |
| **GDPR / GDPR-K** (EU) | No processing by us as a controller: no data leaves the device. Nothing to erase, port, or lawfully base. |
| **UK Age Appropriate Design Code** | Aligned by construction: high-privacy defaults, no profiling, no nudge techniques, no behavioural advertising, parental controls, data minimisation. |
| **Apple Kids Category** | Parental gate before purchases and any link out; no third-party data transmission; no third-party ads. |

The moment you add a server, a login, a cloud sync, or an analytics endpoint,
**all four of those become real work**. That is the strongest argument for
staying local-first well beyond the MVP.

## 6. Dark patterns we will not implement

no streaks · no loss framing ("don't lose your stars!") · no countdown timers
shown to a child · no limited-time offers · no push notifications to a child · no
"just one more" nagging · no autoplay into the next activity · no rewarded video
· no social pressure · no purchase prompts in the child shell · no rating prompt
in front of a child · no interstitials · no artificial difficulty gates that a
purchase removes.

Two more that are easy to miss and matter here:
- **No sound designed to summon** (the "come back!" chime some kids' apps play
  from the background). The app is silent when it isn't open.
- **No "your child is falling behind"** framing to parents. This is entertainment,
  not an educational-outcomes product, and pretending otherwise would be both a
  marketing claim you can't support and a manipulation of anxious parents.

## Sources

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Design safe and age-appropriate experiences (Apple Kids)](https://developer.apple.com/kids/)
- [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/)
