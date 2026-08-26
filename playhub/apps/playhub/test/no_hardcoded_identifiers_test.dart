import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '_repo_paths.dart';

/// Enforces the two rules that make rebranding and price changes cheap:
///
/// * no brand string, bundle id or team id outside `brand/brand_config.dart`
/// * no price, currency or store product id anywhere at all
///
/// Both are cheap to keep and very expensive to reintroduce after launch.
/// See docs/20-expensive-decisions.md and docs/08 §3.
void main() {
  final files = appLibDir()
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();

  test('lib/ is not empty (guards against a silently passing scan)', () {
    expect(files, isNotEmpty);
  });

  test('the brand name appears only in brand_config.dart', () {
    for (final file in files) {
      if (file.path.endsWith('brand_config.dart')) continue;
      final source = file.readAsStringSync();
      expect(
        RegExp("['\"]Playhub['\"]").hasMatch(source),
        isFalse,
        reason: 'brand literal in ${file.path} — use BrandConfig.appName',
      );
    }
  });

  test('no bundle or team identifier outside brand_config.dart', () {
    for (final file in files) {
      if (file.path.endsWith('brand_config.dart')) continue;
      final source = file.readAsStringSync();
      expect(source.contains('dev.provisional'), isFalse, reason: file.path);
      expect(
        RegExp(r'''["'][A-Z0-9]{10}["']''').hasMatch(source),
        isFalse,
        reason: 'possible Apple Team ID in ${file.path}',
      );
    }
  });

  test('no price, currency symbol or store product id anywhere in lib/', () {
    // Prices are read from StoreKit at display time, so a price change is an
    // App Store Connect edit rather than an app release (docs/08 §3).
    final pricePattern = RegExp(
      r'[$£€]\s?\d|\b\d+\.99\b|premium\.(monthly|annual|lifetime)',
    );
    for (final file in files) {
      final source = file.readAsStringSync();
      final match = pricePattern.firstMatch(source);
      expect(
        match,
        isNull,
        reason:
            'price or store product id "${match?.group(0)}" in ${file.path}',
      );
    }
  });

  test('no analytics, tracking or crash-reporting SDK is referenced', () {
    // Zero third-party SDKs is a Kids Category position, not a preference.
    const banned = [
      'firebase',
      'crashlytics',
      'sentry',
      'amplitude',
      'mixpanel',
      'appsflyer',
      'adjust_sdk',
      'facebook_app_events',
      'google_mobile_ads',
    ];
    for (final file in files) {
      final source = file.readAsStringSync().toLowerCase();
      for (final sdk in banned) {
        expect(
          source.contains(sdk),
          isFalse,
          reason: '$sdk referenced in ${file.path}',
        );
      }
    }
  });
}
