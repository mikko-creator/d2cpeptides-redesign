# D2C Peptides: redesign pitch ("Specimen Glass")

A complete visual redesign of the D2C Peptides site (https://sgencms.github.io/d2cpeptides/), built for review.

- **Preview (noindex):** https://mikko-creator.github.io/d2cpeptides-redesign/
- **What it is:** all 321 pages of the source site rebuilt at the same paths, with the same words, links, images, product
  data and features (cart, strength and ship-from options, filters and sort, search, the research-use gate, the help
  chat, the three calculators, checkout by email). Only the design changed.
- **The research-use gate** shows on the first visit, as on the source: tick both statements to enter.

## The design

Utilitarian lab instrument language on frosted glass, kept inside the existing brand: navy `#0a1220`, signal red
`#da303d`, cream, gold, Fraunces display type with Inter, the hexagon mark and the logo files.

- **Layers:** a fixed navy "lab space" sits behind every page (gradient mesh, grid paper, hex lattice, drifting light
  pools). Dark bands are windows onto it. Heroes add a photo or motion layer, a grid, a slow scan line and a pointer
  spotlight, then a glass pane for the words. Product photos become white specimen plates that float at different depths.
- **Utilitarian details:** mono readouts (JetBrains Mono) for labels, prices, specs and stock; numbered sections and
  nav items; corner registration ticks on glass panels; spec-sheet tables; a contents rail that sticks beside long reads.
- **Motion:** scroll reveals, parallax depth, card tilt with a glare, count-up readouts, a seamless ticker, a header
  progress line, a contents scrollspy, and two background loops. Everything respects `prefers-reduced-motion`.
- **Imagery:** the client's own vial and supply photos are used everywhere they were. Six decorative stills and two
  loops were generated for the design (see [docs/MEDIA.md](docs/MEDIA.md)); none shows the client's products or premises.

More detail: [docs/DESIGN.md](docs/DESIGN.md).

## How it is built

The source site is crawled, then every page is carried through a transform that keeps its content and swaps the
presentation. No framework, no runtime dependencies; Node 18+ builtins only.

```
node tools/crawl.mjs              # polite crawl of the source into audit/raw/ (local only, not in this repo)
node tools/harvest-assets.mjs     # the source's images, scripts and indexes into audit/assets/ (local only)
node src/build.mjs --strict       # dist/: 321 pages, every local reference checked
node tools/parity.mjs             # proof: text, links and images of every page equal the source (with controls)
node tools/dev-serve.mjs          # http://127.0.0.1:8790/d2cpeptides-redesign/
```

- `src/build.mjs` - the transform and asset pipeline.
- `src/styles/*.css` - the design system, concatenated in name order (tokens, base, chrome, sections, bands, commerce,
  motion).
- `src/js/fx.js` - the motion and depth layer. The client's own `site.js`, `chatbot.js` and `tools.js` ship unchanged.
- `src/assets/gen/` - the generated decoration.
- `dist/` - the built site, as served by the preview.

## Content parity

`node tools/parity.mjs` compares every built page with its source: 321 of 321 pages carry the identical text stream,
every link and every image (718,155 words, 62,280 links, 1,860 images). The one declared change: the header and the
research-use gate use the client's light logo file, because they now sit on dark glass. The check plants a deleted
sentence, a retargeted link and a dropped image in a copy of a page and must catch all three.
