# Meta App Review — screencast for the 3 rejected comment permissions

Re-submission after the **2026-06-23** decision: 10 approved, **3 rejected** —
`pages_read_user_content`, `pages_manage_engagement`, `instagram_manage_comments`.

Rejection reason (identical for all 3): **"Screencast Not Aligned with Use Case Details"**,
Developer Policy 1.6. Meta explicitly stated *"we have determined that your app's use case is
allowed"* — **the written justifications passed; only the VIDEO failed.** Do not rewrite the
descriptions in `meta-app-review-texts.md`; re-record the video.

What the old videos (`2026-06-21 12-59-35.mp4`, `13-01-03.mp4`) were missing:
- they demonstrated **DMs**, never a comment being read, replied to, or hidden;
- the app UI was in **Spanish** (Meta requires English);
- no captions explaining the UI elements.

Meta's stated requirements for the new video:
1. the complete Meta login flow;
2. a user **granting** the app access to the permission;
3. the **end-to-end** experience of the use case;
4. **English** app UI, captions, tooltips, explain what each button does;
5. declare it if server-to-server / system-user (**not our case** — we use FB Login for Business
   in the browser, so the login flow IS visible; nothing to declare).

One video covering both Facebook and Instagram satisfies all three permissions. Upload the same
file to each of the 3 cards.

---

## Before you hit record

- [ ] **Switch the app to English**: Settings → **Appearance** tab (`/settings?tab=appearance`)
      → click the **English** card. Applies instantly, no save button. Do this BEFORE recording —
      the reviewer must never see Spanish.
- [ ] **Use a fresh Chrome profile / incognito, logged OUT of Facebook.** Meta wants "the complete
      Meta login flow". If Chrome is already logged into Facebook the consent dialog skips the
      login step and that's part of what got us rejected.
- [ ] **The comment must come from a DIFFERENT account than the Page/IG account.** Our own
      ingestion guard (`inbox-writer.ts`) deliberately drops self-comments — if you comment *as
      the Page*, it will never reach the inbox and the demo dies on camera. Use a personal
      Facebook/Instagram account as "the customer".
- [ ] Have ready: one **Facebook Page post** and one **Instagram post**, each with a customer
      comment already posted (or post it live on camera — better, it proves real-time delivery).
- [ ] Screen recorder: Win+G (Xbox Game Bar), OBS, or Loom. 1080p, cursor visible.
- [ ] Captions: burn them in afterwards (CapCut/Clipchamp) or write them as on-screen text.
      Meta explicitly asks for captions **and** tooltips explaining the buttons.

---

## Shot list (~3:00)

Record in one continuous take. Do not cut between permissions — reviewers want a single
uninterrupted end-to-end demo.

### Part 1 — Login + consent (0:00–1:00) → covers requirement #1 and #2

| Time | On screen | Caption (English) |
|---|---|---|
| 0:00 | `https://riverz.co/ingresar`, sign in as the test merchant | "Riverz is a shared inbox for small merchants. A merchant signs in to their account." |
| 0:15 | Land on **Home** (`/dashboard`). Sidebar → **Integrations** (`/integrations`) | "The merchant connects their own Facebook Page and Instagram account here." |
| 0:25 | Point at the **Meta** card. Read its description aloud: *"Messenger and your page's comments in a single connection."* | "The Meta card connects the merchant's own Facebook Page." |
| 0:30 | Click **Connect** → the **Facebook Login for Business** popup opens → **log into Facebook on camera** | "The merchant logs in with Facebook Login for Business." |
| 0:40 | The **consent screen** — pause here, scroll it, let the permission list be readable | "The merchant grants Riverz access to read and manage the comments on their Page. This is the pages_read_user_content and pages_manage_engagement grant." |
| 0:50 | Account picker: **"Choose the accounts to connect"** → select the Page → confirm | "The merchant chooses which of their own Pages to connect." |
| 0:55 | Card turns connected. Click **Connect** on the **Instagram** card → grant → connected | "The same grant for their Instagram professional account: instagram_manage_comments." |

> The Facebook card is labeled **"Meta"**, not "Facebook". If already connected, the button reads
> **"Add another account"** — it opens the same consent dialog, which is the safer option since
> disconnecting silently stops inbound delivery until the webhook cron re-runs.

### Part 2 — Facebook comments end-to-end (1:00–2:00) → `pages_read_user_content` + `pages_manage_engagement`

| Time | On screen | Caption (English) |
|---|---|---|
| 1:00 | Split screen or tab: on Facebook, **post a comment as a customer** on the Page's post | "A customer leaves a comment on the merchant's Facebook post." |
| 1:10 | Sidebar → **Inbox** (`/inbox`) → click the **Comments** tab | "Comments arrive in the merchant's inbox in real time, in a dedicated Comments tab." |
| 1:20 | Open the conversation. **Pause on the post context banner** — thumbnail, **FB post** pill, **"{n} comments on the post"**, **View post ↗** | "Riverz reads the post and its comments so the merchant has full context. This is what pages_read_user_content is used for." |
| 1:35 | Type a reply in the composer → **Send** → show it delivered | "The merchant replies to the customer's comment from Riverz." |
| 1:45 | Switch to the Facebook tab, refresh → **the reply is live on the post** | "The reply is published on the Facebook post. This is pages_manage_engagement." |
| 1:52 | Back in Riverz: **hover the eye-slash icon** under the customer's comment until the **"Hide comment"** tooltip is visible → click → toast **"Hidden"**, icon flips to an eye → click again → toast **"Visible"** | "The merchant can also hide a comment — for example spam — and unhide it. This is also pages_manage_engagement." |

> The moderation bar is **icon-only**. You MUST hover long enough for the tooltip to appear and
> stay on screen, or the reviewer sees an unexplained icon — exactly the "explain the meaning of
> buttons" note in the rejection. The bar only appears under **inbound customer comments**, never
> under the merchant's own replies.

### Part 3 — Instagram comments end-to-end (2:00–2:45) → `instagram_manage_comments`

| Time | On screen | Caption (English) |
|---|---|---|
| 2:00 | On Instagram, **post a comment as a customer** on the merchant's post | "A customer comments on the merchant's Instagram post." |
| 2:10 | Riverz → **Inbox** → **Comments** tab → open the IG conversation. Pause on the banner showing the **IG post** pill | "The Instagram comment and its post context appear in the same inbox." |
| 2:25 | Reply → **Send** → switch to Instagram, refresh → **reply is live** | "The merchant replies to the Instagram comment from Riverz. This is instagram_manage_comments." |
| 2:38 | **Hover** the eye-slash → **"Hide comment"** tooltip → click → **"Hidden"** → click → **"Visible"** | "And can hide or unhide Instagram comments the same way." |

### Part 4 — Close (2:45–3:00)

| Time | On screen | Caption (English) |
|---|---|---|
| 2:45 | Scroll to the footer / open `riverz.co/privacidad` | "Comment data is used only to show and answer the merchant's own customer comments. It is never sold or used for ads." |

---

## Do NOT script these

- **The "Open in Facebook/Instagram" icon inside the moderation bar** — it is dead code: the
  `permalink` prop is never passed from `message-bubble.tsx`, so the icon never renders. Use the
  **"View post ↗"** link in the post context banner instead (that one works).
- **A dedicated comment composer** — there isn't one. Comments use the exact same composer as DMs.
- **Delete comment** — the Trash icon works (`DELETE /{comment-id}`), but it is irreversible and
  would destroy a real customer comment on camera. Hide/unhide demonstrates
  `pages_manage_engagement` just as well and is fully reversible.

## Where the code backs each claim

| Permission | UI | Graph call |
|---|---|---|
| `pages_read_user_content` | post context banner, `message-thread.tsx:1155-1215` | `/api/conversations/[id]/comment-context`, `post-preview` |
| `pages_manage_engagement` | `comment-moderation-bar.tsx:65-73` (hide), reply composer | `POST /{comment-id}` `is_hidden` — `api/messages/moderate/route.ts:144-154` |
| `instagram_manage_comments` | same bar + composer on `ig_comment` | `POST /{comment-id}` `hidden` — `lib/channels/comment-moderation.ts:31` |

## Uploading it

The per-permission **"Get started" modal in Allowed usage cannot be automated** (verified
exhaustively — the dialog mounts but its content never loads under browser automation). Fill the
3 cards by hand: Get started → paste the description from `meta-app-review-texts.md` → upload this
mp4 → tick the confirm checkbox → Save. Then Submit.
