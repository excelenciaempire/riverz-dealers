# Riverz workflow UI films

Replaces the five 3D illustrative films with branded interface animations after
the owner's style correction. This revision uses no paid generative-video calls.
The earlier 105-credit generation remains historical spend, not a new charge.

## Art direction

- Same landing tokens: paper `#f3f0eb`, card `#faf7f1`, sand `#f4eddf`, ink
  `#12201f`, accent `#f7ff9e`.
- Instrument Sans for interface text, Geist Mono for compact labels.
- Five concrete sequences: conversation → checkout link; store information
  checks; approval before address change; checkout → payment → order;
  activity overview with human-review cases.
- Illustrative UI, not a screen recording. Metrics are explicitly sample data.
- Eight seconds per scene, 800×720, 30 fps, silent. Final state holds for reading.
- Separate Spanish/English films, selected by the active application locale.

## Reproduction

`node scripts/landing-motion/build.mjs <output-directory>` generates ten standalone
HyperFrames projects from the bilingual landing catalog, using locally frozen
Google Fonts files and GSAP 3.14.2. Requires Node 24's TypeScript stripping.

Install `hyperframes@0.8.66`, put FFmpeg/FFprobe on PATH, and run:

`node scripts/landing-motion/render.mjs <output-directory>`

Each project must pass runtime/layout/contrast checks at 1, 3, 5 and 7 seconds
before rendering. The script uses one render worker and writes logs/snapshots
to the output directory. Set `HYPERFRAMES_BROWSER_PATH` to a working headless
Chromium binary if needed. On this Windows host, bundled Chromium 152 failed
its version probe; installed headless Chromium 148 rendered successfully.
No personal browser profile or visible Chrome window is used.

The script reuses an existing nonempty render. After changing a composition,
use a fresh output directory to avoid accidentally reusing an older film.

Final MP4/poster files live in `public/portada-b/workflow-ui-<scene>-<locale>.*`.
The player loads near the viewport, pauses offscreen, respects reduced motion,
and resets playback when the locale changes. Old 3D assets are retained in Git
but are no longer referenced by the workflow player.
