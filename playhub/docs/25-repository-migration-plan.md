# 25 — Repository Migration Plan

> **Status:** ⏸ **PLAN ONLY — awaiting your approval before anything runs.**
> No repository has been created, nothing has been deleted, and SG-Build is
> untouched beyond the one advisory line already in its README.

---

## 1. The finding that simplifies this

I checked the actual coupling before designing the migration:

```
$ git log --oneline -- playhub
900741c  Architecture package for the children's entertainment platform     ← 1 commit

$ grep -rn "playhub" --exclude-dir=playhub --exclude-dir=.git .
./README.md:10:  > Note: playhub/ is an unrelated product …                 ← 1 line
```

**The entire coupling is one commit and one README line.** There is no shared
code, no shared build, no shared dependency, no shared CI, no shared secret.

Therefore: **do not use `git subtree split`.** It exists to rescue history that is
worth rescuing; here it would faithfully preserve a single documentation commit
while carrying across a repository identity that has nothing to do with this
product. Your own instruction applies directly — *clean separation is more
important than retaining irrelevant history*. We start the new repository with a
clean root commit and a `PROVENANCE.md` recording where the documents came from,
which is more honest and more useful than a one-commit graft.

If a later phase ever *does* accumulate meaningful history inside `SG-Build`
before extraction, §7 has the subtree-split variant. It should not be needed.

## 2. Target repository

| Property | Value |
| --- | --- |
| Name | `<brand>-app`, decided with [doc 26](26-naming-candidates.md). Interim: `playhub-app` |
| Owner | `derronamrein93-dev` initially; **transfer to the business entity's GitHub org** once it exists ([doc 24](24-apple-account-and-identifiers.md)) |
| Visibility | **Private** |
| Default branch | `main` |
| License | none (proprietary) — `LICENSE` intentionally absent, `UNLICENSED` in pubspec |

## 3. Independence matrix — what must be separate, and where it lands

| Concern | New repo location | Shared with SG-Build? |
| --- | --- | --- |
| Repository | its own | ❌ never |
| CI / CD | `.github/workflows/ci.yaml`, `release.yaml` | ❌ own runners, own minute budget (this one needs **paid macOS minutes**; SG-Build must not fund or be charged for them) |
| Secrets | repo-level GitHub Actions secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD`, `MATCH_GIT_URL` | ❌ **critical** — App Store Connect keys must never sit in a repo scoped to another product |
| Environment config | `.env.example`, `ios/Config/*.xcconfig`, `--dart-define` files | ❌ |
| Bundle / application ID | `ios/Config/App.xcconfig` (provisional `dev.provisional.playhub`) | ❌ |
| Signing | its own `fastlane match` certificates repo | ❌ separate certificate store entirely |
| Analytics config | none to share — this product ships **no analytics SDK** ([doc 13](13-privacy-and-child-safety.md)). `core_analytics` holds a local-only sink | ❌ |
| Subscription config | `StoreProductCatalog`, its own App Store Connect app record and subscription group | ❌ |
| App Store config | its own app record, age band, privacy answers, metadata | ❌ |
| Documentation | `docs/` moves wholesale | ❌ |
| Issue tracker / project board | new repo's own | ❌ |

Nothing is shared. There is no "common" package, and there should never be one.

## 4. The exact migration — commands, in order

Everything up to step D is **additive and reversible**. The only destructive step
is E, it happens last, and it is a reviewable pull request rather than a push.

### Step A — create the empty private repository *(needs your go-ahead)*

I would call `mcp__github__create_repository` with:

```
name:        playhub-app          (or the chosen brand name)
description: Modular mobile entertainment platform for children
private:     true
autoInit:    false
```

Then `add_repo` to bring it into this session's scope.
**Manual alternative if you'd rather do it yourself:** GitHub → New repository →
Private → do **not** initialise with README/`.gitignore`/licence.

### Step B — seed it from the current subtree *(non-destructive)*

```bash
# a clean working copy, no SG-Build git history attached
mkdir -p /tmp/playhub-seed
cp -a /home/user/SG-Build/playhub/. /tmp/playhub-seed/
cd /tmp/playhub-seed

git init -b main
git add -A
git commit -m "Initial commit: architecture package and Phase 0 foundation"
git remote add origin https://github.com/<owner>/playhub-app.git
git push -u origin main
```

### Step C — verify the new repository stands alone

```bash
cd /tmp && rm -rf verify && git clone https://github.com/<owner>/playhub-app.git verify
cd verify
grep -rn "stride\|kicks\|fitos" . --exclude-dir=.git ; # expect: no matches
flutter test                                            # expect: all green
dart run tools/check_boundaries.dart                    # expect: OK
```

The verification gate is: **the clone builds and tests green with zero references
to Stride Guide.** Step D does not proceed until that passes.

### Step D — re-point this session's work

All further Playhub commits go to the new repository. The branch
`claude/kids-platform-architecture-xgizke` in `SG-Build` is left exactly as it is,
as a record.

### Step E — remove `playhub/` from SG-Build *(the only destructive step)*

Delivered as a **pull request against SG-Build's default branch**, not a direct
push, so you review and merge it yourself:

```bash
cd /home/user/SG-Build
git checkout -b chore/extract-playhub origin/<default-branch>
git rm -r --cached playhub && rm -rf playhub
# revert the advisory note in README.md added on 2026-08-25
git commit -m "Remove playhub subtree: extracted to its own repository

The children's platform architecture package has moved to <new repo URL>.
It shared no code with Stride Guide; this removes the parked subtree and the
advisory note in the README. No Stride Guide files are otherwise touched."
git push -u origin chore/extract-playhub
```

The diff touches exactly: `playhub/**` (deleted) and 4 lines of `README.md`.
Nothing under `assets/`, `docs/`, `fitos/`, `index.html` or any migration is
modified. `git diff --stat` is printed for your review **before** the PR opens.

### Step F — rollback, if anything is wrong

| Failure | Recovery |
| --- | --- |
| New repo is wrong / misnamed | Delete it. Nothing else has changed |
| Content missing after seeding | It is still in `SG-Build` — step E has not run |
| Step E merged and regretted | `git revert` the merge commit; `playhub/` returns intact |
| Both repos lost | The branch `claude/kids-platform-architecture-xgizke` on GitHub still holds everything |

Because E is last and is a PR, there is no window in which the work exists in
neither place.

## 5. What I will **not** do to SG-Build

- No changes to `index.html`, `assets/`, `robots.txt`, `sitemap.xml`
- No changes to `fitos/` — no migrations, no SQL, no schema, nothing
- No changes to `docs/` (the Stride Guide blueprint)
- No history rewrite, no force-push, no branch deletion
- No direct commit to its default branch — extraction arrives as a reviewable PR

## 6. Order of operations relative to Phase 0

Migration does **not** block Phase 0. The scaffold is being built inside
`playhub/` now, and it moves wholesale with a `cp -a`. The sensible order:

```
Phase 0 scaffold  →  you approve this plan  →  steps A–D  →  Phase 1 in the new repo
                                                    ↓
                                     step E, whenever convenient
```

Doing the extraction *after* the scaffold means the new repository's first commit
is a complete, tested, CI-green project rather than a folder of markdown.

## 7. Variant: preserving history, if you'd rather

Only worth it if `playhub/` accumulates commits worth keeping before extraction.

```bash
cd /home/user/SG-Build
git subtree split --prefix=playhub -b playhub-extract      # rewrites paths to root
cd /tmp && git clone --single-branch --branch playhub-extract \
    /home/user/SG-Build playhub-hist
cd playhub-hist && git checkout -b main && git branch -D playhub-extract
git remote set-url origin https://github.com/<owner>/playhub-app.git
git push -u origin main
```

Caveat: this also carries the SG-Build commit-author metadata and any commit
messages that mention Stride Guide, which is exactly the "irrelevant history" you
said matters less than clean separation.

---

## ✋ Approval requested

Reply with **"run the migration"** and I will execute steps A–D, print the
verification output, and prepare step E as a PR for you to review. Nothing runs
before that.
