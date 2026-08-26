import 'dart:math';

import 'package:core_theme/core_theme.dart';

import 'difficulty.dart';
import 'game_services.dart';

/// What the platform tells a game about the child. Note what is missing: no
/// nickname, no birthdate, no avatar, no identifiers. A game gets an opaque id
/// and the accessibility settings it must honour.
class ProfileRef {
  const ProfileRef({
    required this.id,
    required this.ageBand,
    this.reduceMotion = false,
    this.highContrast = false,
    this.largerTargets = false,
    this.leftHanded = false,
    this.voiceEnabled = true,
  });

  final String id;
  final AgeBand ageBand;
  final bool reduceMotion;
  final bool highContrast;
  final bool largerTargets;
  final bool leftHanded;
  final bool voiceEnabled;
}

class GameSessionRequest {
  const GameSessionRequest({
    required this.profile,
    required this.difficulty,
    required this.theme,
    required this.quality,
    required this.rng,
    required this.services,
    this.resumeSnapshot,
  });

  final ProfileRef profile;
  final DifficultyProfile difficulty;

  /// Already resolved and cached. Every slot is guaranteed to resolve.
  final ResolvedTheme theme;

  final QualityTier quality;

  /// **Seeded.** The same seed produces the same board, which is what makes a
  /// game's rules unit-testable and a support report replayable.
  final Random rng;

  final GameServices services;

  /// From a previous `GameSession.snapshot()`, after a crash. May be null, and a
  /// game is free to ignore it: resumability is optional and the platform never
  /// depends on it.
  final Map<String, Object?>? resumeSnapshot;
}
