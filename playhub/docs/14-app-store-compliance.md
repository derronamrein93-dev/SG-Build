# 14 — App Store Compliance: Risks & Checklist

> **Status:** proposed. All guideline references must be **re-verified against the
> live App Review Guidelines at submission time** — Apple revises them several
> times a year and the age-rating system was overhauled recently.

---

## 1. The Kids Category decision

Apple offers three Kids-Category age bands: **5 and under**, **6–8**, **9–11**.
You must pick exactly one, and everything in the app must suit it.

Your product spans 2–8, which straddles two bands. Options:

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Kids Category, "5 and under"** ← recommended | Most protective; matches the parent buying for a 3-year-old; content is trivially appropriate; the strongest trust signal | Discovery skews younger; the 7–8 audience is reached by search/word-of-mouth, not by browse |
| B. Kids Category, "6–8" | Discovery for the older half | Your default UX (giant targets, no reading) reads as babyish to the 6–8 browse audience; and a 2-year-old's parent won't find you |
| C. Not in the Kids Category (4+ rating only) | Fewer constraints; third-party analytics permitted | Loses a major trust and discovery advantage, for freedoms this product doesn't want anyway |

**Recommendation: A.** The design centre is 3–6 (doc 21 §2), the app collects
nothing and shows no ads, so every Kids Category constraint is already satisfied
by the architecture. You give up nothing and gain the category's credibility.
Difficulty scaling still serves the 7–8-year-old sibling; you simply don't
*market* to them at launch.

Note that the Kids Category applies to **all subsequent updates** — you cannot
quietly add an analytics SDK later without re-clearing that bar.

## 2. Risk register

| # | Risk | Guideline | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | Parental gate judged too weak | 5.1.4 | **Medium** | Sustained 3 s corner hold **+** Face ID / PIN. Documented in review notes with a demo video. Far above the common maths gate. |
| 2 | A purchase opportunity reachable by a child | 5.1.4, 3.1.1 | **Medium** | Structural: no purchase UI exists in the child route tree; automated test asserts it (doc 07 §1). |
| 3 | Any third-party data transmission found | 5.1.4 | Low | Zero third-party SDKs. A CI check fails the build if a new network-capable dependency appears. |
| 4 | Privacy label mismatches actual behaviour | 5.1.2 | Low | "Data Not Collected" is trivially true; the label is generated from a checklist in this repo. |
| 5 | Subscription metadata incomplete (price, period, terms, links, restore) | 3.1.2 | **Medium** | A pre-submission checklist item with screenshots; Restore Purchases button is mandatory and tested. |
| 6 | "Not enough value in the free tier" / thin-app rejection | 4.2 | Low | Three full games free. |
| 7 | Screen-time claims read as a parental-control app needing entitlements | 5.1.4 / Family Controls | Low–Med | Copy says "limits time in this app". No Family Controls or Screen Time API usage. Never claim device-level control. |
| 8 | Age rating questionnaire mis-answered | — | Low | Answered from a documented checklist; no simulated gambling, no contests, no user-generated content, no unrestricted web. |
| 9 | Reward store misread as gambling or as real-world commerce | 3.1.1, 5.3 | Low–Med | Review notes explain plainly: stars are non-purchasable, non-transferable, have no monetary value; rewards are parent-defined offline promises fulfilled by the parent. **No** in-app fulfilment, **no** third-party goods, **no** delivery. |
| 10 | A future WATCH module triggers content-moderation obligations | 1.2, 5.1.4 | High **if built** | Out of scope. Do not ship any dynamic or third-party content without a full compliance review (doc 21 §6). |
| 11 | Restore-purchase failure on a shared family device | 3.1.1 | Medium | Family Sharing enabled; explicit Restore button; entitlement failures resolve in the customer's favour (doc 08 §2). |
| 12 | Placeholder/programmer art judged low quality | 4.0, 4.3 | **Medium** | Do not submit with placeholder art. Real art is a gate on submission, not on development (doc 05 §8). |
| 13 | Nickname field treated as data collection from a child | 5.1.1 | Low | Entered by the parent during gated onboarding, stored locally, optional, no keyboard exists in the child shell. |

The two I would actually plan for are **#1** and **#5** — a weak-gate rejection
and subscription-metadata nitpicks are the most common causes of a rejected
children's subscription app, and both are cheap to over-prepare.

## 3. Pre-submission checklist

**Account & agreements** — [ ] Apple Developer Program active · [ ] Paid Apps
agreement accepted, tax and banking complete (subscriptions cannot go live
without it) · [ ] App Store Connect app record with a **brand-neutral bundle ID**

**Privacy** — [ ] Privacy policy published at a stable URL, plain-language,
child-directed section · [ ] App Privacy questionnaire = "Data Not Collected" ·
[ ] Privacy manifest (`PrivacyInfo.xcprivacy`) present, declaring required-reason
APIs (UserDefaults, file timestamps) · [ ] no ATT prompt · [ ] no tracking domains
· [ ] all third-party SDK privacy manifests present (there should be none)

**Kids Category** — [ ] category + age band selected · [ ] parental gate before
every purchase, link out, and permission request · [ ] no third-party ads or
analytics · [ ] no external links reachable by a child · [ ] all content
age-appropriate

**Purchases** — [ ] products created & approved (monthly, annual) · [ ] localized
display names & descriptions · [ ] subscription group configured · [ ] Family
Sharing enabled · [ ] free-trial introductory offer configured · [ ] price, period
and terms shown before purchase · [ ] **Restore Purchases** button present and
tested · [ ] Terms of Use (EULA) and Privacy Policy links in the paywall · [ ]
tested in StoreKit sandbox: purchase, restore, cancel, expire, refund, upgrade

**Metadata** — [ ] screenshots for every required device size · [ ] no screenshot
implies device-level parental controls we don't have · [ ] no competitor or
third-party IP in art · [ ] support URL live · [ ] marketing text makes no
educational-outcome claims · [ ] app name available and trademark-checked
**before** the rebrand is locked

**Technical** — [ ] no private APIs · [ ] IPv6-only network tested (trivially,
since we make no calls) · [ ] works fully in airplane mode from a cold install ·
[ ] no crash in a 30-minute soak · [ ] VoiceOver labels on every parent control ·
[ ] Reduce Motion respected · [ ] Dynamic Type respected in the Parent Hub · [ ]
all iPhone sizes + iPad layouts · [ ] no keyboard reachable in the child shell

**Review notes** (write these; they prevent most rejections) — [ ] describe the
parental gate and how to pass it · [ ] a demo account is not needed, state so ·
[ ] explain the star economy in one paragraph, stating explicitly that stars
cannot be purchased, have no monetary value, and that rewards are fulfilled by
the parent offline · [ ] attach a short screen recording of the gate and a
purchase flow

## 4. Ongoing obligations

Every update must still meet Kids Category rules; adding an SDK, a link, or a
content feed later is a **re-review of the whole posture**, not an incremental
change. Budget one compliance pass per release, and re-read the guidelines diff
that Apple publishes with each revision.

## Sources

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Design safe and age-appropriate experiences](https://developer.apple.com/kids/)
- [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)
- [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/)
