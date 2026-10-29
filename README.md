# Kravitas

An AI content studio for creators and affiliates, like Higgsfield but simpler, with RekaLab-style prompt-to-video.
Your **friends** (characters made from real photos) keep the same face in every image and video. Your **products** keep
accurate packaging. One click turns a product into a ready-to-post TikTok Shop / Shopee ad.

## What's inside

- **Home**: bento overview of everything below, plus a 4-step getting-started guide.
- **Ad** (the money-maker): product + friend/avatar → hook, script, voice, lip-synced or showcase video, captions, hashtags. **Batch: 1, 3 or 5 variations** with different angles in one go. Talking engines: **Fast** (H3 Turbo + voice, cheapest), **Studio** (VEED Fabric), **Premium** (OmniHuman).
- **Video / Image / Talk**: camera-directed shots, packshots and thumbnails, talking heads.
- **Story + Storyboard**: plan scene by scene, edit narration/visual/camera, reorder; **edit a finished video and only changed scenes are re-rendered (and charged)**.
- **Voice studio**: ElevenLabs v3 (audio tags like [excited] [whispers]) and Multilingual, MiniMax voices with a natural Malay accent, **clone your own voice**, sound effects and background music.
- **AI avatars**: 8 ready-made Malaysian creator personas, or design your own (4 options to pick from). Saved as friends with a consistent face.
- **Brainstorm**: vision AI studies your photos and prompt, then chat to refine hooks and ideas.
- **Schedule / auto-post**: connect TikTok, Instagram, Facebook, YouTube and Threads; post now or schedule any creation, with the AI-generated label.
- **Plans**: monthly subscriptions (Creator RM79 → 1,600 credits) plus one-off top-ups via Stripe (card, FPX, GrabPay).

## Two ways to run

**Platform (hosted):** Supabase + Railway + Stripe. Every visitor silently gets a guest account with free
starter credits, and tops up through Stripe (card, FPX, GrabPay). Follow **[DEPLOY.md](DEPLOY.md)**.

**Local (your PC):** double-click **`start.bat`** (needs Node.js 20+). With no Supabase settings it runs as a
single-user studio at http://localhost:3365. Paste your fal.ai key under ⚙ to leave demo mode.

## Credits

1 credit ≈ US$0.01 of fal.ai cost (estimates in `lib/models.js`). A job reserves its estimated credits when
it starts, and the unused part is refunded when it ends (or if it fails or the server restarts).

## Where things live

```
server.js            API: guest auth, jobs, uploads, Stripe checkout + webhook, admin
lib/pipelines.js     The tools: each is a series of model calls tracked as a job
lib/models.js        Model IDs, inputs and credit prices
lib/prompts.js       Script / hook / story prompts (Malaysian affiliate tuned)
lib/ffmpeg.js        Stitching, voice-over mixing, burned captions, demo media
lib/fal.js           fal.ai queue + storage
lib/store/           Storage backends: supabase.js (platform) and local.js (PC)
supabase/schema.sql  Database setup for Supabase
public/              The studio UI (vanilla JS, no build step)
```

## Next steps

- Google / email login that upgrades the guest account
- Auto-post / schedule to TikTok, Instagram, Facebook, YouTube (RekaLab-style scheduler)
- Voice cloning so friends speak in their own voice
- Background music + more caption styles
