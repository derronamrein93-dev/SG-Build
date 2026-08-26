import 'package:core_foundation/core_foundation.dart';

import 'entitlement.dart';

/// A purchasable product, **as the store describes it**.
///
/// [displayPrice] is a localised string that came from StoreKit — never a
/// constant, never formatted by us. That is what makes a price change an App
/// Store Connect edit rather than an app release, and what makes regional
/// pricing and price experiments work with no code involvement.
class StoreProduct {
  const StoreProduct({
    required this.key,
    required this.storeId,
    required this.displayName,
    required this.displayPrice,
    this.introOfferDescription,
  });

  final ProductKey key;
  final String storeId;
  final String displayName;
  final String displayPrice;

  /// e.g. "7 days free" — also from the store, also never hard-coded.
  final String? introOfferDescription;
}

/// Whatever actually talks to a payment system.
abstract interface class PurchaseGateway {
  /// Products the store knows about. An empty result is normal offline and must
  /// not be treated as "the user owns nothing".
  Future<Result<List<StoreProduct>>> query(List<String> storeIds);

  /// Transactions the store currently considers valid for this Apple ID.
  Future<Result<List<Entitlement>>> currentEntitlements();

  Future<Result<Entitlement>> purchase(String storeId);

  Future<Result<List<Entitlement>>> restore();
}

/// Deterministic gateway for tests and for development before the Apple
/// Organization account exists (docs/24). Every StoreKit state is reachable.
class FakeGateway implements PurchaseGateway {
  FakeGateway({
    List<StoreProduct>? products,
    List<Entitlement>? owned,
    this.failQuery = false,
    this.failRestore = false,
    this.offline = false,
  }) : _products = products ?? const [],
       _owned = List.of(owned ?? const []);

  final List<StoreProduct> _products;
  final List<Entitlement> _owned;

  bool failQuery;
  bool failRestore;
  bool offline;

  @override
  Future<Result<List<StoreProduct>>> query(List<String> storeIds) async {
    if (offline || failQuery) {
      return const Err(PurchaseFailure('store unreachable'));
    }
    return Ok(_products.where((p) => storeIds.contains(p.storeId)).toList());
  }

  @override
  Future<Result<List<Entitlement>>> currentEntitlements() async {
    if (offline) return const Err(PurchaseFailure('store unreachable'));
    return Ok(List.of(_owned));
  }

  @override
  Future<Result<Entitlement>> purchase(String storeId) async {
    if (offline) return const Err(PurchaseFailure('store unreachable'));
    final product = _products.where((p) => p.storeId == storeId).firstOrNull;
    if (product == null) {
      return const Err(PurchaseFailure('unknown product', retryable: false));
    }
    final granted = Entitlement(
      tier: EntitlementTier.premium,
      source: EntitlementSource.sandbox,
      productKey: product.key,
      lastVerifiedAt: DateTime.now(),
    );
    _owned.add(granted);
    return Ok(granted);
  }

  @override
  Future<Result<List<Entitlement>>> restore() async {
    if (offline || failRestore) {
      return const Err(PurchaseFailure('store unreachable'));
    }
    return Ok(List.of(_owned));
  }
}
