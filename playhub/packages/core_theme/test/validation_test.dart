import 'package:core_theme/core_theme.dart';
import 'package:test/test.dart';

const _matchPairs = GameContentRequirement(
  gameId: 'match_pairs',
  requiredSlots: {
    ThemeSlot.sfxCorrect,
    ThemeSlot.sfxTryAgain,
    ThemeSlot.frameCard,
  },
  tokenSetId: 'creatures',
  tokenAttributes: {TokenAttribute.color},
  minimumTokens: 8,
);

TokenCatalog _catalog(int n) => TokenCatalog(
  setId: 'creatures',
  matchBy: const {TokenAttribute.color},
  tokens: [
    for (var i = 0; i < n; i++)
      ThemeToken(
        id: 't$i',
        artPath: 't$i.webp',
        attributes: {TokenAttribute.color: 'c${i % 5}'},
      ),
  ],
);

ThemePack _pack({
  Map<ThemeSlot, ThemeAsset>? assets,
  int tokens = 8,
  Set<String> supports = const {'match_pairs'},
  String tier = 'free',
}) => ThemePack(
  id: 'test',
  schemaVersion: slotSchemaVersion,
  contentVersion: 1,
  nameKey: 'theme.test.name',
  tier: tier,
  supports: supports,
  catalogs: {'creatures': _catalog(tokens)},
  assets:
      assets ??
      {
        ThemeSlot.sfxCorrect: const ThemeAsset(path1x: 'ok.opus'),
        ThemeSlot.sfxTryAgain: const ThemeAsset(path1x: 'hmm.opus'),
        ThemeSlot.frameCard: const ThemeAsset(path2x: 'card@2x.webp'),
        ThemeSlot.tile('match_pairs'): const ThemeAsset(path2x: 'tile@2x.webp'),
      },
);

void main() {
  const validator = ThemePackValidator(
    requirements: {'match_pairs': _matchPairs},
  );

  test('a complete pack validates clean', () {
    expect(validator.validate(_pack()), isEmpty);
  });

  test('a missing required slot is fatal and names the slot', () {
    final issues = validator.validate(
      _pack(
        assets: const {ThemeSlot.sfxCorrect: ThemeAsset(path1x: 'ok.opus')},
      ),
    );

    expect(issues.where((i) => i.fatal), isNotEmpty);
    expect(issues.map((i) => i.slot), contains('sfx.tryAgain'));
  });

  test('too few tokens fails the pack for that game', () {
    final issues = validator.validate(_pack(tokens: 4));
    expect(issues.single.message, contains('does not meet game "match_pairs"'));
  });

  test('claiming an unknown game fails', () {
    final issues = validator.validate(
      _pack(supports: {'match_pairs', 'wormhole'}),
    );
    expect(issues.single.message, contains('unknown game "wormhole"'));
  });

  test('a bad tier value fails', () {
    expect(
      validator.validate(_pack(tier: 'deluxe')).map((i) => i.message).join(),
      contains('tier must be free or premium'),
    );
  });

  test('exceeding the size budget fails', () {
    final issues = validator.validate(_pack(), actualBytes: 9 * 1024 * 1024);
    expect(issues.single.message, contains('budget is'));
  });

  test('a missing tile is a warning, not a failure', () {
    final issues = validator.validate(
      _pack(
        assets: const {
          ThemeSlot.sfxCorrect: ThemeAsset(path1x: 'ok.opus'),
          ThemeSlot.sfxTryAgain: ThemeAsset(path1x: 'hmm.opus'),
          ThemeSlot.frameCard: ThemeAsset(path2x: 'card@2x.webp'),
        },
      ),
    );

    expect(issues, hasLength(1));
    expect(issues.single.fatal, isFalse);
  });
}
