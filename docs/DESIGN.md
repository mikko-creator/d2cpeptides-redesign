# Design notes: "Specimen Glass"

## Brief

Total redesign of the D2C Peptides site, keeping the brand and its tone (precise, sourced, research-use first).
Glassmorphism combined with a utilitarian style, clean and modern, with several layers of depth, scroll animations and
hover effects. Every page, word, link and image of the source is kept.

## Brand kept

| Element | Value |
| - | - |
| Navy (ground) | `#0a1220`, `#0f1a2e`, `#14213d` |
| Signal red (actions, indices) | `#da303d` (hover `#ef4b57`, text `#c2232f`) |
| Cream / paper | `#f6f1e7`, reading grounds `#f4f3ef` and `#ede9e0` |
| Gold (staging status) | `#c9962f` |
| Display type | Fraunces |
| Text type | Inter |
| Added: data type | JetBrains Mono (labels, prices, specs, stock, numbering) |
| Mark | the hexagon logo; the hexagon also drives bullets, icons and the lattice pattern |

## Layers (back to front)

1. **Stage** (`.stage`, fixed): navy gradient mesh, grid paper and hex lattice at two parallax rates, three slow light
   pools.
2. **Band media** (`.fx`, per hero or band): a generated still or loop, masked so the words keep a calm side; grid,
   hex lattice, two light orbs at opposite parallax rates, a slow scan line, a pointer spotlight.
3. **Glass panes**: dark glass for hero copy, bands and dialogs; light glass for cards, tables, notes and the contents
   rail. Every pane has a top highlight, an inner edge and, on the main panes, corner registration ticks.
4. **Specimen plates**: the client's white-ground vial photos, framed as plates that tilt and float in heroes and on
   product pages.
5. **Chrome**: a glass header whose frost sits on `::before` (so nested glass keeps its own blur), a category rail, a
   ticker, a floating phone dock and the help-chat launcher.

## Motion

- Scroll reveals: fade, rise and de-blur, staggered within grids; released after the entrance so hover and tilt work;
  a focus inside a pending block finishes it; nothing is hidden without JavaScript.
- Parallax: per-layer depth factors, clamped to each band's own margin.
- Hover: buttons sheen and nudge their arrow; cards lift, tilt toward the pointer and catch a glare; tiles turn their
  hexagon; links slide; plates straighten.
- Readouts count up once; the header shows scroll progress; the contents rail tracks the section in view.
- `prefers-reduced-motion`: no reveals, drift, tilt, ticker or loops (posters show instead).

## Templates

All 41 page types of the source use one component vocabulary, so the stylesheet covers them all: home, shop hub,
categories, 45 product pages, 7 supply pages, wholesale and its application, learn hub, 51 compound profiles and 84
sub-pages, goal and compare guides, glossary, FAQ, blog, 34 location pages, tools, shipping, returns, contact, legal,
search, cart, checkout and 404.
