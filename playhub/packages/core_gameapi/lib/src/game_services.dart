import 'package:core_foundation/core_foundation.dart';
import 'package:core_theme/core_theme.dart';

/// Play a sound by *slot*, so a game can never load an arbitrary file and a
/// theme always supplies its own voice.
abstract interface class AudioBus {
  void play(ThemeSlot slot, {double gain = 1.0});
  void loopMusic(ThemeSlot slot);
  void stopMusic();
}

abstract interface class Haptics {
  /// Respects the parent's haptics setting; a no-op when disabled.
  void light();
  void success();
}

/// Spoken prompts, by localisation key. Respects the profile's voice setting.
abstract interface class VoiceOver {
  Future<void> speak(String promptKey);
  void stop();
}

/// Counters only, to a local-only sink. There is no remote endpoint in this
/// product; see docs/13-privacy-and-child-safety.md.
abstract interface class GameTelemetry {
  void count(String name, {int by = 1});
}

/// The complete capability surface handed to a game.
///
/// Deliberately absent: any database, `Navigator`, `HttpClient`, file system,
/// entitlement service, star ledger, purchase API or share sheet. A game module
/// physically cannot corrupt platform state or reach the outside world.
class GameServices {
  const GameServices({
    required this.audio,
    required this.haptics,
    required this.voice,
    required this.telemetry,
    required this.clock,
  });

  final AudioBus audio;
  final Haptics haptics;
  final VoiceOver voice;
  final GameTelemetry telemetry;

  /// Never `DateTime.now()`. See docs/02-system-architecture.md §5.
  final Clock clock;
}
