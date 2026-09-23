# Landing media generation status

The landing sections and all 13 feature cards were restored with ES/EN copy.
Existing illustration assets are retained: no newly generated Seedance video was delivered.

Five Seedance 1.5 Pro generations were explicitly approved for a maximum of
150 Riverz credits (30 each). All five were admitted, then failed with
`MEDIA_OUTCOME_REQUIRES_REVIEW`. Read-only verification found:

- `editor_media_requests.state = review`
- No external task ID or result URL
- `editor_assets.generation_status = failed`, storage path `pending`
- Five credit reservations in `held` state, 30 credits each

Do not resubmit or release reservations without resolving the ambiguous provider
outcome. Reusing an approval for a new variation is not authorized.

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
