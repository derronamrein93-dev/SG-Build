import 'theme_pack.dart';
import 'theme_slot.dart';
import 'token_catalog.dart';

/// Where a resolved asset came from. Surfaced only in Parent Hub diagnostics —
/// it is how we tell "the artist hasn't delivered this yet" from "the pack is
/// broken" without either ever reaching a child.
enum ThemeAssetOrigin { pack, family, coreDefault }

class ResolvedAsset {
  const ResolvedAsset(this.path, this.origin, this.slot);
  final String path;
  final ThemeAssetOrigin origin;
  final ThemeSlot slot;

  bool get isPlaceholder => origin == ThemeAssetOrigin.coreDefault;
}

/// A theme, fully resolved for one quality tier, ready to hand to a game.
///
/// Every slot resolves to *something*. There is no null return and no missing
/// asset at play time — that guarantee is what lets placeholder art ship on day
/// one and be replaced file by file, with no code change.
class ResolvedTheme {
  const ResolvedTheme({
    required this.packId,
    required this.tier,
    required this.assets,
    required this.catalogs,
    required this.palette,
  });

  final String packId;
  final QualityTier tier;
  final Map<ThemeSlot, ResolvedAsset> assets;
  final Map<String, TokenCatalog> catalogs;
  final Map<String, String> palette;

  ResolvedAsset operator [](ThemeSlot slot) =>
      assets[slot] ??
      ResolvedAsset(
        _coreFallbackPath(slot),
        ThemeAssetOrigin.coreDefault,
        slot,
      );

  TokenCatalog? tokens(String setId) => catalogs[setId];

  /// Slots currently served by core defaults — the artist's to-do list.
  Iterable<ThemeSlot> get placeholders =>
      assets.values.where((a) => a.isPlaceholder).map((a) => a.slot);
}

String _coreFallbackPath(ThemeSlot slot) =>
    'assets/core/fallback/${slot.key.replaceAll('.', '_')}';
