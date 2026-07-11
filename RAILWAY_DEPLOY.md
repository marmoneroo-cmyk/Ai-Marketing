# Railway Deployment

BrandPilot runs as **3 services** on Railway + **Redis** (Railway) + **Postgres** (Supabase, already migrated).

Build/start for each service is declared as **config-as-code** in this repo, so you don't hand-type commands:

| Service | Railway config file | Public domain |
|---------|--------------------|---------------|
| api     | `railway.api.json`    | Yes |
| worker  | `railway.worker.json` | No (background) |
| web     | `railway.web.json`    | Yes |

> api & worker run via `tsx` (no compile). Only web builds (`next build`). All workspace
> packages are source-only TS, so the whole system runs from source — no `dist` packaging.

## One-time setup (in the Railway dashboard)

1. **Redis** — `+ New → Database → Add Redis`.
2. For **each** of the 3 services: `+ New → GitHub Repo → marmoneroo-cmyk/Ai-Marketing`, then in
   **Settings**:
   - **Root Directory** = `/` (repo root — required for the pnpm workspace).
   - **Config-as-code file** = the matching `railway.*.json` from the table above.
   - Networking → **Generate Domain** for `api` and `web`.

## Environment variables

Set these per service (Railway → service → Variables). Secrets are **never** committed.

**api** and **worker**:
```
NODE_ENV=production
DATABASE_URL=<Supabase pooler string, the :5432 session one>
REDIS_URL=${{Redis.REDIS_URL}}
AUTH_SECRET=<32-byte base64>
TOKEN_ENCRYPTION_KEY=<32-byte base64>
ANTHROPIC_API_KEY=<real key>
VOYAGE_API_KEY=<real key>
```
**api** also (its own public origin + CORS + OAuth redirect base):
```
APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
```

**web** — do **not** set `NODE_ENV=production` here (the build needs devDependencies):
```
NEXT_PUBLIC_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
```
`NEXT_PUBLIC_*` is baked in at build time — set it before the first web build.

### Generate the two secrets (locally)
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # TOKEN_ENCRYPTION_KEY
```

## Connecting Instagram / Facebook (Meta)

The Meta connector is **real** (Graph API v21.0): once configured it pulls real media/comments
and the discovery engine analyzes them. To turn on the **Connect Instagram/Facebook** buttons,
set these on **api** and **worker**:
```
META_APP_ID=<from your Meta app>
META_APP_SECRET=<from your Meta app>
META_VERIFY_TOKEN=<any random string; re-enter the same value in the Meta webhook config>
```

Then in the [Meta developer dashboard](https://developers.facebook.com/apps):
1. Create an app — type **Business** — and add the **Facebook Login** + **Instagram** products.
2. Set the **Valid OAuth Redirect URI** to (byte-identical — this is `${API_URL}/connectors/meta/callback`):
   `https://<your-api-domain>/connectors/meta/callback`
3. Scopes are already requested by the code: `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`.
4. The Instagram account must be **Business or Creator**, linked to a **Facebook Page**
   (the Graph API cannot read personal IG accounts).
5. In **Development** mode it works for you + added testers. For real customers, submit for
   **Meta App Review** + Business Verification.

Until `META_APP_ID` is set, `Connect` returns `META_APP_ID is not configured`.
The same one Meta app powers both Instagram and Facebook (one start/callback pair).
Comment webhooks (optional) land at `https://<api-domain>/connectors/meta/webhook`, verified by `META_VERIFY_TOKEN`.

## Other integrations (optional — set to enable each)

Every one of these is **optional**: the app boots without them and each feature degrades
gracefully until its keys are set. OAuth redirect URIs are all built from `API_URL`.

### Google sign-in ("Continue with Google") — set on **api**
```
GOOGLE_CLIENT_ID=<Google Cloud OAuth client>
GOOGLE_CLIENT_SECRET=<Google Cloud OAuth client>
```
- Authorized redirect URI: `https://<api-domain>/auth/google/callback`
- Scopes: `openid email profile` (configure the OAuth consent screen in Google Cloud).
- If unset, the button degrades to `?oauth_error=google_unavailable` — no crash.

### TikTok — set on **api** + **worker**
```
TIKTOK_CLIENT_KEY=<TikTok developer app>
TIKTOK_CLIENT_SECRET=<TikTok developer app>
```
- Redirect URI: `https://<api-domain>/connectors/tiktok/callback`
- Scopes: `user.info.basic`, `video.list`.

### WhatsApp (Meta Cloud API) — set on **api** + **worker** (also uses `META_APP_ID`/`META_APP_SECRET`)
```
WHATSAPP_TOKEN=<permanent system-user token>
WHATSAPP_PHONE_NUMBER_ID=<from WhatsApp > API setup>
WHATSAPP_VERIFY_TOKEN=<random string; enter the same value in the Meta webhook config>
```
- Webhook callback URL: `https://<api-domain>/connectors/whatsapp/webhook`

### AI media + other keys (set on **api** + **worker** unless noted)
```
FAL_KEY=<fal.ai key>            # generates the image/video/reel formats
FIRECRAWL_API_KEY=<key>         # website crawl for discovery / onboarding
STRIPE_SECRET_KEY=<key>         # billing
STRIPE_WEBHOOK_SECRET=<secret>  # verifies Stripe webhook signatures
S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY   # media storage
SENTRY_DSN=<dsn>                # error tracking
EMAIL_FROM="BrandPilot <no-reply@yourdomain>"   # transactional email sender identity
```

## Notes
- **DB port**: use `:5432` (Supabase session pooler — the one migrations ran on). `:6543`
  (transaction) needs `prepare:false` in the postgres.js client, which isn't set.
- **Migrations** are already applied to Supabase (64 tables). No migrate step runs on deploy.
  To add one later: a release command `pnpm --filter @brandpilot/db migrate`.
- **Node** is pinned to 20 via `.node-version`. pnpm (9.12.0) comes from `packageManager`.
