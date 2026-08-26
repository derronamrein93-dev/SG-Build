import 'package:core_foundation/core_foundation.dart';
import 'package:test/test.dart';

void main() {
  group('Result', () {
    test('valueOr returns the fallback on failure', () {
      const Result<String> r = Err<String>(
        ContentFailure('missing', slot: 'bg.far'),
      );
      expect(r.valueOr('placeholder'), 'placeholder');
    });

    test('fold dispatches on the case', () {
      const Result<int> ok = Ok(3);
      const Result<int> err = Err<int>(StorageFailure('disk full'));

      expect(ok.fold((v) => 'ok:$v', (f) => 'err'), 'ok:3');
      expect(
        err.fold((v) => 'ok:$v', (f) => 'err:${f.message}'),
        'err:disk full',
      );
    });

    test('map transforms the value and preserves the failure', () {
      const Result<int> ok = Ok(3);
      expect(ok.map((v) => v * 2).valueOrNull, 6);

      const Result<int> err = Err<int>(StorageFailure('nope'));
      expect(err.map((v) => v * 2).isOk, isFalse);
    });
  });

  group('Failure', () {
    test(
      'purchase failures are transient by default, storage failures are not',
      () {
        expect(const PurchaseFailure('network').isTransient, isTrue);
        expect(
          const PurchaseFailure('bad receipt', retryable: false).isTransient,
          isFalse,
        );
        expect(const StorageFailure('corrupt').isTransient, isFalse);
      },
    );
  });
}
