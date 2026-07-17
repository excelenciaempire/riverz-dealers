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
| 1:52 | Back in Riverz: **hover the eye-slash icon** under the customer's comment until the **"Hide comment"** tooltip is visible → click → toast **"Hidden"**, icon flips to an eye. **Switch to the Facebook tab, refresh → show the comment is now hidden on the post.** Back in Riverz → click again → toast **"Visible"** → refresh Facebook → comment reappears | "The merchant can hide a comment — for example spam — and unhide it, and the change takes effect on Facebook. This is pages_manage_engagement." |

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
| 2:38 | **Hover** the eye-slash → **"Hide comment"** tooltip → click → **"Hidden"**. **Switch to Instagram, refresh → show the comment is now hidden.** Back in Riverz → click again → **"Visible"** → refresh IG → comment reappears | "And can hide or unhide Instagram comments the same way, reflected on Instagram." |

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

The manual Hide/Unhide button (both FB and IG) goes through **`/api/messages/moderate`** →
`applyGraphAction`, which branches the Graph field per platform: FB uses `is_hidden`, IG uses
`hide`. (The `comment-moderation.ts` helper is the separate AUTO-hide path used by the IG agent.)

| Permission | UI | Graph call |
|---|---|---|
| `pages_read_user_content` | post context banner, `message-thread.tsx:1155-1215` | `/api/conversations/[id]/comment-context`, `post-preview` |
| `pages_manage_engagement` | `comment-moderation-bar.tsx` (hide), reply composer | `POST /{comment-id}` `is_hidden=true` — `api/messages/moderate/route.ts` |
| `instagram_manage_comments` | same bar + composer on `ig_comment` | `POST /{comment-id}` `hide=true` — `api/messages/moderate/route.ts` |

> **Fixed 2026-07-17 (commit below):** IG hide previously sent `is_hidden` (a Facebook-only
> field) to Instagram comments, which Graph silently ignored — the toast said "Hidden" but the
> comment stayed visible. IG now correctly sends `hide`, and the route requires Meta's explicit
> `{"success":true}` before reporting success. Deploy must be live on Render before you film the
> IG hide step.

## Uploading it

The per-permission **"Get started" modal in Allowed usage cannot be automated** (verified
exhaustively — the dialog mounts but its content never loads under browser automation). Fill the
3 cards by hand: Get started → paste the description from `meta-app-review-texts.md` → upload this
mp4 → tick the confirm checkbox → Save. Then Submit.

---

# How many videos do you actually need? → TWO, not four

Meta shows one video-upload slot per permission, but you REUSE files:

- **Video 1 — Comments** (this document). ONE file, uploaded to all **3** comment cards
  (`pages_read_user_content`, `pages_manage_engagement`, `instagram_manage_comments`).
- **Video 2 — Human agent** (below). ONE file for `human_agent`, in a **separate, later**
  submission — only after the code deploy lands on Render.

So right now you record exactly **one** video (comments). Video 2 comes later.

---

# Video 2 — human_agent (separate submission, LATER)

`human_agent` extends the messaging window from 24h to **7 days** for genuine human replies.
The code is wired (send retries with the HUMAN_AGENT tag when a human's inbox reply lands
outside 24h). Do **not** submit it until:

1. the deploy is live on Render (the reviewer tests the real app), and
2. `human_agent` is added to the FB Login for Business config scopes, so it appears on the
   consent screen (otherwise Meta can't see the grant step it requires).

### What the video must show (~2:00)

| Time | On screen | Caption (English) |
|---|---|---|
| 0:00 | Fresh Chrome, logged out. Sign in at `riverz.co/ingresar` | "A human support agent signs in to Riverz." |
| 0:15 | Integrations → **Meta** card → **Connect** → Facebook login → **consent screen showing human_agent** granted | "The agent grants Riverz the human_agent permission, so they can reply to customers for up to 7 days." |
| 0:35 | Inbox → open a Messenger/Instagram conversation whose **last customer message is clearly more than 24 hours old** (show the timestamp on screen) | "This customer last wrote more than 24 hours ago — outside Meta's standard 24-hour window." |
| 0:55 | The **human agent types a reply** in the composer and clicks Send → message delivered | "A human agent — not an automated bot — personally replies. This is what human_agent is for." |
| 1:15 | Switch to Messenger/Instagram, show the reply arrived on the customer's side | "The reply is delivered, even though more than 24 hours had passed." |
| 1:30 | Optional: show it's a human by highlighting the agent is typing manually, not an AI toggle | "Riverz never uses this tag for automated messages — only for live human agents." |

### The hard part: demonstrating ">24h"

You can't fast-forward a real window on camera. Options:
- Use a real conversation that genuinely went quiet >24h ago (easiest — plan a day ahead: have
  a tester message the page, then record the reply the next day).
- Or show the message timestamp clearly so the reviewer sees the elapsed time.

Meta's rejection reason for our comment videos was exactly "didn't show the end-to-end use
case" — for human_agent the end-to-end IS the out-of-window delivery, so that timestamp shot
is the whole point. Don't skip it.
