# 18 — What I Automate vs What You Must Do

> **Status:** proposed. Your total unavoidable manual work is roughly **6 hours,
> once**, plus ~1 hour per release and the art commissioning.

---

## 1. Fully automated (I write it; you review and approve)

All Dart and Swift/Kotlin glue · all tests · CI and release workflows · fastlane
lanes · the seven `tools/` scripts · Drift schema and every migration ·
placeholder art and audio generation · ThemePack manifests and validation ·
localisation files · privacy-policy and store-listing **drafts** · release notes
and changelogs · screenshot generation via integration tests · Xcode project
settings that can be expressed in files (`Info.plist`, entitlements,
`PrivacyInfo.xcprivacy`, build settings via `xcconfig`) · version and build-number
bumping · size and performance reporting · this documentation.

## 2. What only you can do

Each item below is: **where · exactly what · expected result · how to verify.**

### 2.1 Apple Developer Program — *~30 min + up to 48 h waiting* — **blocks everything**
1. **Open:** <https://developer.apple.com/programs/enroll/>
2. **Do:** enrol as an Individual (fastest) or Organization (needs a D-U-N-S
   number and 1–2 extra weeks — decide now, because moving an app between
   accounts later is painful). Pay $99/yr.
3. **Expect:** an approval email; <https://developer.apple.com/account> shows
   Certificates, Identifiers & Profiles.
4. **Verify:** "Certificates, IDs & Profiles" is visible in the sidebar.

### 2.2 Choose the bundle ID — *~10 min* — **effectively permanent**
1. **Open:** <https://developer.apple.com/account/resources/identifiers/list>
2. **Do:** ➕ → App IDs → App → Description "Playhub" → Bundle ID **Explicit**,
   using a **brand-neutral reverse-DNS you own**, e.g. `com.<yourdomain>.playhub`.
   **Do not** encode a product name you may rebrand (`com.x.dinofun` would be a
   permanent mistake). Enable no capabilities (we need none: no push, no iCloud,
   no sign-in).
3. **Expect:** the identifier appears in the list.
4. **Verify:** it is selectable when creating the app record in the next step.

### 2.3 App Store Connect record — *~20 min*
1. **Open:** <https://appstoreconnect.apple.com/apps> → ➕ → New App
2. **Do:** Platform iOS · Name (placeholder is fine, changeable) · Primary
   language English (U.S.) · Bundle ID from 2.2 · SKU `playhub-ios-01`.
   Then **App Information** → Category **Games**, secondary **Education** →
   **Kids** age band **5 and under** (doc 14 §1).
3. **Expect:** the app appears with status "Prepare for Submission".
4. **Verify:** the app page loads and shows the Kids age band.

### 2.4 Agreements, Tax & Banking — *~30 min* — **subscriptions cannot go live without it**
1. **Open:** App Store Connect → Business (or Agreements, Tax, and Banking)
2. **Do:** accept the Paid Applications agreement; complete tax forms (W-9/W-8BEN)
   and bank details.
3. **Expect:** the Paid Apps agreement status becomes **Active**.
4. **Verify:** In-App Purchases become creatable. If they don't, this step isn't
   finished — it is the most common cause of "my subscription won't submit".

### 2.5 Create the subscription products — *~30 min* — **product IDs are permanent**
1. **Open:** your app → **Subscriptions** → create group `playhub_premium`
2. **Do:** add `premium.monthly` ($4.99, 1 month) and `premium.annual` ($29.99,
   1 year). For each: localized display name and description, **Family Sharing ON**,
   and an **Introductory Offer → Free Trial, 7 days, all territories**.
3. **Expect:** both show "Ready to Submit" / "Missing Metadata" until review.
4. **Verify:** the product IDs exactly match `apps/playhub/lib/brand/brand_config.dart`
   — a test asserts this, so a typo fails CI rather than at runtime.

### 2.6 App Store Connect API key — *~10 min* — this is what removes you from the build loop
1. **Open:** <https://appstoreconnect.apple.com/access/integrations/api>
2. **Do:** Team Keys → ➕ → name "CI" → Access **App Manager** → Generate →
   **download the `.p8` once** (it cannot be re-downloaded). Note the Key ID and
   Issuer ID.
3. **Do:** in GitHub → repo → Settings → Secrets and variables → Actions, add
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (paste the whole file contents).
4. **Expect:** the key is listed as Active.
5. **Verify:** push a tag; `release.yaml` uploads a build and TestFlight shows it
   ~20 minutes later. **After this, you never build the app yourself again.**

### 2.7 Signing certificates — *~20 min, one command*
1. **Do:** on any Mac, run the script I provide: `./scripts/setup_signing.sh`.
   It uses **fastlane match** with your API key to create the distribution
   certificate and provisioning profile and store them in a private git repo.
2. **Expect:** a new `certificates` repo with encrypted credentials; a passphrase
   you save in your password manager and in GitHub secrets as `MATCH_PASSWORD`.
3. **Verify:** `fastlane match appstore --readonly` succeeds from CI.

### 2.8 Privacy policy hosting — *~20 min*
1. **Do:** I write the policy; you publish it at a stable URL (GitHub Pages is
   free and sufficient — I can generate the site).
2. **Verify:** the URL loads publicly and is entered in App Store Connect.

### 2.9 Art commissioning — *ongoing, starts Phase 2* — **the real schedule risk**
1. **Do:** I produce a written art brief per theme (slot list, dimensions, formats,
   palette, style references, delivery structure) generated directly from the
   ThemePack manifest, so the deliverable is unambiguous.
2. **You:** choose a source — a marketplace bundle (cheapest, ~$50–300/theme, risk
   of a generic look), a freelance illustrator (~$1.5–4k/theme), or a small studio
   (higher, most cohesive). Commission, review, approve.
3. **Verify:** dropping delivered files into the pack folder and running
   `validate_themepack.dart` passes with zero errors.

### 2.10 Voice-over — *~2 hours per language*
Record ~40 short lines from a script I generate. A calm, warm adult voice; a
$150–500 freelance VO artist is the right call. **Do not use text-to-speech** —
children respond to real warmth and it's audible.

### 2.11 Real-child testing — *~2 hours, irreplaceable*
Watch three children aged ~3, ~5 and ~7 play unassisted for 15 minutes. Do not
help them. Record the screen if you can. This will teach you more than every
metric in this document combined.

### 2.12 Submission — *~1 hour*
Screenshots (I generate them; you upload), description, keywords, age-rating
questionnaire, privacy questionnaire, review notes (I draft), Submit.

## 3. Ongoing per release (~1 hour)
Review the PR · approve the TestFlight build · run the manual device pass (doc 15
§6) · submit · answer any review questions.

## 4. What would make this harder, and how to avoid it
- **Don't create the App Store Connect record under a personal account you may
  later want to move to a company.** Decide Individual vs Organization now.
- **Don't rename product IDs or the bundle ID after launch.** They're permanent.
- **Don't approve art that hasn't passed the validator.** A pack that "looks
  right" but is 40 MB or the wrong dimensions costs a re-commission.
