import 'clock.dart';

enum LogLevel { debug, info, warn, error }

class LogEntry {
  const LogEntry(this.at, this.level, this.tag, this.message);
  final DateTime at;
  final LogLevel level;
  final String tag;
  final String message;

  @override
  String toString() =>
      '${at.toIso8601String()} ${level.name.toUpperCase().padRight(5)} '
      '[$tag] $message';
}

/// An in-memory ring buffer. Never leaves the device, never transmitted.
///
/// The parent can export it from the Parent Hub's diagnostics screen, which is
/// the only way any of it moves — parent-initiated, contents visible first.
/// This is the whole of our crash/diagnostics story, on purpose: see
/// docs/13-privacy-and-child-safety.md.
class AppLogger {
  AppLogger({required Clock clock, int capacity = 500})
    : _clock = clock,
      _capacity = capacity;

  final Clock _clock;
  final int _capacity;
  final List<LogEntry> _entries = <LogEntry>[];

  List<LogEntry> get entries => List.unmodifiable(_entries);

  void debug(String tag, String message) => _add(LogLevel.debug, tag, message);
  void info(String tag, String message) => _add(LogLevel.info, tag, message);
  void warn(String tag, String message) => _add(LogLevel.warn, tag, message);
  void error(String tag, String message) => _add(LogLevel.error, tag, message);

  void _add(LogLevel level, String tag, String message) {
    _entries.add(LogEntry(_clock.now(), level, tag, message));
    if (_entries.length > _capacity) {
      _entries.removeRange(0, _entries.length - _capacity);
    }
  }

  String export() => _entries.join('\n');

  void clear() => _entries.clear();
}
