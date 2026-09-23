# Riverz robot mascot and working-team films

## Identity

Original mascot generated with the built-in image tool. Cream ceramic body,
petrol face, lime pill eyes and right-temple status tab, sand joints and a small
lowercase r chest badge. Keep the proportions, colors and face consistent.
No flower motifs, abstract agent emblems or unrelated robot designs.

Master: `public/portada-b/riverz-mascot.webp` (1254×1254).
Banner: `public/portada-b/hero-mascot.webp` (1792×1024).
These are illustrative brand characters, not hardware Riverz supplies.

## Five different stories

| Scene | Action | Seedance task | Credits |
| --- | --- | --- | ---: |
| conversation | Listen, type, acknowledge | f379098e44628c37c1219c85bcf01625 | 28 |
| context | Inspect catalog products and check information | 7c8fb1465e1263eee2648d284816b65b | 28 |
| permissions | Wait for a human to approve before proceeding | cbcbc682a23dd4e796acdbb2e82e7504 | 28 |
| order | Place the product, close the parcel, dispatch | 6a75da800132cc69e5cb105267b2a7bf | 28 |
| results | Organize completed tasks and separate human review | 8d6f538b1232fbcc639f0979188f5bad | 28 |

Kie Seedance 1.5 Pro, image-to-video, 8 seconds, 4:3, 720p, silent. Five distinct
first frames generated from the same mascot reference; no repeated source clip.
168 credits total, including one discarded conversation take (task
`aebdf563527f02b3e56c9b978b028760`, 28 credits) that invented text in a bubble.
140 credits for the five selected films, confirmed by provider receipts. This is new spend,
separate from prior versions. Credentials are never stored in the repository.

Finals: `public/portada-b/workflow-mascot-<scene>.mp4` and matching JPG posters.
Text-free footage is shared between languages; titles, accessible descriptions,
controls and the illustrative-scene label use live Spanish/English catalogs.
Lazy loading, offscreen pause, explicit replay and reduced-motion support retained.
Older assets remain available but are no longer selected by the player.

## Reproduction and source receipts

`scripts/landing-motion/mascot-films.mjs <working-directory> create|status` uses
RIVERZ_VIDEO_KEY from the environment. Receipts persist before submission so an
uncertain job is never silently resubmitted. The working directory requires the
five scene JPG first frames. Original clips and receipts are preserved locally
in `C:/tmp/riverz-mascot-films-20260923`.

`scripts/landing-motion/prepare-mascot-films.mjs <working-directory>` optimizes
H.264 fast-start files, creates first-frame posters and sampled contact sheets.

## Validation

All five selected clips were manually reviewed through sampled contact sheets;
the first conversation take was rejected for invented lettering and replaced.
Landing tests: 14 passing. Targeted ESLint and full TypeScript checking passed.
HTTP rendering returned 200 with the new assets in Spanish and English.
Local Spanish layout checked at desktop, tablet and mobile widths from 320 to
1920 CSS pixels without horizontal overflow. Desktop screenshot confirmed the
complete robot team and visible primary CTA. English visual review could not
finish because the existing browser session disconnected; no replacement browser
was launched. Shared assets and bilingual catalog coverage are tested in code.

Provider documentation: https://docs.kie.ai/market/bytedance/seedance-1-5-pro

## Reference-frame prompts

### hero

REFERENCE IMAGE is the identity/style reference, not an edit target. Use EXACTLY this Riverz mascot (cream robot, petrol face, two lime eyes, lime temple tab, lowercase r chest badge), preserve head/body proportions, materials and identity. Premium polished 3D animated-film still, cream studio #f3f0eb and Riverz petrol/sand/lime palette. No words or numbers except existing small r badge. All figures and props fully inside frame, generous margins. Wide panoramic website hero banner 1792x1024. LEFT 53 percent is totally empty uniform cream for live headline. RIGHT 47 percent shows a compact TEAM OF THREE of the same mascot robot doing three different jobs together around an elegantly curved shared cream workbench: rear left robot in discreet headset answering a single floating conversation bubble, central robot consulting a petrol tablet and holding a small shopping bag, right robot working at a sand parcel ready for dispatch. Differentiated poses, coordinated team, friendly and professional, no extra humans. Keep ALL characters and props inside x55%-94%, y18%-82%, small enough to fit with generous edge margins. No petals, no flowers, no abstract AI emblems. No drawn headline, text or labels.

### conversation

REFERENCE IMAGE is the identity/style reference, NOT the composition to preserve. Use EXACTLY this Riverz mascot (cream robot, petrol face, two lime eyes, lime temple tab, lowercase r chest badge), preserve its head, body, materials and proportions. Create one premium 3D animated-film still, landscape 4:3, cream studio #f3f0eb and Riverz petrol/sand/lime palette. No words or numbers anywhere except the mascot's existing small r badge. Full characters and props inside frame, ample margin. A specific action-oriented scene, not a UI mockup. The robot sits at a curved cream customer-service desk wearing a discreet petrol headset, hands ready over a small keyboard, looking attentively at a large upright translucent cream conversation bubble with three dark dots to its left. A small lime reply bubble rests near the keyboard. Friendly focused expression. Mid-wide eye-level view, clean single scene.

### context

REFERENCE IMAGE is the identity/style reference, NOT the composition to preserve. Use EXACTLY this Riverz mascot (cream robot, petrol face, two lime eyes, lime temple tab, lowercase r chest badge), preserve its head, body, materials and proportions. Create one premium 3D animated-film still, landscape 4:3, cream studio #f3f0eb and Riverz petrol/sand/lime palette. No words or numbers anywhere except the mascot's existing small r badge. Full characters and props inside frame, ample margin. A specific action-oriented scene, not a UI mockup. The robot stands at a small premium store catalog shelf containing three distinct unbranded products: a sand perfume bottle, a folded cream shirt, and a petrol shoe. It holds a circular magnifying glass up to the bottle, while its other hand holds a small petrol tablet showing only a simple check symbol. Side three-quarter medium view, warm cream background. Clear information checking, no messages or speech bubbles.

### permissions

REFERENCE IMAGE is the identity/style reference, NOT the composition to preserve. Use EXACTLY this Riverz mascot (cream robot, petrol face, two lime eyes, lime temple tab, lowercase r chest badge), preserve its head, body, materials and proportions. Create one premium 3D animated-film still, landscape 4:3, cream studio #f3f0eb and Riverz petrol/sand/lime palette. No words or numbers anywhere except the mascot's existing small r badge. Full characters and props inside frame, ample margin. A specific action-oriented scene, not a UI mockup. The robot pauses beside a low cream counter with a closed sand parcel on its left and a large round petrol approval button on its right, the button has a lime checkmark. The robot's open palm is raised in a polite waiting gesture, NOT pressing the button. On the far right edge only a human hand is poised well above the approval button. Medium-wide side view. A clear human approval checkpoint, not a conversation desk.

### order

REFERENCE IMAGE is the identity/style reference, not an edit target. Use EXACTLY this Riverz mascot (cream robot, petrol face, two lime eyes, lime temple tab, lowercase r chest badge), preserve head/body proportions, materials and identity. Premium polished 3D animated-film still, cream studio #f3f0eb and Riverz petrol/sand/lime palette. No words or numbers except existing small r badge. All figures and props fully inside frame, generous margins. Landscape 4:3. The robot stands at a low cream packing table. An open sand cardboard shipping box sits in front of it; it is carefully holding an unbranded small petrol perfume bottle above the open box, ready to place it inside. Beside the box is a small paper order card with a lime checkmark only. A short outgoing parcel track extends to the right. Active capable working pose, three-quarter medium view, not a desk with messages.

### results

REFERENCE IMAGE is the identity/style reference, not an edit target. Use EXACTLY this Riverz mascot (cream robot, petrol face, two lime eyes, lime temple tab, lowercase r chest badge), preserve head/body proportions, materials and identity. Premium polished 3D animated-film still, cream studio #f3f0eb and Riverz petrol/sand/lime palette. No words or numbers except existing small r badge. All figures and props fully inside frame, generous margins. Landscape 4:3. The robot stands at a wide low petrol work organizer on cream floor. On left are three cream task tiles each with a simple lime checkmark. On right is one separate sand task tile bearing a simple dark human silhouette, set in a shallow tray for human review. Robot is leaning toward the trays thoughtfully, one hand about to sort the tiles, the other open toward the viewer. Slightly elevated three-quarter camera, complete scene. No data charts, no numbers, no messages, no packing box.

## Master generation prompt

Use case: stylized-concept. Create the definitive original robot brand mascot for Riverz, a premium AI team for ecommerce. One SINGLE cute but professional little working robot, full body, three-quarter front view on uniform warm cream #f3f0eb background, square image. Design: compact rounded rectangular ceramic cream head, dark petrol #12201f inset face screen with two expressive pale lime #f7ff9e pill-shaped eyes and a very subtle friendly mouth; a small single lime rectangular status tab on the robot's RIGHT temple (recognition signature, not an antenna). Rounded cream torso with an inset dark petrol square chest badge containing a simple lowercase 'r' in cream, two short articulated arms with mitten-like functional hands, two sturdy short legs and petrol soles. Restrained sand #cdbca0 joint details. Adult premium brand mascot, approachable and capable, not a toy baby. Matte tactile ceramic/polymer surfaces, soft studio light, delicate contact shadow, no glossy chrome, no blue LEDs. Pose: attentive, one hand gesturing open as if ready to help, other hand holds a small slim petrol tablet. Highly polished 3D animated-film character design, original silhouette not resembling any famous robot character. No extra people or robots, no flowers, no petals, no floating UI, no background props, no additional text, no watermark. All limbs entirely inside frame with generous margins. Clear readable eyes and coherent hands.
