import 'package:core_foundation/core_foundation.dart';

enum BeatKind { correctMatch, piecePlaced, itemSorted, milestone }

/// What a round produced. Feeds the difficulty director and the local-only
/// telemetry counters — never a remote endpoint.
class GameOutcomeStats {
  const GameOutcomeStats({
    required this.duration,
    required this.misses,
    required this.hintsUsed,
    required this.itemsCompleted,
  });

  final Duration duration;
  final int misses;
  final int hintsUsed;
  final int itemsCompleted;

  /// 0..1. Hints are not punished harshly — they are how the product keeps its
  /// promise that the child always succeeds.
  double get cleanliness {
    final attempts = itemsCompleted + misses;
    if (attempts == 0) return 1;
    return (itemsCompleted / attempts).clamp(0.0, 1.0);
  }
}

class SessionSummary {
  const SessionSummary({
    required this.roundsCompleted,
    required this.totalDuration,
    required this.proposedStars,
  });

  final int roundsCompleted;
  final Duration totalDuration;
  final int proposedStars;
}

/// Everything a game may tell the platform. Note there is no `scoreChanged`
/// and no `starsAwarded`: a game *proposes*, the platform *decides*.
sealed class GameEvent {
  const GameEvent();
}

final class RoundStarted extends GameEvent {
  const RoundStarted(this.roundIndex);
  final int roundIndex;
}

final class ProgressChanged extends GameEvent {
  const ProgressChanged(this.fraction);

  /// 0..1.
  final double fraction;
}

/// A positive beat — a correct match, a placed piece. Drives juice and haptics.
final class PositiveBeat extends GameEvent {
  const PositiveBeat(this.kind);
  final BeatKind kind;
}

/// A wrong attempt. The platform never punishes; this only feeds the hint
/// ladder. There is no `Failed` event in this API, on purpose.
final class MissedAttempt extends GameEvent {
  const MissedAttempt(this.consecutiveMisses);
  final int consecutiveMisses;
}

final class RoundCompleted extends GameEvent {
  const RoundCompleted({
    required this.roundIndex,
    required this.proposedStars,
    required this.stats,
  });

  final int roundIndex;

  /// A **proposal**. The platform caps it, deduplicates it by idempotency key,
  /// applies the daily earn cap, and only then writes to the ledger.
  final int proposedStars;

  final GameOutcomeStats stats;
}

final class SessionFinished extends GameEvent {
  const SessionFinished(this.summary);
  final SessionSummary summary;
}

/// The game has failed and cannot continue. The platform keeps already-banked
/// stars, returns the child home with a friendly character, and writes the
/// detail to the local log. The child never sees an error.
final class GameFailedInternally extends GameEvent {
  const GameFailedInternally(this.failure);
  final Failure failure;
}
