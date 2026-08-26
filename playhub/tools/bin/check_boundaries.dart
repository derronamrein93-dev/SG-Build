// Fails the build when a package reaches somewhere it must not.
//
// This is the single most important piece of tooling in the repository: it is
// what keeps "modular platform" true in month 18 rather than only in month 1.
// Rules are enforced mechanically because discipline does not survive a
// deadline. See docs/02-system-architecture.md §2 and docs/23-flame-usage-policy.md.

import 'dart:io';

import 'package:yaml/yaml.dart';

/// Package name → what it is forbidden to depend on or import.
const Map<String, Set<String>> _forbidden = {
  // Depends on nothing. Ever.
  'core_foundation': {
    'core_theme',
    'core_gameapi',
    'core_persistence',
    'core_entitlements',
    'core_domain',
    'core_ui_kit',
    'core_audio',
    'core_content',
    'playhub',
    'flutter',
    'flame',
    'drift',
    'http',
  },
  // The contract. Knows nothing below it.
  'core_gameapi': {
    'core_persistence',
    'core_entitlements',
    'core_domain',
    'playhub',
    'flame',
    'drift',
    'http',
    'url_launcher',
    'in_app_purchase',
  },
  // Content model only.
  'core_theme': {
    'core_persistence',
    'core_entitlements',
    'core_gameapi',
    'playhub',
    'flutter',
    'flame',
    'drift',
    'http',
  },
  // Purchases. Must not reach into the database or the UI.
  'core_entitlements': {
    'core_persistence',
    'core_gameapi',
    'core_theme',
    'playhub',
    'flutter',
    'flame',
  },
  // The only package that knows what a table is.
  'core_persistence': {
    'core_gameapi',
    'core_entitlements',
    'playhub',
    'flame',
    'http',
  },
};

/// Applied to every `packages/games/*` package. This is the sandbox: a game
/// module physically cannot corrupt platform state or reach the outside world.
const Set<String> _forbiddenForGames = {
  'core_persistence',
  'core_entitlements',
  'core_domain',
  'playhub',
  'drift',
  'http',
  'dio',
  'url_launcher',
  'in_app_purchase',
  'shared_preferences',
  'path_provider',
  'flutter_secure_storage',
  'local_auth',
  'share_plus',
  'image_picker',
};

/// Any dependency that can collect data or reach the network is banned
/// outright. Zero third-party SDKs is a Kids Category position, not a
/// preference — see docs/13-privacy-and-child-safety.md.
const Set<String> _bannedEverywhere = {
  'firebase_core',
  'firebase_analytics',
  'firebase_crashlytics',
  'sentry_flutter',
  'amplitude_flutter',
  'mixpanel_flutter',
  'appsflyer_sdk',
  'facebook_app_events',
  'google_mobile_ads',
  'app_tracking_transparency',
  'posthog_flutter',
  'segment_analytics',
};

int _failures = 0;

void _fail(String message) {
  stderr.writeln('  ✗ $message');
  _failures++;
}

void main(List<String> args) {
  final root = _repoRoot();
  stdout.writeln('Checking package boundaries in ${root.path}');

  final packages = <_Pkg>[
    ..._collect(Directory('${root.path}/packages')),
    ..._collect(Directory('${root.path}/packages/games')),
    ..._collect(Directory('${root.path}/apps')),
  ];

  if (packages.isEmpty) {
    stderr.writeln('No packages found — is this the repository root?');
    exit(2);
  }

  for (final pkg in packages) {
    final banned = <String>{
      ..._bannedEverywhere,
      ...?_forbidden[pkg.name],
      if (pkg.isGame) ..._forbiddenForGames,
    };

    for (final dep in pkg.dependencies) {
      if (banned.contains(dep)) {
        _fail('${pkg.name} declares a forbidden dependency: $dep');
      }
    }

    // `flame` is allowed only inside an individual game package. A core package
    // that depends on it has quietly made the whole shell a game.
    if (!pkg.isGame && pkg.dependencies.contains('flame')) {
      _fail('${pkg.name} depends on flame — only packages/games/* may');
    }

    for (final entry in pkg.imports.entries) {
      for (final imported in entry.value) {
        if (banned.contains(imported)) {
          _fail(
            '${pkg.name}: ${entry.key} imports forbidden package "$imported"',
          );
        }
      }
    }

    // A theme pack is content. The moment it needs code, the slot vocabulary is
    // wrong and should be extended instead.
    if (pkg.isTheme && pkg.dartFiles.isNotEmpty) {
      _fail(
        '${pkg.name} is a ThemePack and must contain no Dart files '
        '(found ${pkg.dartFiles.length})',
      );
    }

    // A game's rules must be testable without a screen, so the logic half
    // imports neither Flutter nor Flame.
    if (pkg.isGame) {
      for (final entry in pkg.imports.entries) {
        if (!entry.key.contains('/logic/')) continue;
        for (final imported in entry.value) {
          if (imported == 'flutter' || imported == 'flame') {
            _fail(
              '${pkg.name}: ${entry.key} is game logic and must not '
              'import $imported — keep rules headless and testable',
            );
          }
        }
      }
      // No hard-coded theme identity anywhere in a game.
      for (final file in pkg.dartFiles) {
        final source = File(file).readAsStringSync();
        final match = RegExp(
          '''["'](dino|farm|ocean|space|pirate|safari|unicorn)["']''',
        ).firstMatch(source);
        if (match != null) {
          _fail(
            '${pkg.name}: ${_rel(root, file)} contains a theme id literal '
            '${match.group(0)} — games address content by ThemeSlot only',
          );
        }
      }
    }
  }

  stdout.writeln('Checked ${packages.length} packages.');
  if (_failures > 0) {
    stderr.writeln('\n$_failures boundary violation(s).');
    exit(1);
  }
  stdout.writeln('✓ All boundaries hold.');
}

class _Pkg {
  _Pkg(this.name, this.dir, this.dependencies, this.imports, this.dartFiles);

  final String name;
  final String dir;
  final Set<String> dependencies;

  /// Relative file path → package names it imports.
  final Map<String, Set<String>> imports;

  final List<String> dartFiles;

  bool get isGame => dir.contains('/packages/games/');
  bool get isTheme => dir.contains('/packages/themes/');
}

List<_Pkg> _collect(Directory dir) {
  if (!dir.existsSync()) return const [];
  final out = <_Pkg>[];

  for (final entity in dir.listSync()) {
    if (entity is! Directory) continue;
    final pubspec = File('${entity.path}/pubspec.yaml');
    if (!pubspec.existsSync()) continue;

    final doc = loadYaml(pubspec.readAsStringSync());
    if (doc is! YamlMap) continue;
    final name = doc['name'] as String?;
    if (name == null) continue;

    final deps = <String>{};
    for (final key in ['dependencies', 'dev_dependencies']) {
      final section = doc[key];
      if (section is YamlMap) deps.addAll(section.keys.cast<String>());
    }

    final dartFiles = <String>[];
    final imports = <String, Set<String>>{};
    final lib = Directory('${entity.path}/lib');
    if (lib.existsSync()) {
      for (final f in lib.listSync(recursive: true)) {
        if (f is! File || !f.path.endsWith('.dart')) continue;
        if (f.path.endsWith('.g.dart')) continue;
        dartFiles.add(f.path);
        final found = <String>{};
        for (final m in RegExp(
          r'''import\s+['"]package:([a-z0-9_]+)/''',
        ).allMatches(f.readAsStringSync())) {
          found.add(m.group(1)!);
        }
        if (found.isNotEmpty) imports[f.path] = found;
      }
    }

    out.add(_Pkg(name, entity.path, deps, imports, dartFiles));
  }
  return out;
}

Directory _repoRoot() {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    if (File('${dir.path}/pubspec.yaml').existsSync() &&
        Directory('${dir.path}/packages').existsSync()) {
      return dir;
    }
    dir = dir.parent;
  }
  return Directory.current;
}

String _rel(Directory root, String path) =>
    path.startsWith(root.path) ? path.substring(root.path.length + 1) : path;
