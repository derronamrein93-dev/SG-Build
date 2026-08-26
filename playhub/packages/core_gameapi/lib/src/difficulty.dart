/// Broad cognitive/motor bands. A band is a floor and a ceiling, not a
/// suggestion: a gifted three-year-old can reach the top of [preschool] and
/// never enters [earlySchool], because reading ability and finger precision are
/// properties of the band, not of skill.
enum AgeBand {
  toddler(2, 3),
  preschool(4, 5),
  earlySchool(6, 8);

  const AgeBand(this.minYears, this.maxYears);
  final int minYears;
  final int maxYears;

  static AgeBand forYears(int years) => switch (years) {
    <= 3 => AgeBand.toddler,
    <= 5 => AgeBand.preschool,
    _ => AgeBand.earlySchool,
  };
}

/// Every dial a game may expose. A game declares which it supports; the
/// director supplies values clamped to the child's band.
enum DifficultyKnob {
  itemCount,
  distractorCount,
  gridSize,

  /// Forgiveness in logical pixels. **Larger is easier.**
  snapTolerance,

  sequenceLength,
  revealDuration,
  rotationEnabled,

  /// Always 0 in the MVP. Reserved, and deliberately unused: a countdown in
  /// front of a four-year-old manufactures anxiety.
  timePressure,

  /// Seconds without progress before the hint ladder starts.
  hintDelay,
}

/// The window a knob may move within, for one band.
class KnobWindow {
  const KnobWindow(this.min, this.max);
  final num min;
  final num max;

  /// [mastery] is 0..1. 0 sits at the easy end of the band, 1 at the hard end.
  num at(double mastery) => min + (max - min) * mastery.clamp(0.0, 1.0);
}

/// The resolved difficulty handed to one session. A game never reads the
/// child's age, only these numbers.
class DifficultyProfile {
  const DifficultyProfile({
    required this.band,
    required this.mastery,
    required Map<DifficultyKnob, KnobWindow> windows,
  }) : _windows = windows;

  final AgeBand band;

  /// Rolling per-child, per-game competence signal, 0..1.
  final double mastery;

  final Map<DifficultyKnob, KnobWindow> _windows;

  bool supports(DifficultyKnob which) => _windows.containsKey(which);

  /// The resolved value, clamped to the band's window.
  num knob(DifficultyKnob which, {num fallback = 0}) {
    final window = _windows[which];
    if (window == null) return fallback;
    return window.at(mastery);
  }

  int knobInt(DifficultyKnob which, {int fallback = 0}) =>
      knob(which, fallback: fallback).round();

  bool knobFlag(DifficultyKnob which) => knob(which) >= 0.5;

  /// The default windows per band. Starting values, tuned from playtests; they
  /// live in one place so tuning is a one-line change.
  static Map<DifficultyKnob, KnobWindow> defaultWindows(AgeBand band) =>
      switch (band) {
        AgeBand.toddler => const {
          DifficultyKnob.itemCount: KnobWindow(2, 4),
          DifficultyKnob.distractorCount: KnobWindow(0, 1),
          DifficultyKnob.gridSize: KnobWindow(4, 6),
          DifficultyKnob.snapTolerance: KnobWindow(88, 72),
          DifficultyKnob.sequenceLength: KnobWindow(2, 2),
          DifficultyKnob.revealDuration: KnobWindow(5, 4),
          DifficultyKnob.rotationEnabled: KnobWindow(0, 0),
          DifficultyKnob.timePressure: KnobWindow(0, 0),
          DifficultyKnob.hintDelay: KnobWindow(4, 6),
        },
        AgeBand.preschool => const {
          DifficultyKnob.itemCount: KnobWindow(4, 9),
          DifficultyKnob.distractorCount: KnobWindow(1, 3),
          DifficultyKnob.gridSize: KnobWindow(6, 12),
          DifficultyKnob.snapTolerance: KnobWindow(64, 48),
          DifficultyKnob.sequenceLength: KnobWindow(3, 4),
          DifficultyKnob.revealDuration: KnobWindow(4, 3),
          DifficultyKnob.rotationEnabled: KnobWindow(0, 0),
          DifficultyKnob.timePressure: KnobWindow(0, 0),
          DifficultyKnob.hintDelay: KnobWindow(8, 10),
        },
        AgeBand.earlySchool => const {
          DifficultyKnob.itemCount: KnobWindow(6, 20),
          DifficultyKnob.distractorCount: KnobWindow(2, 6),
          DifficultyKnob.gridSize: KnobWindow(16, 24),
          DifficultyKnob.snapTolerance: KnobWindow(40, 28),
          DifficultyKnob.sequenceLength: KnobWindow(4, 7),
          DifficultyKnob.revealDuration: KnobWindow(2.5, 1.5),
          DifficultyKnob.rotationEnabled: KnobWindow(0, 1),
          DifficultyKnob.timePressure: KnobWindow(0, 0),
          DifficultyKnob.hintDelay: KnobWindow(15, 20),
        },
      };

  static DifficultyProfile forBand(AgeBand band, {double mastery = 0.0}) =>
      DifficultyProfile(
        band: band,
        mastery: mastery,
        windows: defaultWindows(band),
      );
}
