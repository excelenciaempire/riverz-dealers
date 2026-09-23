# Riverz — editorial agents and creative chats

## Current direction

Replaces the mascot hero and five mascot films after the owner's feedback.
The banner matches the existing flat editorial illustrations and adds stronger
brand pale lime, cream, sand and petrol color fields. Three human-like illustrated agents
represent sales, support and orders; no robot mascot is used.

## Final brand palette correction

Edited the generated banner with the built-in image tool, preserving composition.
Palette: paper #f3f0eb, cream #faf7f1, sand #f4eddf / #efe5d0,
tan #cdbca0, petrol #12201f / #2a3639 and pale lime #f7ff9e.
Removed sage and gold. New asset URL avoids reuse of the earlier cached artwork.

Prompt:
> Edit this Riverz website hero illustration, keeping its exact composition, three editorial human-like AI agents doing sales/support/order work, objects, beautiful flat cut-paper editorial style and subtle paper texture. ONLY change the palette to Riverz's existing website brand colors: warm paper #f3f0eb, cream #faf7f1, sand #f4eddf and #efe5d0, subdued tan #cdbca0, deep petrol #12201f and #2a3639, pale luminous lime #f7ff9e. Remove ALL sage/mint green and golden yellow/ochre. Replace sage arch with large sand arch, golden right agent shirt with cream/sand, golden platform with sand/tan; all yellow/citron accents should be brand pale lime #f7ff9e. Keep substantial confident color fields and lively visual contrast, not washed out: dark petrol clothing/desk, broad pale lime diagonal and left agent shirt, warm sand architectural fields. Left 40% remains nearly blank warm paper for website heading overlay. No words, letters, logos, robots, mascot, flowers or new objects. Preserve full figures and wide landscape format. This is a precise brand-palette correction, not a redesign.

## Motion system

Five distinct 6.5-second interface stories, 960×720, 30 fps, silent:

- Conversation: incoming question, typing, reply, product card and checkout.
- Context: question, three store-information checks, grounded reply.
- Permissions: customer request, team approval click, confirmed change.
- Order: a clearly aligned customer chat becomes a separate order receipt.
- Activity: a highlighted case opens its actual illustrative conversation.

Rendered from deterministic HyperFrames/GSAP compositions to keep type sharp and
accurate. Spanish and English have separate films; changing locale resets playback.
No generative-video credits used for this revision. Lazy loading, offscreen pause,
reduced-motion support, posters and explicit replay remain enabled.
No visible explanatory caption beneath the films, as requested by the owner.
Version 3 removes duplicate channel/example badges, stacked closing statements and
the redundant three-step order footer. The final reply stays inside the chat panel.
Accessible scene descriptions remain; no customer data or claimed performance metrics.

## Assets and reproduction

- Banner: `public/portada-b/hero-agents-brand.webp`.
- Films/posters: `public/portada-b/workflow-chat-v3-<scene>-<es|en>.<mp4|jpg>`.
- Build: `node scripts/landing-motion/build-chat.mjs <out> <frozen-font-assets>`.
- Render: `node scripts/landing-motion/render.mjs <out> workflow-chat-v3 6.2`.
- HyperFrames 0.8.66. Set FFmpeg/FFprobe on PATH and a working
  `HYPERFRAMES_BROWSER_PATH`. This host uses headless Chromium 148; the bundled
  Chromium 152 fails its version probe. One headless worker, no personal profile.
- Frozen fonts and GSAP: `C:/tmp/riverz-ui-films`; compositions, checks and outputs:
  `C:/tmp/riverz-chat-v3`. Use a fresh directory after editing to avoid render reuse.

Banner generated and edited using the built-in image tool, not CLI fallback.
Final asset is stored in the project. Earlier artwork is retained but not selected.

## Validation

- Ten HyperFrames checks passed before rendering (runtime, layout, motion, contrast).
- Reviewed scene snapshots in both languages and final rendered poster frames.
- All ten MP4s: H.264, 960×720, 6.5 seconds; unique file hashes.
- Landing: 17 tests passed; targeted ESLint and full TypeScript checking passed.
- Spanish hero visually verified at desktop/mobile; no horizontal overflow across
  320, 390, 768, 1024, 1366 and 1920 CSS-pixel widths.
- Fixed a development-only immutable-cache rule that could hydrate fresh HTML
  using stale client bundles. Production's hashed-asset policy is unchanged.
- Local English interactive review was limited by the development session;
  bilingual rendering and all English film layouts were checked separately.

## Banner generation prompt

Use case: illustration-story. Create a NEW Riverz website HERO BANNER 1792x1024. The supplied screenshot is ONLY a STYLE REFERENCE for its flat 2D editorial illustrations inside the cards. Do NOT reproduce the screenshot, browser chrome, website text, card borders or layout. Match the reference's sophisticated simplified geometric human silhouettes, cut-paper forms, warm ivory paper texture, dark petrol ink, sand and soft acidic yellow/lime accents. Absolutely NOT 3D, not glossy, not photorealistic. Subject: a coordinated TEAM OF THREE AI AGENTS working for an ecommerce store, represented as stylized human-like editorial figures rather than robots or mascots. Agent at left in lime with discreet headset seated at a laptop, actively replying to two speech bubbles. Central tall petrol-clothed agent compares a small product/catalog card with a tablet. Third sand-and-petrol agent at right coordinates an order card beside two neatly stacked parcels with a clear check symbol. Their simple connected work surfaces form a cohesive asymmetrical composition with a single soft lime path connecting conversation to catalog to order. Three distinct roles and gestures, visually alive and collaborative. Same simplified faces and restrained grain as reference, no tiny facial detail. Wide composition: LEFT 52% blank uniform warm cream #f3f0eb for live headline. Entire agent team and props on RIGHT between x54%-96%, y16%-84%, all heads/hands/feet in frame and ample edge margins, visual mass evenly balanced. Background no rectangle; seamlessly warm cream. Palette only #f3f0eb warm cream, #12201f dark petrol, #cdbca0 sand, #f7ff9e pale lime (lime can be slightly deeper in limited areas like reference). No lettering, no words, no numbers, no logo, no robots, no flowers, no petals, no floating generic AI stars, no abstract hub, no gradients or realistic shadows. Energetic premium editorial illustration like the attached Riverz cards, not childish clip art.
