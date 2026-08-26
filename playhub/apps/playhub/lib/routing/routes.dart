/// The two route trees, declared as data so their separation is testable.
///
/// There is **no edge** from any child route to any parent route. The only way
/// in is [parentGate], which requires a sustained three-second corner hold
/// followed by Face ID or a PIN — see docs/07-child-parent-separation.md.
///
/// `test/route_separation_test.dart` asserts the trees are disjoint and that the
/// gate is the sole entry point.
library;

/// Reachable by a child. No text input, no external links, no prices, no
/// purchase surfaces exist anywhere in this tree.
const Set<String> childRoutes = {
  '/',
  '/play/:gameId',
  '/celebrate',
  '/collection',
  '/rewards',
  '/rest',
  '/switch-profile',
};

/// Reachable only through [parentGate].
const Set<String> parentRoutes = {
  '/parent',
  '/parent/profiles',
  '/parent/screen-time',
  '/parent/audio',
  '/parent/quality',
  '/parent/rewards',
  '/parent/requests',
  '/parent/tasks',
  '/parent/subscription',
  '/parent/privacy',
  '/parent/diagnostics',
};

/// The single edge between the two trees.
const String parentGate = '/gate';

/// Reserved for the future content modules in docs/18 — the navigation seam
/// exists so adding one is not a restructure. Nothing is built behind them.
const Set<String> reservedModuleRoots = {'/watch', '/create', '/learn'};
