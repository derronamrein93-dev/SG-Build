# core_entitlements

The one thing this package owns: **what this household is entitled to**.

`Feature` · `Entitlement` · `EntitlementService` · `PurchaseGateway` · `ProductKey`

Two rules, both enforced by tests in this package:

1. **No price, currency, or trial length appears anywhere.** Prices are read from
   the store at display time, so a price change is an App Store Connect edit
   rather than an app release.
2. **No store product identifier appears anywhere.** Code refers to
   `ProductKey`; `StoreProductCatalog` maps keys → store IDs and is the only
   place a store string exists. It is empty until the Apple account exists.

Callers ask `entitlements.has(Feature.rewardStore)`, never `tier == premium`, so
the free/premium line can move during pricing experiments without touching a
single call site.
