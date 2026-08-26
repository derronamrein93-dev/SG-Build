import 'package:core_gameapi/core_gameapi.dart';

/// **The one file that changes when a game is added.**
///
/// `test/game_registry_test.dart` asserts that the ids here exactly match the
/// packages present under `packages/games/`, so a forgotten registration fails
/// the build rather than shipping an invisible game.
class GameRegistry {
  const GameRegistry(this._modules);

  /// No games yet — they arrive in Phases 3 and 4.
  const GameRegistry.empty() : _modules = const [];

  final List<GameModule> _modules;

  List<GameModule> get all => List.unmodifiable(_modules);

  Set<String> get ids => _modules.map((m) => m.id).toSet();

  GameModule? resolve(String id) {
    for (final m in _modules) {
      if (m.id == id) return m;
    }
    return null;
  }

  /// Modules whose declared API version does not match this build. A non-empty
  /// result fails a test; it can never reach a child.
  List<GameModule> get incompatible =>
      _modules.where((m) => m.apiVersion != gameApiVersion).toList();
}
