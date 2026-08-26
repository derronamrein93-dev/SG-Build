// Coverage is reported everywhere and *gated* only where the family's data
// lives. UI packages are covered by golden tests instead, so a percentage there
// would be theatre. See docs/15-testing-strategy.md §7.

import 'dart:io';

/// Path fragment → minimum line coverage.
const Map<String, double> _floors = {
  'packages/core_persistence/lib/src/dao/': 0.85,
  'packages/core_entitlements/lib/src/': 0.80,
  'packages/core_theme/lib/src/': 0.75,
  'packages/core_foundation/lib/src/': 0.80,
};

void main() {
  final lcov = File('coverage/lcov.info');
  if (!lcov.existsSync()) {
    stdout.writeln(
      'No coverage/lcov.info — skipping (run flutter test --coverage).',
    );
    return;
  }

  final hits = <String, (int found, int hit)>{};
  String? current;
  var found = 0;
  var hit = 0;

  for (final line in lcov.readAsLinesSync()) {
    if (line.startsWith('SF:')) {
      current = line.substring(3);
      found = 0;
      hit = 0;
    } else if (line.startsWith('DA:')) {
      final parts = line.substring(3).split(',');
      found++;
      if ((int.tryParse(parts[1]) ?? 0) > 0) hit++;
    } else if (line == 'end_of_record' && current != null) {
      hits[current] = (found, hit);
      current = null;
    }
  }

  var failed = false;
  for (final entry in _floors.entries) {
    var totalFound = 0;
    var totalHit = 0;
    for (final file in hits.entries) {
      if (!file.key.contains(entry.key)) continue;
      totalFound += file.value.$1;
      totalHit += file.value.$2;
    }
    if (totalFound == 0) {
      stdout.writeln('  · ${entry.key}: no coverage data yet');
      continue;
    }
    final ratio = totalHit / totalFound;
    final ok = ratio >= entry.value;
    stdout.writeln(
      '  ${ok ? '✓' : '✗'} ${entry.key}: '
      '${(ratio * 100).toStringAsFixed(1)}% (floor ${(entry.value * 100).round()}%)',
    );
    if (!ok) failed = true;
  }

  if (failed) {
    stderr.writeln('\nCoverage floor not met.');
    exit(1);
  }
  stdout.writeln('✓ Coverage floors met.');
}
