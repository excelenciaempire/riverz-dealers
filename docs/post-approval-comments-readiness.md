# Comment writes — post-approval readiness

**Status:** the code is fully built for every merchant. The only thing gating
comment **writes** (reply / hide / delete / like, comment-to-DM public replies,
IG-agent public replies) for non-owner merchants is Meta **Advanced Access** for:

- `pages_read_user_content`
- `pages_manage_engagement`
- `instagram_manage_comments`

These were **rejected** in App Review (screencast issue, not the code/use-case —
see `meta-app-review-comments-screencast.md`). Under Standard Access they work
only for accounts held by someone with a **role on the Meta app** (the owner),
and fail for any other merchant.

## What happens the day Meta approves — ZERO code change

Verified by the multichannel robustness audit (2026-07-24): every comment-write
surface already uses the **connection's own page token** and the **event's own
connection**, never a global/owner token or an email allowlist:

- FB reply — `src/lib/channels/fb_comment/adapter.ts` `sendText`
- IG reply — `src/lib/channels/ig_comment/adapter.ts` `sendText`
- hide / unhide / delete / like — `src/app/api/messages/moderate/route.ts`
- comment-to-DM — `src/lib/comment-to-dm/engine.ts`
- IG-agent public reply — `src/lib/instagram-agent/comment-reply.ts`

So once Advanced Access is granted, the exact same Graph calls succeed for any
merchant. Nothing to deploy.

## The ONE manual owner step (Meta dashboard, not code)

Production connect uses **Facebook Login for Business** via a `config_id`, which
**REPLACES** the `scopes[]` list in `src/lib/channels/oauth.ts`. The three comment
permissions are already in that fallback list, but for the `config_id` path they
must ALSO be in the **Login configuration** in the Meta App Dashboard:

1. developers.facebook.com → the app (`1021515967221344`) → **Facebook Login for
   Business** → **Configurations** → the config referenced by
   `META_LOGIN_CONFIG_ID` / `NEXT_PUBLIC_META_LOGIN_CONFIG_ID`.
2. Ensure its permission set includes `pages_read_user_content`,
   `pages_manage_engagement`, `instagram_manage_comments` (plus the already-present
   `instagram_basic`, `pages_read_engagement`, etc.).
3. Merchants who connected BEFORE this must **reconnect** once so their token is
   re-minted carrying the new scopes (a token only carries scopes granted at mint
   time).

Verify a merchant's token actually carries them:
`GET /debug_token?input_token={page_token}` and `GET /me/permissions`.

## Known follow-ups (do NOT block approval; tracked separately)

- **IG-agent multi-account attribution** — `comment-reply.ts` falls back to the
  workspace's newest IG connection when a comment's own connection can't be
  traced; a workspace with 2+ IG accounts could reply from the wrong account.
  Proper fix needs a `comments_meta.connection_id` column so every comment records
  its true owning account. Only affects multi-IG-account workspaces.
- **comment-to-DM / IG-agent silent errors** — both now log the failure reason
  (commit history), but the UI still shows only a sent-count; surfacing the
  "needs App Review" reason in the UI is a nice-to-have.
