import 'theme_slot.dart';
import 'token_catalog.dart';

/// Presentation budget. Never changes gameplay — same board, same difficulty,
/// same stars. Only how much the device is asked to draw.
enum QualityTier { low, medium, high }

/// An asset with per-quality variants. `@1x` on LOW, `@2x` above.
class ThemeAsset {
  const ThemeAsset({this.path1x, this.path2x, this.rivePath, this.artboard});

  final String? path1x;
  final String? path2x;
  final String? rivePath;
  final String? artboard;

  bool get isEmpty => path1x == null && path2x == null && rivePath == null;

  /// The best path for [tier], degrading rather than failing.
  String? pathFor(QualityTier tier) {
    if (rivePath != null) return rivePath;
    if (tier == QualityTier.low) return path1x ?? path2x;
    return path2x ?? path1x;
  }
}

/// A ThemePack, parsed. Contains no Dart code by design — a pack on disk is a
/// manifest plus asset files, which is what makes a new theme a design task
/// rather than an engineering one.
class ThemePack {
  const ThemePack({
    required this.id,
    required this.schemaVersion,
    required this.contentVersion,
    required this.nameKey,
    required this.tier,
    required this.assets,
    required this.catalogs,
    required this.supports,
    this.family,
    this.palette = const {},
  });

  final String id;
  final int schemaVersion;
  final int contentVersion;
  final String nameKey;

  /// `free` or `premium` — resolved through the entitlement layer, never here.
  final String tier;

  /// Optional parent pack whose slots fill this one's gaps before core defaults.
  /// A seasonal variant is ~15 files instead of 120.
  final String? family;

  final Map<String, String> palette;
  final Map<ThemeSlot, ThemeAsset> assets;
  final Map<String, TokenCatalog> catalogs;

  /// Game ids this pack claims to support.
  final Set<String> supports;

  ThemeAsset? asset(ThemeSlot slot) => assets[slot];
  TokenCatalog? catalog(String setId) => catalogs[setId];

  @override
  String toString() => 'ThemePack($id v$contentVersion)';
}
