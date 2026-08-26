import 'package:drift/drift.dart';

/// Single-row application settings. Audio, quality, and which optional modules
/// are switched on. Defaults are chosen so a parent who changes nothing still
/// gets a good product.
class AppSettings extends Table {
  IntColumn get id => integer().withDefault(const Constant(1))();

  IntColumn get schemaVersion => integer()();

  /// The PIN *hash* lives in the Keychain, never here. This is only whether one
  /// has been set.
  BoolColumn get parentPinSet => boolean().withDefault(const Constant(false))();
  BoolColumn get biometricGate => boolean().withDefault(const Constant(true))();

  RealColumn get masterVolume => real().withDefault(const Constant(0.8))();
  RealColumn get musicVolume => real().withDefault(const Constant(0.6))();
  RealColumn get sfxVolume => real().withDefault(const Constant(0.9))();
  BoolColumn get voiceEnabled => boolean().withDefault(const Constant(true))();
  BoolColumn get muted => boolean().withDefault(const Constant(false))();

  /// auto | low | medium | high
  TextColumn get qualityMode => text().withDefault(const Constant('auto'))();
  TextColumn get qualityResolved => text().nullable()();

  /// Device model + OS + app version. AUTO re-probes only when this changes.
  TextColumn get qualityProbeStamp => text().nullable()();

  /// Chores are off by default: a parent who wants only games should never see
  /// the word.
  BoolColumn get tasksEnabled => boolean().withDefault(const Constant(false))();
  BoolColumn get rewardsEnabled =>
      boolean().withDefault(const Constant(true))();
  BoolColumn get onboardingDone =>
      boolean().withDefault(const Constant(false))();

  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// A child. Note what is absent: no birthdate, no surname, no photo, no
/// identifier of any kind. An age *band*, a nickname a parent typed, and an
/// avatar from a bundled set.
class Profiles extends Table {
  TextColumn get id => text()();
  TextColumn get nickname => text().withLength(min: 1, max: 24)();
  TextColumn get avatarKey => text()();

  /// toddler | preschool | earlySchool
  TextColumn get ageBand => text()();

  /// Optional, 2..8, used only to tune the band.
  IntColumn get ageYears => integer().nullable()();

  TextColumn get themeId => text()();

  /// Null means adaptive difficulty.
  TextColumn get difficultyOverride => text().nullable()();

  BoolColumn get reduceMotion => boolean().withDefault(const Constant(false))();
  BoolColumn get highContrast => boolean().withDefault(const Constant(false))();
  BoolColumn get largerTargets =>
      boolean().withDefault(const Constant(false))();
  BoolColumn get leftHanded => boolean().withDefault(const Constant(false))();
  BoolColumn get voEnabled => boolean().withDefault(const Constant(true))();

  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  /// Soft delete. Tombstones cost nothing now and are what make an optional
  /// cloud backup possible later without a migration.
  DateTimeColumn get deletedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class PlaySessions extends Table {
  TextColumn get id => text()();
  TextColumn get profileId => text().references(Profiles, #id)();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  IntColumn get foregroundSeconds => integer().withDefault(const Constant(0))();

  /// child | limit | background | crash
  TextColumn get endReason => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class GamePlays extends Table {
  TextColumn get id => text()();
  TextColumn get sessionId => text().references(PlaySessions, #id)();
  TextColumn get profileId => text()();
  TextColumn get gameId => text()();
  TextColumn get themeId => text()();

  /// JSON: the exact knob values used, so a support report is reproducible.
  TextColumn get difficultySnapshot => text()();

  /// Reproduces the exact board.
  IntColumn get rngSeed => integer()();

  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  IntColumn get roundsCompleted => integer().withDefault(const Constant(0))();
  IntColumn get misses => integer().withDefault(const Constant(0))();
  IntColumn get hintsUsed => integer().withDefault(const Constant(0))();
  BoolColumn get completed => boolean().withDefault(const Constant(false))();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// **Append-only.** Rows are never updated or deleted; a mistake is corrected
/// with an offsetting `correction` entry, so the history always explains the
/// balance. Balance is `SUM(delta)`, never a stored number.
class StarLedger extends Table {
  TextColumn get id => text()();
  TextColumn get profileId => text().references(Profiles, #id)();

  /// Positive to earn, negative to redeem. Never zero.
  IntColumn get delta => integer()();

  /// game_round | achievement | milestone | task_approved | reward_redeemed |
  /// parent_grant | parent_adjust | correction
  TextColumn get reason => text()();

  TextColumn get refType => text().nullable()();
  TextColumn get refId => text().nullable()();

  /// The single mechanism that prevents every double-award bug: a retry, a
  /// double-tap or a crash-resume writing the same entry is a no-op.
  TextColumn get idempotencyKey => text().unique()();

  /// Parent-visible explanation — "Mum added 20 for helping Grandma".
  TextColumn get note => text().nullable()();

  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Caps stars minted per source per local day.
///
/// Uncapped play earnings would mean "more screen time buys more ice cream",
/// which fights the product's core promise. See docs/09 §4 — this is a
/// correctness constraint, not a tuning knob.
class StarDailyCounters extends Table {
  TextColumn get profileId => text()();
  TextColumn get localDate => text()();

  /// play | task | achievement | parent
  TextColumn get source => text()();

  IntColumn get earned => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {profileId, localDate, source};
}

class AchievementProgress extends Table {
  TextColumn get profileId => text()();
  TextColumn get achievementId => text()();
  IntColumn get progress => integer().withDefault(const Constant(0))();
  IntColumn get target => integer()();
  DateTimeColumn get unlockedAt => dateTime().nullable()();
  DateTimeColumn get seenAt => dateTime().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {profileId, achievementId};
}

class Collectibles extends Table {
  TextColumn get profileId => text()();

  /// e.g. `dino.sticker.03`
  TextColumn get collectibleId => text()();

  /// sticker | badge | trophy | decoration
  TextColumn get kind => text()();

  DateTimeColumn get acquiredAt => dateTime()();

  /// Where the child arranged it in the sticker book.
  TextColumn get placedSlot => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {profileId, collectibleId};
}

/// A reward a parent defined. Fulfilled by the parent, offline. Stars have no
/// monetary value and cannot be purchased — see the App Review notes in docs/14.
class Rewards extends Table {
  TextColumn get id => text()();
  TextColumn get title => text().withLength(min: 1, max: 60)();
  TextColumn get iconKey => text()();

  /// An optional parent photo, copied into the app sandbox, downscaled, EXIF
  /// stripped, never read back out.
  TextColumn get imagePath => text().nullable()();

  IntColumn get starCost => integer()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  DateTimeColumn get deletedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class RewardRequests extends Table {
  TextColumn get id => text()();
  TextColumn get profileId => text()();
  TextColumn get rewardId => text()();

  /// The price is frozen when the child asks. A parent editing the cost while a
  /// request is pending must not change what the child asked for.
  IntColumn get starCostSnapshot => integer()();

  /// requested | approved | declined | fulfilled | expired
  TextColumn get status => text()();

  DateTimeColumn get requestedAt => dateTime()();
  DateTimeColumn get decidedAt => dateTime().nullable()();
  DateTimeColumn get fulfilledAt => dateTime().nullable()();

  /// Set only on approval — stars move at approval, never at request.
  TextColumn get ledgerEntryId => text().nullable()();

  TextColumn get parentNote => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class Tasks extends Table {
  TextColumn get id => text()();

  /// Null means any child.
  TextColumn get profileId => text().nullable()();

  TextColumn get title => text().withLength(min: 1, max: 60)();
  TextColumn get iconKey => text()();
  IntColumn get starValue => integer()();

  /// once | daily | weekdays | weekends | custom
  TextColumn get recurrence => text()();

  /// e.g. `1,3,5` for custom.
  TextColumn get recurrenceDays => text().nullable()();

  BoolColumn get active => boolean().withDefault(const Constant(true))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  DateTimeColumn get deletedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Materialised lazily for today and tomorrow only — no infinite calendar
/// expansion, no background scheduling, no notifications to a child.
class TaskInstances extends Table {
  TextColumn get id => text()();
  TextColumn get taskId => text().references(Tasks, #id)();
  TextColumn get profileId => text()();
  TextColumn get dueDate => text()();

  /// open | awaiting_parent | approved | declined | missed
  TextColumn get status => text()();

  DateTimeColumn get markedAt => dateTime().nullable()();
  DateTimeColumn get decidedAt => dateTime().nullable()();
  TextColumn get ledgerEntryId => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};

  @override
  List<Set<Column<Object>>> get uniqueKeys => [
    {taskId, profileId, dueDate},
  ];
}

class ScreenTimeRules extends Table {
  TextColumn get profileId => text()();

  /// Opt-in: a parent who never opens the Hub gets an app that just works.
  BoolColumn get enabled => boolean().withDefault(const Constant(false))();

  IntColumn get sessionLimitMinutes => integer().nullable()();
  IntColumn get dailyLimitMinutes => integer().nullable()();
  IntColumn get breakMinutes => integer().withDefault(const Constant(15))();

  /// Minutes before the end at which to warn, comma separated.
  TextColumn get warnAtMinutes => text().withDefault(const Constant('2,0.5'))();

  TextColumn get bedtimeStart => text().nullable()();
  TextColumn get bedtimeEnd => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {profileId};
}

class ScreenTimeUsage extends Table {
  TextColumn get profileId => text()();
  TextColumn get localDate => text()();
  IntColumn get secondsUsed => integer().withDefault(const Constant(0))();

  /// Written every 10 s. On a crash or a kill, at most 10 s of usage is lost.
  DateTimeColumn get lastHeartbeat => dateTime().nullable()();

  /// A persisted cooldown deadline — relaunching the app does not clear it.
  DateTimeColumn get restUntil => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {profileId, localDate};
}

class EntitlementCache extends Table {
  IntColumn get id => integer().withDefault(const Constant(1))();
  TextColumn get tier => text().withDefault(const Constant('free'))();
  TextColumn get source => text().nullable()();
  TextColumn get productId => text().nullable()();
  DateTimeColumn get expiresAt => dateTime().nullable()();
  DateTimeColumn get lastVerifiedAt => dateTime().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class ContentPacks extends Table {
  TextColumn get id => text()();

  /// theme | game_assets
  TextColumn get kind => text()();

  IntColumn get contentVersion => integer()();

  /// bundled | downloaded
  TextColumn get source => text()();

  DateTimeColumn get installedAt => dateTime()();
  IntColumn get bytes => integer()();
  TextColumn get sha256 => text().nullable()();
  DateTimeColumn get lastUsedAt => dateTime().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Local-only counters. **Never transmitted** — there is no endpoint. Ring
/// buffered on each launch. See docs/13-privacy-and-child-safety.md.
class TelemetryEvents extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get props => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
}
