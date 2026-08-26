# 08 — Subscription & Entitlement Architecture

> **Decision:** StoreKit 2 via `in_app_purchase`, verified on-device, no backend,
> with an offline grace period and a strict "safety is never paywalled" rule.
> **Status:** proposed. **Reversal cost:** product IDs and the free/premium line
> are effectively permanent (doc 20).

---

## 1. Architecture

```
UI (Parent Shell only)
   │  reads
   ▼
EntitlementService ──── watches ────► PurchaseGateway (interface)
   │  exposes                                │
   │  Stream<Entitlement>                    ├─ StoreKitGateway   (in_app_purchase / StoreKit 2)
   │  bool has(Feature f)                    ├─ FakeGateway       (tests, deterministic)
   ▼                                         └─ [future] PlayBillingGateway
entitlement_cache (SQLite, single row)
```

Everything downstream asks `entitlements.has(Feature.rewardStore)` — a **feature
enum**, never `tier == premium`. That indirection is what lets the free/premium
line move later (during pricing experiments) without touching call sites.

```dart
enum Feature { allGames, allThemes, extraProfiles, rewardStore, taskSystem,
               advancedScreenTime, futureContentPacks }
```

## 2. Verification without a server

StoreKit 2 returns **cryptographically signed, on-device-verifiable**
transactions. For a single-app, no-account product this is sufficient — the MVP
needs no backend, no receipt-validation endpoint, and therefore no server that
holds any data about a child.

```
launch ─► StoreKit.currentEntitlements
            ├─ verified & unexpired  → tier = premium, cache, last_verified = now
            ├─ verified & expired    → tier = free
            └─ unavailable (offline) → use cache, honour grace period
```

**Offline grace: 30 days.** A family on a two-week trip with no connectivity must
not lose the content they pay for; that is precisely the use case the brief calls
out. After 30 days without a successful check, premium content locks with a
parent-facing (not child-facing) explanation.

**Failure direction:** every ambiguous state resolves *in the customer's favour*.
An unverifiable transaction, a StoreKit error, a corrupted cache — all keep the
last known-good entitlement rather than downgrading. The downside of an
occasional wrongly-granted month is trivial; the downside of a paying parent
being locked out at a restaurant is a refund and a one-star review.

## 3. Products — price-neutral by construction

> **Decision (approved):** pricing is **deferred**. It is configuration and
> business logic, never application architecture. No price, trial length, or
> currency appears anywhere in `lib/`, and a lint test enforces that.

### How prices stay out of the codebase

The paywall renders **whatever StoreKit reports**, in the user's own currency and
locale, fetched at display time:

```dart
final products = await gateway.query(catalog.allIds());
// products.first.price        -> "$4.99"  — a localized string FROM the store
// products.first.introOffer   -> the trial, if any, as configured in App Store Connect
```

Consequences, all of which are the point:

- A price change is an App Store Connect edit. **No app release, no review.**
- Regional pricing, price experiments and promotional offers all work with zero
  code involvement.
- No `const monthlyPrice = 1.99` can ever drift out of sync with the store.
- If a product fails to load, the paywall shows the tier's *benefits* and a retry —
  it never guesses a price or shows a hard-coded one.

### Product keys, not store identifiers

Store product IDs are permanent and conventionally carry the bundle ID, which we
don't have yet ([doc 24](24-apple-account-and-identifiers.md)). So code refers to
keys:

```dart
enum ProductKey { premiumMonthly, premiumAnnual, premiumLifetime }
```

`StoreProductCatalog` maps keys → store IDs in one config object. Today it is
empty and `FakeGateway` drives every test. When the Apple account exists, one map
is filled in and no call site changes.

`premiumLifetime` exists in the enum from day one so the *entitlement resolution*
path is built and tested for a non-consumable, even though no such product is
planned for launch. Adding it later is then a store-side decision, not an
engineering project.

### Shape of the offering (to validate, not to build against)

| Product | Type | Notes |
| --- | --- | --- |
| `premiumMonthly` | auto-renewing, group `premium` | |
| `premiumAnnual` | auto-renewing, same group | expected default choice |
| `premiumLifetime` | non-consumable | architecture only; ship if validated |

Structural decisions that *are* architecture, and are settled now:

- **One subscription group**, so upgrade/downgrade/proration is Apple's problem.
- **Family Sharing ON** for the subscriptions — parents share households, and this
  measurably reduces refunds and support contacts.
- **An introductory free trial** is assumed to exist and the UI handles its
  presence or absence; its length is a store setting.
- **Product IDs are brand- and price-neutral strings**, so neither a rebrand nor a
  price change strands them.

### The pricing conversation, deferred not closed

Your working hypothesis is an extremely inexpensive subscription. My argument
against pricing that low is in §5 below and I still hold it — but nothing in the
codebase depends on the answer, so it is genuinely safe to decide with real data
during Phase 6, or after launch via App Store price experiments. That is the whole
reason for building it this way.

## 4. The free/premium line

| | FREE | PREMIUM |
| --- | --- | --- |
| Games | **all 3 MVP games** | all games, incl. every future release |
| Themes | 1 (Farm) | all themes + seasonal packs |
| Child profiles | 2 | 6 |
| Stars, achievements, stickers | ✅ full | ✅ full |
| **Screen-time limits, all audio & quality controls, the parent gate** | ✅ **full** | ✅ full |
| Parent Reward Store | ❌ | ✅ |
| Chore/task system | ❌ | ✅ |
| Offline play | ✅ | ✅ |

Two deliberate positions:

1. **Every game is free; themes are the paywall.** Themes are what the product
   manufactures cheaply (doc 05), so they are the right thing to sell. A parent
   who can play all three games has genuinely evaluated the product — which is what
   your brief demands — and the child asking for "the dinosaur one" is a far more
   comfortable conversion moment than "you can't play this game".
2. **Safety features are never paywalled.** Screen-time limits, volume control and
   the parent gate stay free forever. Charging a parent for the ability to limit
   their child's screen time is the kind of decision that ends up in an article
   about predatory kids' apps, and it directly contradicts the product promise.

## 5. Pricing critique — for the Phase 6 decision, not for the code

Pricing is deferred and the architecture is neutral, so this section is an
argument to revisit later, not a blocker now. Your hypothesis is an extremely
inexpensive subscription in the $0.99–$1.99 range. I think that would be a
mistake, for four reasons:

1. **It's below the category.** Paid children's app subscriptions generally sit
   in the mid-single to low-double digits per month; $1.49 sits an order of
   magnitude below the anchors parents already hold. *(Verify current competitor
   pricing before launch — do not take my figures from memory.)*
2. **Price signals quality to this buyer.** A parent choosing what to put in
   front of their 4-year-old reads a suspiciously cheap subscription as
   ad-supported, low-effort, or a data play. You are selling *trust*; underpricing
   undermines the pitch.
3. **The unit economics don't fund the content treadmill.** After Apple's cut, a
   $1.49 subscription nets roughly $1.27 (15% small-business rate). Themes and
   games are your only retention mechanism and they cost real money to produce.
4. **You can lower a price. You cannot raise one** on existing subscribers
   without a consent flow that many will decline.

**When the decision comes due, my recommendation is roughly $4.99/month with an
annual at ~50% off and a 7-day trial** — still cheaper than most of the category,
while producing several times the revenue per subscriber. Validate it with an
App Store price experiment rather than a guess; that tooling exists precisely for
this, and the architecture lets you use it without shipping a build.

**On lifetime:** I recommend **not** launching with it. A lifetime purchase caps
your best customers' LTV at roughly two years of annual, while committing you to
serve them content forever — the worst trade in a content business. If you want
it as a launch conversion lever, price it at **≥ $79.99** and describe it honestly
as unlocking everything currently released plus future releases while the app is
supported. The architecture already carries it (`ProductKey.premiumLifetime` resolves to the
same `Feature` set), so adding it later is a store-side change, not code.

## 6. Absolute rules for the child-facing surface

- The child shell contains **no price, no currency symbol, no purchase button, no
  countdown, no "only today", no store**. Locked content is a padlock and a
  friendly "ask a grown-up" card, and tapping it leads to *the gate*, not a
  purchase screen.
- Stars are **never** purchasable, tradeable, or convertible. There is no second
  currency, no gacha, no loot box, no wheel, no streak-loss anxiety.
- No mechanic anywhere in the product should make a child ask a parent for money.
  The one moment a child may prompt a parent is "can we get the dinosaurs?", which
  is a request the *parent* evaluates at their leisure in the Parent Hub.
- Never bypass App Store billing. Every purchase is StoreKit; there is no external
  link to a payment page anywhere in the binary.

## 7. Advertising

Not in the MVP; no ad SDK is linked. The seam that keeps it *possible* later is
that `EntitlementService` already answers "should this user see monetisation
surfaces", so a future ad-supported tier is a new `Feature` and a new surface —
not a rewrite. I'd note, though, that shipping ads into a Kids-Category app later
means meeting Apple's contextual-ad requirements and losing the "no tracking, no
ads" positioning that is currently your cheapest marketing asset.
