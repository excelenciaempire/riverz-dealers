# Meta App Review — submission package (Advanced Access)

App: **Bandeja Unificada CRM** (`1021515967221344`), business portfolio `903402909162306`.
Goal: get **Advanced Access** on the messaging + comment permissions so the app can
message/read for end users who are NOT app testers, outside the 24h window. This is
the gate for "the app can do everything in production".

Status prerequisites (already done): Business verification approved, Access
Verification (Tech Provider) submitted/in review, app Live, privacy policy +
data-deletion + deauthorize URLs set on riverz.co, JSSDK enabled with riverz.co
allowed domain.

## Permissions to request (per use case)

Messenger (Facebook Page DMs):
- `pages_messaging` — receive and reply to Page DMs in the inbox
- `pages_show_list` — list the Pages the user manages so they can pick one
- `pages_read_engagement`, `pages_manage_metadata` — read Page context + subscribe the Page to webhooks
- `business_management` — resolve the user's business assets

Facebook comments:
- `pages_read_engagement` — read comments on the Page's posts/ads
- `pages_manage_engagement` — reply to / hide comments

Instagram (DMs + comments):
- `instagram_basic` — read the IG professional account profile/media
- `instagram_manage_messages` — receive and reply to IG DMs
- `instagram_manage_comments` — read and reply to IG comments

## Reviewer instructions (paste into each permission's "How will you use this" + test steps)

Riverz is a SaaS shared inbox + AI assistant for small merchants. A merchant
connects their own Facebook Page and Instagram professional account via Facebook
Login for Business. The app then shows their customers' WhatsApp/Instagram/
Messenger messages and comments in one inbox and lets the merchant (and an
optional AI assistant) read and reply. Data is used only to provide the inbox
service on the merchant's behalf; it is never sold or used for ads.

Test login (give the reviewer a working account): provide a test merchant email +
password for riverz.co AND add the reviewer's Facebook account as a tester on the
app (App Roles → Roles → add Tester), with a test Page + IG account they can grant.

Step-by-step the reviewer can follow:
1. Log in at https://riverz.co and open Integraciones.
2. Click Conectar on the Facebook card → Facebook Login for Business dialog →
   grant the Page → card turns green. (demonstrates pages_* permissions)
3. Click Conectar on the Instagram card (or it links via the same Page) → grant →
   green. (demonstrates instagram_* permissions)
4. Open Bandeja, open a conversation, send a reply. (pages_messaging /
   instagram_manage_messages)
5. Show a comment on the Page/IG arriving in the inbox and reply to it.
   (pages_read_engagement/pages_manage_engagement, instagram_manage_comments)

## Screencast video script (record ~2-3 min, screen recording with cursor)

Record on https://riverz.co (the allowed domain). Show the full flow end to end;
do not cut between permissions — reviewers want one continuous demo.

1. (0:00) Browser on https://riverz.co, log in. Land on the panel.
2. (0:15) Go to Integraciones. Narrate: "merchants connect their own channels here".
3. (0:25) Click Conectar on Facebook → the Facebook Login for Business popup opens
   → select the Page → accept all permissions → popup closes → card shows the Page
   connected (green). This single grant is what each pages_* permission is for.
4. (0:55) Click Conectar / Reconectar on Instagram → grant → green.
5. (1:15) Open Bandeja. Open a WhatsApp/Instagram/Messenger conversation. Read an
   inbound message, then TYPE and SEND a reply. Show it delivered.
6. (1:45) Show a comment (FB post or IG) appearing in the inbox; open it; reply to
   the comment and show the reply posted.
7. (2:15) Briefly show the AI assistant replying (optional) and the privacy policy
   link in the footer. End.

Tip on Windows: Win+G (Xbox Game Bar) records the screen; or use Loom/OBS. Upload
the mp4 in each use case's review form, then Submit.

## After submission

Meta reviews in a few business days. If they reject, the message names the exact
permission + reason; usually it's "video does not clearly show the permission in
use" — re-record that segment and resubmit. Advanced Access on each permission is
what lets the app message any customer, not just testers.
