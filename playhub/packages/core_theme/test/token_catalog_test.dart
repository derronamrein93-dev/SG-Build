import 'dart:math';

import 'package:core_theme/core_theme.dart';
import 'package:test/test.dart';

TokenCatalog _creatures() => TokenCatalog(
  setId: 'creatures',
  matchBy: {TokenAttribute.color, TokenAttribute.category},
  tokens: [
    for (final (id, color, cat) in const [
      ('trex', 'green', 'carnivore'),
      ('raptor', 'green', 'carnivore'),
      ('stego', 'blue', 'herbivore'),
      ('bronto', 'grey', 'herbivore'),
      ('tri', 'brown', 'herbivore'),
      ('ptero', 'red', 'flyer'),
    ])
      ThemeToken(
        id: id,
        artPath: 'tokens/$id.webp',
        attributes: {TokenAttribute.color: color, TokenAttribute.category: cat},
      ),
  ],
);

void main() {
  test('distinctValuesOf gives a sorter its bins', () {
    expect(_creatures().distinctValuesOf(TokenAttribute.category), [
      'carnivore',
      'flyer',
      'herbivore',
    ]);
  });

  test('pickDistinctBy never returns two tokens sharing the attribute', () {
    final rng = Random(7);
    final picked = _creatures().pickDistinctBy(
      TokenAttribute.color,
      count: 4,
      nextInt: rng.nextInt,
    );

    expect(picked, hasLength(4));
    final colors = picked.map((t) => t.attr(TokenAttribute.color)).toSet();
    expect(colors, hasLength(4));
  });

  test('picking is deterministic for a given seed', () {
    // Boards must be reproducible: same seed, same board. This is what makes a
    // game's rules unit-testable and a support report replayable.
    List<String> run() {
      final rng = Random(99);
      return _creatures()
          .pickDistinctBy(TokenAttribute.color, count: 3, nextInt: rng.nextInt)
          .map((t) => t.id)
          .toList();
    }

    expect(run(), run());
  });

  test('asking for more distinct values than exist returns what there is', () {
    final rng = Random(1);
    final picked = _creatures().pickDistinctBy(
      TokenAttribute.category,
      count: 10,
      nextInt: rng.nextInt,
    );
    expect(picked, hasLength(3));
  });

  test('supports() gates a game on attributes AND count', () {
    final c = _creatures();
    expect(
      c.supports(needed: {TokenAttribute.color}, minimumTokens: 6),
      isTrue,
    );
    expect(
      c.supports(needed: {TokenAttribute.color}, minimumTokens: 16),
      isFalse,
      reason: 'not enough tokens for the early-school band',
    );
    expect(
      c.supports(needed: {TokenAttribute.initialSound}, minimumTokens: 4),
      isFalse,
      reason: 'tokens are not tagged with initialSound',
    );
  });
}
