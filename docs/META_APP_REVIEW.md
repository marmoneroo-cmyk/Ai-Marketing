# Meta App Review Kit — BrandPilot

This is your step-by-step kit to get **Instagram (Instagram API with Instagram Login)**
permissions approved so **every customer** can connect in one click with full data access —
not just accounts added as Testers.

> **The one-time gate.** Everything you struggled with (scopes, reconnect, "comments hidden")
> is because the app is in **Development mode**, where only Testers get data. App Review moves
> the app to **Live mode**, after which any customer gets one-click connect + full data. This is
> the same review HubSpot, Later, Buffer, and Hootsuite all pass. You do it **once**.

---

## 0. What you'll submit (the checklist)

- [ ] **Business Verification** completed in Meta Business Settings.
- [ ] **Privacy Policy URL**, **Terms URL**, **Data Deletion URL** set in App Settings → Basic (see §2).
- [ ] App icon (1024×1024), category, and long description filled in.
- [ ] For each permission: a **written justification** (§4) + a **screencast** (§5).
- [ ] **Reviewer test instructions** + a test login (§6).
- [ ] **Data Handling questionnaire** answered (§7).
- [ ] Submit for review.

Permissions to request (request only what you use now; add messaging later):

| Permission | Feature it powers | Priority |
|---|---|---|
| `instagram_business_basic` | Read account profile, media, follower count | Now |
| `instagram_business_content_publish` | Publish scheduled posts | Now |
| `instagram_business_manage_comments` | Ingest comments into the inbox + reply | Now |
| `instagram_business_manage_messages` | Ingest & reply to DMs | Later (needs the webhook, see §8) |

---

## 1. Prerequisites

1. **Business Verification** — Meta Business Settings → Security Center → verify your business
   (legal name, address, a document or domain/phone). Advanced Access for these permissions
   requires it. This is usually the longest step (can take a few days), so **start it first**.
2. Confirm the Instagram account you test with is a **Business or Creator** account.
3. Make sure the app's **Instagram → API setup with Instagram login** has the redirect URI
   registered **exactly**: `https://<YOUR_API_DOMAIN>/connectors/instagram/callback`
   (your deployed API domain — e.g. the Railway API URL).

---

## 2. URLs to paste (App Settings → Basic)

Replace `<YOUR_APP_DOMAIN>` with your deployed **web** domain:

| Field | Value |
|---|---|
| Privacy Policy URL | `https://<YOUR_APP_DOMAIN>/privacy` |
| Terms of Service URL | `https://<YOUR_APP_DOMAIN>/terms` |
| User Data Deletion | Choose **"Data Deletion Instructions URL"** → `https://<YOUR_APP_DOMAIN>/data-deletion` |

> These three pages are already built and live in the app. Verify each opens publicly (in an
> incognito window, logged out) before submitting — Meta's reviewer must reach them without a login.

---

## 3. App details (App Settings → Basic / App Review)

- **Category:** Business / Marketing.
- **App icon:** 1024×1024 PNG.
- **Short/long description:** e.g. *"BrandPilot is an AI marketing assistant for small businesses.
  It connects a business's own Instagram account to help the owner plan and publish content,
  see their audience, and manage comments — all reviewed and approved by the owner."*

---

## 4. Permission justifications (paste into each permission's "How will you use…" box)

Keep each answer specific to what the app does with **the user's own account**.

### `instagram_business_basic`
> We use this to read the connected business's own account profile, media, and follower count so
> the owner can see their audience and so our content tools can reference the account's existing
> posts. Data is shown only to the account owner inside their private dashboard and is never sold
> or shared for advertising.

### `instagram_business_content_publish`
> We use this to publish posts that the business owner has drafted and explicitly approved and
> scheduled inside BrandPilot, to the business's own Instagram account. Nothing is published without
> the owner's approval.

### `instagram_business_manage_comments`
> We use this to read comments on the business's own media and display them in a unified inbox so
> the owner can respond, and — when the owner approves — to reply to those comments on their behalf.
> This helps small-business owners keep up with customer engagement. We only access comments on the
> connected account's own media.

### `instagram_business_manage_messages` (only if requesting messaging now)
> We use this to receive direct messages sent to the business's own account and display them in the
> owner's inbox, and — when the owner approves a drafted reply — to send responses on their behalf,
> so the owner can manage customer conversations in one place.

---

## 5. Screencast scripts (record one short video per permission)

Record with a **Business/Creator IG account that is added as a Tester** (so data flows in Dev mode
while recording). Show the real product. Keep each 30–90s.

**Common intro (all videos):** Show logging into BrandPilot → Settings → clicking **Connect
Instagram** → the Instagram consent screen listing the permission → approving → landing back
connected.

- **basic:** After connecting, open the Dashboard and show the **follower count** + the account
  handle populated from the account. Narrate: *"basic profile + follower data is shown only to the
  owner."*
- **content_publish:** Open **Content**, show a drafted post, **approve + schedule** it, then show it
  publishing to the connected Instagram account (or the scheduled state + the resulting post).
  Narrate that publishing only happens after owner approval.
- **manage_comments:** Show a comment appearing in the **Inbox** (post a test comment from another
  tester account first), open it, show the drafted reply, and send/approve it. Narrate that only the
  owner's own media comments are accessed.
- **manage_messages** (if applicable): Show a DM arriving in the Inbox and a drafted reply being
  approved and sent.

> Tip: Meta rejects vague videos. Show the **actual button clicks**, the **consent screen**, and the
> **data in the product** for the specific permission. No slideshows.

---

## 6. Reviewer test instructions (paste into "Instructions for reviewer")

> 1. Go to `https://<YOUR_APP_DOMAIN>` and sign in with the test account below.
> 2. Go to **Settings → Connected channels → Connect Instagram** and approve the permissions with a
>    Business/Creator Instagram account.
> 3. **Dashboard** shows the account's follower count (basic).
> 4. **Content** → approve & schedule a draft to publish (content_publish).
> 5. Post a comment on one of the account's posts; within ~10 minutes it appears in **Inbox** with a
>    drafted reply (manage_comments).
>
> Test login: **email:** `<reviewer test email>` — **password:** `<reviewer test password>`
> (Create a dedicated reviewer account; do not use your real credentials.)

---

## 7. Data Handling questionnaire (typical answers)

- **Do you sell or share Platform Data?** No.
- **Do you transfer it to third parties?** Only to subprocessors that operate the service on our
  behalf (AI providers, hosting, storage) — listed in our Privacy Policy — never for advertising.
- **How is it stored/secured?** Encrypted access tokens (AES-256-GCM) at rest, TLS in transit,
  per-organization data isolation, access restricted to authorized systems.
- **Deletion:** Users disconnect a channel (token deleted immediately) or request account deletion;
  data is deleted within 30 days. See the Data Deletion URL.

---

## 8. Enabling DMs (messaging) — extra steps beyond comments

Messaging is delivered by **webhook**, not polling, so before requesting `manage_messages`:

1. In the app's **Instagram → Webhooks**, set the callback URL to
   `https://<YOUR_API_DOMAIN>/connectors/meta/webhook` and the **Verify Token** to your
   `META_VERIFY_TOKEN` env value, then subscribe the **`messages`** (and optionally **`comments`**)
   fields.
2. Re-connect Instagram so the account is subscribed.
3. Then request `instagram_business_manage_messages` in App Review with the messaging screencast.

> Comments already work by polling (no webhook needed). Webhooks make both comments **and** DMs
> real-time; the ingestion pipeline already parses both.

---

## 9. After approval

- Switch the app to **Live** mode.
- From then on, **any customer** clicks Connect Instagram, approves, and all data flows — no Tester
  setup, no reconnect friction. That's the one-click experience.

---

### Quick reference — what's already built for you
- ✅ Privacy / Terms / Data Deletion pages (live at `/privacy`, `/terms`, `/data-deletion`).
- ✅ Instagram Login connect + reconnect, token auto-refresh, comment ingestion pipeline.
- ✅ Meta webhook receiver (`/connectors/meta/webhook`) with signature verification, ready for DMs.
- ⏳ You provide: business verification, app icon, screencasts, a reviewer test account, and the
  final registered business name/address in the legal pages.
