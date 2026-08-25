# 10 — Screen Time Implementation Strategy

> **Decision:** foreground-only wall-clock accounting with a 10-second persisted
> heartbeat, dual-source clock validation, and a celebratory session ending.
> **Status:** proposed. **Reversal cost:** low.

---

## 1. What we can and cannot do

We are an ordinary app. We **cannot** lock the device, prevent the child from
switching apps, or use Apple's Screen Time / Family Controls APIs (those require
a Family Controls entitlement and target a different product shape). What we
control is *our own* session, which is what the promise actually needs — and we
point parents to **Guided Access** for true device-level containment (doc 07 §3).

Setting expectations honestly in the Parent Hub — "this limits time in Playhub;
to lock the whole phone, use Guided Access" — is better than implying a
capability we don't have.

## 2. Timing model

```dart
class ScreenTimeGovernor {
  // ticks once per second while foregrounded, persists every 10 s
  void _tick() {
    final wall = _clock.now().difference(_lastWall);
    final mono = _stopwatch.elapsed - _lastMono;
    // take the SMALLER of the two: a forward clock jump cannot burn the
    // session, and a backward jump cannot mint free time.
    final delta = Duration(milliseconds:
        math.max(0, math.min(wall.inMilliseconds, mono.inMilliseconds)));
    if (delta > const Duration(seconds: 5)) return;   // sleep/suspend artefact
    _sessionElapsed += delta; _dailyUsed += delta;
    ...
  }
}
```

Properties this gives us:

| Scenario | Behaviour |
| --- | --- |
| App backgrounded (call, home button) | Timer pauses; time away is not counted |
| Device sleeps mid-game | `Stopwatch` and wall clock diverge; delta clamped, no phantom usage |
| Child changes the device clock forward | Monotonic source wins; no session is cut short |
| Parent's timezone changes mid-flight | Daily bucket keys on **local calendar date**; a change is treated as a new day boundary, never as negative usage |
| App killed mid-session | Last heartbeat (≤ 10 s old) is authoritative on relaunch; at most 10 s of usage is lost |
| Device restarted | Same — heartbeat persists in SQLite |
| Rest period active, app relaunched | `rest_until` is a persisted timestamp; relaunching does not clear it |

## 3. Configuration

Per profile (`screen_time_rules`):

| Setting | Options | Default |
| --- | --- | --- |
| Limits enabled | on / off | **off** |
| Session limit | 10 / 15 / 20 / 30 / 45 / custom minutes | 15 |
| Daily limit | off / 30 / 45 / 60 / 90 / custom | off |
| Break (rest) | 5 / 15 / 30 / 60 min / until parent unlocks | 15 |
| Warnings | at 2 min and 30 s (each toggleable) | both on |
| Quiet hours | optional start/end | off |

Defaults are deliberately permissive: a parent who never opens the Hub gets an
app that just works. Limits are opt-in, and the onboarding surfaces them once
with a single "set a play limit?" card.

## 4. The ending experience — the design that matters most

An abrupt cut-off at minute 15 produces exactly the meltdown the product exists
to prevent. The ending is a **60–90 second choreographed sequence**, and it is
the single most important UX in the app:

```
T-2:00   The guide character yawns once. A soft chime. Nothing blocks play.
         (VO, if enabled: "two more minutes!")
T-0:30   The character starts packing up in the corner. Second soft chime.
T-0:00   ── the current round is NOT interrupted ──
         Grace window: up to 60 s, or the game's `typicalRound`, whichever is
         smaller, to reach the next natural break. Games are asked to
         `requestEndEarly()`, which lets them wrap up gracefully.
Ending   Full-screen celebration owned by the platform, not the game:
           "Great playing!"  ★ ★ ★   (stars earned THIS session, counting up)
           stickers earned appear and fly into the sticker book
           the guide character waves goodbye
Rest     A calm, quiet screen: the character asleep, a gentle scene, no timer
         counting down at the child (a countdown is a source of anxiety and an
         invitation to keep checking). A soft "come back later" and, if a rest
         end time exists, a simple sun/moon illustration of when.
         NOT dismissible by the child. No buttons the child can press.
```

Two hard rules:

1. **Never end mid-round.** Losing progress at the buzzer is the frustration
   state the brief forbids. The grace window is not optional.
2. **The ending is a reward, not a punishment.** The child ends on the biggest
   celebration of the session. Anecdotally this is what converts "five more
   minutes!" into "I got three stars!" — and it is entirely a design choice, free
   to implement.

## 5. Parent override

From the rest screen, the parent gate (hold-corner → Face ID) reveals:

- **Add 10 minutes** — one tap, the common case, logged.
- **End rest now** — clears `rest_until`.
- **Turn off limits for today** — for a long car journey.
- **Open Parent Hub**.

Overrides are recorded in the session log so the Hub can show "you added time 4
times this week", which is information a parent actually wants — presented
neutrally, never judgmentally.

## 6. Daily limit interaction

Session limit and daily limit are independent. Reaching the daily limit produces
the same celebration and a rest that lasts until the next local day (or quiet-hours
end). The daily bucket rolls at local midnight; a session in progress across
midnight continues to completion and is attributed to the day it started.

## 7. Testing

All of this is testable headlessly because every consumer of time takes an
injected `Clock` (doc 02 §5):

- 15-minute limit expires at exactly 900 s of foreground time — fast-forwarded.
- Backgrounding for an hour adds zero usage.
- Clock jumped +6 h mid-session: session does not end early.
- Clock jumped −6 h: no extra time granted, no negative usage.
- Kill at 8 min, relaunch: 8 min (±10 s) restored, not 0.
- Rest survives relaunch, device restart, and a timezone change.
- Round in progress at T-0 completes before the ending sequence starts.
- DST transitions in both directions produce no double-counting.
