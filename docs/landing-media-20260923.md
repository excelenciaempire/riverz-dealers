# Landing media generation status

The landing sections and all 13 feature cards were restored with ES/EN copy.
The five original card animations are active. Three reviewed Seedance clips
temporarily replaced sales, recovery and setup, then the owner requested their
original animations back. The generation history below is retained for audit.

Five Seedance 1.5 Pro generations were explicitly approved for a maximum of
150 Riverz credits (30 each). All five were admitted, then failed with
`MEDIA_OUTCOME_REQUIRES_REVIEW`. Read-only verification found:

- `editor_media_requests.state = review`
- No external task ID or result URL
- `editor_assets.generation_status = failed`, storage path `pending`
- Five credit reservations in `held` state, 30 credits each

The owner subsequently explicitly approved an additional 150 credits and the
duplicate-charge risk. Five replacements were created using the audited recovery
RPC in RiverzAI commit `9ee267226`. No original marker or hold was reset/released.

Editor session: `84cc9f99-b5cd-4827-ba02-ff0e7d4cc70b`.

| Clip | Job ID | Asset ID |
| --- | --- | --- |
| Sales | `75d5ca2a-001d-4985-abcf-869869788d6f` | `b13afb07-2267-47a1-9944-90be476b7113` |
| Cart recovery | `0a03fc04-9931-484f-839f-2434ec8fab9a` | `3c6197b4-4ed2-40d9-b67e-6b9d1c827072` |
| Campaigns | `ec5c762c-0fa5-4fbf-a489-4f742e6553ff` | `c042042f-10c3-416e-8662-e551e47d3fae` |
| Setup | `8dd4e31e-3054-4107-980a-61aa674a23d0` | `90387672-92ad-4890-b1ec-532dc94285e4` |
| Results | `c01e477f-ef4b-46fc-9a36-8f3203fd11e6` | `053e0c1e-9102-4180-9f2b-20f7d2660aef` |

Visual direction: ivory paper, forest green, restrained pale citron, text-free
editorial illustration; five-second 16:9 clips. Generated media must be visually
reviewed and optimized before replacing the current assets. Preserve static
fallbacks, lazy loading, and reduced-motion behavior. Keep actual UI previews
legible rather than animating their text with a generative model.

## Authorized replacement outcomes

All five replacement jobs succeeded, with a 30-credit quote each. The original
150 credits remain held pending provider reconciliation, separately from these
150 credits. No further paid retries are authorized by this run.

| Clip | Replacement job | Kie receipt | Publication decision |
| --- | --- | --- | --- |
| Sales | `bfeb5fc9-efd9-4c9a-852c-89195f65e0d6` | `6aaf1429f3e795cc66e2ee2b0e3025e8` | Publish: conversation and confirmed parcel |
| Recovery | `b68f50e3-febf-468c-b7c8-3aadb546345e` | `1f4d8dcb58d25ecd6a4966aee37f6f2b` | Publish: cart returns toward checkout |
| Campaigns | `da55505f-c82e-4824-8062-3496474eb5dc` | `3d0f56d910d72c4c1e9d055fe7727bc2` | Reject: pseudo-text on paper |
| Setup | `c5e10925-a126-4729-b6a8-29273e3401c9` | `05b548bdf9af08bc3c157bdc89b27610` | Publish: message shapes assemble |
| Results | `6cc41b10-f6a7-4c2c-b0cc-a61d5d7cc55b` | `3e36219ed3571ed265c47426e0c2d7b8` | Reject: pseudo-text and unclear chart |

Each clip was inspected with a five-frame contact sheet (one sample per second).
Published derivatives: animated WebP, 800px wide, 14fps, quality 68; static JPG
fallback at 3.2s, 1200px wide. Sales/recovery/setup total under 2MB animated.
No GIF duplicate is needed for these clips. Original assets remain available.
Preserve all 13 sections, reduced-motion fallback and viewport-based loading.
