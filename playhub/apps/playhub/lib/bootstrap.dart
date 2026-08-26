import 'package:flutter/widgets.dart';

import 'brand/brand_config.dart';
import 'registry/game_registry.dart';

/// Composition root. Wires packages together and does nothing else — if logic
/// appears in this file, it belongs in a package.
///
/// Phase 0 boots to a placeholder. The shell arrives in Phase 1.
Future<void> bootstrap({
  BrandConfig brand = const BrandConfig.provisional(),
  GameRegistry registry = const GameRegistry.empty(),
}) async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(_Placeholder(brand: brand, registry: registry));
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.brand, required this.registry});

  final BrandConfig brand;
  final GameRegistry registry;

  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: Color(0xFFF6F1E4),
    child: Center(child: SizedBox.shrink()),
  );
}
