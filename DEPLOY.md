# Going live: Supabase + Railway + Stripe

About 30 minutes. You need accounts on supabase.com, railway.com, stripe.com and fal.ai, and this folder pushed to your GitHub repo (`imaginary-friends`).

## 1. Supabase (database, guest accounts, file storage)

1. Create a project (region: **Southeast Asia (Singapore)**).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**. This creates the tables, the credit functions and the public `media` bucket.
3. **Authentication → Sign In / Providers → Anonymous Sign-Ins → Enable.** This gives every visitor a guest account with no sign-up.
4. **Project Settings → API**: copy the **Project URL**, the **anon public** key and the **service_role** key. The service_role key is a full-access secret: put it only in Railway, never in the browser or GitHub.

## 2. fal.ai (the AI models)

1. https://fal.ai/dashboard/keys → create a key.
2. Add billing credit on fal. All users' generations are paid from this balance, and your Stripe sales refill it.

## 3. Railway (runs the app)

1. **New Project → Deploy from GitHub repo** → pick `imaginary-friends`. Railway detects Node and runs `npm install`, which also downloads ffmpeg.
2. **Variables**: add everything from `.env.example`:
   - `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_TOKEN` (any long random string)
   - `FREE_CREDITS=30` (welcome credits per guest)
   - `COMPANY_NAME` and `SUPPORT_EMAIL` (shown on /terms and /privacy)
3. **Settings → Networking → Generate Domain**. Copy it and set `PUBLIC_URL=https://<your-domain>`.
4. Open the domain. You should land on the studio with 30 credits.

## 4. Stripe (selling credits)

1. Use **Test mode** first. In **Developers → API keys** copy the **Secret key** → Railway `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Copy the **Signing secret** → Railway `STRIPE_WEBHOOK_SECRET`.
3. **Settings → Payment methods**: turn on **FPX** and **GrabPay** (cards are on by default). Checkout shows whatever you enable there.
4. Test: open the site → click your credits → buy a pack with card `4242 4242 4242 4242` (any future date, any CVC). Credits appear when you return.
5. When it works, switch Stripe to Live mode and replace both Stripe variables with the live values.

## Pricing

1 credit ≈ US$0.01 of fal.ai cost. The default packs are RM25 → 400, RM59 → 1,000 and RM149 → 2,800 credits. Margins are thin after Stripe fees and exchange rates, so set your own prices with the `PACKS` variable (see `.env.example`). Per-model credit costs are in `lib/models.js`.

## Admin

Grant credits (beta testers, refunds). The user's Account ID is shown in their Credits window:

```bash
curl -X POST https://<your-domain>/api/admin/credits \
  -H "x-admin-token: <ADMIN_TOKEN>" -H "content-type: application/json" \
  -d '{"userId":"<account id>","credits":500,"note":"Beta tester"}'
```

List users: `curl https://<your-domain>/api/admin/users -H "x-admin-token: <ADMIN_TOKEN>"`

## Before you announce it

- Read `/terms` and `/privacy` on your site. They're a solid starting template written for Malaysia's PDPA, but have them checked before you take real payments.
- Do one real RM purchase in Stripe Live mode and refund it from the Stripe dashboard.
- Generate one of each mode (Video, Image, Ad, Talk, Story) with the real fal key and check the costs in your fal dashboard against the credits charged. Adjust `lib/models.js` if needed.

## Good to know

- **Guest accounts live in the browser.** If someone clears their browser data they lose access to their credits and creations. Adding Google or email login later can attach to the same account (Supabase "link identity"), so nobody loses anything.
- **Abuse:** every new browser gets `FREE_CREDITS`. Supabase rate-limits anonymous sign-ins per IP (adjust under Authentication → Rate Limits). For stronger protection, turn on CAPTCHA (Cloudflare Turnstile) in Supabase; that also needs a small front-end change.
- **Redeploys:** generations running during a redeploy are marked failed and their unused credits refunded automatically.
- **Storage:** generated media is public by unguessable URL (fal.ai needs to fetch inputs). Don't use it for anything private.
- **Local mode still works:** with no Supabase variables, `start.bat` runs the single-user studio on your PC as before.
