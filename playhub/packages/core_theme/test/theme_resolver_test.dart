import 'package:core_theme/core_theme.dart';
import 'package:test/test.dart';

ThemePack _pack({
  required String id,
  String? family,
  Map<ThemeSlot, ThemeAsset> assets = const {},
  Set<String> supports = const {'match_pairs'},
}) => ThemePack(
  id: id,
  schemaVersion: slotSchemaVersion,
  contentVersion: 1,
  nameKey: 'theme.$id.name',
  tier: 'free',
  family: family,
  assets: assets,
  catalogs: const {},
  supports: supports,
);

void main() {
  group('fallback chain', () {
    test('an asset in the pack wins', () {
      final resolver = ThemeResolver(
        packs: {
          'dino': _pack(
            id: 'dino',
            assets: {
              ThemeSlot.backgroundFar: const ThemeAsset(
                path2x: 'dino/far@2x.webp',
              ),
            },
          ),
        },
      );

      final theme = resolver.resolve('dino', QualityTier.medium);
      expect(theme[ThemeSlot.backgroundFar].path, 'dino/far@2x.webp');
      expect(theme[ThemeSlot.backgroundFar].origin, ThemeAssetOrigin.pack);
    });

    test('the family pack fills a gap before core defaults do', () {
      final resolver = ThemeResolver(
        packs: {
          'prehistoric': _pack(
            id: 'prehistoric',
            assets: {
              ThemeSlot.guideIdle: const ThemeAsset(
                rivePath: 'shared/guide.riv',
              ),
            },
          ),
          'dino': _pack(id: 'dino', family: 'prehistoric'),
        },
      );

      final theme = resolver.resolve('dino', QualityTier.medium);
      expect(theme[ThemeSlot.guideIdle].path, 'shared/guide.riv');
      expect(theme[ThemeSlot.guideIdle].origin, ThemeAssetOrigin.family);
    });

    test('every slot resolves to something, even for a totally empty pack', () {
      // The guarantee that lets placeholder art ship on day one: there is no
      // null return and no missing asset at play time.
      final resolver = ThemeResolver(packs: {'bare': _pack(id: 'bare')});
      final theme = resolver.resolve('bare', QualityTier.low);

      for (final slot in ThemeSlot.fixedSlots) {
        expect(theme[slot].path, isNotEmpty, reason: 'unresolved: ${slot.key}');
        expect(theme[slot].origin, ThemeAssetOrigin.coreDefault);
      }
      expect(theme.placeholders, isNotEmpty);
    });

    test('an unknown pack id degrades instead of throwing', () {
      const resolver = ThemeResolver(packs: {});
      final theme = resolver.resolve('does_not_exist', QualityTier.high);
      expect(theme[ThemeSlot.sfxCorrect].isPlaceholder, isTrue);
    });
  });

  group('quality tiers', () {
    final asset = const ThemeAsset(path1x: 'a@1x.webp', path2x: 'a@2x.webp');

    test('LOW takes @1x, MEDIUM and HIGH take @2x', () {
      expect(asset.pathFor(QualityTier.low), 'a@1x.webp');
      expect(asset.pathFor(QualityTier.medium), 'a@2x.webp');
      expect(asset.pathFor(QualityTier.high), 'a@2x.webp');
    });

    test('a tier degrades to the variant that exists rather than failing', () {
      const only2x = ThemeAsset(path2x: 'b@2x.webp');
      expect(only2x.pathFor(QualityTier.low), 'b@2x.webp');
    });

    test('Rive assets serve every tier from one file', () {
      const rive = ThemeAsset(rivePath: 'guide.riv', artboard: 'guide');
      for (final t in QualityTier.values) {
        expect(rive.pathFor(t), 'guide.riv');
      }
    });
  });

  test('home-screen tile art is resolved per game, from the theme', () {
    final resolver = ThemeResolver(
      packs: {
        'ocean': _pack(
          id: 'ocean',
          supports: {'match_pairs', 'jigsaw'},
          assets: {
            ThemeSlot.tile('jigsaw'): const ThemeAsset(
              path2x: 'ocean/tile_jigsaw.webp',
            ),
          },
        ),
      },
    );

    final theme = resolver.resolve('ocean', QualityTier.medium);
    expect(theme[ThemeSlot.tile('jigsaw')].path, 'ocean/tile_jigsaw.webp');
    // The game with no bespoke tile still gets one.
    expect(theme[ThemeSlot.tile('match_pairs')].path, isNotEmpty);
  });

  test('the slot vocabulary is versioned and stable', () {
    // A golden. If this fails, the slot vocabulary changed — which invalidates
    // every ThemePack ever authored. Bump deliberately, never incidentally.
    expect(slotSchemaVersion, 1);
    expect(ThemeSlot.fixedSlots, hasLength(28));
    expect(ThemeSlot.backgroundFar.key, 'bg.far');
    expect(ThemeSlot.sticker(3).key, 'reward.sticker.03');
    expect(ThemeSlot.tokens('creatures').key, 'tokens.creatures');
  });
}
