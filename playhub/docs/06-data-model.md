# 06 — Local Data Model & Persistence

> **Decision:** SQLite (WAL) via Drift. UUIDv7 primary keys, `updated_at` and
> soft-delete tombstones on every row from day one. The star economy is an
> **append-only ledger**.
> **Status:** proposed. **Reversal cost:** HIGH — migrating live save data on
> family devices is the least forgiving change in the product.

---

## 1. Principles

1. **One writer, one transaction, one truth.** All mutations go through
   `core_domain` services; no widget touches a DAO.
2. **Money-like data is a ledger.** Stars are never a mutable integer. Balance is
   `SUM(delta)`. Every entry has a reason and an idempotency key.
3. **Sync-ready without sync.** UUIDv7 ids (time-ordered, collision-free across
   devices), `updated_at`, and `deleted_at` tombstones cost nothing now and make
   optional cloud backup possible later without a migration. This is the cheapest
   insurance in the whole schema.
4. **Nothing identifying.** No birthdate — only an age band. No surname, no email,
   no photo library access, no contacts, no location, no device identifier.
5. **Crash-safe.** WAL journaling, `synchronous=NORMAL`, every multi-step change
   in one transaction, plus a nightly integrity check.

## 2. Schema

```sql
-- ─── settings & profiles ─────────────────────────────────────────────
CREATE TABLE app_settings (              -- single row, id = 1
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version      INTEGER NOT NULL,
  parent_pin_set      INTEGER NOT NULL DEFAULT 0,   -- hash lives in Keychain
  biometric_gate      INTEGER NOT NULL DEFAULT 1,
  master_volume       REAL NOT NULL DEFAULT 0.8,
  music_volume        REAL NOT NULL DEFAULT 0.6,
  sfx_volume          REAL NOT NULL DEFAULT 0.9,
  voice_enabled       INTEGER NOT NULL DEFAULT 1,
  muted               INTEGER NOT NULL DEFAULT 0,
  quality_mode        TEXT NOT NULL DEFAULT 'auto', -- auto|low|medium|high
  quality_resolved    TEXT,                          -- cached AUTO result
  quality_probe_stamp TEXT,                          -- device+os fingerprint
  tasks_enabled       INTEGER NOT NULL DEFAULT 0,    -- chores OFF by default
  rewards_enabled     INTEGER NOT NULL DEFAULT 1,
  onboarding_done     INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL
);

CREATE TABLE profiles (
  id            TEXT PRIMARY KEY,        -- uuid v7
  nickname      TEXT NOT NULL,           -- free text, parent-entered, never leaves device
  avatar_key    TEXT NOT NULL,           -- key into a bundled avatar set, not a photo
  age_band      TEXT NOT NULL,           -- toddler|preschool|earlySchool
  age_years     INTEGER,                 -- optional, 2..8, for band tuning only
  theme_id      TEXT NOT NULL,
  difficulty_override TEXT,              -- null = adaptive
  reduce_motion INTEGER NOT NULL DEFAULT 0,
  high_contrast INTEGER NOT NULL DEFAULT 0,
  larger_targets INTEGER NOT NULL DEFAULT 0,
  left_handed   INTEGER NOT NULL DEFAULT 0,
  vo_enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ─── play history ────────────────────────────────────────────────────
CREATE TABLE play_sessions (             -- one per app-session per profile
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id),
  started_at TEXT NOT NULL, ended_at TEXT,
  foreground_seconds INTEGER NOT NULL DEFAULT 0,
  end_reason TEXT,                       -- child|limit|background|crash
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_sessions_profile_day ON play_sessions(profile_id, started_at);

CREATE TABLE game_plays (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES play_sessions(id),
  profile_id TEXT NOT NULL, game_id TEXT NOT NULL, theme_id TEXT NOT NULL,
  difficulty_snapshot TEXT NOT NULL,     -- json: the exact knobs used
  rng_seed INTEGER NOT NULL,             -- reproduces the exact board for support
  started_at TEXT NOT NULL, ended_at TEXT,
  rounds_completed INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0, hints_used INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE INDEX ix_plays_profile_game ON game_plays(profile_id, game_id, started_at);

-- ─── the star ledger (append-only) ───────────────────────────────────
CREATE TABLE star_ledger (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  delta INTEGER NOT NULL,                -- + earn, − redeem. NEVER 0
  reason TEXT NOT NULL,                  -- game_round|achievement|milestone|
                                         -- task_approved|reward_redeemed|
                                         -- parent_grant|parent_adjust|correction
  ref_type TEXT, ref_id TEXT,            -- what caused it
  idempotency_key TEXT NOT NULL UNIQUE,  -- ← prevents every double-award bug
  note TEXT,                             -- parent-visible explanation
  created_at TEXT NOT NULL
);
CREATE INDEX ix_ledger_profile ON star_ledger(profile_id, created_at);
-- Rows are NEVER updated or deleted. A mistake is corrected with an
-- offsetting 'correction' entry, so the history always explains the balance.

CREATE VIEW star_balances AS
  SELECT profile_id, COALESCE(SUM(delta),0) AS balance FROM star_ledger
  GROUP BY profile_id;

-- daily earn caps (see doc 09 §4)
CREATE TABLE star_daily_counters (
  profile_id TEXT NOT NULL, local_date TEXT NOT NULL, source TEXT NOT NULL,
  earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, local_date, source)
);

-- ─── achievements & collection ───────────────────────────────────────
CREATE TABLE achievement_progress (
  profile_id TEXT NOT NULL, achievement_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL,
  unlocked_at TEXT, seen_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, achievement_id)
);

CREATE TABLE collectibles (
  profile_id TEXT NOT NULL, collectible_id TEXT NOT NULL,  -- 'dino.sticker.03'
  kind TEXT NOT NULL,                   -- sticker|badge|trophy|decoration
  acquired_at TEXT NOT NULL, placed_slot TEXT,             -- sticker-book position
  PRIMARY KEY (profile_id, collectible_id)
);

-- ─── parent reward store ─────────────────────────────────────────────
CREATE TABLE rewards (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  icon_key TEXT NOT NULL,               -- bundled emoji/icon key
  image_path TEXT,                      -- optional parent photo, app-sandbox only
  star_cost INTEGER NOT NULL CHECK (star_cost > 0),
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE reward_requests (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, reward_id TEXT NOT NULL,
  star_cost_snapshot INTEGER NOT NULL,  -- price is frozen at request time
  status TEXT NOT NULL,                 -- requested|approved|declined|fulfilled|expired
  requested_at TEXT NOT NULL, decided_at TEXT, fulfilled_at TEXT,
  ledger_entry_id TEXT,                 -- set ONLY on approval
  parent_note TEXT, updated_at TEXT NOT NULL
);

-- ─── optional chores ─────────────────────────────────────────────────
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, profile_id TEXT,  -- null = any child
  title TEXT NOT NULL, icon_key TEXT NOT NULL,
  star_value INTEGER NOT NULL CHECK (star_value > 0),
  recurrence TEXT NOT NULL,              -- once|daily|weekdays|weekends|custom
  recurrence_days TEXT,                  -- '1,3,5' for custom
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE task_instances (            -- materialised per due date
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, profile_id TEXT NOT NULL,
  due_date TEXT NOT NULL,                -- local calendar date
  status TEXT NOT NULL,                  -- open|awaiting_parent|approved|declined|missed
  marked_at TEXT, decided_at TEXT, ledger_entry_id TEXT, updated_at TEXT NOT NULL,
  UNIQUE (task_id, profile_id, due_date)
);

-- ─── screen time ─────────────────────────────────────────────────────
CREATE TABLE screen_time_rules (
  profile_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  session_limit_minutes INTEGER,         -- null = unlimited
  daily_limit_minutes INTEGER,
  break_minutes INTEGER NOT NULL DEFAULT 15,
  warn_at_minutes TEXT NOT NULL DEFAULT '2,0.5',
  bedtime_start TEXT, bedtime_end TEXT,  -- optional 'HH:mm' quiet hours
  updated_at TEXT NOT NULL
);

CREATE TABLE screen_time_usage (
  profile_id TEXT NOT NULL, local_date TEXT NOT NULL,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TEXT,                   -- crash-safe: written every 10 s
  rest_until TEXT,                       -- cooldown deadline
  PRIMARY KEY (profile_id, local_date)
);

-- ─── entitlements & content ──────────────────────────────────────────
CREATE TABLE entitlement_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tier TEXT NOT NULL DEFAULT 'free',     -- free|premium
  source TEXT,                           -- storekit|promo|sandbox
  product_id TEXT, expires_at TEXT, in_grace_until TEXT,
  last_verified_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE content_packs (             -- bundled in MVP; downloadable later
  id TEXT PRIMARY KEY, kind TEXT NOT NULL,   -- theme|game_assets
  content_version INTEGER NOT NULL, source TEXT NOT NULL, -- bundled|downloaded
  installed_at TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 TEXT, last_used_at TEXT, updated_at TEXT NOT NULL
);

-- ─── local-only telemetry (never transmitted in MVP) ─────────────────
CREATE TABLE telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, props TEXT, created_at TEXT NOT NULL
);  -- ring-buffered: trimmed to the most recent 5 000 rows on each launch
```

## 3. Integrity guarantees

| Risk | Mitigation |
| --- | --- |
| Double-awarded stars (retry, crash, double-tap) | `idempotency_key UNIQUE`. Key = `play:<playId>:round:<n>`. A retry is a no-op. |
| Redeem approved twice | Approval is one transaction: check status → insert ledger row → update request, guarded by `WHERE status='requested'`. |
| Negative balance | The debit transaction re-reads `star_balances` and aborts if `balance < cost`. Enforced in SQL, not in the UI. |
| Corrupt database | `PRAGMA integrity_check` on launch; on failure, restore the most recent nightly snapshot and tell the parent plainly what was lost. |
| Losing everything with the phone | Manual **Export/Import backup** (a single signed JSON file the parent shares to Files/iCloud Drive/email) + `NSFileProtectionCompleteUntilFirstUserAuthentication` and iCloud device backup left ON for the DB. No account required. |
| Clock tampering / travel | Daily counters key on **local calendar date**; deltas clamped (doc 10). A backwards clock jump never grants stars. |
| Migration failure | Every migration is tested from *every* prior version with a seeded fixture DB; failure restores the pre-migration snapshot and the app boots read-only rather than empty. |

## 4. Migrations

- Drift's `MigrationStrategy` with an explicit numbered step per version.
- `test/migration/` holds a fixture database for every shipped schema version;
  CI migrates each to `HEAD` and asserts row counts and balances are preserved.
  This test is non-negotiable — it is the only thing standing between an update
  and a family losing 4 000 stars.
- Before any migration runs, the DB file is copied to `db.premigration.bak`.
- Destructive changes are forbidden. Columns are added and deprecated, never
  dropped, until a major version does a supervised rebuild.

## 5. What is deliberately *not* stored

birthdate · full name · photos from the camera roll (parent reward images are
copied into the app sandbox and never read back out) · contacts · location ·
IDFA/IDFV · any device identifier · any server-side record of anything · free-text
the child can type (there is no keyboard in the child shell at all).
