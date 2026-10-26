# Generated media

Every image and video in `src/assets/gen/` is **AI-generated decoration**. None of it is a photograph or footage of
D2C Peptides, its products, vials, packaging, staff, customers or premises. The vials, boxes and lab glass shown are
generic and invented by the models.

Each file carries the IPTC digital source type **trainedAlgorithmicMedia**:

- WebP stills and posters: an XMP packet (`tools/ai-label.xmp`), embedded with `webpmux`.
- MP4 loops: the container `comment` and `description` tags, checked with `node tools/ai-label.mjs verify --control`.

The prompt, settings, request id and selection reason for every generation, including rejected candidates, are in
`audit/generated-images.json`.

| Asset | Files | Model (via Higgsfield) | Shows |
| - | - | - | - |
| hero | `hero-640/1280/1920.webp` | Grok Imagine Image 2.0 (xAI) | Abstract render of a glass peptide chain in navy light |
| hero loop | `hero-loop.mp4`, `hero-loop-phone.mp4`, `hero-loop-poster.webp` | Kling 3.0 Turbo image-to-video, from the hero still | The same chain turning slowly while particles drift |
| lab | `lab-640/1280/1920.webp` | Grok Imagine Image 2.0 (xAI) | Three unlabelled glass vials and a pipette on a dark bench |
| lab loop | `lab-loop.mp4`, `lab-loop-phone.mp4`, `lab-loop-poster.webp` | Kling 3.0 Turbo image-to-video, from the lab still | A slow sideways camera glide past the vials |
| coldchain | `coldchain-640/1280/1920.webp` | Grok Imagine Image 2.0 (xAI) | Open shipping box with a foam insert, gel ice packs and vials |
| rack | `rack-640/1280/1920.webp` | Grok Imagine Image 2.0 (xAI) | Rows of capped glass vials in a white rack |
| crystal | `crystal-640/1280/1920.webp` | Grok Imagine Image 2.0 (xAI) | Close-up of a freeze-dried powder cake in glass |
| desert | `desert-640/1280/1920.webp` | Grok Imagine Image 2.0 (xAI) | A generic desert landscape at dusk (not a specific named place) |

The loops play forward and then in reverse, so there is no visible seam. They have no audio and no flashing: the largest
change in brightness from one frame to the next stays below 3 on a 0 to 255 scale. The site never loads them for a visitor
who has `prefers-reduced-motion` or Save-Data set (`src/js/fx.js`): the poster shows instead, and a loop only plays while it is
on screen.
