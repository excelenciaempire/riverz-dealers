# Meta App Review — ready-to-paste texts (submission 1021518693887738)

App **Riverz** `1021515967221344`. Language: **English** (Meta reviewers read English).
What I (the agent) already placed in the form is marked ✅. What you must paste/finish
manually is marked ✋ — the per-permission "Allowed usage" editor modal does **not** load
under browser automation, so those have to be typed by hand (Get started → Describe →
paste → Confirm → upload video → Save).

---

## 1. Allowed usage — "Describe how your app uses this permission or feature" ✋

Paste one of these into each permission card (Get started → "Describe how your app uses
this permission or feature").

**whatsapp_business_messaging**
> Riverz shows the WhatsApp messages that a merchant's customers send to the merchant's connected WhatsApp Business number in a single shared inbox, and lets the merchant (and, when they enable it, an AI assistant) reply to them. Used only to provide the customer-support inbox on the merchant's behalf.

**whatsapp_business_management**
> Riverz uses this to read and manage the merchant's own WhatsApp Business Account assets — phone numbers, message templates and business profile — so the merchant can connect their number, manage templates and send/receive customer messages from the Riverz inbox.

**pages_show_list**
> After the merchant signs in with Facebook Login for Business, Riverz uses this to list the Facebook Pages the merchant manages so they can choose which Page to connect to their inbox. No Page is accessed until the merchant selects it.

**pages_manage_metadata**
> Riverz uses this to subscribe the merchant's selected Page to webhooks so new messages and comments on that Page are delivered to the merchant's inbox in real time.

**pages_read_engagement**
> Riverz uses this to read the content and comments on the merchant's connected Page (posts, comments and conversation context) so they can be displayed in the inbox and answered.

**pages_manage_engagement**
> Riverz uses this to let the merchant reply to, hide or manage the comments their customers leave on the merchant's Facebook Page posts and ads, directly from the Riverz inbox.

**pages_messaging**
> Riverz uses this to receive the Messenger conversations sent to the merchant's connected Facebook Page and to let the merchant (and, when enabled, an AI assistant) reply to those customers from the inbox.

**business_management**
> Riverz uses this to read the merchant's own business assets (Pages, Instagram accounts and WhatsApp accounts) during connection, so the merchant can pick which of their assets to connect to the inbox.

**instagram_manage_messages**
> Riverz uses this to receive the Instagram Direct messages sent to the merchant's connected Instagram professional account and to let the merchant (and, when enabled, an AI assistant) reply to them from the inbox.

**instagram_manage_comments**
> Riverz uses this to read and reply to (or hide) the comments customers leave on the merchant's Instagram professional-account media, from the Riverz inbox.

**public_profile** (only needs the Confirm checkbox; if a description is asked)
> Riverz uses the basic public profile of the merchant who signs in with Facebook Login to create and identify their Riverz account.

### Business Description (one-line, on the WhatsApp cards) ✅ placed
> Riverz is an AI-assisted shared inbox that lets small businesses manage and reply to their customers' WhatsApp, Instagram, Messenger and email conversations from one place.

---

## 2. Data handling ✅ (placed by the agent)

- Responsible entity (data controller): **Riverz**
- Country: **Colombia**
- National-security / public-authority requests in last 12 months: **No**
- Policies in place (all 4 checked, now backed by the new privacy-policy section):
  legality review · challenging unlawful requests · data minimization · documentation
- Data processors / service providers: **Yes** ✋ *you must add the entries* — for each,
  click "Add data processor", category = **"IT solutions and services, including cloud
  storage and processing"**, country = **United States**, Save:
  - **Supabase** (database & storage)
  - **Render** (application hosting)
  - **Anthropic** (AI replies, only when the merchant enables the assistant)

---

## 3. Reviewer instructions

- Website platform `https://riverz.co` ✅ added
- "Is Facebook Login integrated on this platform?" → **Yes** ✅
- Field "Provide instructions for accessing the app…" ✅ placed (full step-by-step + Meta-API confirmation)
- ✋ **Test credentials** field (accesscode-web-1) — you must paste a working test merchant login:
  > Test merchant account — sign in at https://riverz.co/ingresar
  > Email: <test email>
  > Password: <test password>
  > (Optional) The reviewer's Facebook account has been added as a Tester (App Roles → Roles) so they can grant a test Page + Instagram professional account.
- ✋ **Supporting documentation** (documents-web-1) — optional: drag-drop a screen-recording
  .mp4 showing login + connecting a channel + replying.

---

## 4. Dependency gotchas to check before submitting ✋

- `instagram_manage_messages` and `instagram_manage_comments` require **instagram_basic**
  to be part of the submission. Confirm it is still in the permission list.
- `pages_manage_engagement` shows a note that the request must also include
  **pages_read_user_content**. Add it or that permission may be blocked.

---

## 5. Per-permission video uploads ✋

The screencast upload lives inside the same (non-automatable) Allowed-usage modal.
Re-use a small number of demos: the WhatsApp send/receive video for the two
`whatsapp_*` permissions, and one Messenger/Instagram demo for the `pages_*` /
`instagram_*` permissions.
