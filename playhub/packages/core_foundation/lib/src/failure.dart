/// Everything that can go wrong, as a closed set.
///
/// A child never sees any of these. The shell's worst case is a friendly
/// character returning them home; the detail is written to the local log and
/// shown only in the Parent Hub's diagnostics screen.
sealed class Failure {
  const Failure(this.message, {this.cause});

  final String message;
  final Object? cause;

  /// Whether retrying the same operation could plausibly succeed.
  bool get isTransient => false;

  @override
  String toString() =>
      '$runtimeType: $message${cause == null ? '' : ' <- $cause'}';
}

/// The database could not be read, written, opened or migrated.
final class StorageFailure extends Failure {
  const StorageFailure(super.message, {super.cause, this.isCorruption = false});
  final bool isCorruption;
}

/// A theme pack, asset or manifest is missing, malformed or failed validation.
/// Always recoverable: the resolver falls back to core defaults.
final class ContentFailure extends Failure {
  const ContentFailure(super.message, {super.cause, this.slot});
  final String? slot;
}

/// StoreKit could not be reached or a transaction could not be verified.
final class PurchaseFailure extends Failure {
  const PurchaseFailure(super.message, {super.cause, this.retryable = true});
  final bool retryable;
  @override
  bool get isTransient => retryable;
}

/// An invariant that should hold in the data does not — a negative star
/// balance, a duplicate idempotency key, an orphaned reward request. These are
/// never swallowed: they are logged and surfaced to the Parent Hub.
final class IntegrityFailure extends Failure {
  const IntegrityFailure(super.message, {super.cause});
}

/// A game module misbehaved: threw, stalled, or violated its contract.
final class GameFailure extends Failure {
  const GameFailure(super.message, {super.cause, required this.gameId});
  final String gameId;
}
