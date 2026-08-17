# Stride Guide™

This repo holds two things:

| | |
| --- | --- |
| **[Product blueprint](docs/README.md)** | PRD, UX spec, recommendation engine, data model and build plan for **Stride Guide FitOS** — the store-side fitting interface. Start here. |
| **Landing page** (this file, below) | The marketing site at the repo root. |

---

## Landing Page

Conversion-focused marketing site for Stride Guide, a retail footwear fitting
platform that turns in-store pressure mapping into customer fitting
intelligence, Foot History™ records, and permission-based follow-up.

**Positioning:** Better fittings. Better follow-up. More returning customers.
**Tagline:** Turn every step into a sale.™

## Stack

Static HTML, CSS and vanilla JavaScript — no build step, no framework, no
runtime dependencies. Open `index.html` on any static host and it works.

```
index.html                  Entire page (markup + SVG definitions + JSON-LD)
assets/css/styles.css       Design tokens, layout, components, responsive rules
assets/js/main.js           Nav, scroll reveals, count-up metrics, pilot form
assets/fonts/*.woff2        Self-hosted Space Grotesk + Inter (latin subsets)
assets/img/favicon.svg      Site icon
assets/img/og-image.png     1200×630 social share card
robots.txt, sitemap.xml     Crawl + indexing
```

### Local preview

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Asset paths are root-absolute (`/assets/...`), so serve from the site root
rather than opening `index.html` off the filesystem.

## The pressure maps

Every plantar pressure visualization on the page — hero platform, Foot
History thumbnails, dashboard comparison, privacy shield — is generated from
one shared SVG system defined at the top of `index.html`:

1. Pressure is authored as **alpha blobs** (`#heatRightBase`, `#heatLeftBase`,
   `#heatImproved`, `#heatHeelLoad`) — one soft circle per contact region:
   heel, lateral column, metatarsal heads, toes, arch.
2. `#pressureRamp` blurs that alpha field to interpolate between sensels,
   converts alpha to luminance, then maps it through a single-hue ramp
   (deep teal → green → electric green → white) with `feComponentTransfer`.
   The legend bar under the hero platform mirrors the same ramp.
3. `#clipFoot` clips the result to the foot silhouette.

To create a new scan signature, copy one of the blob groups and adjust the
circle positions/opacities — the ramp and clip do the rest. Note that the clip
shapes are written out in full rather than referenced with `<use>`: browsers
do not honour `<use>` inside `<clipPath>`.

## Wiring up the pilot form

The early-access form posts nowhere by default. Point it at a real endpoint by
adding `data-endpoint` to the form:

```html
<form id="pilot-form" class="form" data-endpoint="https://your-endpoint.example/pilots" novalidate>
```

It then `POST`s a `FormData` payload and reports success or failure inline.
Without that attribute it falls back to opening the visitor's mail client with
the fields pre-filled, addressed to the `CONTACT` constant in
`assets/js/main.js` (currently `pilots@strideguide.co`) — update that address
before launch.

## Before going live

- Replace the `https://strideguide.co/` placeholder domain in the canonical
  link, Open Graph/Twitter tags, JSON-LD, `robots.txt` and `sitemap.xml`.
- Set the pilot form endpoint and contact address (above).
- Serve with compression and long-lived cache headers on `/assets/*`.

## Accessibility and performance notes

- Single `<h1>`, ordered heading levels, landmark regions, skip link.
- Every pressure visualization carries a text description of what the scan
  shows; purely decorative art is `aria-hidden`.
- Body and small label text meets WCAG AA contrast against the dark surfaces
  (`--muted-dim` is lightened slightly from the brand's `#6E786F` to clear
  4.5:1 at small sizes).
- All motion — heat-map breathing, scan sweep, reveals, count-ups — is
  disabled under `prefers-reduced-motion: reduce`.
- Scroll reveals never trap content: anything in the first viewport is shown
  immediately, and a timer reveals everything if IntersectionObserver
  callbacks don't run.
- Two self-hosted woff2 files (~70 KB total, preloaded), no third-party
  requests, no images other than the social card.

## Content status

Stride Guide is pilot-stage. The site says so: the early-access section asks
for first retail deployments rather than claiming existing adoption, and the
dashboard, device panel and customer records are clearly a product preview
populated with representative sample data.

## Fonts

Space Grotesk and Inter are used under the SIL Open Font License 1.1.
See `assets/fonts/LICENSE.md`.
