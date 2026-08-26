import 'resolved_theme.dart';
import 'theme_pack.dart';
import 'theme_slot.dart';

/// Resolves slots through a three-level chain: pack → family → core defaults.
///
/// A missing asset is never a crash and never an empty rectangle. The core
/// layer is brand-neutral and always complete, so a half-authored pack is
/// playable while it is being made and a corrupt downloaded pack degrades
/// instead of bricking a game.
class ThemeResolver {
  const ThemeResolver({
    required Map<String, ThemePack> packs,
    Set<ThemeSlot> coreDefaults = const {},
  }) : _packs = packs,
       _coreDefaults = coreDefaults;

  final Map<String, ThemePack> _packs;
  final Set<ThemeSlot> _coreDefaults;

  ThemePack? pack(String id) => _packs[id];

  ResolvedTheme resolve(
    String packId,
    QualityTier tier, {
    Iterable<ThemeSlot> extraSlots = const [],
  }) {
    final pack = _packs[packId];
    if (pack == null) {
      return ResolvedTheme(
        packId: packId,
        tier: tier,
        assets: const {},
        catalogs: const {},
        palette: const {},
      );
    }

    final family = pack.family == null ? null : _packs[pack.family];
    final wanted = <ThemeSlot>{
      ...ThemeSlot.fixedSlots,
      ...pack.supports.map(ThemeSlot.tile),
      ...pack.assets.keys,
      ...extraSlots,
    };

    final resolved = <ThemeSlot, ResolvedAsset>{};
    for (final slot in wanted) {
      final own = pack.asset(slot)?.pathFor(tier);
      if (own != null) {
        resolved[slot] = ResolvedAsset(own, ThemeAssetOrigin.pack, slot);
        continue;
      }
      final inherited = family?.asset(slot)?.pathFor(tier);
      if (inherited != null) {
        resolved[slot] = ResolvedAsset(
          inherited,
          ThemeAssetOrigin.family,
          slot,
        );
        continue;
      }
      resolved[slot] = ResolvedAsset(
        'assets/core/fallback/${slot.key.replaceAll('.', '_')}',
        ThemeAssetOrigin.coreDefault,
        slot,
      );
    }

    return ResolvedTheme(
      packId: pack.id,
      tier: tier,
      assets: resolved,
      catalogs: {...?family?.catalogs, ...pack.catalogs},
      palette: {...?family?.palette, ...pack.palette},
    );
  }

  /// Slots the core layer must ship a fallback for. Asserted in CI so a new
  /// slot can never be added without its placeholder.
  Set<ThemeSlot> get coreDefaults => _coreDefaults;
}
