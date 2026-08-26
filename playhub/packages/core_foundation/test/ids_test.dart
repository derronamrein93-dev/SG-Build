import 'dart:math';

import 'package:core_foundation/core_foundation.dart';
import 'package:test/test.dart';

void main() {
  group('Ids.v7', () {
    final ids = Ids(random: Random(42));

    test('has the canonical UUID shape, version 7 and RFC 4122 variant', () {
      final id = ids.v7();
      expect(
        id,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
    });

    test('sorts chronologically as a plain string', () {
      // The property the database depends on: lexical order == time order,
      // so indexes stay dense and "recent rows" is a range scan.
      final earlier = ids.v7(at: DateTime.utc(2026, 1, 1));
      final later = ids.v7(at: DateTime.utc(2026, 6, 1));
      final latest = ids.v7(at: DateTime.utc(2027, 1, 1));

      final sorted = [latest, earlier, later]..sort();
      expect(sorted, [earlier, later, latest]);
    });

    test('generates no duplicates within the same millisecond', () {
      final at = DateTime.utc(2026, 8, 26);
      final generated = {for (var i = 0; i < 5000; i++) ids.v7(at: at)};
      expect(generated, hasLength(5000));
    });
  });
}
