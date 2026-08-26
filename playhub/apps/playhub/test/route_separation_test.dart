import 'package:flutter_test/flutter_test.dart';
import 'package:playhub/routing/routes.dart';

void main() {
  group('child and parent route trees are structurally disjoint', () {
    test('no route appears in both trees', () {
      expect(childRoutes.intersection(parentRoutes), isEmpty);
    });

    test('no child route lives under the parent prefix', () {
      // A settings button on a home screen is not a boundary; it is a target.
      for (final route in childRoutes) {
        expect(route.startsWith('/parent'), isFalse, reason: route);
      }
    });

    test('every parent route lives under the parent prefix', () {
      for (final route in parentRoutes) {
        expect(route.startsWith('/parent'), isTrue, reason: route);
      }
    });

    test('the gate is in neither tree — it is the only edge between them', () {
      expect(childRoutes.contains(parentGate), isFalse);
      expect(parentRoutes.contains(parentGate), isFalse);
    });

    test('reserved module roots collide with nothing', () {
      // The navigation seam for Watch/Create/Learn (docs/18) costs nothing now
      // and is not allowed to shadow an existing route.
      for (final root in reservedModuleRoots) {
        expect(childRoutes.contains(root), isFalse);
        expect(parentRoutes.contains(root), isFalse);
      }
    });

    test('the child tree contains no purchase or settings surface', () {
      const forbidden = [
        'buy',
        'purchase',
        'subscribe',
        'store',
        'settings',
        'price',
      ];
      for (final route in childRoutes) {
        for (final word in forbidden) {
          expect(
            route.toLowerCase().contains(word),
            isFalse,
            reason: '"$word" in child route $route',
          );
        }
      }
    });
  });
}
