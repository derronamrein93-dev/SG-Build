import 'package:core_entitlements/core_entitlements.dart';
import 'package:core_foundation/core_foundation.dart';
import 'package:test/test.dart';

const _catalog = StoreProductCatalog({
  ProductKey.premiumMonthly: 'test.premium.monthly',
  ProductKey.premiumAnnual: 'test.premium.annual',
});

const _monthly = StoreProduct(
  key: ProductKey.premiumMonthly,
  storeId: 'test.premium.monthly',
  displayName: 'Monthly',
  displayPrice: 'whatever the store says',
  introOfferDescription: 'a trial, if configured',
);

EntitlementService _service({
  FakeGateway? gateway,
  FakeClock? clock,
  Entitlement? cached,
}) {
  final store = InMemoryEntitlementStore();
  if (cached != null) store.write(cached);
  return EntitlementService(
    gateway: gateway ?? FakeGateway(products: const [_monthly]),
    store: store,
    clock: clock ?? FakeClock(),
    catalog: _catalog,
  );
}

void main() {
  group('feature gating', () {
    test('free households get no premium features', () async {
      final s = _service();
      await s.initialise();

      expect(s.has(Feature.rewardStore), isFalse);
      expect(s.has(Feature.allThemes), isFalse);
      await s.dispose();
    });

    test('a purchase unlocks every premium feature', () async {
      final s = _service();
      await s.initialise();

      final result = await s.purchase(ProductKey.premiumMonthly);

      expect(result.isOk, isTrue);
      expect(s.has(Feature.rewardStore), isTrue);
      expect(s.has(Feature.taskSystem), isTrue);
      await s.dispose();
    });

    test('purchasing an unconfigured product fails without retrying', () async {
      final s = _service();
      await s.initialise();

      final result = await s.purchase(ProductKey.premiumLifetime);

      expect(result.isOk, isFalse);
      expect((result as Err).failure.isTransient, isFalse);
      await s.dispose();
    });
  });

  group('offline behaviour', () {
    test('premium survives 29 days offline', () async {
      final clock = FakeClock(start: DateTime(2026, 8, 1));
      final s = _service(
        clock: clock,
        gateway: FakeGateway(offline: true),
        cached: Entitlement(
          tier: EntitlementTier.premium,
          source: EntitlementSource.storeKit,
          productKey: ProductKey.premiumAnnual,
          lastVerifiedAt: DateTime(2026, 8, 1),
        ),
      );

      clock.advance(const Duration(days: 29));
      await s.initialise();

      expect(
        s.current.isPremium,
        isTrue,
        reason: 'a family on a long trip must keep what they paid for',
      );
      await s.dispose();
    });

    test('premium lapses after the grace window', () async {
      final clock = FakeClock(start: DateTime(2026, 8, 1));
      final s = _service(
        clock: clock,
        gateway: FakeGateway(offline: true),
        cached: Entitlement(
          tier: EntitlementTier.premium,
          source: EntitlementSource.storeKit,
          lastVerifiedAt: DateTime(2026, 8, 1),
        ),
      );

      clock.advance(const Duration(days: 31));
      await s.initialise();

      expect(s.current.isPremium, isFalse);
      await s.dispose();
    });

    test('a store error never downgrades a valid entitlement', () async {
      // Ambiguity resolves in the customer's favour.
      final clock = FakeClock(start: DateTime(2026, 8, 1));
      final gateway = FakeGateway(
        owned: [
          Entitlement(
            tier: EntitlementTier.premium,
            source: EntitlementSource.storeKit,
            lastVerifiedAt: DateTime(2026, 8, 1),
          ),
        ],
      );
      final s = _service(clock: clock, gateway: gateway);
      await s.initialise();
      expect(s.current.isPremium, isTrue);

      gateway.offline = true;
      clock.advance(const Duration(days: 2));
      final result = await s.refresh();

      expect(result.isOk, isFalse);
      expect(s.current.isPremium, isTrue);
      await s.dispose();
    });

    test(
      'an expired subscription lapses even inside the grace window',
      () async {
        final clock = FakeClock(start: DateTime(2026, 8, 1));
        final s = _service(
          clock: clock,
          gateway: FakeGateway(offline: true),
          cached: Entitlement(
            tier: EntitlementTier.premium,
            source: EntitlementSource.storeKit,
            expiresAt: DateTime(2026, 8, 3),
            lastVerifiedAt: DateTime(2026, 8, 1),
          ),
        );

        clock.advance(const Duration(days: 5));
        await s.initialise();

        expect(s.current.isPremium, isFalse);
        await s.dispose();
      },
    );
  });

  group('restore', () {
    test('restores premium on a fresh install', () async {
      final gateway = FakeGateway(
        owned: [
          const Entitlement(
            tier: EntitlementTier.premium,
            source: EntitlementSource.storeKit,
            productKey: ProductKey.premiumAnnual,
            lastVerifiedAt: null,
          ),
        ],
      );
      final s = _service(gateway: gateway);

      final result = await s.restore();

      expect(result.isOk, isTrue);
      expect(s.current.isPremium, isTrue);
      await s.dispose();
    });

    test('restoring nothing is a clean free result, not an error', () async {
      final s = _service(gateway: FakeGateway());
      final result = await s.restore();

      expect(result.isOk, isTrue);
      expect(s.current.isPremium, isFalse);
      await s.dispose();
    });
  });

  group('price neutrality', () {
    test('prices come from the store, never from the app', () async {
      final s = _service();
      final result = await s.products();

      expect(
        result.valueOrNull!.single.displayPrice,
        'whatever the store says',
      );
      await s.dispose();
    });

    test('the provisional catalog is empty until the Apple account exists', () {
      const provisional = StoreProductCatalog.provisional();
      expect(provisional.isConfigured, isFalse);
      expect(provisional.allIds, isEmpty);
      expect(provisional.idFor(ProductKey.premiumMonthly), isNull);
    });
  });

  test('lifetime outranks a dated subscription', () async {
    final gateway = FakeGateway(
      owned: [
        Entitlement(
          tier: EntitlementTier.premium,
          source: EntitlementSource.storeKit,
          productKey: ProductKey.premiumAnnual,
          expiresAt: DateTime(2027),
          lastVerifiedAt: DateTime(2026, 8, 1),
        ),
        const Entitlement(
          tier: EntitlementTier.premium,
          source: EntitlementSource.storeKit,
          productKey: ProductKey.premiumLifetime,
          lastVerifiedAt: null,
        ),
      ],
    );
    final s = _service(
      gateway: gateway,
      clock: FakeClock(start: DateTime(2026, 8, 1)),
    );
    await s.initialise();

    expect(s.current.productKey, ProductKey.premiumLifetime);
    await s.dispose();
  });
}
