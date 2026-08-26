import 'dart:math';

import 'package:core_foundation/core_foundation.dart';
import 'package:core_persistence/core_persistence.dart';
import 'package:drift/native.dart';
import 'package:test/test.dart';

const _profile = 'profile-1';

void main() {
  late PlayhubDatabase db;
  late FakeClock clock;
  late StarLedgerDao ledger;

  setUp(() async {
    clock = FakeClock(start: DateTime(2026, 8, 26, 9));
    db = PlayhubDatabase(NativeDatabase.memory());
    ledger = StarLedgerDao(
      db,
      ids: Ids(random: Random(1)),
      clock: clock,
    );

    await db
        .into(db.profiles)
        .insert(
          ProfilesCompanion.insert(
            id: _profile,
            nickname: 'Test',
            avatarKey: 'fox',
            ageBand: 'preschool',
            themeId: 'farm',
            createdAt: clock.now(),
            updatedAt: clock.now(),
          ),
        );
  });

  tearDown(() => db.close());

  group('earning', () {
    test('balance is the sum of the ledger, not a stored number', () async {
      await ledger.earn(
        profileId: _profile,
        amount: 3,
        reason: StarReason.gameRound,
        source: StarSource.play,
        idempotencyKey: 'play:a:round:1',
      );
      await ledger.earn(
        profileId: _profile,
        amount: 5,
        reason: StarReason.achievement,
        source: StarSource.achievement,
        idempotencyKey: 'ach:first_puzzle',
      );

      expect(await ledger.balanceOf(_profile), 8);
    });

    test('the same idempotency key never awards twice', () async {
      // The retry / double-tap / crash-resume guarantee.
      final first = await ledger.earn(
        profileId: _profile,
        amount: 3,
        reason: StarReason.gameRound,
        source: StarSource.play,
        idempotencyKey: 'play:abc:round:1',
      );
      final second = await ledger.earn(
        profileId: _profile,
        amount: 3,
        reason: StarReason.gameRound,
        source: StarSource.play,
        idempotencyKey: 'play:abc:round:1',
      );

      expect(first, 3);
      expect(second, 0);
      expect(await ledger.balanceOf(_profile), 3);
    });

    test('a module cannot exceed the ceiling the platform enforces', () async {
      // A game *proposes*; the platform decides.
      final granted = await ledger.earn(
        profileId: _profile,
        amount: 9999,
        reason: StarReason.gameRound,
        source: StarSource.play,
        idempotencyKey: 'play:greedy:round:1',
        ceiling: 3,
      );

      expect(granted, 3);
    });

    test('zero and negative proposals are ignored', () async {
      expect(
        await ledger.earn(
          profileId: _profile,
          amount: 0,
          reason: StarReason.gameRound,
          source: StarSource.play,
          idempotencyKey: 'z',
        ),
        0,
      );
      expect(await ledger.balanceOf(_profile), 0);
    });
  });

  group('daily play cap', () {
    Future<int> playRound(int n, {int amount = 3}) => ledger.earn(
      profileId: _profile,
      amount: amount,
      reason: StarReason.gameRound,
      source: StarSource.play,
      idempotencyKey: 'play:session:round:$n',
    );

    test(
      'play earnings stop at the cap, so more screen time buys no more',
      () async {
        var total = 0;
        for (var i = 0; i < 40; i++) {
          total += await playRound(i);
        }

        expect(total, StarLedgerDao.dailyPlayCap);
        expect(await ledger.balanceOf(_profile), StarLedgerDao.dailyPlayCap);
      },
    );

    test(
      'the final award is trimmed to the remaining headroom, not refused',
      () async {
        for (var i = 0; i < 9; i++) {
          await playRound(i); // 27 stars
        }
        expect(await ledger.earnedTodayFrom(_profile, StarSource.play), 27);

        final trimmed = await playRound(99, amount: 3);
        expect(trimmed, 3);

        final refused = await playRound(100, amount: 3);
        expect(refused, 0);
      },
    );

    test('chores and parent grants are NOT capped', () async {
      for (var i = 0; i < 40; i++) {
        await playRound(i);
      }

      final chore = await ledger.earn(
        profileId: _profile,
        amount: 15,
        reason: StarReason.taskApproved,
        source: StarSource.task,
        idempotencyKey: 'task:instance:1',
      );
      final grant = await ledger.earn(
        profileId: _profile,
        amount: 20,
        reason: StarReason.parentGrant,
        source: StarSource.parent,
        idempotencyKey: 'grant:1',
        note: 'Helped Grandma',
      );

      expect(chore, 15);
      expect(grant, 20);
      expect(await ledger.balanceOf(_profile), StarLedgerDao.dailyPlayCap + 35);
    });

    test('the cap resets at the local date rollover', () async {
      for (var i = 0; i < 40; i++) {
        await playRound(i);
      }
      expect(await ledger.balanceOf(_profile), 30);

      clock.advance(const Duration(hours: 16)); // next local day
      final next = await ledger.earn(
        profileId: _profile,
        amount: 3,
        reason: StarReason.gameRound,
        source: StarSource.play,
        idempotencyKey: 'play:tomorrow:round:1',
      );

      expect(next, 3);
    });
  });

  group('spending', () {
    Future<void> give(int n) => ledger.earn(
      profileId: _profile,
      amount: n,
      reason: StarReason.parentGrant,
      source: StarSource.parent,
      idempotencyKey: 'seed:$n:${DateTime.now().microsecondsSinceEpoch}',
    );

    test('a redemption debits exactly once', () async {
      await give(100);

      final result = await ledger.spend(
        profileId: _profile,
        amount: 100,
        reason: StarReason.rewardRedeemed,
        idempotencyKey: 'req:abc',
        refType: 'reward_requests',
        refId: 'abc',
      );

      expect(result.isOk, isTrue);
      expect(await ledger.balanceOf(_profile), 0);
    });

    test('approving the same request twice moves stars once', () async {
      await give(100);

      final a = await ledger.spend(
        profileId: _profile,
        amount: 100,
        reason: StarReason.rewardRedeemed,
        idempotencyKey: 'req:abc',
      );
      final b = await ledger.spend(
        profileId: _profile,
        amount: 100,
        reason: StarReason.rewardRedeemed,
        idempotencyKey: 'req:abc',
      );

      expect(
        a.valueOrNull,
        b.valueOrNull,
        reason: 'same ledger entry returned',
      );
      expect(await ledger.balanceOf(_profile), 0);
    });

    test('an insufficient balance is refused and moves nothing', () async {
      await give(40);

      final result = await ledger.spend(
        profileId: _profile,
        amount: 100,
        reason: StarReason.rewardRedeemed,
        idempotencyKey: 'req:toobig',
      );

      expect(result.isOk, isFalse);
      expect((result as Err).failure, isA<IntegrityFailure>());
      expect(await ledger.balanceOf(_profile), 40);
    });

    test('two concurrent redemptions cannot overdraw', () async {
      await give(100);

      final results = await Future.wait([
        ledger.spend(
          profileId: _profile,
          amount: 100,
          reason: StarReason.rewardRedeemed,
          idempotencyKey: 'req:one',
        ),
        ledger.spend(
          profileId: _profile,
          amount: 100,
          reason: StarReason.rewardRedeemed,
          idempotencyKey: 'req:two',
        ),
      ]);

      expect(results.where((r) => r.isOk), hasLength(1));
      expect(await ledger.balanceOf(_profile), 0);
    });
  });

  group('corrections', () {
    test('a mistake is offset, never erased', () async {
      final entries = <String>[];
      await ledger.earn(
        profileId: _profile,
        amount: 50,
        reason: StarReason.parentGrant,
        source: StarSource.parent,
        idempotencyKey: 'oops',
      );
      final history = await ledger.history(_profile);
      entries.add(history.single.id);

      await ledger.correct(
        profileId: _profile,
        delta: -50,
        correctsEntryId: entries.first,
        note: 'Added to the wrong child',
      );

      expect(await ledger.balanceOf(_profile), 0);
      final after = await ledger.history(_profile);
      expect(after, hasLength(2), reason: 'the original row must still exist');
    });
  });

  group('property: the balance can never go negative', () {
    test('across 2000 random operations', () async {
      final rng = Random(20260826);

      for (var i = 0; i < 2000; i++) {
        if (rng.nextBool()) {
          await ledger.earn(
            profileId: _profile,
            amount: rng.nextInt(6) + 1,
            reason: StarReason.parentGrant,
            source: StarSource.parent,
            idempotencyKey: 'p-earn:$i',
          );
        } else {
          await ledger.spend(
            profileId: _profile,
            amount: rng.nextInt(40) + 1,
            reason: StarReason.rewardRedeemed,
            idempotencyKey: 'p-spend:$i',
          );
        }

        if (i % 200 == 0) {
          expect(await ledger.balanceOf(_profile), greaterThanOrEqualTo(0));
        }
      }

      expect(await ledger.balanceOf(_profile), greaterThanOrEqualTo(0));
    });
  });

  test('the schema opens clean and passes an integrity check', () async {
    expect(await db.integrityCheck(), isTrue);
    expect(db.schemaVersion, schemaVersionCurrent);
  });
}
