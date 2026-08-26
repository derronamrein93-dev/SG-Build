/// A semantic address for a piece of content.
///
/// Games reference slots. They never reference a file, a colour, a character
/// name, or a theme id — there is no `if (theme == 'dino')` anywhere in this
/// codebase, and CI fails the build if a theme id literal appears in a game
/// package.
///
/// This vocabulary is a public contract with every ThemePack ever authored.
/// **Add to it; never rename or remove.** See [slotSchemaVersion].
extension type const ThemeSlot(String key) {
  static const backgroundFar = ThemeSlot('bg.far');
  static const backgroundMid = ThemeSlot('bg.mid');
  static const backgroundNear = ThemeSlot('bg.near');
  static const backgroundColorTop = ThemeSlot('bg.color.top');
  static const backgroundColorBottom = ThemeSlot('bg.color.bottom');

  static const guideIdle = ThemeSlot('char.guide.idle');
  static const guideCheer = ThemeSlot('char.guide.cheer');
  static const guidePoint = ThemeSlot('char.guide.point');
  static const guideThink = ThemeSlot('char.guide.think');

  static const accentPrimary = ThemeSlot('ui.accent.primary');
  static const accentSecondary = ThemeSlot('ui.accent.secondary');
  static const surface = ThemeSlot('ui.surface');
  static const onSurface = ThemeSlot('ui.onSurface');
  static const frameTile = ThemeSlot('ui.frame.tile');
  static const frameCard = ThemeSlot('ui.frame.card');

  static const sfxPick = ThemeSlot('sfx.pick');
  static const sfxPlace = ThemeSlot('sfx.place');
  static const sfxCorrect = ThemeSlot('sfx.correct');
  static const sfxTryAgain = ThemeSlot('sfx.tryAgain');
  static const sfxRoundComplete = ThemeSlot('sfx.roundComplete');
  static const sfxStarEarned = ThemeSlot('sfx.starEarned');

  static const musicHome = ThemeSlot('music.home');
  static const musicPlayCalm = ThemeSlot('music.play.calm');
  static const musicPlayUpbeat = ThemeSlot('music.play.upbeat');

  static const fxCelebrateSmall = ThemeSlot('fx.celebrate.small');
  static const fxCelebrateLarge = ThemeSlot('fx.celebrate.large');
  static const fxTrailDrag = ThemeSlot('fx.trail.drag');

  static const badgeThemeMastery = ThemeSlot('reward.badge.themeMastery');

  /// Home-screen artwork for a game, *in this theme*. The tile a child taps is
  /// content, not chrome — which is why the same game looks different in each
  /// theme without the game knowing.
  static ThemeSlot tile(String gameId) => ThemeSlot('tile.$gameId');

  /// One of the pack's collectible stickers, `01`..`08`.
  static ThemeSlot sticker(int n) =>
      ThemeSlot('reward.sticker.${n.toString().padLeft(2, '0')}');

  /// A token catalog — a set of matchable objects with semantic attributes.
  static ThemeSlot tokens(String setId) => ThemeSlot('tokens.$setId');

  /// A hero image: a jigsaw source, a find-the-object scene.
  static ThemeSlot scene(String sceneId) => ThemeSlot('scene.$sceneId');

  /// Every slot a pack may be asked for that is not parameterised.
  static const List<ThemeSlot> fixedSlots = [
    backgroundFar,
    backgroundMid,
    backgroundNear,
    backgroundColorTop,
    backgroundColorBottom,
    guideIdle,
    guideCheer,
    guidePoint,
    guideThink,
    accentPrimary,
    accentSecondary,
    surface,
    onSurface,
    frameTile,
    frameCard,
    sfxPick,
    sfxPlace,
    sfxCorrect,
    sfxTryAgain,
    sfxRoundComplete,
    sfxStarEarned,
    musicHome,
    musicPlayCalm,
    musicPlayUpbeat,
    fxCelebrateSmall,
    fxCelebrateLarge,
    fxTrailDrag,
    badgeThemeMastery,
  ];
}

/// Bumped only when the vocabulary changes in a way packs must react to.
/// A golden test asserts this value, so a change is always deliberate.
const int slotSchemaVersion = 1;

/// How badly a game needs a slot.
enum SlotRequirement {
  /// Validation fails if a pack supporting the game omits it.
  required,

  /// Resolves through the fallback chain without complaint.
  recommendedWithFallback,

  /// Absence is normal.
  optional,
}
