# 28 — This Repository Is Public

> **Finding:** `derronamrein93-dev/SG-Build` is a **public** repository. Verified
> just now with an unauthenticated API request: `HTTP 200`, `visibility: public`.
> **Status:** flagged for your decision. Nothing has been removed or hidden.

---

## 1. Why this matters now

You gave me a D-U-N-S Number. Before writing it into a file I checked where that
file would end up, and the answer is: on the open internet.

**I did not commit it.** A D-U-N-S is not confidential — it exists to be handed to
vendors and appears in public registries — but there is no upside to publishing
it beside the entity's address, so it stays in your password manager and, if you
want it in-project at all, in the extracted **private** repository.

That check surfaced the larger issue.

## 2. What is currently public

| Exposed | Assessment |
| --- | --- |
| All 28 architecture documents | Full product strategy, MVP scope, phase plan, effort estimates |
| Pricing analysis | Your $0.99–$1.99 hypothesis, my counter-argument, the target range |
| Monetization plan | Free/premium line, subscription structure |
| **The brand shortlist, including "Kite" as the recommendation** | ⚠️ **The part that actually matters — §3** |
| The Kicks-Stand LLC relationship | That a footwear entity is entering children's software |
| The Phase 0 codebase | Low sensitivity. It's an architecture, not a moat |
| Launch timing | Roughly when a competitor would need to move |

| **Not** exposed | |
| --- | --- |
| Credentials, API keys, signing material | None exist yet, and secrets will be repository-scoped when they do |
| The D-U-N-S Number | Deliberately withheld |
| Customer or child data | None exists; the product collects nothing |
| Kicks-Stand LLC's address | Not written anywhere in this repo |

Stride Guide's own product blueprint has been public in this repo since before I
arrived. That was your call and I am not second-guessing it — but the same
reasoning below applies to it.

## 3. The brand name is the real exposure

Everything else on that list is strategy a competitor would have to *act* on,
slowly. A name is different, because someone else can take it in an afternoon.

US trademark rights come from use in commerce, but that is not the whole story:
anyone can file an **intent-to-use** application on a mark they have not used
yet. A publicly-readable document saying "we recommend Kite, alternates Lantern
and Playgrove, in the children's software category" is a shopping list. Losing a
first-filing race does not automatically lose you the mark, but it buys an
opposition proceeding that costs far more than clearance would have.

**Recommendation:** decide the brand, clear it, and get an application on file
**before** the name is discussed anywhere else public. Until then it stays
provisional, which is already how the codebase treats it.

## 4. Deleting the folder does not unpublish it

Worth being blunt, because it is the assumption that usually goes wrong:

> Removing `playhub/` in a later commit does **not** remove it from a public
> repository. The history remains fetchable, forks and clones persist, and
> third-party mirrors and archives may already have copies.

So the extraction plan in [doc 25](25-repository-migration-plan.md) improves the
*future* — the new repository is private from its first commit — but it does not
retroactively unpublish anything.

If the exposure genuinely concerns you, the only meaningful lever is **making
`SG-Build` private**, which removes public access to its history as well as its
current state. That is a decision about Stride Guide, not about this product, so
it is yours to weigh.

## 5. What I recommend

1. **Approve the extraction** ([doc 25](25-repository-migration-plan.md)). The
   new repository is private from commit one. This is now the more urgent of the
   two reasons to do it.
2. **Decide whether `SG-Build` should stay public.** If Stride Guide's blueprint
   being open is deliberate, fine — just make that a choice rather than a default.
3. **Treat the brand as confidential from here.** Clear it, file it, then talk
   about it.
4. **Keep the D-U-N-S, the LLC address and anything Apple-issued out of any
   public repository**, permanently. When secrets do exist, they are
   repository-scoped GitHub secrets in the private repo and never organization
   -level ([doc 24 §5](24-apple-account-and-identifiers.md)).

None of this blocks engineering. Phase 1 can begin the moment the extraction is
approved.
