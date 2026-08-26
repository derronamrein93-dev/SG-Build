# 26 — Product / Company Name Candidates

> **Status:** proposal, ten options. `playhub` remains the **internal codename**
> either way — it appears in directory and package names only, never in front of
> a user, and the brand is one config value ([doc 20](20-expensive-decisions.md)).
> **I am not anchored on it and don't recommend it as the brand:** "hub" is
> corporate, it says nothing to a child, and it is heavily used.

---

## 1. What the name has to do

| Criterion | The real test |
| --- | --- |
| Parent-friendly | A cautious parent reads it and feels calm, not sold to |
| Kid-friendly, **not** babyish | A six-year-old likes it; an eight-year-old isn't embarrassed by it |
| Expandable past games | *"____ Watch"*, *"____ Create"*, *"____ Learn"* must all sound natural |
| Pronounceable | One obvious pronunciation on sight, in most accents |
| Spellable | A parent can type it into search after hearing it once |
| Icon-viable | Reduces to **one strong glyph at 60 px**, works in light and dark |
| Brandable | Not descriptive-generic; registrable; survives growing up |

The icon test is the one most naming exercises skip and it eliminates a lot: an
abstract or compound name with no object behind it gives a designer nothing.

## 2. The ten

### Top recommendations

**1. Kite** ⭐ *my pick*
Four letters. Universally understood, joyful, and quietly the right metaphor —
a kite is a thing a parent and child do together, outdoors, in the open air. That
is a pointed and flattering counterpoint for a screen product, and it gives the
marketing a spine: *the good kind of screen time*. Icon is unbeatable: a coloured
diamond with a tail, instantly readable at any size, gorgeous on either theme.
Kite Watch / Kite Create / Kite Learn all read as products. Grows up gracefully —
it is not a "kids' word", so it never becomes a ceiling.
*Risk:* moderate. A defunct developer-tools company used it; expect to need a
modified domain.

**2. Lantern**
Warmth, guidance, and safety in one word — the parent-facing promise stated
without saying "safe". Superb icon: a glowing shape that is genuinely beautiful in
dark mode, which almost nothing in this category is. Slightly storybook, never
babyish. Lantern Learn is a natural sub-brand.
*Risk:* moderate; several unrelated apps use it. Two syllables, seven letters — the
longest of my top three.

**3. Playgrove**
A tended grove: many separate things growing in one cared-for place. It is the
architecture, said out loud — modules in a bounded, safe space. Invented compound,
so it is the most likely of the ten to be **clearly registrable and available**,
and it is unambiguous to spell and say.
*Risk:* low. The trade-off is that it works harder than it sings — it explains
rather than evokes, and "play" narrows it slightly if Watch/Learn become central.

### The rest, honestly assessed

**4. Recess** — Conceptually the closest to the product promise of anything here:
a bounded, joyful, sanctioned break. Parents get it instantly; "recess" is a
school-age word, so it is the least babyish option. *Risk:* a beverage brand and a
well-remembered Disney cartoon both own the association. `recess.com` doesn't
currently resolve, which is unusual and worth a real check.

**5. Puddle** — Pure childhood: jumping in puddles is joy without a screen in it.
Short, memorable, delightful splash icon, easy for a five-year-old to say.
*Risk:* low-moderate. The mild downside is the muddy connotation, and it sits at
the younger end.

**6. Marbles** — A bag of many small, beautiful, collectible things — literally a
platform of modules, and it pairs perfectly with the sticker/collection system.
Tactile and nostalgic for parents; glossy spheres make a rich icon.
*Risk:* moderate ("Marbles: The Brain Store"), plus the "losing your marbles"
idiom, which is either charming or off-message depending on the day.

**7. Tadpole** — Growth from tiny to capable, which is exactly what the difficulty
system does. Warm, specific, memorable, a lovely simple icon.
*Risk:* moderate — a childcare-management company uses it. It also skews young and
gets slightly awkward as the child ages out of it.

**8. Sandcastle** — Building, imagination, and time well spent on something
temporary. Rich icon, warm parent associations.
*Risk:* low-moderate. Ten letters is the longest here, and it is a two-beat word
that fights the four-letter simplicity the category rewards.

**9. Zigzag** — Motion and play; a distinctive, energetic wordmark; trivially
spellable and fun to say. Reads as a *path*, which suits progression.
*Risk:* moderate and widely used. It is the most graphic-design-led option — strong
logotype, weaker story.

**10. Lumo** — Light, in three syllables' worth of nothing. Short, invented,
mascot-ready (a small glowing character writes itself), and easy everywhere.
*Risk:* moderate. It sits close to Lumosity in a category adjacent to ours, which
is the kind of neighbour a children's brand doesn't want. Included because the
mascot potential is real, not because I'd choose it.

## 3. Domain reality — I checked

DNS resolution for all ten, both TLDs, just now:

| | `.com` | `.app` | | | `.com` | `.app` |
| --- | --- | --- | --- | --- | --- | --- |
| kite | resolves | resolves | | marbles | resolves | resolves |
| lantern | resolves | resolves | | tadpole | resolves | resolves |
| recess | **no DNS** | resolves | | sandcastle | resolves | resolves |
| playgrove | resolves | resolves | | zigzag | resolves | resolves |
| puddle | resolves | **no DNS** | | lumo | resolves | **no DNS** |

Nine of ten exact-match `.com`s are live. **This is normal and is not a reason to
pick a worse name.** Resolving ≠ registered-and-defended, and it says nothing about
trademark. The modern answer is a modified domain — `heykite.com`, `kite.family`,
`playkite.com`, `getlantern.app` — which is what most consumer brands launched in
the last decade actually use.

**Two different domains, two different jobs** — worth separating clearly, because
it changes what blocks what ([doc 24](24-apple-account-and-identifiers.md)):

| Domain | Job | Blocks |
| --- | --- | --- |
| An **entity** domain (a Kicks-Stand one, or strideguide.co patched to name the LLC) | Apple enrolment: a live, substantive site on a domain associated with the legal entity, plus your work email on it | Enrolment → distribution |
| The **product** domain (`kite…`) | The app's marketing site, privacy policy, and the reverse-DNS **bundle ID** | The first build upload |

So the brand decision **no longer blocks Apple enrolment** — the entity domain
handles that. It blocks the bundle ID, and a bundle ID **cannot be changed once a
build has been uploaded**. That is the real deadline: decide the brand before the
first upload, which lands in Phase 8.

## 4. Before you commit — please do these three things

I have not done any of them and cannot responsibly claim a name is clear:

1. **USPTO TESS search** (and the equivalent where you'll operate) in **Class 9**
   (software) and **Class 41** (entertainment/education services). Both classes
   matter for this product.
2. **App Store search** on the exact word plus "kids" — an existing children's app
   with the name is disqualifying regardless of trademark status.
3. **A trademark attorney** for your final two. A few hundred dollars now versus a
   forced rename after launch, which costs the App Store listing, the reviews, and
   the ranking history.

## 5. My recommendation

**Kite**, with **Lantern** as the alternate and **Playgrove** as the safe harbour
if clearance on both fails.

> **Kite is provisional until clearance completes.** Nothing in the codebase
> assumes it: the codename stays `playhub`, the bundle ID stays
> `dev.provisional.playhub`, and the release lane refuses to upload while it does.
> A test fails the build if a brand literal appears outside `BrandConfig`.

Kite wins on the criterion that is hardest to fix later: it is a name the product
can grow into rather than out of. A ten-year-old is not embarrassed to have Kite
on their tablet, an eight-year-old's parent isn't embarrassed to recommend it, and
if the product ever becomes Watch/Create/Learn as well as Games, nothing in the
name has to change.

None of this blocks engineering. The codename stays `playhub` until you decide,
and switching costs about an hour ([doc 20](20-expensive-decisions.md)).
