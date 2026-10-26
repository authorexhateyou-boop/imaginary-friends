# Imaginary Friends Studio

An AI content studio for creators and affiliates, like Higgsfield but simpler, with RekaLab-style prompt-to-video.
Your **friends** (characters made from real photos) keep the same face in every image and video. Your **products** keep
accurate packaging. One click turns a product into a ready-to-post TikTok Shop / Shopee ad.

## How it works

One screen, like Higgsfield: pick a mode at the top (**Video · Image · Ad · Talk · Story**), tap a preset,
attach a friend/product with **＋**, type a prompt in the bar at the bottom and hit **Generate**
(or Ctrl+Enter). Results land in your feed; click one to watch, download, copy the caption, or reuse its settings.

## Modes

| Tool | What it does | Models (via fal.ai) |
|---|---|---|
| 🛍️ **Affiliate Ad** | Product + friend → hook, script, voice-over, lip-synced talking UGC *or* product showcase video, burned captions, caption + hashtags | Script AI → Nano Banana 2 → ElevenLabs → OmniHuman 1.5 / video model |
| 🎬 **Direct the Shot** | Keyframe with your friend's face → camera-directed video (dolly, orbit, crane, FPV…) or animate your own image | Nano Banana 2 → MiniMax H3 / Seedance 2.0 / Kling 3.0 |
| 📽️ **Story Video** | One prompt → planned scenes, narration, images, motion, stitched video with captions | Script AI → ElevenLabs → Nano Banana 2 → video model → ffmpeg |
| 🗣️ **Talking Avatar** | Make a friend say any script (or AI writes one) | ElevenLabs → OmniHuman 1.5 |
| 🖼️ **Image Studio** | Packshots, lifestyle, flat lays, thumbnails, with friend/product references | Nano Banana 2 (+ edit) |
| ✍️ **Script Writer** | API only for now (the Ad tool already writes hook, script, caption and hashtags) | Script AI |

Languages: Bahasa Melayu, English, Manglish. Platforms: TikTok Shop, Shopee, Lazada, Instagram Reels.

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
