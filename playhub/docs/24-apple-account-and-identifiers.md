# 24 — Apple Enrolment (Kicks-Stand LLC) & Provisional Identifiers

> **Decision (approved):** **Kicks-Stand LLC**, an existing Indiana LLC, is the
> legal entity that owns and publishes this product. **No new entity is being
> formed.** Development proceeds on provisional identifiers.
> **Status:** accepted. **Reversal cost:** low — see §7 on App Transfer.

---

## 1. Assessment: is Kicks-Stand LLC the right publisher?

You asked me to flag any material reason not to. I looked at all five axes and
found **no blocker and no reason to form a new entity**. Two things are worth
knowing before you commit, and one of them is time-sensitive.

| Axis | Verdict | Notes |
| --- | --- | --- |
| **Legal** | ✅ No issue | Apple requires a legal entity that can enter contracts. An existing LLC qualifies exactly where a DBA, trade name or sole proprietorship would be rejected outright. You are ahead, not behind. |
| **Tax** | ✅ Simplifies | One entity, one return. Keep the two products as separate bookkeeping classes and ideally separate bank sub-accounts so per-product P&L stays clean — that is an accounting choice, not a legal-structure one. |
| **Apple enrolment** | ✅ No blocker, ⚠️ three gaps to close | All three are hours of work. §3. |
| **Liability** | ⚠️ Commingled, but manageable | A judgment against either product reaches the other's assets. The mitigations are insurance and good hygiene, not a second entity — and this product's exposure is unusually low because it collects no data at all ([doc 13](13-privacy-and-child-safety.md)). Raise it with your attorney; don't restructure for it. |
| **Branding** | ⚠️ **One material finding** | §2. |

### The two things worth knowing

**⚠️ The App Store publishes your legal entity name.** The seller/developer line
on the product page shows the legal entity — so a children's app would read
**"Kicks-Stand LLC"**. Separately, EU **Digital Services Act** trader rules
require Apple to verify and publish a trader **address, phone number and email**
on the product page in all 27 EU territories, and every developer must declare a
trader status whether or not they ship to the EU.

Two consequences:

1. A footwear-flavoured LLC name under a children's app is odd but not
   disqualifying — plenty of apps ship under unrelated holding-company names. It
   is a cosmetic cost you may simply accept.
2. **The DSA address is published publicly.** If Kicks-Stand LLC's address of
   record is your home, that address goes on a public App Store page. Use a
   registered-agent or commercial mail address instead. This is worth fixing
   before enrolment, not after.

**⏱ The rename window has effectively closed — and that is fine.** I flagged
that a D-U-N-S must be registered to the exact legal name, so renaming afterwards
means re-registering with D&B and re-verifying with Apple. The D-U-N-S now
exists, so **Kicks-Stand LLC is the name that goes to Apple**, and the App Store
seller line will read that way.

Renaming remains *possible* — it is an Indiana amendment plus a D&B record
update plus, if enrolment has already happened, an account name change with
Apple. It is now a multi-week detour rather than a one-week decision. Unless the
seller line genuinely bothers you, take the name as settled and move on.

## 2. What Apple requires, and where Kicks-Stand LLC stands

| Requirement | Status | Action |
| --- | --- | --- |
| A legal entity (not a DBA/trade name/branch) | ✅ **Satisfied** | none |
| D-U-N-S registered to that exact entity | ✅ **Obtained** — verify the record's name and address | §3.4 |
| Public, functional website on a domain **associated with the organization** | ⚠️ **Gap** | §3.2 |
| Work email on that domain | ⚠️ **Partial** | §3.3 |
| Enroller has authority to bind the entity | ✅ Presumed (you are the owner) | confirm you are listed as member/manager |
| Government-ID identity verification | ⏳ Pending | during enrolment |
| $99/year | ⏳ Pending | at the end |

## 3. Your verification checklist

### 3.1 Entity facts to confirm before requesting anything

Pull these from **INBiz** (Indiana's business portal) and have them side by side —
a mismatch in any one of them is the usual cause of a failed D-U-N-S match:

- [ ] **Exact legal name**, character for character. `Kicks-Stand LLC` vs
      `Kicks Stand LLC` vs `Kicks-Stand, L.L.C.` are three different strings to a
      verification system. Use whatever INBiz shows, exactly.
- [ ] **Status is Active / in good standing**, and the Indiana **Business Entity
      Report** is current (Indiana LLCs file every two years — a lapsed report is
      a quiet way to be "not in good standing" at the worst moment).
- [ ] **Principal office address** on record. **This becomes the publicly
      published DSA trader address.** Change it to a registered agent or
      commercial address first if it is your home.
- [ ] **Registered agent** on file.
- [ ] **Formation date** and **EIN** (both are asked for in D&B/Apple flows).
- [ ] You are listed as **member or manager**, i.e. authorised to bind.

### 3.2 The website gap — I checked, and this one is real

Kicks-Stand LLC's only live web presence is **strideguide.co**, and:

```
index.html:1045  © <span id="year">2026</span> Stride Guide. All rights reserved.
```

**The site never names Kicks-Stand LLC anywhere.** Apple requires the domain to
be *associated with your organization*, and a site that names a product but not
the entity is exactly the kind of thing that stalls verification.

DNS check, just now:

| Domain | Status |
| --- | --- |
| `strideguide.co` | live (301) — but names no entity |
| `kicksstand.com` | **taken** (resolves) |
| `kicks-stand.com` | **taken** (registered, not serving) |
| `kicksstand.co` | **no DNS — likely available** |
| `kicksstandllc.com` | **no DNS — likely available** |

**Option A — free, same-day.** Add `Kicks-Stand LLC` and its business address to
the Stride Guide footer, and an "About / Company" line naming the entity. This is
usually enough for Apple, and it is one small edit to `index.html`.

**Option B — ~$12/year, recommended.** Register an entity domain (`kicksstand.co`
or `kicksstandllc.com` appear free) and publish a genuine corporate one-pager:
what the company is, its two products, contact details, privacy policy. This is
the shape Apple expects for a multi-product holding entity, it keeps the entity's
public identity independent of either product brand, and it gives you a stable
home for legal pages that neither product's marketing site should carry.

> ⚠️ Whichever you choose, the page must be **substantive**. Apple explicitly
> rejects registrar placeholder pages, near-empty sites and social-media profiles.

### 3.3 Work email

`pilots@strideguide.co` exists, so the mail infrastructure is there. You need a
**personal-role address on the enrolment domain** — `derron@kicksstand.co` under
Option B, or `derron@strideguide.co` under Option A. A gmail.com address will be
rejected, and this is a step people hit at the very end.

### 3.4 D-U-N-S — ✅ **obtained**

Kicks-Stand LLC has a D-U-N-S Number on file. It is a well-formed nine-digit
identifier and the ~5-business-day wait is behind us.

> **Where the number lives:** deliberately **not in this repository**, which is
> public. A D-U-N-S is not confidential — it is designed to be handed to vendors
> and appears in public registries — but there is no benefit to publishing it
> next to the entity's address. Keep it in your password manager, and record it
> in the extracted **private** repository ([doc 25](25-repository-migration-plan.md))
> if you want it in-project at all.

What remains is not obtaining it but **verifying the record behind it**. Apple
uses the D&B record to confirm your identity and legal status, so a stale record
fails enrolment even though the number is valid:

- [ ] **Legal name on the D&B record matches INBiz character-for-character.**
      A record created years ago by a bank may carry a slightly different string.
- [ ] **Address on the D&B record matches** the entity's current address of
      record. A D-U-N-S issued at formation often still carries the formation
      address.
- [ ] **The address is not your home** — it becomes the publicly published EU DSA
      trader address (§1).
- [ ] Entity status and trade style look right.

Corrections go through D&B, not Apple, and take a few days — so check the record
**before** starting enrolment rather than discovering a mismatch inside it.

## 4. The revised timeline — the long pole is gone

My earlier plan budgeted 3–8 weeks because entity formation was the pacing item.
**That step is already done**, which changes the picture materially:

```
✅ Legal entity exists                          done
✅ D-U-N-S obtained                             done
        ↓
Verify the D&B record matches INBiz            ~1 h, + a few days if it needs correcting
        ↓
Entity facts verified from INBiz               hours
        ↓
Website + email on an entity-associated domain hours   ← the remaining real work
        ↓
Apple enrolment + identity verification        days
        ↓
Paid Apps agreement, tax, banking              ~30 min
        ↓
Trader status declaration (DSA)                ~15 min
```

**Realistic total: a few days to a week**, and the only genuine work left is
publishing a page that names the LLC and creating an email address on that
domain. Both are an afternoon.

For perspective on how far this has moved: the first version of this plan
budgeted **3–8 weeks** and called entity formation the longest lead time in the
project. The entity already existed and the D-U-N-S is already issued, so Apple
enrolment is now one of the *cheapest* remaining items. **Art commissioning is
the schedule risk** ([doc 18](18-automation-vs-manual.md) §2.9) — it is the only
thing left with a multi-week external dependency, and it should start in Phase 2.

## 5. Separation despite common ownership

You asked for complete separation at brand, repository, bundle-ID,
infrastructure, secrets, analytics and product level. Here is exactly what is and
is not shared, stated plainly rather than optimistically.

| Layer | Shared with Stride Guide? | How it is kept apart |
| --- | --- | --- |
| Legal entity | ✅ **Yes — by design** | The only intentional overlap |
| Apple Developer account / Team ID | ✅ Yes — unavoidable | One entity gets one Program membership. Today this is moot: Stride Guide/FitOS is a web product with no App Store presence, so the account is effectively this product's alone |
| App Store Connect app record | ❌ No | Separate app, separate metadata, separate age rating, separate privacy answers |
| Subscription products & group | ❌ No | Own group, own product IDs |
| Bundle / application ID | ❌ No | Rooted in the **product's** domain, never `com.kicksstand.*` — §6 |
| Repository | ❌ No | Own private repo ([doc 25](25-repository-migration-plan.md)) |
| **Secrets** | ❌ No | **Repository-scoped GitHub secrets only — never organization-level secrets.** An org-level `ASC_KEY_P8` would be readable by any Stride Guide workflow. This is the single most important separation rule on this list |
| App Store Connect API key | ❌ No | A dedicated key named for this product, used only by this repo's release lane. Revocable independently |
| Signing certificates | ⚠️ Team-level by nature | Its own `fastlane match` certificate repository and passphrase; the underlying distribution certificate belongs to the team and cannot be split |
| CI/CD | ❌ No | Own workflows, own runner minutes — this one needs paid macOS minutes and must not draw on Stride Guide's budget |
| Analytics | ❌ No — and none exists | Zero SDKs; no shared pipeline to leak into |
| Database / infrastructure | ❌ No | No backend at all in the MVP |
| Brand | ❌ No | Nothing in the child- or parent-facing product references Kicks-Stand or Stride Guide, beyond the App Store seller line Apple controls |
| Documentation | ❌ No | Own `docs/` |

**The honest caveat:** one legal entity gets one Apple Developer Program
membership and one Team ID, so certificates and the team are shared by
construction. Everything above that line is separable and separated. If total
Apple-level separation ever becomes necessary, §7 is the exit.

## 6. Provisional identifiers — how development continues today

Every Apple-issued identifier sits behind one layer of indirection, so none
appears as a literal anywhere in the codebase. Enforced by
`no_hardcoded_identifiers_test.dart`, which fails the build.

| Identifier | Provisional value | Lives in | Cost to change |
| --- | --- | --- | --- |
| Bundle ID | `dev.provisional.playhub` | `ios/Config/App.xcconfig` | one line |
| Android application ID | same | `android/app/build.gradle` | one line |
| Apple Team ID | `PROVISIONAL` | `App.xcconfig` | one line |
| App display name | codename | `BrandConfig` + ARB `{appName}` | one line |
| Store product IDs | none exist | `StoreProductCatalog` | one map |
| Privacy-policy URL | placeholder | `BrandConfig` | one line |

**Two things gate the real bundle ID, and neither is the entity:**

1. **Brand clearance.** Kite stays provisional until trademark clearance
   completes ([doc 26](26-naming-candidates.md) §4).
2. **A product domain.** The bundle ID follows the *product's* domain, not the
   entity's — `co.kiteplay.app`, not `com.kicksstand.kite` — so the children's
   product carries no trace of the footwear business at the identifier level, as
   you asked.

> ⚠️ **A bundle ID cannot be changed once a build has been uploaded**, and it
> survives even an app transfer. Do not upload a build under a provisional or
> entity-rooted identifier. The release lane already refuses to run while the
> bundle ID contains `dev.provisional` — that guard exists for exactly this.

### What proceeds now vs what waits

| ✅ Proceeds today | ⛔ Waits for enrolment |
| --- | --- |
| Phases 0–5 in full | Signed device builds |
| All unit, widget, golden and logic tests | TestFlight |
| Simulator builds and integration tests | Real StoreKit sandbox |
| The entitlement system via `FakeGateway` | Creating products in App Store Connect |
| **Local StoreKit testing** — purchase, restore, cancel, expire and refund flows need no App Store Connect products at all | The signed release lane (written, gated) |

Only **distribution** is gated, and that is not on the critical path until
Phase 8.

## 7. The exit, if this ever needs to change

The main strategic argument for a separate entity is "what if I sell it, or it
needs to stand alone?". Apple's **App Transfer** answers that, which is why I am
comfortable recommending the shared entity:

- The app moves to another developer account **keeping its reviews, ratings and
  bundle ID**, and users keep receiving updates.
- **Apps with auto-renewable subscriptions can be transferred** — the initiator
  generates an app-specific shared secret and hands it to the recipient, who
  regenerates it afterwards.
- The recipient must accept within **60 days** and create new provisioning
  profiles against the transferred App ID.

So a future spin-out, sale or restructure costs a transfer and some paperwork —
not a rebuild, and not a lost App Store listing. **That removes the only expensive
reason to form a second entity today.**

## 8. The switch-over, when enrolment completes

Scripted as `tools/bin/apply_identity.dart`:

1. Real bundle ID and Team ID into `ios/Config/App.xcconfig`
2. Real app name, domain and policy URLs into `BrandConfig`
3. Real product IDs into `StoreProductCatalog`
4. `fastlane match` once, into this product's own certificate repository
5. `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD` as
   **repository-scoped** GitHub secrets
6. Un-gate the release lane

Under an hour, most of it waiting on Apple.

## Sources

- [D-U-N-S Number — Apple Developer Account Help](https://developer.apple.com/help/account/membership/D-U-N-S)
- [Enrollment — Apple Developer Account Help](https://developer.apple.com/help/account/membership/program-enrollment/)
- [Identity verification](https://developer.apple.com/help/account/membership/identity-verification/)
- [Manage EU Digital Services Act trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)
- [Apps without trader status will be removed from the App Store in the EU](https://developer.apple.com/news/?id=einwn76m)
- [Overview of app transfer](https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/)
- [Accept an app transfer](https://developer.apple.com/help/app-store-connect/transfer-an-app/accept-an-app-transfer/)
