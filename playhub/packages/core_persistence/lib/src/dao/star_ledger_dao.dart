import 'package:core_foundation/core_foundation.dart';
import 'package:drift/drift.dart';

import '../database.dart';
import '../tables/tables.dart';

part 'star_ledger_dao.g.dart';

/// Why stars moved. Persisted as a string so old rows always stay readable.
enum StarReason {
  gameRound('game_round'),
  achievement('achievement'),
  milestone('milestone'),
  taskApproved('task_approved'),
  rewardRedeemed('reward_redeemed'),
  parentGrant('parent_grant'),
  parentAdjust('parent_adjust'),
  correction('correction');

  const StarReason(this.wire);
  final String wire;
}

/// Which daily cap an entry counts against.
enum StarSource {
  play('play'),
  task('task'),
  achievement('achievement'),
  parent('parent');

  const StarSource(this.wire);
  final String wire;
}

/// All star movement. The ledger is append-only: nothing here updates or
/// deletes a row.
@DriftAccessor(tables: [StarLedger, StarDailyCounters])
class StarLedgerDao extends DatabaseAccessor<PlayhubDatabase>
    with _$StarLedgerDaoMixin {
  StarLedgerDao(super.db, {required Ids ids, required Clock clock})
    : _ids = ids,
      _clock = clock;

  final Ids _ids;
  final Clock _clock;

  /// Stars from playing, per profile per local day.
  ///
  /// Above the cap, play still produces celebration, stickers and achievement
  /// progress — it just stops minting currency, so more screen time does not
  /// buy a bigger reward. The child is never shown a "cap reached" message.
  static const int dailyPlayCap = 30;

  Future<int> balanceOf(String profileId) async {
    final sum = starLedger.delta.sum();
    final row =
        await (selectOnly(starLedger)
              ..addColumns([sum])
              ..where(starLedger.profileId.equals(profileId)))
            .getSingle();
    return row.read(sum) ?? 0;
  }

  Stream<int> watchBalance(String profileId) {
    final sum = starLedger.delta.sum();
    return (selectOnly(starLedger)
          ..addColumns([sum])
          ..where(starLedger.profileId.equals(profileId)))
        .watchSingle()
        .map((row) => row.read(sum) ?? 0);
  }

  /// Awards stars, applying the ceiling, the daily cap and idempotency, in one
  /// transaction.
  ///
  /// Returns how many were actually minted — 0 when the key was already used or
  /// the cap is spent. Never throws for either case: both are ordinary,
  /// expected outcomes of a child playing enthusiastically.
  Future<int> earn({
    required String profileId,
    required int amount,
    required StarReason reason,
    required StarSource source,
    required String idempotencyKey,
    int? ceiling,
    String? refType,
    String? refId,
    String? note,
  }) async {
    if (amount <= 0) return 0;

    return transaction(() async {
      final existing =
          await (select(starLedger)
                ..where((t) => t.idempotencyKey.equals(idempotencyKey))
                ..limit(1))
              .getSingleOrNull();
      if (existing != null) return 0;

      var granted = ceiling == null
          ? amount
          : (amount > ceiling ? ceiling : amount);

      if (source == StarSource.play) {
        final today = _clock.localDate();
        final counter =
            await (select(starDailyCounters)..where(
                  (t) =>
                      t.profileId.equals(profileId) &
                      t.localDate.equals(today) &
                      t.source.equals(source.wire),
                ))
                .getSingleOrNull();

        final already = counter?.earned ?? 0;
        final headroom = dailyPlayCap - already;
        if (headroom <= 0) return 0;
        if (granted > headroom) granted = headroom;

        await into(starDailyCounters).insertOnConflictUpdate(
          StarDailyCountersCompanion.insert(
            profileId: profileId,
            localDate: today,
            source: source.wire,
            earned: Value(already + granted),
          ),
        );
      }

      if (granted <= 0) return 0;

      await into(starLedger).insert(
        StarLedgerCompanion.insert(
          id: _ids.v7(at: _clock.now()),
          profileId: profileId,
          delta: granted,
          reason: reason.wire,
          idempotencyKey: idempotencyKey,
          refType: Value(refType),
          refId: Value(refId),
          note: Value(note),
          createdAt: _clock.now(),
        ),
      );
      return granted;
    });
  }

  /// Spends stars. Re-reads the balance **inside** the transaction, so a
  /// concurrent redemption cannot drive the balance negative.
  ///
  /// Returns the ledger entry id, or an [IntegrityFailure] when the balance is
  /// insufficient — which the Parent Hub renders as a plain explanation, never
  /// as an error in front of a child.
  Future<Result<String>> spend({
    required String profileId,
    required int amount,
    required StarReason reason,
    required String idempotencyKey,
    String? refType,
    String? refId,
    String? note,
  }) async {
    if (amount <= 0) {
      return const Err(IntegrityFailure('spend amount must be positive'));
    }

    return transaction(() async {
      final existing =
          await (select(starLedger)
                ..where((t) => t.idempotencyKey.equals(idempotencyKey))
                ..limit(1))
              .getSingleOrNull();
      if (existing != null) return Ok(existing.id);

      final balance = await balanceOf(profileId);
      if (balance < amount) {
        return Err<String>(
          IntegrityFailure('insufficient balance: have $balance, need $amount'),
        );
      }

      final id = _ids.v7(at: _clock.now());
      await into(starLedger).insert(
        StarLedgerCompanion.insert(
          id: id,
          profileId: profileId,
          delta: -amount,
          reason: reason.wire,
          idempotencyKey: idempotencyKey,
          refType: Value(refType),
          refId: Value(refId),
          note: Value(note),
          createdAt: _clock.now(),
        ),
      );
      return Ok(id);
    });
  }

  /// Corrects an earlier entry with an offsetting row. The original is never
  /// touched, so the history always explains the balance.
  Future<String> correct({
    required String profileId,
    required int delta,
    required String correctsEntryId,
    required String note,
  }) async {
    final id = _ids.v7(at: _clock.now());
    await into(starLedger).insert(
      StarLedgerCompanion.insert(
        id: id,
        profileId: profileId,
        delta: delta,
        reason: StarReason.correction.wire,
        idempotencyKey: 'correction:$correctsEntryId',
        refType: const Value('star_ledger'),
        refId: Value(correctsEntryId),
        note: Value(note),
        createdAt: _clock.now(),
      ),
    );
    return id;
  }

  Future<int> earnedTodayFrom(String profileId, StarSource source) async {
    final row =
        await (select(starDailyCounters)..where(
              (t) =>
                  t.profileId.equals(profileId) &
                  t.localDate.equals(_clock.localDate()) &
                  t.source.equals(source.wire),
            ))
            .getSingleOrNull();
    return row?.earned ?? 0;
  }

  Future<List<StarLedgerData>> history(String profileId, {int limit = 100}) =>
      (select(starLedger)
            ..where((t) => t.profileId.equals(profileId))
            ..orderBy([(t) => OrderingTerm.desc(t.createdAt)])
            ..limit(limit))
          .get();
}
