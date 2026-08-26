# 24 — Apple Organization Account & Provisional Identifiers

> **Decision (approved):** the app will be owned and published by a **business
> entity**, and explicitly **not** by the existing Stride Guide / Kicks-Stand
> business. Development proceeds immediately on **provisional identifiers**.
> **Status:** accepted. **Reversal cost:** low if the indirection below is kept.

---

## 1. What Apple actually requires for an Organization account

Verified against Apple's current documentation (sources at the foot of this page):

| Requirement | Detail | Gotcha |
| --- | --- | --- |
| **A legal entity** | The organization must be a legal entity able to enter contracts with Apple | **Apple does not accept DBAs, fictitious business names, trade names, or branches.** A sole proprietorship with a trading name is not enough — you need an actual registered entity (LLC, Corp, Ltd, GmbH…) |
| **D-U-N-S Number** | A nine-digit Dun & Bradstreet identifier **registered to that exact legal entity** | Must match the entity name and address precisely. A D-U-N-S registered to a different or older entity name will fail verification |
| **A public website** | Publicly available, functional, on a domain associated with the organization | Social media pages, parked domains, registrar placeholder pages and near-empty sites are explicitly rejected |
| **A work email on that domain** | Your enrolling email must be at the organization's domain | A gmail.com address will not do — this is a hard blocker people hit late |
| **Legal authority to bind** | You must be owner/founder, executive, senior project lead, or an employee with granted authority | Apple may call to verify |
| **Identity verification** | Government ID via the Apple Developer app or web flow | Straightforward but sequential |
| **$99/year** | Paid at the end of enrolment | |

### The dependency chain — this is what sets the lead time

```
   Register the legal entity            ← days to weeks, jurisdiction-dependent
              ↓
   Buy the domain                       ← minutes  (can be done TODAY)
              ↓
   Stand up a real website on it        ← hours    (can be done TODAY-ish)
              ↓
   Create a work email on that domain   ← hours
              ↓
   Request / verify the D-U-N-S Number  ← Apple's lookup form; commonly ~5 business
                                          days, occasionally longer
              ↓
   Enrol as an Organization             ← days, plus possible verification call
              ↓
   Accept Paid Apps agreement, tax, banking
              ↓
   Register bundle ID · create products · issue certificates
```

**Realistic total: 3–8 weeks.** Every step is sequential. None of it is
engineering work, and all of it can run in parallel with development.

## 2. Start these immediately (today, in this order)

| # | Action | Why now | Blocks |
| --- | --- | --- | --- |
| 1 | **Decide the entity**: jurisdiction, structure, and — importantly — that it is a *new* entity, not Kicks-Stand / Stride Guide | It is the root of the whole chain | everything |
| 2 | **Register the legal entity** | Longest genuinely external lead time | D-U-N-S |
| 3 | **Choose the name and buy the domain** (see [doc 26](26-naming-candidates.md)) | The domain must exist, be live, and match the entity. It also becomes the bundle-ID prefix | website, email, D-U-N-S, bundle ID |
| 4 | **Check the D-U-N-S you may already have** at Apple's lookup form before requesting a new one | Entities are often already in D&B's database; a duplicate request wastes a week | enrolment |
| 5 | **Publish a real one-page website** on the domain | A placeholder page is an explicit rejection reason. One honest page — what the product is, contact, privacy policy — satisfies it, and we need the privacy-policy URL anyway | enrolment |
| 6 | **Create `you@<yourdomain>`** | Required for enrolment | enrolment |

Steps 3, 5 and 6 are same-day work. Step 2 is the pacing item.

> ⚠️ **Why not the existing business?** Publishing a children's app under
> Kicks-Stand / Stride Guide would tie an unrelated consumer brand's App Store
> presence, tax reporting, subscription revenue and legal exposure to a footwear
> retail venture — and would make the children's product hard to sell, licence or
> spin out later. It also puts a children's-privacy compliance surface inside a
> business that has nothing to do with it. Separate entity is right.

## 3. Provisional identifiers — how development continues today

Every Apple-issued identifier is behind one layer of indirection, so none of them
appears as a literal anywhere in the codebase.

| Identifier | Provisional value now | Where it lives | Cost to change later |
| --- | --- | --- | --- |
| Bundle ID | `dev.provisional.playhub` | `ios/Config/App.xcconfig` → `PRODUCT_BUNDLE_IDENTIFIER = $(APP_BUNDLE_ID)` | one line + regenerated profiles |
| Android application ID | `dev.provisional.playhub` | `android/app/build.gradle` reading the same property | one line |
| Apple Team ID | `PROVISIONAL` | `App.xcconfig` → `DEVELOPMENT_TEAM` | one line |
| App display name | codename | `BrandConfig` + ARB `{appName}` | one line ([doc 20](20-expensive-decisions.md)) |
| **Store product IDs** | none exist | `StoreProductCatalog`, a config map | see §4 |
| Privacy-policy URL | placeholder | `BrandConfig` | one line |
| App Store Connect app id | n/a | fastlane `Appfile`, read from env | one line |

**Nothing in `lib/` contains a bundle ID, a team ID, a product ID, a price, or a
brand name.** A test asserts it (`no_hardcoded_identifiers_test.dart`).

### What development can and cannot do before enrolment

| ✅ Proceeds now | ⛔ Waits for the account |
| --- | --- |
| Everything in Phases 0–5 | Signed device builds |
| All unit, widget, golden and logic tests | TestFlight distribution |
| Simulator builds and simulator integration tests | Real StoreKit sandbox purchases |
| The entitlement system, driven by `FakeGateway` | App Store Connect product creation |
| `.storekit` **local test configuration** — Xcode's local StoreKit testing needs no App Store Connect products at all, so the full purchase, restore, cancel, expire and refund flows are testable now | Push, Sign in with Apple, iCloud (none of which we use) |
| CI on Linux: analyze, test, goldens, boundaries, budgets | The signed release lane (written, gated on secrets) |

The only thing genuinely gated is **distribution**, and that is not on the
critical path until Phase 8.

## 4. Store product IDs — deferred, and price-neutral

Apple's IAP product IDs are permanent and must be unique across the account, so
they conventionally carry the bundle ID as a prefix — which we don't have yet.
Rather than guess, the code refers to **product keys**, never store IDs:

```dart
enum ProductKey { premiumMonthly, premiumAnnual, premiumLifetime }

/// Keys → store identifiers. The ONLY place a store ID string exists.
class StoreProductCatalog {
  const StoreProductCatalog(this._ids);
  final Map<ProductKey, String> _ids;
  String idFor(ProductKey k) => _ids[k]!;
}
```

When the account exists, one config map is filled in with
`<bundleId>.premium.monthly` and friends. No call site changes.

Pricing itself never enters the codebase at all — see [doc 08](08-entitlements-and-monetization.md) §3
as revised: prices, trial lengths and territory availability are set in App Store
Connect and **read from StoreKit at runtime**, so the paywall renders whatever the
store says. There is no price constant to update, and a price change requires no
app release.

## 5. The switch-over, when the account is ready

A single documented changeover, scripted as `tools/apply_identity.dart`:

1. Fill `ios/Config/App.xcconfig` with the real bundle ID and Team ID
2. Fill `BrandConfig` with the real app name, domain and policy URLs
3. Fill the `StoreProductCatalog` map with the real product IDs
4. Run `fastlane match` once to issue certificates
5. Add `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD` to GitHub secrets
6. Un-gate the release lane

Estimated effort when the day comes: **under an hour**, most of it waiting for
Apple's servers.

## Sources

- [D-U-N-S Number — Apple Developer Account Help](https://developer.apple.com/help/account/membership/D-U-N-S)
- [Enrollment — Apple Developer Account Help](https://developer.apple.com/help/account/membership/program-enrollment/)
- [Identity verification](https://developer.apple.com/help/account/membership/identity-verification/)
- [Become a member](https://developer.apple.com/programs/enroll/)
