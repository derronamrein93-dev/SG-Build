import 'package:flutter/widgets.dart';

import 'game_event.dart';

/// One playthrough.
///
/// [build] returns a plain `Widget`, so a module may render with Flutter
/// widgets or with a Flame `GameWidget` — the platform never learns which, and
/// `flame` never appears in a core package. See docs/23-flame-usage-policy.md.
abstract interface class GameSession {
  Stream<GameEvent> get events;

  Widget build(BuildContext context);

  /// The **platform** owns pause: the HUD button, backgrounding, an incoming
  /// call and a screen-time warning all call this. A session must emit no
  /// events and run no timers while paused.
  Future<void> pause();

  Future<void> resume();

  /// "Wrap up gracefully within a few seconds." Sent when a screen-time limit
  /// is reached, so the round can reach a natural break instead of being cut
  /// off mid-move.
  Future<void> requestEndEarly();

  Future<void> dispose();

  /// Enough state to survive a crash mid-round. Returning null is fine.
  Map<String, Object?>? snapshot();
}
