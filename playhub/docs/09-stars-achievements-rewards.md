# 09 — Stars, Achievements, Collectibles & Parent Rewards

> **Decision:** one append-only ledger, capped daily play earnings, and
> parent approval as an explicit two-phase commit.
> **Status:** proposed. **Reversal cost:** HIGH — the ledger shape and the earn
> rates set family expectations that cannot be quietly changed.

---

## 1. The progression loop

```
PLAY ─► round completed ─► platform validates & caps ─► STARS (ledger entry)
                     └──► achievement progress ─► unlock ─► bonus STARS + badge
                     └──► collectible drop ─────► sticker book
                                                        │
STARS ──────────────────────────────────────────────────┴──► reward request
                                                                 │
                                          parent approves in Hub ─┘ (stars deducted here)
```

Every arrow is a row in `star_ledger` or `achievement_progress`. There is no
in-memory score that can be lost.

## 2. Earn rates (initial; tunable via a single constants file)

| Event | Stars | Notes |
| --- | --- | --- |
| Round completed | 1–3 | 1 base, +1 for low hint use, +1 for a full clean round |
| Game session completed (3 rounds) | +2 | encourages finishing, not grinding |
| Achievement unlocked | 5–25 | by tier: bronze 5, silver 10, gold 25 |
| Daily first-play bonus | 3 | once per local day, per profile |
| Task approved by parent | parent-defined (5–20) | premium feature |
| Parent manual grant | any | for offline good behaviour |

Rough calibration: a child playing ~15 minutes earns **10–15 stars**. A 100-star
ice cream trip is therefore roughly a week of ordinary play, or two or three
chores plus play. That ratio matters — too fast and rewards become meaningless;
too slow and the child disengages. It is a launch hypothesis to be tuned against
real families, and it lives in one file so tuning is a one-line change.

## 3. Achievements (MVP set of 14)

| Category | Achievement | Trigger |
| --- | --- | --- |
| First steps | First Puzzle · First Match · First Day | one-time |
| Volume | 5 Games Completed · 10 Puzzles Solved · 25 Rounds | cumulative counters |
| Mastery | Matching Master · Maze-free Jigsaw Ace · Clean Sweep (a round with zero misses) | per-game |
| Theme | Dinosaur Explorer · Farm Helper · Ocean Friend | play N rounds in that theme |
| Collection | Sticker Starter (8) · Sticker Collector (24) | collectible counts |

Rules:
- **No time-based or streak-based achievements.** "Play 7 days in a row" is a
  retention dark pattern aimed at a five-year-old; it manufactures anxiety and
  pressures parents to hand over a device on a day they'd rather not. Explicitly
  excluded from this product.
- **No negative achievements**, no "you missed it", no expiry.
- Achievement definitions are **data** (`assets/core/achievements.json`), so new
  ones ship with a content update; only genuinely new *trigger types* need code.
- Progress is visible and always increasing. Nothing ever regresses.

## 4. The daily earn cap — a correctness requirement, not a tuning knob

**Problem:** the brief's reward economy pays stars for playing, while the product's
core promise is a *bounded* 15 minutes. Uncapped, the two fight: the child learns
that more screen time buys the ice cream, and starts negotiating for more screen
time. That is the opposite of what a parent is buying.

**Fix:** `star_daily_counters` caps stars from `source = 'play'` at **30 per
local day per profile**. Above the cap, play still produces celebration, stickers,
and achievement progress — it just stops minting currency. The child never sees a
"cap reached" message; the stars simply aren't the point of minute sixteen.

Chores and parent grants are **not** capped. The result is a system where the
fastest route to a reward is doing something in the real world, and screen time
alone gets you there slowly. That is a genuinely better product and a much better
story to tell parents.

## 5. Collectibles

Stickers (8 per theme), badges (achievements), and trophies (milestones), shown in
a **sticker book** the child can arrange. Rules: every collectible is earned, none
is purchasable, none is random-drop-with-duplicates (no gacha, no "you got a
duplicate" disappointment). A theme's Nth sticker unlocks at a known round count,
so progress is legible to a child who cannot read: the book shows empty outlined
slots that fill in.

Room decorations and character accessories are architecturally the same entity
(`collectibles.kind`) and are a post-MVP surface.

## 6. Parent Reward Store — two-phase commit

The single most important behaviour in this feature: **stars are debited on
parental approval, never on the child's request.**

```
CHILD                          SYSTEM                         PARENT
browse rewards  ───────────►  balance ≥ cost?
tap "ask"       ───────────►  INSERT reward_requests
                              status='requested'
                              star_cost_snapshot = cost      ◄── badge in Hub
"asked a grown-up!" ◄────────  (no stars moved)                  + local notification
                                                             reviews request
                                                    ◄──────── approve / decline
                              ONE TRANSACTION:
                                re-check balance ≥ snapshot
                                INSERT star_ledger(-cost, idem=req:<id>)
                                UPDATE request → approved
                              ◄── if balance now insufficient: decline with a
                                  parent-facing explanation, no stars moved
child sees "Yes! 🍦"  ◄────────
                                                             later: mark fulfilled
```

Design details that matter:

- **Price is frozen at request time** (`star_cost_snapshot`). A parent editing the
  reward's cost while a request is pending must not change what the child asked for.
- **Decline is never harsh.** The child sees "not right now" with a warm animation,
  keeps every star, and the reward stays in the list. Parents get an optional
  one-line note field.
- **Pending requests are impossible to miss:** a Hub badge, the top card of the
  dashboard, and (with permission) one local notification. Silent, forgotten
  requests are the failure mode that would destroy trust in this feature — a child
  who asks and hears nothing learns the app lies.
- **Requests expire after 14 days** into `expired`, with no star movement, so an
  abandoned request doesn't haunt the list forever.
- **Reward images**: a parent may attach a photo; it is copied into the app
  sandbox, downscaled to ≤ 512 px, stripped of EXIF, and never leaves the device.
- **Star adjustments by parents are ledger entries** (`parent_adjust`) with a note,
  so the history always explains the balance — including "Mum added 20 for helping
  Grandma".

## 7. Chore / task system (post-MVP, architecture now)

Same two-phase commit: the child marks a task done → `awaiting_parent` → approval
mints stars with `idempotency_key = 'task:<instanceId>'`.

- Recurrence materialises `task_instances` lazily for today and tomorrow only —
  no infinite calendar expansion, no background scheduling, no notifications to
  the child.
- Missed days are simply `missed`; there is no punishment, no streak, no guilt.
- The whole module is behind `app_settings.tasks_enabled`, **off by default**, and
  when off it does not appear anywhere in either shell. A parent who wants only
  games never sees the word "chore".

## 8. Anti-patterns explicitly excluded

no leaderboards · no comparisons to other children · no daily streaks · no timed
events · no limited-time offers shown to a child · no purchasable currency · no
loot boxes or random rewards with duplicates · no energy/lives system · no "your
friends are playing" · no push notifications to re-engage a child · no
"you'll lose your stars if…" · nothing that expires.
