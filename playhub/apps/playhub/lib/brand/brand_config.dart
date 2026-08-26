/// Everything that changes when the product is rebranded.
///
/// **The product name appears here and in the ARB files as `{appName}` — nowhere
/// else, ever.** `test/no_hardcoded_identifiers_test.dart` fails the build if a
/// brand string, bundle identifier, team identifier or store product id appears
/// anywhere in `lib/`.
///
/// Cost of a full rebrand: about an hour. See docs/20-expensive-decisions.md.
class BrandConfig {
  const BrandConfig({
    required this.appName,
    required this.bundleId,
    required this.teamId,
    required this.privacyPolicyUrl,
    required this.termsUrl,
    required this.supportUrl,
    required this.isProvisional,
  });

  /// **Provisional identity.** Everything here is a placeholder until the Apple
  /// Organization account exists — see docs/24-apple-account-and-identifiers.md.
  /// Development does not wait on it; only distribution does.
  const BrandConfig.provisional()
    : appName = 'Playhub',
      bundleId = 'dev.provisional.playhub',
      teamId = 'PROVISIONAL',
      privacyPolicyUrl = 'https://example.invalid/privacy',
      termsUrl = 'https://example.invalid/terms',
      supportUrl = 'https://example.invalid/support',
      isProvisional = true;

  /// Codename only. Not the brand — see docs/26-naming-candidates.md.
  final String appName;

  /// Permanent once registered. Deliberately brand-neutral so a rename costs
  /// nothing.
  final String bundleId;

  final String teamId;
  final String privacyPolicyUrl;
  final String termsUrl;
  final String supportUrl;

  /// True while running on placeholder identity. The Parent Hub's diagnostics
  /// screen shows a banner, and the release lane refuses to upload.
  final bool isProvisional;
}
