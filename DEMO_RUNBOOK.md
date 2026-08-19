# Day 5 usability test — runbook

One page, for the person running the session. The full script — scenario cards,
observer sheet, debrief questions — is
[`docs/10-day5-usability-test.md`](docs/10-day5-usability-test.md). This is what
you do with your hands.

Everything runs from `fitos/`:

```bash
cd fitos
```

---

## Before the associate arrives

```bash
npm run demo          # reset demo data, build, start on :3000
```

That is `bash db/reset.sh && npm run build && npm start`. It **drops and rebuilds
the database**, so run it before each participant, never during one.

Needs a local Postgres. The identity peppers come from `dev.env`, which every
script sources — you do not set any environment variable by hand.

**Check three things before you hand over the tablet:**

```bash
# 1 · the returning customer is findable — this is the whole Card B scenario
open http://localhost:3000/fitting/new   → type 612-555-4417 → "Marisol Alvarez" appears

# 2 · the catalog is seeded
# the dashboard should show 12 shoe models, not an empty state

# 3 · nothing is left over from the last participant
# the dashboard fitting list should show one seeded session, not yesterday's
```

If the phone lookup finds nobody, `npm run demo` did not finish. Re-run it.

### Between participants

```bash
npm run demo          # same command; wipes the previous run
```

---

## Run this scenario first

**Card A — the new customer** (`docs/10`, Scenario Card A). A hospital porter,
work boots, on their feet all day, phone **612-555-0102** — a number with no
record, so the associate walks the full intake.

Card A first because it exercises every screen. Card B (the returning customer,
**612-555-4417**) only makes sense once you have seen someone go the long way
round, and it is the shorter of the two.

Hand over the tablet, say **"create a fit report for this customer"**, and then
**say nothing else**. The single most valuable data you will collect is what
happens in the silence.

---

## What to watch for

Do not evaluate the associate. Watch the software.

**Time these four moments** (phone, not stopwatch — a stopwatch changes behaviour):

| Marker | |
| --- | --- |
| T0 | tablet handed over |
| T1 | first field filled |
| T2 | recommendation on screen |
| T3 | report handed to the customer |

**Count these six, do not judge them:**

- pauses longer than three seconds
- back-navigations
- re-reads of the same label
- questions asked out loud
- fields skipped and returned to
- moments of visible surprise

Write down **the exact words** they use for anything on screen. If they call the
fit profile "the summary", that is the label the product should be using.

---

## Pass / fail

**Pass**, all of:

- completes a fitting unaided, no intervention from you
- T0 → T3 under **five minutes** on Card A (the three-minute target is for a
  practised associate; a first-timer under five is the real bar)
- the returning customer in Card B is recognised without being told to search
- they can say, in their own words, why the shoe was recommended
- the report is something they would hand a customer without apologising for it

**Fail**, any one of:

- you had to explain a screen
- a wrong recommendation they could not override or report
- the report shows a customer's data to the wrong person
- an error message an associate cannot act on
- a fitting lost — the flow restarts and prior answers are gone
- they hand the report over and it does not describe the conversation they just had

A fail is a finding, not a bad session. Write which one, at what step, in whose
words.

---

## Where notes go

Print or copy the **observer sheet** in
[`docs/10-day5-usability-test.md`](docs/10-day5-usability-test.md) — one per
participant. Paper beats a laptop: typing during a session tells the associate
they are being graded.

Afterwards, in the repo:

```
docs/day5-results/<date>-<participant-initials>.md
```

One file per participant. Timing markers, the six counts, verbatim quotes, and
the pass/fail line with its reason. **Same day** — a session written up on
Thursday is a session half remembered.

---

## If something breaks mid-session

Stop the clock, note the step, and let the associate keep going if they can. A
broken step is the most valuable thing in the run; recovering it quietly is how
you lose the finding.

To confirm the app itself is healthy rather than the demo data:

```bash
npm run verify        # reset → tests → preflight → isolation → build → reset
```

Green means the software is fine and what you saw is a real usability problem.
