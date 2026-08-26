import 'package:core_foundation/core_foundation.dart';
import 'package:core_theme/core_theme.dart';

import '../game_services.dart';

/// Records what a game asked for, so contract tests can assert on it.
class RecordingAudioBus implements AudioBus {
  final List<ThemeSlot> played = [];
  ThemeSlot? music;

  @override
  void play(ThemeSlot slot, {double gain = 1.0}) => played.add(slot);

  @override
  void loopMusic(ThemeSlot slot) => music = slot;

  @override
  void stopMusic() => music = null;
}

class RecordingHaptics implements Haptics {
  int lightCount = 0;
  int successCount = 0;

  @override
  void light() => lightCount++;

  @override
  void success() => successCount++;
}

class RecordingVoiceOver implements VoiceOver {
  final List<String> spoken = [];

  @override
  Future<void> speak(String promptKey) async => spoken.add(promptKey);

  @override
  void stop() {}
}

class RecordingTelemetry implements GameTelemetry {
  final Map<String, int> counters = {};

  @override
  void count(String name, {int by = 1}) =>
      counters[name] = (counters[name] ?? 0) + by;
}

/// A fully fake service surface driven by a [FakeClock].
GameServices fakeGameServices({Clock? clock}) => GameServices(
  audio: RecordingAudioBus(),
  haptics: RecordingHaptics(),
  voice: RecordingVoiceOver(),
  telemetry: RecordingTelemetry(),
  clock: clock ?? FakeClock(),
);

/// A theme in which every slot resolves to a core-default placeholder — the
/// state a pack is in before any art is delivered. A game must be fully
/// playable in it.
ResolvedTheme placeholderTheme({
  String packId = 'test',
  QualityTier tier = QualityTier.medium,
  Map<String, TokenCatalog> catalogs = const {},
}) => ResolvedTheme(
  packId: packId,
  tier: tier,
  assets: const {},
  catalogs: catalogs,
  palette: const {},
);

/// A generic token catalog big enough for the early-school band.
TokenCatalog fakeTokenCatalog({
  String setId = 'tokens',
  int count = 16,
  Set<TokenAttribute> attributes = const {
    TokenAttribute.color,
    TokenAttribute.shape,
    TokenAttribute.category,
  },
}) => TokenCatalog(
  setId: setId,
  matchBy: attributes,
  tokens: [
    for (var i = 0; i < count; i++)
      ThemeToken(
        id: 'tok$i',
        artPath: 'tok$i.webp',
        attributes: {for (final a in attributes) a: '${a.name}${i % 8}'},
      ),
  ],
);
