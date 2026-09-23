# Workflow illustrations and copy review

## Scope

Five AI-generated films replace the five native workflow animations in `#loop`.
The thirteen capability cards remain unchanged. All visible labels are live
Spanish/English HTML, never generated lettering or a simulated product interface.

## Copy decisions

- Hero leads with store sales/support and done-for-you setup.
- Workflow explains incoming questions, connected data, permissions, orders and review.
- No guaranteed revenue, invented performance statistics or universal setup deadline.
- Approval examples distinguish automatic tasks from sensitive human decisions.
- Third-party messaging/phone fees are visible beside the plan; 35% first-month offer retained.
- Lead form promises a conversation about the store, tasks and plan, not a hard sell.

## Production

Provider: Kie. Model: `bytedance/seedance-1.5-pro`.
Settings: six seconds, 16:9, 720p, audio disabled, fixed camera.
Selected for short illustrative scenes at card size and low measured provider cost.
Palette: warm ivory, forest green, restrained yellow. Three-dimensional objects,
no synthetic text, no fabricated customer/revenue claims. These are explicitly
labeled AI illustrations, not recordings of the product.

| Scene        | Provider task                    | Credits consumed |
| ------------ | -------------------------------- | ---------------: |
| Conversation | 92c1d03f2a256ba8891c6db66120ce8c |               21 |
| Context      | aa38391dc361594ba0e95292182c3562 |               21 |
| Permissions  | 7a79b34f18b4715cb2bc9fe09d2bc33f |               21 |
| Order        | ea97081de530b11a46d2a1f460a25869 |               21 |
| Results      | c1c5b4af30bee1917f460307e5100413 |               21 |

Total: **105 Kie credits**, confirmed by each successful recordInfo response.
Initial results task `1dc3d25751fab26e5a04d267b7fda75b` was rejected with
`Invalid content.text`; provider reported zero credits. A simplified prompt
was submitted once after inspecting the confirmed failure. No uncertain job
was resubmitted. No credentials are stored in the repository.

## Delivery and QA

H.264/yuv420p MP4, fast-start metadata, silent, each under 1 MB. Each has a JPEG
poster. Load only near the viewport; play once when visible; pause when outside
the viewport or the tab is hidden. Explicit play/pause/replay; reduced-motion
users get a static poster until they choose play. No infinite loops.

Early/middle/late contact sheets were visually inspected for all five sources.
The clips are illustrative rather than literal: the approval gate and order
objects communicate their theme, not an exact application workflow. No generated
lettering was found. Supplemental Gemini analysis could not run because its
configured API key was rejected; no automated visual verdict is claimed.

Source receipts and original clips are preserved locally under
`C:/tmp/riverz-workflow-20260923`; web-delivery assets are in `public/portada-b`.
