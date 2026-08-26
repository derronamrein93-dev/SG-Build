import 'package:core_gameapi/core_gameapi.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AgeBand', () {
    test('maps years to bands at the documented boundaries', () {
      expect(AgeBand.forYears(2), AgeBand.toddler);
      expect(AgeBand.forYears(3), AgeBand.toddler);
      expect(AgeBand.forYears(4), AgeBand.preschool);
      expect(AgeBand.forYears(5), AgeBand.preschool);
      expect(AgeBand.forYears(6), AgeBand.earlySchool);
      expect(AgeBand.forYears(8), AgeBand.earlySchool);
    });
  });

  group('DifficultyProfile', () {
    test('mastery 0 sits at the easy end, mastery 1 at the hard end', () {
      final easy = DifficultyProfile.forBand(AgeBand.preschool, mastery: 0);
      final hard = DifficultyProfile.forBand(AgeBand.preschool, mastery: 1);

      expect(easy.knobInt(DifficultyKnob.itemCount), 4);
      expect(hard.knobInt(DifficultyKnob.itemCount), 9);
    });

    test('a gifted toddler never reaches preschool difficulty', () {
      // Bands are floors and ceilings, not suggestions: finger precision and
      // reading ability are properties of the band, not of skill.
      final toddlerMax = DifficultyProfile.forBand(AgeBand.toddler, mastery: 1);
      final preschoolMin = DifficultyProfile.forBand(
        AgeBand.preschool,
        mastery: 0,
      );

      expect(
        toddlerMax.knobInt(DifficultyKnob.itemCount),
        lessThanOrEqualTo(preschoolMin.knobInt(DifficultyKnob.itemCount)),
      );
    });

    test('snapTolerance shrinks as mastery rises (larger is easier)', () {
      final easy = DifficultyProfile.forBand(AgeBand.earlySchool, mastery: 0);
      final hard = DifficultyProfile.forBand(AgeBand.earlySchool, mastery: 1);

      expect(
        hard.knob(DifficultyKnob.snapTolerance),
        lessThan(easy.knob(DifficultyKnob.snapTolerance)),
      );
    });

    test('toddlers get the most forgiving targets of any band', () {
      final toddler = DifficultyProfile.forBand(AgeBand.toddler, mastery: 1);
      final school = DifficultyProfile.forBand(AgeBand.earlySchool, mastery: 0);

      expect(
        toddler.knob(DifficultyKnob.snapTolerance),
        greaterThan(school.knob(DifficultyKnob.snapTolerance)),
      );
    });

    test('time pressure is zero in every band at every mastery', () {
      for (final band in AgeBand.values) {
        for (final m in [0.0, 0.5, 1.0]) {
          expect(
            DifficultyProfile.forBand(
              band,
              mastery: m,
            ).knob(DifficultyKnob.timePressure),
            0,
            reason: 'no countdown in front of a child: $band @ $m',
          );
        }
      }
    });

    test('mastery outside 0..1 is clamped rather than extrapolated', () {
      final over = DifficultyProfile.forBand(AgeBand.preschool, mastery: 4);
      final under = DifficultyProfile.forBand(AgeBand.preschool, mastery: -2);

      expect(over.knobInt(DifficultyKnob.itemCount), 9);
      expect(under.knobInt(DifficultyKnob.itemCount), 4);
    });

    test('an unsupported knob returns the caller fallback, never throws', () {
      const profile = DifficultyProfile(
        band: AgeBand.toddler,
        mastery: 0.5,
        windows: {},
      );
      expect(profile.supports(DifficultyKnob.gridSize), isFalse);
      expect(profile.knob(DifficultyKnob.gridSize, fallback: 4), 4);
    });

    test('hint help arrives sooner for younger children', () {
      final toddler = DifficultyProfile.forBand(AgeBand.toddler, mastery: 0);
      final school = DifficultyProfile.forBand(AgeBand.earlySchool, mastery: 0);

      expect(
        toddler.knob(DifficultyKnob.hintDelay),
        lessThan(school.knob(DifficultyKnob.hintDelay)),
      );
    });
  });

  group('GameOutcomeStats', () {
    test('cleanliness is 1 for a flawless round and 0 attempts', () {
      const flawless = GameOutcomeStats(
        duration: Duration(seconds: 30),
        misses: 0,
        hintsUsed: 0,
        itemsCompleted: 6,
      );
      expect(flawless.cleanliness, 1);

      const empty = GameOutcomeStats(
        duration: Duration.zero,
        misses: 0,
        hintsUsed: 0,
        itemsCompleted: 0,
      );
      expect(empty.cleanliness, 1);
    });

    test('misses lower cleanliness but it never goes negative', () {
      const messy = GameOutcomeStats(
        duration: Duration(seconds: 90),
        misses: 12,
        hintsUsed: 4,
        itemsCompleted: 4,
      );
      expect(messy.cleanliness, closeTo(0.25, 0.001));
      expect(messy.cleanliness, greaterThanOrEqualTo(0));
    });
  });

  test('the API version is pinned', () {
    // A golden. Changing this breaks every game module; it must be deliberate.
    expect(gameApiVersion, 1);
  });
}
