/// The closed set of attributes a game may match, sort or group by.
///
/// This is what stops the theme abstraction collapsing. A matching game does not
/// need "a picture" — it needs objects it can *compare*. So a pack ships tokens
/// tagged with these, and a game queries semantically:
/// "give me six tokens with distinct colours".
enum TokenAttribute {
  color,
  shape,
  silhouette,
  size,
  count,
  category,
  initialSound;

  static TokenAttribute? tryParse(String raw) {
    for (final a in TokenAttribute.values) {
      if (a.name == raw) return a;
    }
    return null;
  }
}

/// One matchable object supplied by a ThemePack.
class ThemeToken {
  const ThemeToken({
    required this.id,
    required this.artPath,
    required this.attributes,
    this.voPath,
  });

  final String id;
  final String artPath;
  final String? voPath;
  final Map<TokenAttribute, String> attributes;

  String? attr(TokenAttribute a) => attributes[a];

  @override
  String toString() => 'ThemeToken($id)';
}

/// A named set of tokens — 'creatures', 'shapes', 'vehicles'.
class TokenCatalog {
  const TokenCatalog({
    required this.setId,
    required this.matchBy,
    required this.tokens,
  });

  final String setId;
  final Set<TokenAttribute> matchBy;
  final List<ThemeToken> tokens;

  int get length => tokens.length;

  /// Distinct values present for [attribute] — a sorter's bins come from this.
  List<String> distinctValuesOf(TokenAttribute attribute) {
    final seen = <String>{};
    for (final t in tokens) {
      final v = t.attr(attribute);
      if (v != null) seen.add(v);
    }
    final out = seen.toList()..sort();
    return out;
  }

  /// [count] tokens whose [attribute] values are all different.
  ///
  /// Deterministic for a given [nextInt] source, because boards must be
  /// reproducible: the same seed makes the same board, which is what lets a
  /// game's rules be unit-tested and a support report be replayed.
  List<ThemeToken> pickDistinctBy(
    TokenAttribute attribute, {
    required int count,
    required int Function(int max) nextInt,
  }) {
    final byValue = <String, List<ThemeToken>>{};
    for (final t in tokens) {
      final v = t.attr(attribute);
      if (v == null) continue;
      byValue.putIfAbsent(v, () => []).add(t);
    }

    final values = byValue.keys.toList()..sort();
    final picked = <ThemeToken>[];
    while (picked.length < count && values.isNotEmpty) {
      final v = values.removeAt(nextInt(values.length));
      final bucket = byValue[v]!;
      picked.add(bucket[nextInt(bucket.length)]);
    }
    return picked;
  }

  /// Whether this catalog can serve a game needing [needed] attributes on at
  /// least [minimumTokens] tokens. Checked at build time, never at play time.
  bool supports({
    required Set<TokenAttribute> needed,
    required int minimumTokens,
  }) {
    if (tokens.length < minimumTokens) return false;
    return needed.every((a) => tokens.every((t) => t.attr(a) != null));
  }
}
