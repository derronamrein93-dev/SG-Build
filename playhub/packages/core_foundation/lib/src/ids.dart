import 'dart:math';
import 'dart:typed_data';

/// Time-ordered unique identifiers (UUID v7 layout).
///
/// Every row in the database uses one. They are generated on-device, sort
/// chronologically (so indexes stay dense and "most recent" queries are cheap),
/// and never collide across devices — which is what makes an optional cloud
/// backup possible later without a schema migration. Hand-rolled rather than
/// pulled from a package: it is twenty lines, and this product keeps its
/// dependency surface deliberately small.
class Ids {
  Ids({Random? random}) : _random = random ?? Random.secure();

  final Random _random;

  /// A UUID v7: 48-bit big-endian millisecond timestamp, 4-bit version,
  /// 74 bits of randomness, 2-bit variant.
  String v7({DateTime? at}) {
    final ms = (at ?? DateTime.now()).millisecondsSinceEpoch;
    final bytes = Uint8List(16);

    for (var i = 0; i < 6; i++) {
      bytes[5 - i] = (ms >> (8 * i)) & 0xff;
    }
    for (var i = 6; i < 16; i++) {
      bytes[i] = _random.nextInt(256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
