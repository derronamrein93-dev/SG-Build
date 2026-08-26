import 'dart:io';

import 'package:core_gameapi/core_gameapi.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playhub/registry/game_registry.dart';

void main() {
  const registry = GameRegistry.empty();

  test('every registered module targets the current API version', () {
    expect(registry.incompatible, isEmpty);
  });

  test('registered ids are unique', () {
    expect(registry.ids.length, registry.all.length);
  });

  test('the registry matches the game packages on disk', () {
    // A forgotten registration fails the build rather than shipping an
    // invisible game. Adding a game is one line here — that is the modularity
    // claim, stated as a testable fact.
    final games = Directory('packages/games');
    final dir = games.existsSync() ? games : Directory('../../packages/games');
    final onDisk = !dir.existsSync()
        ? <String>{}
        : dir
              .listSync()
              .whereType<Directory>()
              .map((d) => d.path.split(Platform.pathSeparator).last)
              .where((name) => name.startsWith('game_'))
              .map((name) => name.substring('game_'.length))
              .toSet();

    expect(registry.ids, onDisk);
  });

  test('resolving an unknown id returns null rather than throwing', () {
    expect(registry.resolve('not_a_game'), isNull);
  });

  test('the API version this app builds against is pinned', () {
    expect(gameApiVersion, 1);
  });
}
