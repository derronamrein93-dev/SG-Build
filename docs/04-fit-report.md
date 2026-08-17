# 04 · Customer Fit Report

The report is the product. It is the only artifact the customer sees, the only
part they show someone else, and the entire justification for the follow-up.
Build it with more care than any internal screen.

---

## 1. Design principles

1. **It is a document, not an app screen.** Serif headings, generous margins,
   real paper proportions. It should look like something from a good clinic or a
   bespoke tailor, not a receipt or a dashboard export.
2. **One page.** Always. If it does not fit, cut content, not type size.
3. **Reads in 30 seconds, keeps for 6 months.** Skimmable at a glance, specific
   enough to be worth putting in a drawer.
4. **Co-branded, store first.** The store's name is the largest brand on the
   page; Stride Guide is a discreet mark in the footer. The store is the one
   with the relationship — and this is what makes owners show it off.
5. **Fit language, never clinical language.** Every string passes the
   guardrails in [03 §4](03-recommendation-engine.md#4-language-guardrails).
6. **Ends with a next step.** A report with no next action is a souvenir.

## 2. Structure

| # | Block | Content | Source |
| --- | --- | --- | --- |
| 1 | **Header** | Store logo · store name, address, phone · "Fit Report" · date | Store record |
| 2 | **Customer line** | Name · fitted by *(associate first name)* · visit number | Customer, associate |
| 3 | **What you came in for** | One sentence, generated from intake | Intake need-summary |
| 4 | **Your fit profile** | Size L/R · width · arch · foot shape · a plain-language roll description | Assessment |
| 5 | **What you told us** | Up to 3 comfort concerns in the customer's own framing | Intake |
| 6 | **What we recommend** | Shoe type · support level · cushioning level · width & toe box note · insole (if any) | Recommendation |
| 7 | **Why** | 2–3 sentences of plain rationale | Rule `report` strings |
| 8 | **Notes from your fitting** | Associate notes, customer-safe | Assessment notes |
| 9 | **What we fitted you in** | Brand/model/size purchased, if any | Outcome |
| 10 | **Your next step** | One instruction + the follow-up date | Follow-up |
| 11 | **Disclaimer** | Fixed legal text | Constant |
| 12 | **Footer** | Store contact · "Fitting powered by Stride Guide" · report ID | System |

**Levels are shown as filled dots, not numbers.** `Support ●●●○` communicates
instantly and avoids implying measurement precision the system does not have.

## 3. Delivery

| Channel | v1 | Notes |
| --- | --- | --- |
| On screen | ✅ | Shown to the customer on the tablet at the end of the fitting — this is the moment that sells it. |
| Print | ✅ | Print stylesheet, one page, US Letter + A4. Most stores have a receipt-adjacent printer; test on a real one. |
| Email link | ✅ | Short-lived signed URL to a mobile-friendly web version, plus a print-to-PDF button. No PDF pipeline in v1. |
| PDF attachment | ⏳ v1.1 | Only if pilot stores ask. Server-side render of the same HTML. |
| QR code | ⏳ v1.1 | Two hours of work later; the email link covers it now. |
| SMS | ❌ | Consent and carrier registration overhead before the value is proven. See [01 §9](01-prd.md#9-what-not-to-build-yet). |

**Link privacy:** report URLs use an unguessable token, expire after 90 days, and
contain no personal identifiers in the path. Anyone with the link can view it —
acceptable for this content, and the trade-off is documented rather than
accidental.

## 4. Disclaimer (fixed text, every report)

> This fit report reflects a footwear fitting conducted in store. It is intended
> to help with shoe selection and comfort. It is not a medical assessment,
> diagnosis, or treatment recommendation. If you have ongoing pain or a foot
> health concern, please consult a qualified healthcare professional.

Set in small but legible type (minimum 8.5pt print / 12px screen), never grey on
grey, never collapsed behind a link.

---

## 5. Sample report

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ▢ NORTHSIDE RUNNING CO.                                    FIT REPORT  │
│     1420 Grand Ave · (612) 555-0148                    14 August 2026    │
│                                                                          │
│   ──────────────────────────────────────────────────────────────────     │
│                                                                          │
│   Prepared for  M. ALVAREZ                                               │
│   Fitted by     Denise · Visit 2                                         │
│                                                                          │
│                                                                          │
│   WHAT YOU CAME IN FOR                                                   │
│   Work footwear for shifts of eight hours or more, with heel             │
│   discomfort building through the day.                                   │
│                                                                          │
│                                                                          │
│   YOUR FIT PROFILE                                                       │
│   ┌────────────────────┬───────────────────────────────────────────┐     │
│   │ Size               │ 10.5 left · 11 right                      │     │
│   │ Width              │ Wide                                      │     │
│   │ Arch               │ Lower arch                                │     │
│   │ Foot shape         │ Wide forefoot, standard volume            │     │
│   │ How your foot rolls│ Rolls inward slightly                     │     │
│   └────────────────────┴───────────────────────────────────────────┘     │
│                                                                          │
│   Your feet measured slightly different sizes. That is common, and we    │
│   fitted the larger foot for comfort.                                    │
│                                                                          │
│                                                                          │
│   WHAT YOU TOLD US                                                       │
│   • Heel discomfort by the end of a shift                                │
│   • Current boots feel tight across the ball of the foot                 │
│   • Comfort and durability matter most                                   │
│                                                                          │
│                                                                          │
│   WHAT WE RECOMMEND                                                      │
│   ┌────────────────────┬───────────────────────────────────────────┐     │
│   │ Shoe type          │ Supportive work footwear                  │     │
│   │ Support level      │ ●●●○  Stability                           │     │
│   │ Cushioning level   │ ●●●○  Plush                               │     │
│   │ Width & toe box    │ Wide fit, roomy toe box                   │     │
│   │ Insole             │ Anti-fatigue insole                       │     │
│   └────────────────────┴───────────────────────────────────────────┘     │
│                                                                          │
│                                                                          │
│   WHY                                                                    │
│   You spend most of your day standing, and the wear on your current      │
│   boots showed more contact along the inner edge. A supportive shoe      │
│   with a firmer platform and lasting cushioning is usually more          │
│   comfortable over a long shift than soft foam on its own. The wider     │
│   fit gives the front of your foot room to spread out naturally.         │
│                                                                          │
│                                                                          │
│   NOTES FROM YOUR FITTING                                                │
│   Sized to the right foot with a volume insert on the left. Walked       │
│   both pairs on the hard floor — the wide fit felt noticeably better     │
│   through the forefoot.                                                  │
│                                                                          │
│                                                                          │
│   WHAT WE FITTED YOU IN                                                  │
│   Brand A · Model 4E Wide · Size 11 · with anti-fatigue insole           │
│                                                                          │
│                                                                          │
│   YOUR NEXT STEP                                                         │
│   Wear them indoors for a few shifts before a full day on concrete.      │
│   We will check in on 13 November to see how they are working out —      │
│   and your fit profile is saved, so your next fitting starts from here.  │
│                                                                          │
│   ──────────────────────────────────────────────────────────────────     │
│                                                                          │
│   This fit report reflects a footwear fitting conducted in store. It is  │
│   intended to help with shoe selection and comfort. It is not a medical  │
│   assessment, diagnosis, or treatment recommendation. If you have        │
│   ongoing pain or a foot health concern, please consult a qualified      │
│   healthcare professional.                                               │
│                                                                          │
│   Northside Running Co. · (612) 555-0148    Fitting powered by ▲ Stride  │
│   Report SG-2026-0814-0142                                       Guide   │
└──────────────────────────────────────────────────────────────────────────┘
```

### What the sample demonstrates

- **Not one clinical term.** "Rolls inward slightly" instead of pronation,
  "lower arch" instead of pes planus, "wear along the inner edge" instead of a
  gait diagnosis.
- **The customer's own words** are reflected back in *What you told us*, which
  is what makes people feel heard.
- **The rationale names the evidence** — hours standing, wear pattern, width —
  so the recommendation reads as observed rather than upsold.
- **The next step is concrete and dated,** and it explicitly says the profile is
  saved. That sentence is the retention mechanism.
- **The insole appears as part of the fit,** not as an add-on line item.

## 6. Empty and partial states

| Situation | Report behavior |
| --- | --- |
| Low confidence | *Why* becomes: "We based this on what you told us and how the shoes felt today. Comfort during wear is the best guide." No fake certainty. |
| No purchase | *What we fitted you in* is replaced by *What to look for*, listing the profile characteristics so the customer can shop the recommendation elsewhere. **Include this deliberately** — it builds trust, and they bring the sheet back. |
| No insole recommended | Row omitted entirely, not shown as "None." |
| Anonymous fitting | Print only, no name block, no follow-up, no report ID lookup. |
| Referral flagged | No extra alarm copy; the standard disclaimer carries it. |

---

**Next:** [05 · Data Model](05-data-model.md)
