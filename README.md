# Vaani AI — Cloudflare Worker

The existing `vaani-ai` Worker serves both the static site and API from one origin. The current production deployment is not changed by these repository edits; review and deploy manually when ready.

## Source-of-truth and deployment boundaries

- **Deployed frontend source of truth:** `public/index.html`. The root `index.html` is kept byte-for-byte synchronized for compatibility and regression tests; update both together (the UI test enforces this).
- **Deployed API source of truth:** `src/index.js`, selected by `wrangler.toml` as the Worker entrypoint.
- `vaani-site/index.html` and `supabase/functions/vaani-api/index.ts` are legacy/alternate implementations, not automatically deployed by this Worker's `wrangler.toml`. Do not edit/deploy them as though they were the active production path without explicitly migrating and verifying that deployment.
- The Worker in-memory chat limiter is per-isolate best effort only. Production protection still requires a Cloudflare rate-limiting rule or a shared, durable limiter.

## Files
- `public/index.html`: Supabase Google sign-in, profile, credits, saved chat history and DB credit packs.
- `public/assets/stars.webp`: star texture.
- `src/index.js`: `POST /api/chat` SSE stream, Razorpay order/webhook/verify, admin API and static-site routing.
- `wrangler.toml`: Worker configuration for `vaani-ai`.
- `supabase/migrations/20261026_worker_hardening.sql`: make chat persistence + credit deduction transactional and fail-closed. Review against live schema and apply manually before real usage.
- `supabase/migrations/20261028_audit_security_hardening.sql`: revoke anonymous execution of `is_admin()` and prevent duplicate non-null Razorpay payment IDs. Review and apply through the approved migration workflow.
- `public/privacy.html`, `public/terms.html`, `public/refund.html`, `public/contact.html`: legal drafts with explicit owner TODOs.

## Local run
```sh
npm install
cp .dev.vars.example .dev.vars
npx wrangler dev
```
Fill `.dev.vars` locally; never commit it.

## Set secrets
Run each command in this repository directory and enter the value only in the terminal prompt. Never paste values into chat or GitHub.
```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

## OAuth and deployment
Supabase URL: `https://voohqnqyspxdlyaqygof.supabase.co`
Google callback: `https://voohqnqyspxdlyaqygof.supabase.co/auth/v1/callback`
Enable Google provider in Supabase Auth and add the exact Worker origin to Site URL / Redirect URLs. After verifying the owner has logged in, set only the intended owner profile's `is_admin = true`.

After reviewing the changes and verifying the Cloudflare account, deploy with:
```sh
npx wrangler deploy
```
This deploy updates the Worker named `vaani-ai`; it must not be run until you are ready to replace the demo deployment.

Configure Razorpay webhook URL:
`https://vaani-ai.radhadevi05051980.workers.dev/api/razorpay-webhook`
Subscribe to `payment.captured`. Fulfilment uses the idempotent `fulfill_order` SQL function.

## Model setting
The Worker reads the model exclusively from the Supabase `app_settings` row with key `model`. It returns a configuration error if the setting is missing; there is no hardcoded model fallback.

## Production checklist
- Apply and verify the SQL hardening migration after checking the live schema.
- Verify Google OAuth, chat stream and per-user isolation.
- Test Razorpay in test mode: order amount, signature, webhook, and exactly-once credit grant.
- Replace every TODO in the legal pages before live payments.
- The built-in per-isolate rate limit is best effort only. Configure Cloudflare edge rate limiting for reliable production abuse controls.
