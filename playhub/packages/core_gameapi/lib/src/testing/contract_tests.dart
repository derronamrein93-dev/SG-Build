import 'dart:async';
import 'dart:math';

import 'package:core_foundation/core_foundation.dart';
import 'package:core_theme/core_theme.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../core_gameapi.dart';
import 'fakes.dart';

/// The contract suite every game module must pass before it may ship.
///
/// A game package calls this from its own tests:
///
/// ```dart
/// void main() => runGameModuleContractTests(() => MatchPairsModule());
/// ```
void runGameModuleContractTests(
  GameModule Function() build, {
  Map<String, TokenCatalog> catalogs = const {},
}) {
  group('GameModule contract', () {
    late GameModule module;

    setUp(() => module = build());

    test('1. declares the current API version', () {
      expect(
        module.apiVersion,
        gameApiVersion,
        reason: 'module was written against a different API version',
      );
    });

    test('2. has a stable, lowercase, snake_case id', () {
      expect(module.id, matches(RegExp(r'^[a-z][a-z0-9_]*$')));
    });

    test('3. uses localisation keys, never literal user-facing text', () {
      expect(module.manifest.titleKey, contains('.'));
      expect(module.manifest.voPromptKey, contains('.'));
    });

    test('4. declares a star ceiling the platform can enforce', () {
      expect(module.manifest.maxStarsPerRound, greaterThan(0));
      expect(module.manifest.maxStarsPerRound, lessThanOrEqualTo(10));
    });

    test('5. never opts into time pressure', () {
      // No countdown in front of a four-year-old. If a future game needs one,
      // it is a product decision, not a quiet knob change.
      expect(
        module.supportedKnobs,
        isNot(contains(DifficultyKnob.timePressure)),
      );
    });

    test('6. is deterministic: same seed, same opening state', () {
      Object? open(int seed) {
        final s = module.createSession(
          _request(module, seed: seed, catalogs: catalogs),
        );
        final snapshot = s.snapshot();
        unawaited(s.dispose());
        return snapshot;
      }

      expect(open(1234).toString(), open(1234).toString());
    });

    test(
      '7. builds a playable session in every band, at both mastery ends',
      () {
        for (final band in AgeBand.values) {
          for (final mastery in [0.0, 1.0]) {
            final session = module.createSession(
              _request(
                module,
                band: band,
                mastery: mastery,
                catalogs: catalogs,
              ),
            );
            expect(session, isNotNull, reason: 'failed for $band @ $mastery');
            unawaited(session.dispose());
          }
        }
      },
    );

    test('8. emits nothing while paused', () async {
      final session = module.createSession(
        _request(module, catalogs: catalogs),
      );
      final seen = <GameEvent>[];
      final sub = session.events.listen(seen.add);

      await session.pause();
      seen.clear();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(seen, isEmpty, reason: 'a paused session must be silent');
      await sub.cancel();
      await session.dispose();
    });

    test('9. survives a snapshot round-trip', () async {
      final a = module.createSession(
        _request(module, seed: 7, catalogs: catalogs),
      );
      final snapshot = a.snapshot();
      await a.dispose();

      final b = module.createSession(
        _request(module, seed: 7, catalogs: catalogs, resume: snapshot),
      );
      expect(b, isNotNull);
      await b.dispose();
    });

    test('10. closes its event stream on dispose', () async {
      final session = module.createSession(
        _request(module, catalogs: catalogs),
      );
      var closed = false;
      final sub = session.events.listen(null, onDone: () => closed = true);

      await session.dispose();
      await Future<void>.delayed(Duration.zero);

      expect(closed, isTrue, reason: 'dispose must close the event stream');
      await sub.cancel();
    });

    test('11. token requirements are internally consistent', () {
      if (module.tokenSetId == null) {
        expect(module.tokenAttributes, isEmpty);
        expect(module.minimumTokens, 0);
      } else {
        expect(module.minimumTokens, greaterThan(0));
      }
    });
  });
}

GameSessionRequest _request(
  GameModule module, {
  int seed = 42,
  AgeBand band = AgeBand.preschool,
  double mastery = 0.5,
  Map<String, TokenCatalog> catalogs = const {},
  Map<String, Object?>? resume,
}) {
  final resolvedCatalogs = catalogs.isNotEmpty
      ? catalogs
      : (module.tokenSetId == null
            ? const <String, TokenCatalog>{}
            : {
                module.tokenSetId!: fakeTokenCatalog(
                  setId: module.tokenSetId!,
                  count: module.minimumTokens < 16 ? 16 : module.minimumTokens,
                  attributes: module.tokenAttributes.isEmpty
                      ? const {TokenAttribute.color}
                      : module.tokenAttributes,
                ),
              });

  return GameSessionRequest(
    profile: ProfileRef(id: 'test-profile', ageBand: band),
    difficulty: DifficultyProfile.forBand(band, mastery: mastery),
    theme: placeholderTheme(catalogs: resolvedCatalogs),
    quality: QualityTier.medium,
    rng: Random(seed),
    services: fakeGameServices(clock: FakeClock()),
    resumeSnapshot: resume,
  );
}
