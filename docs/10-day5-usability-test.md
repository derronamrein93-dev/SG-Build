# 10 · Day 5 — Associate Usability Test

**Purpose:** find out whether a real footwear associate can complete a fitting
with no coaching. Not a demo. Not a feature review. One question:

> Can someone who has never seen this software fit a customer with it, without
> being told what to do?

**Rule for the observer: say nothing.** The urge to help is the single biggest
threat to the value of this session. Every time you explain something, you erase
the finding you came for.

---

## 1. Setup — 15 minutes before the associate arrives

| Item | Detail |
| --- | --- |
| Device | The actual tablet, landscape, on the store's Wi-Fi. Not your laptop. |
| Data | `bash db/reset.sh` — fresh seed, one returning customer on file |
| App | Open the dashboard. Nothing else in the browser. No tabs open to the code |
| Printer | If the store has one the tablet can reach, connect it now |
| Recording | Screen recording on. Audio if they consent, notes otherwise |
| Timer | Ready but not visible to the associate |
| You | Out of arm's reach. Sitting, not hovering |

**Before they arrive, decide who is playing the customer.** A second staff
member is better than you: an associate performs differently for a colleague
than for the person who built the software. Give the customer-player the
scenario card and let them answer in their own words.

**What you do not do:** open the app for them, log in for them, describe the
screens, say "so what you'd do here is…", or apologise for anything.

## 2. What you say, once, then stop

> "This is a fitting tool we're testing. Please fit [name] the way you normally
> would, using this instead of paper. I'm going to sit here and take notes and
> I won't be able to answer questions — if you get stuck, do whatever you'd
> naturally do. There's nothing you can break, and if something is confusing
> that's a problem with the software, not with you."

Then stop talking. If they ask a question, the answer is *"What would you do if
I weren't here?"* — every time, warmly, without adding anything.

## 3. Scenario cards

Run **two** fittings: one new customer, one returning. The second is where the
product's actual claim lives, and it takes a third of the time.

### Card A — new customer, work boots

> You're a hospital porter. You're on your feet the whole shift, twelve hours,
> mostly on hard floors. Your heels ache by the end of the day and your current
> boots feel tight across the front of your foot. You want something comfortable
> and hard-wearing; you don't care what it looks like. If asked, your phone
> number is **612-555-0102**. You've never shopped here before.

### Card B — returning customer, running shoes

> You were fitted here a couple of months ago. You run four or five times a
> week. Lately your right knee has been bothering you after longer runs, and
> the outside of your old shoes is worn unevenly. Your phone number is
> **612-555-4417**. If asked whether anything has changed since last time, say
> the knee thing is new.

*(Card B's number is the seeded customer, so the returning-customer path fires.)*

## 4. Observer sheet

One row per fitting. Write what happened, not what you think it means.

| Timestamp | Screen | What they did | What they said | Hesitation? |
| --- | --- | --- | --- | --- |
| | | | | |

**Time these four things** — from the recording afterwards, not live:

| Marker | Target |
| --- | --- |
| Tap of "New Fitting" → customer identified | ≤ 0:25 (new) · ≤ 0:10 (returning) |
| Customer identified → assessment complete | ≤ 1:45 |
| Assessment complete → recommendation on screen | ≤ 0:05 |
| Total, first tap → report created | **≤ 3:00** |

**Count these, every occurrence:**

- Times they paused more than three seconds without touching the screen
- Times they went back a step
- Times they asked you a question
- Times they narrated confusion out loud ("wait, is this…")
- Times they picked a chip and immediately unpicked it
- Times they looked at you instead of the tablet

**Write down verbatim** anything they say while looking at the recommendation
screen, and anything the *customer-player* says when handed the report. Those
two moments are the product.

## 5. Success criteria

The session passes if **all** of these are true:

- [ ] Both fittings completed without you speaking after the intro
- [ ] Median total time under 3:00
- [ ] The associate never asked what a screen was for
- [ ] The recommendation was read aloud to the customer, or paraphrased, without prompting
- [ ] The associate agreed with the recommendation, or overrode it deliberately and said why
- [ ] The customer-player said something unprompted about the report
- [ ] The associate said some version of "I'd use this" without being asked

The last two are worth more than the timings. A three-minute fitting nobody
values is a failed test.

## 6. Failure conditions — stop and fix before the next session

Any one of these ends the test early:

| Condition | What it means |
| --- | --- |
| Associate cannot complete a fitting unaided | The flow is wrong, not the training |
| They ask you a question in the first 60 seconds | The first screen does not explain itself |
| Total time exceeds 5:00 | Cut fields from the assessment, not from the report |
| They abandon and reach for paper | Fundamental, and the most valuable finding you can get |
| The recommendation is one they'd argue with | Rule problem — capture the full input state via pilot feedback |
| Anything on screen or in the report reads as medical advice | Stop everything. Highest-severity failure in the product |
| The customer-player looks uncomfortable at any point | Find out exactly which moment, and why |

**Not** failure conditions: a typo, a colour they dislike, a wish for a feature,
slow page loads on store Wi-Fi. Note them and move on.

## 7. Debrief questions — after both fittings, in this order

Ask open questions first, and let silences run. The first answer is politeness;
the second is information.

1. Walk me through what just happened, as if I hadn't been here.
2. What did you expect to happen that didn't?
3. Was there a moment you weren't sure what to do?
4. What would you have done differently on paper?
5. What would your colleagues say about this on a Saturday?
6. If the recommendation had disagreed with you, what would you have done?
7. What would you tell the customer this is, in your own words?
8. What is missing that you would need before using this with a real customer?
9. If I took this away tomorrow, what would you miss — if anything?
10. What would make you stop using it after a week?

**Question 9 is the important one.** If the answer is "nothing," the product
does not yet earn its place on the floor, regardless of how the timings looked.

Then, for the customer-player:

1. What did you think when you were handed that?
2. Was there anything in it you didn't understand?
3. Did any of it feel like it was about your health rather than your shoes?
4. Would you keep it?

## 8. What to do with the results, same day

1. Fix the top drop-off point before the next session — one fix, not a list.
2. Any recommendation the associate disagreed with goes into the rule review
   with its full input state, as a golden test case.
3. Any language the customer-player found unclear gets rewritten in the report
   language layer, not explained away.
4. Log the timings. They are the baseline every later change is measured against.

**Run this with at least three associates before any external demo.** One
associate tells you about one person; three start telling you about the product.

---

**Back to:** [Blueprint index](README.md)
