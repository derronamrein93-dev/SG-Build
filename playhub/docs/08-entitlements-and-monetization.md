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

## 3. Products

| Product | Type | Recommended price | Notes |
| --- | --- | --- | --- |
| `premium.monthly` | auto-renewing, group `playhub_premium` | **$4.99** | 7-day free trial |
| `premium.annual` | auto-renewing, same group | **$29.99** (50% off) | The default choice; pre-selected |
| `premium.lifetime` | non-consumable | **defer — see §5** | |

- **Family Sharing: ON** for both subscriptions. Parents share devices and
  households; this measurably reduces refunds and support contacts.
- Both in one subscription group so upgrade/downgrade/proration is Apple's problem.
- Product IDs are **immutable forever** in App Store Connect. They are chosen
  brand-neutrally so a rebrand doesn't strand them.
- Introductory offer: free trial, not a discounted period — parents evaluate a
  kids' app in one weekend, not one month.

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

## 5. Pricing critique (this is the part I most want you to reconsider)

Your hypothesis is $0.99–$1.99/month. I think that is a mistake, for four reasons:

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

**Recommendation: $4.99/month, $29.99/year, 7-day free trial, annual as the
default selection.** Run a price test after 90 days with the App Store's price
experiment tooling. That is still cheaper than almost everything in the category
while producing ~4× the revenue per subscriber.

**On lifetime:** I recommend **not** launching with it. A lifetime purchase caps
your best customers' LTV at roughly two years of annual, while committing you to
serve them content forever — the worst trade in a content business. If you want
it as a launch conversion lever, price it at **≥ $79.99** and describe it honestly
as unlocking everything currently released plus future releases while the app is
supported. Keep the architecture for it (`ContentTier.lifetime` already resolves
to the same `Feature` set), so adding it later is a product-ID change, not code.

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
