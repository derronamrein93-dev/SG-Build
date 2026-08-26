import 'dart:io';

/// Resolves a repo-relative path whether tests are run from the package
/// directory (`flutter test` inside apps/playhub) or from the workspace root
/// (`flutter test apps/playhub`, which is what CI does).
Directory repoDir(String fromWorkspaceRoot) {
  final candidates = [
    Directory(fromWorkspaceRoot),
    Directory('../../$fromWorkspaceRoot'),
  ];
  for (final c in candidates) {
    if (c.existsSync()) return c;
  }
  throw StateError(
    'could not locate "$fromWorkspaceRoot" from ${Directory.current.path}',
  );
}

/// The app's own `lib/`, from either working directory.
Directory appLibDir() => repoDir('apps/playhub/lib');
