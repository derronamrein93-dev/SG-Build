import 'package:core_foundation/core_foundation.dart';
import 'package:test/test.dart';

void main() {
  group('FakeClock', () {
    test('advance moves wall time and monotonic time together', () {
      final clock = FakeClock(start: DateTime(2026, 8, 26, 9));
      clock.advance(const Duration(minutes: 5));

      expect(clock.now(), DateTime(2026, 8, 26, 9, 5));
      expect(clock.elapsed(), const Duration(minutes: 5));
    });

    test('a wall-clock jump does not move monotonic time', () {
      // This is the scenario screen time has to survive: the device clock
      // changes (timezone, DST, a child fiddling with settings) but no real
      // time has passed.
      final clock = FakeClock(start: DateTime(2026, 8, 26, 9));
      clock.advance(const Duration(minutes: 3));
      clock.jumpWallClock(const Duration(hours: 6));

      expect(clock.elapsed(), const Duration(minutes: 3));
      expect(clock.now(), DateTime(2026, 8, 26, 15, 3));
    });

    test('a backwards wall-clock jump cannot rewind monotonic time', () {
      final clock = FakeClock(start: DateTime(2026, 8, 26, 9));
      clock.advance(const Duration(minutes: 10));
      clock.jumpWallClock(const Duration(hours: -6));

      expect(clock.elapsed(), const Duration(minutes: 10));
    });

    test('localDate is zero-padded and rolls at local midnight', () {
      final clock = FakeClock(start: DateTime(2026, 1, 5, 23, 59, 59));
      expect(clock.localDate(), '2026-01-05');

      clock.advance(const Duration(seconds: 1));
      expect(clock.localDate(), '2026-01-06');
    });
  });

  group('SystemClock', () {
    test('elapsed is monotonic across reads', () {
      final clock = SystemClock();
      final a = clock.elapsed();
      final b = clock.elapsed();
      expect(b, greaterThanOrEqualTo(a));
    });

    test('localDate matches the current local calendar date', () {
      final now = DateTime.now();
      final expected =
          '${now.year.toString().padLeft(4, '0')}-'
          '${now.month.toString().padLeft(2, '0')}-'
          '${now.day.toString().padLeft(2, '0')}';
      expect(SystemClock().localDate(), expected);
    });
  });
}
