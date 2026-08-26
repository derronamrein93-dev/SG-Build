// Validates every ThemePack against the slot vocabulary and the games it claims
// to support, so a pack with a missing slot, an unknown token attribute or an
// oversized budget fails the build rather than a child's afternoon.
//
// Phase 2 wires this to real packs under packages/themes/. Until then it
// asserts the tree is in the expected shape and exits clean.

import 'dart:io';

const int _packBudgetBytes = 8 * 1024 * 1024;

void main() {
  final dir = Directory('packages/themes');
  if (!dir.existsSync()) {
    stdout.writeln('No packages/themes yet — nothing to validate (Phase 2).');
    return;
  }

  var failures = 0;
  var packs = 0;

  for (final entity in dir.listSync()) {
    if (entity is! Directory) continue;
    packs++;
    final name = entity.path.split(Platform.pathSeparator).last;

    final manifest = File('${entity.path}/theme.json');
    if (!manifest.existsSync()) {
      stderr.writeln('  ✗ $name: no theme.json');
      failures++;
      continue;
    }

    // A ThemePack is content. The moment it needs code, the slot vocabulary is
    // wrong and should be extended instead.
    final dart = entity
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'));
    if (dart.isNotEmpty) {
      stderr.writeln('  ✗ $name: contains ${dart.length} Dart file(s)');
      failures++;
    }

    var bytes = 0;
    for (final f in entity.listSync(recursive: true).whereType<File>()) {
      bytes += f.lengthSync();
    }
    if (bytes > _packBudgetBytes) {
      stderr.writeln(
        '  ✗ $name: $bytes bytes exceeds the $_packBudgetBytes budget',
      );
      failures++;
    } else {
      stdout.writeln('  ✓ $name: ${(bytes / 1024).round()} KB');
    }
  }

  stdout.writeln('Validated $packs ThemePack(s).');
  if (failures > 0) exit(1);
}
