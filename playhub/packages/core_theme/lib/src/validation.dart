import 'theme_pack.dart';
import 'theme_slot.dart';
import 'token_catalog.dart';

class ValidationIssue {
  const ValidationIssue(
    this.packId,
    this.message, {
    this.slot,
    this.fatal = true,
  });
  final String packId;
  final String message;
  final String? slot;
  final bool fatal;

  @override
  String toString() =>
      '${fatal ? 'ERROR' : 'warn '} [$packId]${slot == null ? '' : ' $slot:'} $message';
}

/// What one game needs from a pack before the pack may claim to support it.
class GameContentRequirement {
  const GameContentRequirement({
    required this.gameId,
    required this.requiredSlots,
    this.tokenSetId,
    this.tokenAttributes = const {},
    this.minimumTokens = 0,
  });

  final String gameId;
  final Set<ThemeSlot> requiredSlots;
  final String? tokenSetId;
  final Set<TokenAttribute> tokenAttributes;
  final int minimumTokens;
}

/// Validates a pack against the slot vocabulary and the games it claims.
///
/// Runs in CI on every pack, so a pack with a missing slot, an unknown
/// attribute or an oversized budget fails the build rather than a child's
/// afternoon.
class ThemePackValidator {
  const ThemePackValidator({
    required this.requirements,
    this.maxBytes = 8 * 1024 * 1024,
  });

  final Map<String, GameContentRequirement> requirements;
  final int maxBytes;

  List<ValidationIssue> validate(ThemePack pack, {int? actualBytes}) {
    final issues = <ValidationIssue>[];

    if (pack.schemaVersion != slotSchemaVersion) {
      issues.add(
        ValidationIssue(
          pack.id,
          'schemaVersion ${pack.schemaVersion} != supported $slotSchemaVersion',
        ),
      );
    }

    if (pack.tier != 'free' && pack.tier != 'premium') {
      issues.add(
        ValidationIssue(
          pack.id,
          'tier must be free or premium, got "${pack.tier}"',
        ),
      );
    }

    for (final gameId in pack.supports) {
      final req = requirements[gameId];
      if (req == null) {
        issues.add(
          ValidationIssue(pack.id, 'claims support for unknown game "$gameId"'),
        );
        continue;
      }

      for (final slot in req.requiredSlots) {
        final asset = pack.asset(slot);
        if (asset == null || asset.isEmpty) {
          issues.add(
            ValidationIssue(
              pack.id,
              'missing required slot for game "$gameId"',
              slot: slot.key,
            ),
          );
        }
      }

      final tileSlot = ThemeSlot.tile(gameId);
      if (pack.asset(tileSlot) == null) {
        issues.add(
          ValidationIssue(
            pack.id,
            'no home-screen tile art for game "$gameId"',
            slot: tileSlot.key,
            fatal: false,
          ),
        );
      }

      final setId = req.tokenSetId;
      if (setId != null) {
        final catalog = pack.catalog(setId);
        if (catalog == null) {
          issues.add(
            ValidationIssue(pack.id, 'game "$gameId" needs token set "$setId"'),
          );
        } else if (!catalog.supports(
          needed: req.tokenAttributes,
          minimumTokens: req.minimumTokens,
        )) {
          issues.add(
            ValidationIssue(
              pack.id,
              'token set "$setId" does not meet game "$gameId" requirements '
              '(needs >=${req.minimumTokens} tokens tagged '
              '${req.tokenAttributes.map((a) => a.name).join(", ")}; '
              'has ${catalog.length})',
            ),
          );
        }
      }
    }

    if (actualBytes != null && actualBytes > maxBytes) {
      issues.add(
        ValidationIssue(
          pack.id,
          'pack is $actualBytes bytes, budget is $maxBytes',
        ),
      );
    }

    return issues;
  }
}
