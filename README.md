# The US Verdict — daily auto post (free version)

Same pipeline as your Honest Brit (UK) system, retargeted at "The US Verdict"
using the priorities and peak-time schedule from your US strategy doc.

## What it does
1. Reads US politics headlines from free RSS feeds (NPR, ABC News, The Hill,
   Fox News) and scores them against your Gallup-based priority list
   (healthcare → economy/inflation → deficit → immigration → Trump/scandal),
   picking the top story.
2. Sends it to **Groq's free API** (Llama 3.3 70B) to write the headline,
   caption, poll question/options, hashtags, and a symbolic image-scene
   description.
3. Builds a 1080×1080 square image (per your Appendix B spec): free
   background art from pollinations.ai + your headline/poll-bar layout
   burned on top via `sharp`, in the navy/red/white/gold palette.
4. Sends the photo to your Telegram chat, then the caption, then hashtags +
   a US/Sri Lanka posting-time table.
5. You open Telegram, download the photo, copy the caption, paste into
   Facebook.

## Cost: $0
Same free stack as the UK repo — GitHub Actions, RSS, Groq free tier,
pollinations.ai, Telegram Bot API.

## Same limitation as the UK version, and why
Your strategy doc's image prompts (6.1, 6.2) call for photorealistic images
of real named people — Trump at a podium, etc. — in fabricated scenes. That
wasn't built here either, for the same reason as the Honest Brit repo: a
realistic AI-rendered image of a real, identifiable person in an invented
scene is synthetic media that can be mistaken for a genuine photo, no matter
the page's intent.

What's built instead: the same split-screen composition, dramatic lighting,
and American-flag styling — but the figures are anonymous/faceless
silhouettes (a suited figure at a podium, an ordinary person at a gas pump),
so the "power vs. pocketbook" contrast your doc describes still comes
through without depicting anyone's real likeness. Headline styling, poll
bar, buttons, caption structure, and hashtag rules all match your doc
exactly.

## Scheduling
Matches the two HIGH-engagement windows from section 7.1 of your doc:
- Every day: 7:00 PM EDT (evening peak window)
- Tue / Wed / Thu (your best days): an extra 12:00 PM EDT slot

Edit the cron lines in `.github/workflows/daily-post.yml` if you want to add
the Sunday or other windows too.

## Setup
### 1. Get a free Groq API key
console.groq.com → sign up → **API Keys** → Create key.

### 2. Push this folder to a GitHub repo

### 3. Add repo secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**,
one at a time:
- `GROQ_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

(Use a separate Telegram chat/bot from your UK one if you want the two feeds
kept apart.)

### 4. Test it
Repo → **Actions** tab → "Daily US Verdict Post" → **Run workflow**.

## Local test (optional)
```
npm install
GROQ_API_KEY=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm start
```
