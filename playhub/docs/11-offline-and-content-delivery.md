# 11 — Offline-First & Content Delivery

> **Decision:** MVP ships 100% of content in the binary and makes **zero network
> requests**. The content abstraction that would allow downloadable packs is built
> now; the downloader is not.
> **Status:** proposed. **Reversal cost:** low if the manifest format is right.

---

## 1. The MVP position: no network at all

Three games and three themes fit comfortably inside the size budget (doc 19), so
the MVP has no reason to download anything. The consequences are all good:

- Restaurant Wi-Fi, airplane mode, a car in a valley, a 30-hour flight — identical
  behaviour, because there is nothing to fail.
- No loading spinner ever appears in front of a three-year-old.
- The App Store privacy questionnaire answer is trivially **"Data Not Collected"**,
  because there is no endpoint to collect anything (doc 13).
- No CDN bill, no infrastructure, no uptime obligation, nothing to secure.
- Nothing in the app can be interrupted, hijacked, or served malicious content.

The app requests no network permission usage in the MVP other than what StoreKit
itself performs, which is Apple's own transport and needs no code from us.

## 2. The seam for later

```dart
abstract interface class ContentSource {
  Future<ContentManifest> manifest();
  Future<PackHandle> ensure(PackId id, {ProgressSink? progress});
  Future<void> evict(PackId id);
}

class BundledContentSource implements ContentSource { ... }   // MVP: the only one
class RemoteContentSource  implements ContentSource { ... }   // later
class LayeredContentSource implements ContentSource { ... }   // bundled ∪ downloaded
```

Every asset lookup already goes through `ThemeResolver` → `ContentSource`, so the
day a remote source is added, **no game and no screen changes**.

## 3. Manifest format (defined now, used by both sources)

```jsonc
{
  "manifestVersion": 1,
  "generatedAt": "2026-08-25T00:00:00Z",
  "minAppVersion": "1.0.0",
  "packs": [
    { "id": "theme_pirate", "kind": "theme", "contentVersion": 2,
      "bytes": 6291456, "sha256": "…",
      "url": "https://cdn.example/packs/theme_pirate.v2.zip",
      "minAppVersion": "1.2.0", "tier": "premium",
      "ageAppropriate": { "min": "preschool", "max": "earlySchool" } }
  ],
  "signature": "…"          // Ed25519 over the canonicalised body
}
```

Rules baked in from day one because they are expensive to add later:

1. **Unknown fields are ignored by older apps** — forward compatibility.
2. **`minAppVersion` per pack** — a pack needing a newer game engine is simply not
   offered to an old app rather than crashing it.
3. **Hash + signature verification before install.** A pack that fails either is
   discarded. Content served to children must be tamper-evident.
4. **Atomic install**: download → verify → unpack to a temp dir → atomic rename.
   A pack is never half-installed.
5. **Never evict a pack in use**, and never evict the last theme a profile can play.
6. **Downloads only on the parent's explicit action, in the Parent Hub**, over
   Wi-Fi by default. A child never triggers a download, never sees a progress bar,
   never waits.

## 4. Remote configuration & feature flags

Same discipline: `FeatureFlags` is an interface with a `BakedInFlags`
implementation in the MVP. Defaults are compiled in, so **offline is always the
fully-functional state**; a future remote source can only *override* flags, never
be required for the app to work. If the flag fetch fails, times out, or returns
garbage, the baked-in defaults stand and nothing logs an error to the child.

Flags are for kill-switching a broken game and staging a rollout — not for
changing prices, not for A/B-testing children, and never for anything that alters
what a child sees mid-session.

## 5. When downloadable content becomes worth building

Trigger conditions, not a date:

- the bundled size approaches 150 MB, **or**
- theme production outpaces app releases (more than ~1 pack per release), **or**
- a seasonal pack needs to land on a date that isn't a release date.

Until one of those is true, shipping content in app updates is simpler, safer,
reviewable by Apple, and free.

**Compliance note:** in a children's app, content delivered outside App Review is
scrutinised. Only ever serve first-party, pre-reviewed packs from your own CDN.
No user-generated content, no third-party feeds, no dynamic content of any kind
in front of a child. This is also why the "WATCH" module is a much bigger
undertaking than it looks (doc 21 §6).
