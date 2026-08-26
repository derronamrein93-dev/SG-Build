import 'package:core_foundation/core_foundation.dart';
import 'package:test/test.dart';

void main() {
  test('the ring buffer drops the oldest entries and never grows', () {
    final logger = AppLogger(clock: FakeClock(), capacity: 3);

    for (var i = 0; i < 10; i++) {
      logger.info('test', 'entry $i');
    }

    expect(logger.entries, hasLength(3));
    expect(logger.entries.first.message, 'entry 7');
    expect(logger.entries.last.message, 'entry 9');
  });

  test('entries are stamped from the injected clock, not wall time', () {
    final clock = FakeClock(start: DateTime(2026, 8, 26, 12));
    final logger = AppLogger(clock: clock);

    logger.warn('screen_time', 'session limit reached');

    expect(logger.entries.single.at, DateTime(2026, 8, 26, 12));
    expect(logger.export(), contains('[screen_time] session limit reached'));
  });
}
