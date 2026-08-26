# 21 — Critical Review of the Brief

You asked me to challenge requirements that create unnecessary complexity, poor
UX, child-safety problems, App Store problems, excessive cost, or technical debt.
Here is that list, ordered by how much I think it matters. Points 1–4 I feel
strongly about; 5–10 are judgement calls where I'd defer if you disagree.

---

## 1. Unity is the wrong tool given your own constraint #1 🔴

Covered fully in [doc 01](01-tech-stack-decision.md). The short version: you
ranked "Claude can produce and maintain as much of the codebase as possible"
first, and Unity structurally prevents that, because half a Unity project is
GUI-authored binary-ish YAML and none of it can be compiled or tested in the
environment Claude works in. You would be the build verification step for every
change, forever, which is precisely what you said you wanted to avoid.

**Recommendation:** Flutter + Flame. **Reverse me if:** you want real 3D/physics
as a pillar, you plan to hire a game studio, or you're licensing Unity-only IP.

## 2. "Ages 2–8" is two products wearing one coat 🔴

A 2-year-old cannot reliably drag, has no object permanence for a memory game
beyond 2×2, taps randomly, and needs an adult nearby. An 8-year-old reads
fluently, wants difficulty, and will be visibly embarrassed by an interface built
for a toddler. Serving both well means two navigation models, two art registers
and two content strategies — and the usual result of trying is a product that
delights neither.

**Recommendation:** design centre **3–6**. Serve 2-year-olds with a "Tiny" mode
(2 tiles, huge targets, no sub-menus) that costs little because difficulty is
already injected. Serve 7–8 with the top difficulty band only, and don't build
features for them. Market to parents of 3–6-year-olds; the older sibling is a
bonus, not a target.

**Consequence if you disagree:** you'll spend Phase 3–4 building two of everything
and the home screen will be a compromise.

## 3. Your star economy currently fights your core promise 🔴

Stars are earned by playing. Rewards cost stars. Therefore: **more screen time =
more ice cream.** You are simultaneously selling parents a tool to *limit* screen
time and teaching their child to lobby for more of it. A seven-year-old will find
this optimisation within a week.

**Recommendation:** cap play-earned stars at ~30/day (doc 09 §4). Chores and
parent grants are uncapped. The child learns that *the fastest path to the reward
is doing something in the real world*, which is a genuinely better product and a
much better line on your App Store page than anything else in the brief.

This isn't tuning. It's the difference between a thoughtful product and a
well-intentioned one that backfires.

## 4. $0.99–$1.99/month will hurt you 🔴

Detailed in [doc 08 §5](08-entitlements-and-monetization.md). Four problems:
it's far below what parents already pay in this category; a suspiciously cheap
kids' subscription signals "ad-supported or data-harvesting" to exactly the
cautious parent you're targeting; after Apple's cut it doesn't fund the content
treadmill that drives retention; and **you can lower a price but not raise one**.

**Recommendation:** $4.99/mo, $29.99/yr, 7-day trial, annual pre-selected. Test
downward later with App Store price experiments. Also: **drop lifetime at launch**
— it caps your best customers at ~2 years of revenue while obligating you to serve
them forever.

## 5. Screen-time controls must never be premium 🟠

The brief lists "advanced Parent Hub" under Premium. If any interpretation of that
puts session limits behind a paywall, don't. Charging a parent to limit their
child's screen time is the story a journalist writes, it contradicts the product
promise, and it converts badly anyway (a parent who can't limit time uninstalls
rather than subscribes). Sell **content**; give away **control**.

## 6. "WATCH" is not an adjacent module. It's a different company 🟠

Adding curated video means: licensing or producing content, a CDN and bandwidth
bill that scales with usage, encoding pipelines, offline download management,
storage on the device, a content-moderation posture, and a much harder App Review
under the Kids Category. It also breaks the two best things about the current
architecture — zero network and zero data collection.

**Recommendation:** keep the *navigation seam* (a tab bar that could grow), which
costs nothing, and treat WATCH as a separate strategic decision requiring its own
business case. Do not let it influence a single MVP decision. Of the four future
modules, **CREATE** (colouring, stickers, simple music) is far cheaper and fits
the existing architecture almost perfectly — it's a game module. If you want a
second pillar, build that one.

## 7. Chores are the riskiest feature in the brief 🟠

Highest complexity (recurrence rules, materialisation, approval queues, per-child
assignment, timezone edge cases), highest ongoing parent effort, and least
validated demand. The families who want a chore chart mostly already have one on
the fridge, and the ones who don't won't start because a game app asked them to.

**Recommendation:** build the schema in Phase 5 (a few hours), ship the feature in
v1.1, and let the first hundred subscribers tell you whether they want it. If
Reward Store usage is low, chores are dead and you saved four weeks.

## 8. 8–10 launch games is the wrong content ratio 🟡

You already had the key insight — themes multiply content cheaply — but the launch
plan doesn't apply it. A game costs ~10× a theme and adds one activity; a theme
costs ~1× and re-skins every game. **3 games × 6 themes = 18 perceived
experiences** for roughly the cost of 4 games and 1 theme.

**Recommendation:** launch with 3 games and 3 themes (the pipeline needs proving),
then add **one theme per release and one game per two releases**. That cadence
looks like an actively-developed platform to a subscriber, at a fraction of the cost.

## 9. "No frustrating failure states" needs a concrete definition 🟡

Taken literally it produces a game with no challenge, which bores a 6-year-old
within a day — and boredom churns subscriptions just as effectively as frustration.

**Recommendation:** the explicit rule is *the child always eventually succeeds,
with escalating help* — the five-level hint ladder in [doc 04 §5](04-game-module-api.md),
ending in the game solving itself and celebrating anyway. Difficulty adapts
upward freely and downward only between sessions, never visibly. That gives a
7-year-old real challenge and a 3-year-old guaranteed success from the same code.

## 10. Two smaller things 🟡

**A maths parental gate is too weak for an 8-year-old audience.** Use a sustained
gesture plus Face ID (doc 07 §2). It's easier for the parent *and* harder for the
child — a rare win on both axes.

**"Offline-first with no accounts" means losing the phone loses everything.**
A child who has collected 4 000 stars and every sticker will be genuinely upset,
and the parent will blame you. Fix it cheaply: a one-file backup export/import
plus leaving the database in iCloud device backup (doc 06 §3). No account, no
server, no privacy cost.

---

## What I think is right in the brief and want to reinforce

- **Themes as first-class, decoupled from mechanics.** This is the strongest idea
  in the document and the whole architecture is built to exploit it.
- **Parent-defined real-world rewards.** Genuinely differentiated, and it converts
  screen time into a parenting tool rather than a guilty pleasure. It's why a
  parent stays subscribed.
- **Offline-first.** Correct, and it turns out to also be the cheapest, safest and
  most compliant option.
- **No ads, no loot boxes, no leaderboards, no social.** Correct on every axis:
  ethics, compliance, engineering cost, and marketing.
- **Modular game plug-ins.** Correct, and the only way a solo operator ships a
  platform rather than an app.
- **"3 excellent games, not 10 mediocre ones."** Exactly right, and the hardest
  discipline to keep. Hold that line in Phase 4 when it's tempting to add a fourth.
