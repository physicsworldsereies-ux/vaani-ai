# Vaani production setup package

This package updates the supplied Vaani single-page app to use a server-side Supabase Edge Function for Gemini chat and Razorpay payments, adds an admin panel, and includes a security-hardening migration.

## Important status

- The HTML now calls `vaani-api` for AI responses and payments; it will not fake AI answers or successful payments.
- A deployed Supabase Edge Function and the migration are required for those calls to work.
- Razorpay and Gemini secrets are intentionally not embedded in the browser or this repository.
- Google OAuth must be configured in Supabase Auth and its redirect URLs must include the deployed website URL.
- The admin panel appears only for profiles with `is_admin = true`. Set the first admin manually in the Supabase SQL editor after verifying the exact account ID/email.

## 1. Supabase migration

Review and apply `supabase/migrations/20261025_secure_credits_admin.sql` to project `voohqnqyspxdlyaqygof`. This migration deliberately removes direct browser write privileges for chat messages, orders, credit ledger, credit packs, and admin settings. The updated frontend uses the Edge Function for those operations. Back up the project and test in a branch before production application.

## 2. Deploy Edge Function

Deploy `supabase/functions/vaani-api/index.ts` as function `vaani-api` with platform JWT verification **disabled** (`verify_jwt = false`) because the same function receives Razorpay webhook calls. The function itself validates a Supabase access token for every non-webhook action, and validates the Razorpay HMAC signature for `/webhook`. Keep the service role key secret. Do not disable the function’s internal authentication checks.

## 3. Configure Edge Function secrets

Set these as Supabase Edge Function secrets, never in HTML:

- `GEMINI_API_KEY` — Google AI Studio API key
- `RAZORPAY_KEY_ID` — Razorpay public key ID
- `RAZORPAY_KEY_SECRET` — Razorpay secret key
- `RAZORPAY_WEBHOOK_SECRET` — a separate webhook secret configured in Razorpay
- `APP_ORIGIN` — exact deployed website origin, e.g. `https://your-domain.example`

Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Confirm they are available in your project runtime. Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## 4. Razorpay dashboard

Create a webhook pointing to `https://voohqnqyspxdlyaqygof.supabase.co/functions/v1/vaani-api/webhook`. Subscribe to `payment.captured` and `order.paid`, use a strong webhook secret, and configure allowed payment methods in Razorpay. Test with Razorpay test mode first. Switch to live credentials only after successful end-to-end tests and account approval.

## 5. Google OAuth

In Supabase Dashboard → Authentication → Providers, enable Google and configure the OAuth client ID/secret. In Authentication → URL Configuration, set the production Site URL and add the exact production URL plus local preview URL to Redirect URLs. Google must remain the only login option in the UI.

## 6. First admin

After confirming the exact user row, run a narrowly scoped SQL update in the Supabase SQL editor:

```sql
UPDATE public.profiles SET is_admin = true WHERE email = 'YOUR_VERIFIED_ADMIN_EMAIL';
```

Replace the example with your own verified account email. Do not make every user an admin.

## 7. Host the frontend

Host `index.html` on a static host (Cloudflare Pages, Netlify, or another static host). Ensure the `APP_ORIGIN` secret and Supabase Auth redirect URLs match the exact domain. This package does not claim that the site has been published to a public domain.

## Admin panel

The admin panel provides dashboard stats, user ban/unban and role controls, credit adjustments, pack price/credit activation controls, settings (system prompt, model, maintenance mode and credit rates), orders, and ledger. All write actions go through the server-side function, which verifies the signed-in user's `profiles.is_admin` value.
