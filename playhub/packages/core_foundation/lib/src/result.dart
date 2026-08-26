import 'failure.dart';

/// The return type for anything that can fail in a way the caller must handle.
///
/// Exceptions are reserved for programmer error. Expected failures — a missing
/// asset, a full disk, an unverifiable receipt — are values, so the compiler
/// makes you deal with them.
sealed class Result<T> {
  const Result();

  bool get isOk => this is Ok<T>;

  /// The value, or null if this is an [Err].
  T? get valueOrNull => switch (this) {
    Ok<T>(:final value) => value,
    Err<T>() => null,
  };

  /// The value, or [fallback] if this is an [Err]. The child-facing UI uses this
  /// almost everywhere: a failure becomes a placeholder, never an error message.
  T valueOr(T fallback) => valueOrNull ?? fallback;

  R fold<R>(R Function(T value) ok, R Function(Failure failure) err) =>
      switch (this) {
        Ok<T>(:final value) => ok(value),
        Err<T>(:final failure) => err(failure),
      };

  Result<R> map<R>(R Function(T value) transform) => switch (this) {
    Ok<T>(:final value) => Ok(transform(value)),
    Err<T>(:final failure) => Err<R>(failure),
  };
}

final class Ok<T> extends Result<T> {
  const Ok(this.value);
  final T value;

  @override
  String toString() => 'Ok($value)';
}

final class Err<T> extends Result<T> {
  const Err(this.failure);
  final Failure failure;

  @override
  String toString() => 'Err($failure)';
}
