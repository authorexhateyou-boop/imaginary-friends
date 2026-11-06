# Going live: Supabase + Railway (or Vercel) + Stripe

> **Vercel for now?** It works: import the repo in Vercel (Framework preset: *Other*, no build command, `vercel.json` handles the rest),
> add the same environment variables as in the Railway step below, and redeploy. Limit: a function can run for at most
> 5 minutes (Hobby; up to 13 on Pro if you raise `maxDuration` in `vercel.json`), so long Story videos or slow models may
> time out. Those jobs are failed and refunded automatically. Use the fast *MiniMax H3 Turbo* model, and move to Railway
> when you have real users.

About 30 minutes. You need accounts on supabase.com, railway.com, stripe.com and fal.ai, and this folder pushed to your GitHub repo (`imaginary-friends`).

## 1. Supabase (database, guest accounts, file storage)

1. Create a project (region: **Southeast Asia (Singapore)**).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run** (run it again after updates; it's safe to re-run). This creates the tables, the credit functions and the public `media` bucket.
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
   - `FREE_CREDITS=40` (welcome credits per guest, about 4 Motion ads)
   - `COMPANY_NAME` and `SUPPORT_EMAIL` (shown on /terms and /privacy)
3. **Settings → Networking → Generate Domain**. Copy it and set `PUBLIC_URL=https://<your-domain>`.
4. Open the domain. The landing page is at `/` and the studio at `/studio`, where you start with 40 credits.

## 4. Stripe (selling credits)

1. Use **Test mode** first. In **Developers → API keys** copy the **Secret key** → Railway `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid` (monthly plan renewals) and `customer.subscription.deleted`
   - Copy the **Signing secret** → Railway `STRIPE_WEBHOOK_SECRET`.
3. **Settings → Payment methods**: turn on **FPX** and **GrabPay** (cards are on by default). Checkout shows whatever you enable there. Note: monthly plans (subscriptions) are paid by card; FPX and GrabPay work for one-off top-ups.
   **Settings → Billing → Customer portal**: activate it so subscribers can change or cancel their plan from Kravitas.
4. Test: open the site → click your credits → buy a pack with card `4242 4242 4242 4242` (any future date, any CVC). Credits appear when you return.
5. When it works, switch Stripe to Live mode and replace both Stripe variables with the live values.

## 5. Auto-posting (Post for Me)

1. Sign up at https://www.postforme.dev (from US$10/month for 1,000 posts, unlimited connected accounts) and create an API key.
2. Add `POSTFORME_API_KEY` in Railway/Vercel and redeploy. The Schedule tab's Connect buttons then open the real TikTok, Instagram, Facebook, YouTube and Threads logins.
3. Videos must be on Supabase storage (hosted mode) so the platforms can fetch them. Posting doesn't work from the PC-only version.

## Pricing

Credits = AI cost in US cents × `CREDIT_MARKUP` (1.9), so 1 credit ≈ US$0.0053 of AI cost.

| Plan | Price | Credits | Unlocks | Gross margin if every credit is used |
|---|---|---|---|---|
| Basic | RM39/mo | 600 | Motion ads · up to 3 variations | ~59% |
| Starter | RM59/mo | 1,000 | + Lite and Fast AI video, camera video shots | ~60% |
| Creator | RM129/mo | 2,500 | + Studio lip-sync, Kling, Seedance · 5 variations · voice cloning · auto-post | ~55% |
| Pro | RM299/mo | 6,500 | + Premium (OmniHuman), Kling Pro | ~48% |

What an 8–10s talking ad costs: **Motion ≈ 9 credits** (animated still + Turbo voice, no AI video), **Lite ≈ 32** (H3 Turbo, Seedream/FLUX keyframe, Turbo voice), Fast ≈ 49, Studio ≈ 170, Premium ≈ 320. So Basic makes ~66 Motion ads and Starter ~110 Motion or ~30 Lite ads a month. Ads default to **Approve first**: scripts and the keyframe are made for a few credits, and the expensive voice + video render only runs after the user approves (and can edit) the script. Guests without a plan can use Motion only (like Basic), which keeps free credits cheap to give away. Top-up packs (RM25 → 300, RM59 → 800, RM129 → 2,000) cost more per credit than plans on purpose. Change them with `PLANS` and `PACKS`; per-model costs and tiers are in `lib/models.js`.

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
