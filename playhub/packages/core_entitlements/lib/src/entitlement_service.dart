import 'dart:async';

import 'package:core_foundation/core_foundation.dart';

import 'entitlement.dart';
import 'purchase_gateway.dart';

/// Where the cached entitlement lives between launches.
abstract interface class EntitlementStore {
  Future<Entitlement?> read();
  Future<void> write(Entitlement entitlement);
}

class InMemoryEntitlementStore implements EntitlementStore {
  Entitlement? _value;

  @override
  Future<Entitlement?> read() async => _value;

  @override
  Future<void> write(Entitlement entitlement) async => _value = entitlement;
}

/// Resolves what the household may use, and keeps working offline.
///
/// Two deliberate policies:
///
/// * **Offline grace.** A family on a two-week trip with no connectivity must
///   not lose content they paid for — that is the exact use case this product
///   exists for. Premium survives [graceWindow] without a successful check.
/// * **Ambiguity favours the customer.** A StoreKit error, an unverifiable
///   transaction or a corrupt cache all *keep* the last known-good entitlement.
///   An occasional wrongly-granted month costs little; a paying parent locked
///   out at a restaurant costs a refund and a one-star review.
class EntitlementService {
  EntitlementService({
    required PurchaseGateway gateway,
    required EntitlementStore store,
    required Clock clock,
    StoreProductCatalog catalog = const StoreProductCatalog.provisional(),
    this.graceWindow = const Duration(days: 30),
  }) : _gateway = gateway,
       _store = store,
       _clock = clock,
       _catalog = catalog;

  final PurchaseGateway _gateway;
  final EntitlementStore _store;
  final Clock _clock;
  final StoreProductCatalog _catalog;
  final Duration graceWindow;

  final _controller = StreamController<Entitlement>.broadcast();
  Entitlement _current = const Entitlement.free();

  Stream<Entitlement> get changes => _controller.stream;
  Entitlement get current => _current;

  StoreProductCatalog get catalog => _catalog;

  bool has(Feature feature) =>
      alwaysFreeFeatures.contains(feature) ||
      _current.features.contains(feature);

  /// Load the cache, then refresh from the store. Never blocks the UI on the
  /// network: the cached answer is available immediately.
  Future<void> initialise() async {
    final cached = await _store.read();
    if (cached != null) _emit(_applyExpiry(cached));
    await refresh();
  }

  /// Re-check with the store. Safe to call on launch, on foreground, and after
  /// a purchase.
  Future<Result<Entitlement>> refresh() async {
    final result = await _gateway.currentEntitlements();

    return result
        .fold(
          (entitlements) async {
            final best = _best(entitlements);
            final resolved = best == null
                ? const Entitlement.free()
                : best.copyWith(lastVerifiedAt: _clock.now());
            await _persist(resolved);
            return Ok(resolved);
          },
          (failure) async {
            // Could not reach the store. Hold the line rather than downgrading.
            _emit(_applyExpiry(_current));
            return Err<Entitlement>(failure);
          },
        )
        .then((v) => v);
  }

  Future<Result<Entitlement>> purchase(ProductKey key) async {
    final storeId = _catalog.idFor(key);
    if (storeId == null) {
      return const Err(
        PurchaseFailure(
          'no store product configured for this key',
          retryable: false,
        ),
      );
    }
    final result = await _gateway.purchase(storeId);
    if (result case Ok(:final value)) {
      await _persist(value.copyWith(lastVerifiedAt: _clock.now()));
    }
    return result;
  }

  Future<Result<Entitlement>> restore() async {
    final result = await _gateway.restore();
    return result
        .fold((list) async {
          final best = _best(list);
          if (best == null) return const Ok(Entitlement.free());
          final resolved = best.copyWith(lastVerifiedAt: _clock.now());
          await _persist(resolved);
          return Ok(resolved);
        }, (failure) async => Err<Entitlement>(failure))
        .then((v) => v);
  }

  /// Products for the paywall, with prices **from the store**.
  Future<Result<List<StoreProduct>>> products() =>
      _gateway.query(_catalog.allIds);

  Future<void> _persist(Entitlement e) async {
    await _store.write(e);
    _emit(e);
  }

  void _emit(Entitlement e) {
    _current = e;
    if (!_controller.isClosed) _controller.add(e);
  }

  /// Applies expiry and the offline grace window to a cached entitlement.
  Entitlement _applyExpiry(Entitlement e) {
    if (!e.isPremium) return e;

    final expires = e.expiresAt;
    if (expires != null && _clock.now().isAfter(expires)) {
      return const Entitlement.free();
    }

    final verified = e.lastVerifiedAt;
    if (verified != null && _clock.now().difference(verified) > graceWindow) {
      return const Entitlement.free();
    }
    return e;
  }

  Entitlement? _best(List<Entitlement> candidates) {
    Entitlement? best;
    for (final c in candidates) {
      if (!c.isPremium) continue;
      if (best == null) {
        best = c;
        continue;
      }
      final a = c.expiresAt;
      final b = best.expiresAt;
      if (b == null) continue; // lifetime beats everything
      if (a == null || a.isAfter(b)) best = c;
    }
    return best;
  }

  Future<void> dispose() => _controller.close();
}
