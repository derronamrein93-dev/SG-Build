import 'package:core_theme/core_theme.dart';

import 'difficulty.dart';
import 'game_session.dart';
import 'session_request.dart';

/// Bumped only on a breaking change to this contract. Every module declares the
/// version it was written against, and a registry test rejects a mismatch —
/// so an out-of-date game fails the build, never a child's afternoon.
const int gameApiVersion = 1;

/// Free or premium. Resolved through the entitlement layer, never here: this
/// package knows nothing about purchases.
enum ContentTier { free, premium }

/// How a game is played. The MVP deliberately ships one of each, so three games
/// genuinely prove the framework rather than three variations proving one path.
enum InputModel { tapOnly, dragAndDrop, dragToPosition, trace }

class GameManifest {
  const GameManifest({
    required this.titleKey,
    required this.voPromptKey,
    required this.minAge,
    required this.maxAge,
    required this.tier,
    required this.input,
    required this.typicalRound,
    required this.maxStarsPerRound,
    this.supportsPortrait = true,
    this.supportsLandscape = true,
  });

  /// A localisation key. Never a literal — English-only at launch, but no
  /// hardcoded strings, ever.
  final String titleKey;

  final String voPromptKey;
  final AgeBand minAge;
  final AgeBand maxAge;
  final ContentTier tier;
  final InputModel input;

  /// Used by the screen-time grace window to decide how long to wait for a
  /// natural break before ending a session.
  final Duration typicalRound;

  /// A hard ceiling the platform enforces on a round's proposed stars.
  final int maxStarsPerRound;

  final bool supportsPortrait;
  final bool supportsLandscape;
}

/// Static description of a game. Constructed at startup for the home screen, so
/// it must be cheap: no asset loading, no I/O, no work.
abstract interface class GameModule {
  /// Stable forever. It keys save data, achievements and telemetry.
  String get id;

  /// Must equal [gameApiVersion].
  int get apiVersion;

  GameManifest get manifest;

  /// Validated against every shipped ThemePack in CI, so a pack that cannot
  /// serve this game is caught at build time.
  Set<ThemeSlot> get requiredSlots;

  /// Knobs this game honours. Others are ignored.
  Set<DifficultyKnob> get supportedKnobs;

  /// The token set and attributes this game needs from a pack, if any.
  String? get tokenSetId => null;
  Set<TokenAttribute> get tokenAttributes => const {};
  int get minimumTokens => 0;

  GameSession createSession(GameSessionRequest request);
}
