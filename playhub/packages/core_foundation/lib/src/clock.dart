/// The only source of time in the application.
///
/// Nothing outside [SystemClock] may call `DateTime.now()`. Screen time, daily
/// rollovers, task schedules and entitlement grace periods all read from an
/// injected clock, which is what makes them testable without waiting.
abstract interface class Clock {
  /// Wall-clock time. Can jump backwards (user changes the device clock, DST,
  /// timezone change), so never subtract two of these to measure a duration.
  DateTime now();

  /// Monotonic elapsed time since an arbitrary origin. Never jumps backwards.
  /// Use this — not [now] — to measure how long something took.
  Duration elapsed();

  /// The local calendar date, as `yyyy-mm-dd`. The key for every daily bucket
  /// (screen-time usage, star earn caps, task instances).
  String localDate();
}

class SystemClock implements Clock {
  SystemClock() : _stopwatch = Stopwatch()..start();

  final Stopwatch _stopwatch;

  @override
  DateTime now() => DateTime.now();

  @override
  Duration elapsed() => _stopwatch.elapsed;

  @override
  String localDate() => _formatDate(DateTime.now());
}

/// Deterministic clock for tests. Wall time and monotonic time advance
/// independently so clock-tampering and sleep/suspend can be reproduced.
class FakeClock implements Clock {
  FakeClock({DateTime? start, Duration? monotonic})
    : _now = start ?? DateTime(2026),
      _elapsed = monotonic ?? Duration.zero;

  DateTime _now;
  Duration _elapsed;

  /// Advance both wall time and monotonic time by the same amount — the normal
  /// case, where nothing unusual is happening.
  void advance(Duration by) {
    _now = _now.add(by);
    _elapsed += by;
  }

  /// Move wall-clock time only. Models the user changing the device clock,
  /// a timezone change, or DST. Monotonic time is unaffected, which is the
  /// whole reason both exist.
  void jumpWallClock(Duration by) => _now = _now.add(by);

  /// Advance monotonic time only. Models wall-clock granularity loss.
  void advanceMonotonic(Duration by) => _elapsed += by;

  @override
  DateTime now() => _now;

  @override
  Duration elapsed() => _elapsed;

  @override
  String localDate() => _formatDate(_now);
}

String _formatDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';
