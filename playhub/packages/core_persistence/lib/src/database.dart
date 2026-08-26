import 'package:drift/drift.dart';

import 'tables/tables.dart';

part 'database.g.dart';

/// Current schema version. Every bump needs a migration step in
/// [PlayhubDatabase.migration] **and** a fixture database in
/// `test/migration/`, or CI fails.
const int schemaVersionCurrent = 1;

@DriftDatabase(
  tables: [
    AppSettings,
    Profiles,
    PlaySessions,
    GamePlays,
    StarLedger,
    StarDailyCounters,
    AchievementProgress,
    Collectibles,
    Rewards,
    RewardRequests,
    Tasks,
    TaskInstances,
    ScreenTimeRules,
    ScreenTimeUsage,
    EntitlementCache,
    ContentPacks,
    TelemetryEvents,
  ],
)
class PlayhubDatabase extends _$PlayhubDatabase {
  PlayhubDatabase(super.e);

  @override
  int get schemaVersion => schemaVersionCurrent;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();
      await _createIndexes();
    },
    onUpgrade: (m, from, to) async {
      // Migrations are additive only. Columns are added and deprecated,
      // never dropped, until a major version does a supervised rebuild.
      // Each step is numbered and tested from a fixture database of that
      // exact version — see test/migration/.
      //
      // for (var v = from; v < to; v++) {
      //   switch (v) {
      //     case 1: await m.addColumn(profiles, profiles.someNewColumn);
      //   }
      // }
      await _createIndexes();
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
      // WAL plus NORMAL synchronous: a power loss can lose the last
      // transaction, never the database. Combined with the 10-second
      // screen-time heartbeat, worst-case loss is ~10 seconds of play.
      await customStatement('PRAGMA journal_mode = WAL');
      await customStatement('PRAGMA synchronous = NORMAL');
    },
  );

  Future<void> _createIndexes() async {
    await customStatement(
      'CREATE INDEX IF NOT EXISTS ix_ledger_profile '
      'ON star_ledger (profile_id, created_at)',
    );
    await customStatement(
      'CREATE INDEX IF NOT EXISTS ix_plays_profile_game '
      'ON game_plays (profile_id, game_id, started_at)',
    );
    await customStatement(
      'CREATE INDEX IF NOT EXISTS ix_sessions_profile_day '
      'ON play_sessions (profile_id, started_at)',
    );
    await customStatement(
      'CREATE INDEX IF NOT EXISTS ix_requests_status '
      'ON reward_requests (status, requested_at)',
    );
  }

  /// `PRAGMA integrity_check`, run on launch. A failure triggers restore from
  /// the pre-migration snapshot rather than a silent empty database.
  Future<bool> integrityCheck() async {
    final rows = await customSelect('PRAGMA integrity_check').get();
    final first = rows.firstOrNull?.data.values.first;
    return first == 'ok';
  }
}
