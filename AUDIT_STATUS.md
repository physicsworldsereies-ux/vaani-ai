# Vaani production audit — findings and next actions

Audit date: 2026-10-26

This is a repository and public-site review, not a claim that the production environment has been fully penetration-tested. No live database writes, payment transactions, deployments, or secret changes were performed.

## Confirmed observations

- Public site: https://vaani-ai.radhadevi05051980.workers.dev/
- GitHub repository: https://github.com/physicsworldsereies-ux/vaani-ai
- The repository's current frontend calls a Supabase Edge Function at `/functions/v1/vaani-api`.
- The live public hostname is a Cloudflare Workers `workers.dev` URL. That alone does not prove which source revision or backend is deployed.
- The public page displayed a Razorpay **Test Mode** indicator during inspection. Do not accept real payments until the intended live/test configuration is verified.
- The repository Edge Function contains chat, credit-pack order creation, signature verification, webhook fulfilment, and admin actions. Their presence in source does not prove those flows work in production.
- A Supabase project inspection previously showed core tables with RLS enabled, but security-advisor warnings and migration-state uncertainty remain. Do not assume the security migration in this repository has been applied to production.

## Release blockers to verify

1. **Choose one deployment architecture.** Decide whether the production app is the Supabase Edge Function architecture in this repository or the separate Cloudflare Worker implementation from the ZIP. Do not mix the two accidentally.
2. **Match production to source.** Inspect the Cloudflare Worker’s Settings → Builds Git repository, deployed version, and runtime bindings. Cloudflare documents connecting an existing Worker under Workers & Pages → Worker → Settings → Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
3. **Database security.** Back up the database, inspect the actual policies/grants/functions and migration history, then apply/reconcile `supabase/migrations/20261025_secure_credits_admin.sql` only after reviewing it against the live schema. Do not run the fresh-project bootstrap on an existing database.
4. **Edge Function deployment.** Confirm `vaani-api` exists and deploy the reviewed source. Configure `GEMINI_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and exact `APP_ORIGIN` as server-side secrets/settings. Never commit their values.
5. **Google OAuth.** Confirm Google provider, authorized redirect URI, Site URL, and exact production callback.
6. **Payments.** In test mode, verify order creation, browser signature verification, signed webhook delivery, idempotent fulfilment, amount/currency consistency, and exactly-once credit grant. Do not switch to live payments until these pass.
7. **Admin authorization.** Verify only the intended account is an admin. Test that ordinary users cannot change credits, admin flags, ban status, packs, settings, or orders through direct browser/API calls.
8. **Abuse controls.** Add a maximum request-body size, rate limiting for chat/order creation, and operational logging that never logs tokens or secrets. Confirm error paths do not charge credits twice or leave inconsistent history.

## Verification status

- [x] Public landing page reachable.
- [x] GitHub source reviewed.
- [ ] Production Cloudflare repository connection and deployed revision verified.
- [ ] Supabase migration/security state reconciled.
- [ ] Edge Function deployment and secrets verified.
- [ ] Google OAuth end-to-end verified.
- [ ] Razorpay test payment and webhook end-to-end verified.
- [ ] Chat/credit/admin abuse tests passed.

## Cloudflare connection checklist

For an existing Worker, open Workers & Pages → select the Worker → Settings → Builds → Connect. Select this repository and configure the root directory/build settings to match the actual Wrangler configuration. The Worker name must match the `name` in the Wrangler config. Review the build and preview before relying on production.

Official guide: https://developers.cloudflare.com/workers/ci-cd/builds/

Do not paste secrets into GitHub, chat, screenshots, or public issue comments.
