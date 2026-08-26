/// What a household may use.
///
/// Call sites ask for a [Feature], never for a tier, so the free/premium line
/// can move during a pricing experiment without touching any of them.
enum Feature {
  allGames,
  allThemes,
  extraProfiles,
  rewardStore,
  taskSystem,
  futureContentPacks,
}

/// Features that are free **forever**, as a product commitment rather than a
/// current setting.
///
/// Screen-time limits, audio controls, quality settings and the parent gate are
/// deliberately absent from [Feature] altogether: they are always available and
/// there is no code path that could gate them. Charging a parent to limit their
/// child's screen time contradicts the product promise, so the architecture
/// makes it impossible rather than merely discouraged.
const Set<Feature> alwaysFreeFeatures = {};

enum EntitlementTier { free, premium }

enum EntitlementSource { none, storeKit, promo, sandbox }

/// Product *keys*, not store identifiers.
///
/// Apple's product IDs are permanent and conventionally carry the bundle ID,
/// which does not exist yet (docs/24). Code refers to these; the catalog maps
/// them to real strings when the account is created. No call site changes.
enum ProductKey { premiumMonthly, premiumAnnual, premiumLifetime }

/// Keys → store identifiers. **The only place a store product ID may exist.**
class StoreProductCatalog {
  const StoreProductCatalog(this._ids);

  /// Provisional: no products exist yet. `FakeGateway` drives every test until
  /// the Apple Organization account is enrolled.
  const StoreProductCatalog.provisional() : _ids = const {};

  final Map<ProductKey, String> _ids;

  bool get isConfigured => _ids.isNotEmpty;

  String? idFor(ProductKey key) => _ids[key];

  ProductKey? keyFor(String storeId) {
    for (final entry in _ids.entries) {
      if (entry.value == storeId) return entry.key;
    }
    return null;
  }

  List<String> get allIds => _ids.values.toList(growable: false);
}

/// The resolved state, cached locally and honoured offline.
class Entitlement {
  const Entitlement({
    required this.tier,
    required this.source,
    required this.lastVerifiedAt,
    this.productKey,
    this.expiresAt,
  });

  const Entitlement.free()
    : tier = EntitlementTier.free,
      source = EntitlementSource.none,
      productKey = null,
      expiresAt = null,
      lastVerifiedAt = null;

  final EntitlementTier tier;
  final EntitlementSource source;
  final ProductKey? productKey;
  final DateTime? expiresAt;
  final DateTime? lastVerifiedAt;

  bool get isPremium => tier == EntitlementTier.premium;

  /// Which features this tier unlocks. The one place the free/premium line is
  /// written down.
  Set<Feature> get features => switch (tier) {
    EntitlementTier.free => const {},
    EntitlementTier.premium => Feature.values.toSet(),
  };

  Entitlement copyWith({
    EntitlementTier? tier,
    EntitlementSource? source,
    ProductKey? productKey,
    DateTime? expiresAt,
    DateTime? lastVerifiedAt,
  }) => Entitlement(
    tier: tier ?? this.tier,
    source: source ?? this.source,
    productKey: productKey ?? this.productKey,
    expiresAt: expiresAt ?? this.expiresAt,
    lastVerifiedAt: lastVerifiedAt ?? this.lastVerifiedAt,
  );
}
