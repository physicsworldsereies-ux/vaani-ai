# Vaani production setup package

This repository's current deployment architecture is:
- **Frontend:** root `index.html`, a static site suitable for Cloudflare Pages.
- **Backend:** Supabase Edge Function `supabase/functions/vaani-api/index.ts`.
- **Database:** Supabase Postgres, with security migration under `supabase/migrations/`.
- **Payments:** Razorpay orders and signed webhook handled by the Edge Function.
- **AI:** Gemini called server-side by the Edge Function.

Do not deploy the older Cloudflare Worker from the supplied ZIP alongside this backend without intentionally migrating the architecture. The current frontend calls `https://<project-ref>.supabase.co/functions/v1/vaani-api`, not a Cloudflare Worker URL.

## Repository contents and database setup

- `index.html`: current frontend, Google OAuth UI, chat, credit packs, Razorpay checkout, admin interface, legal dialogs.
- `supabase/functions/vaani-api/index.ts`: authenticated chat/payment/admin API and Razorpay webhook.
- `supabase/migrations/20261025_secure_credits_admin.sql`: security hardening for an existing schema.
- `supabase/bootstrap/initial_schema.sql`: initial schema for a **brand-new/empty Supabase project only**. It is intentionally outside the migrations folder so it is not automatically applied to an already populated production database.

### Important: do not blindly run the bootstrap against the existing live database

The bootstrap creates tables, policies, triggers, functions, defaults and sample credit packs. If your current Supabase project already has these objects, running the bootstrap there can fail on existing objects or create duplicate setup. First inspect the live database and migration history. For a fresh project, run the bootstrap once in the SQL Editor, then apply the security migration. For an existing project, verify its schema against the bootstrap and review/apply only the necessary changes, including the security migration, after taking a backup.

The security migration revokes direct browser writes to credit/payment/admin data and leaves those operations to the Edge Function. Review the SQL and test before applying to production.

## Deploy the Edge Function

Deploy `supabase/functions/vaani-api/index.ts` as `vaani-api` with platform JWT verification **disabled** (`verify_jwt = false`) because Razorpay webhooks do not carry Supabase user JWTs. The function itself validates a Supabase access token for every non-webhook action and validates the Razorpay HMAC signature for `/webhook`. Do not disable those internal checks.

## Required Supabase Edge Function secrets

Set these in Supabase Dashboard → Edge Functions → Secrets, never in HTML or Git:

- `GEMINI_API_KEY` — Google AI Studio API key
- `RAZORPAY_KEY_ID` — Razorpay key ID
- `RAZORPAY_KEY_SECRET` — Razorpay secret
- `RAZORPAY_WEBHOOK_SECRET` — separate secret configured for the webhook
- `APP_ORIGIN` — exact deployed website origin, e.g. `https://your-domain.example`

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Confirm them in the runtime. Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## Razorpay dashboard

Configure webhook URL:
`https://voohqnqyspxdlyaqygof.supabase.co/functions/v1/vaani-api/webhook`

Subscribe to `payment.captured` and `order.paid`. Use a separate strong webhook secret. Test end-to-end in Razorpay test mode before enabling live credentials.

## Google OAuth

In Supabase Dashboard → Authentication → Providers, enable Google and configure the OAuth client ID/secret. In Authentication → URL Configuration, set the production Site URL and add the exact production URL plus any required preview URL to Redirect URLs. The UI is intended to offer Google login only.

## First admin

After signing in with the intended Google account and verifying its profile row, grant admin only to that exact account:
```sql
UPDATE public.profiles SET is_admin = true WHERE email = 'YOUR_VERIFIED_ADMIN_EMAIL';
``
Do not make all users admins.

## Cloudflare Pages

Connect `physicsworldsereies-ux/vaani-ai` to Cloudflare Pages and set the project root/build settings for a static HTML site (root directory `/`, no build command, output directory `/`). The file `index.html` is at repository root. Confirm the final Pages domain matches `APP_ORIGIN` and Supabase Auth redirect configuration. This repository inspection does not prove that a Pages project or deployment already exists.

## Verification still required

Repository contents alone cannot prove live Supabase or Cloudflare state. Verify separately:
1. Whether the security migration is applied and the live schema/RLS matches it.
2. Whether the Edge Function is deployed and its secrets exist.
3. Whether Google OAuth callback/redirect settings work for the exact site URL.
4. Whether Razorpay test-mode order creation, checkout, webhook signature, and idempotent credit fulfilment work end-to-end.
5. Whether Cloudflare Pages points at this repository and deploys the root `index.html`.

Never commit secrets, local `.env` files, Supabase service-role keys, or Razorpay secrets.
