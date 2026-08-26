/// A reusable contract suite every game module must pass.
///
/// Import this from a game package's tests and call
/// `runGameModuleContractTests`. Written once, applied to every future game —
/// including games written by a contractor.
library;

export 'src/testing/contract_tests.dart';
export 'src/testing/fakes.dart';
