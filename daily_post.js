import sharp from "sharp";
import { XMLParser } from "fast-xml-parser";

const GROQ_KEY = process.env.GROQ_API_KEY;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!GROQ_KEY || !TG_TOKEN || !TG_CHAT_ID) {
  throw new Error("Missing GROQ_API_KEY / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars");
}

// ---------- RSS ----------
const FEEDS = [
  "https://feeds.npr.org/1014/rss.xml",              // NPR Politics
  "https://feeds.abcnews.com/abcnews/politicsheadlines", // ABC News Politics
  "https://thehill.com/homenews/feed/",                  // The Hill
  "https://moxie.foxnews.com/google-publisher/politics.xml" // Fox News Politics (balance of sources)
];

// Weighted against the Gallup "top national concerns" list in your strategy doc,
// plus the two confirmed high-performers (Trump, gas prices).
const PRIORITY = [
  { tags: ["trump", "white house", "president"], weight: 4 },
  { tags: ["gas price", "gas prices", "oil price", "inflation", "economy", "grocery", "rent"], weight: 5 },
  { tags: ["healthcare", "health care", "medicaid", "obamacare", "insurance premium"], weight: 5 },
  { tags: ["deficit", "federal spending", "national debt", "budget"], weight: 3 },
  { tags: ["immigration", "border", "migrant", "asylum"], weight: 3 },
  { tags: ["tariff", "iran", "midterm", "congress", "senate", "shutdown"], weight: 2 },
  { tags: ["scandal", "resign", "investigation", "indict"], weight: 4 }
];

async function fetchFeedItems(url) {
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!resp.ok) return [];
  const xml = await resp.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map(it => ({
    title: String(it.title || "").trim(),
    description: String(it.description || "").replace(/<[^>]+>/g, "").trim()
  })).filter(it => it.title);
}

function scoreItem(item) {
  const text = (item.title + " " + item.description).toLowerCase();
  let score = 0;
  for (const p of PRIORITY) {
    if (p.tags.some(t => text.includes(t))) score += p.weight;
  }
  return score;
}

async function pickTopStory() {
  const allItems = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeedItems(feed);
      allItems.push(...items.slice(0, 12));
    } catch (e) {
      console.warn("Feed failed:", feed, e.message);
    }
  }
  if (allItems.length === 0) throw new Error("No RSS items");
  allItems.sort((a, b) => scoreItem(b) - scoreItem(a));
  return allItems[0];
}

// ---------- Groq ----------
async function writePostPackage(story) {
  const instruction = `You write for "The US Verdict", a US political commentary Facebook page.

Story:
Title: ${story.title}
Description: ${story.description}

Strict rules:
- headline = maximum 4 words, ALL CAPS, very punchy (examples: "WHO PAYS?", "TAX THE ELITE", "KEPT IN THE DARK?")
- poll_question = short (max 9 words)
- left_option = "YES"
- right_option = "NO"
- image_scene must be SYMBOLIC ONLY — no real named public figures or recognizable likenesses of any person, living or historical. Left side: a generic anonymous suited silhouette or figure at a podium (face obscured or turned away), lit warm and dramatic. Right side: an ordinary person at a gas pump or grocery checkout (face obscured or from behind/side), lit cool and harsh. Heavy distressed American flag background. Dark cinematic lighting. No text, no logos, no identifiable faces.

Return ONLY raw JSON:
{
  "headline": "MAX 4 WORDS ALL CAPS",
  "summary": "2 short factual sentences",
  "quote_or_stat": "1 key sentence",
  "poll_question": "short clear question",
  "left_option": "YES",
  "left_explain": "brief",
  "right_option": "NO",
  "right_explain": "brief",
  "hashtags_main": ["#TheUSVerdict","#USPolitics","#Topic1","#Topic2"],
  "hashtags_extra": ["#tag1","#tag2"],
  "image_scene": "detailed symbolic (non-identifiable) left-podium + right-everyday-person composition"
}`;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: instruction }],
      temperature: 0.5
    })
  });

  if (!resp.ok) throw new Error(`Groq error: ${await resp.text()}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  const match = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON:\n" + text);
  return JSON.parse(match[0]);
}

// ---------- Image – typography focused ----------
async function buildImage(pkg) {
  const scenePrompt = `${pkg.image_scene}, dark cinematic political poster, heavy distressed American flag, dramatic lighting, no visible identifiable faces, photorealistic textures, 8k --no text, no logos, no recognizable real people`;

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(scenePrompt)}?width=1080&height=1080&nologo=true&seed=${Date.now() % 1000000}`;
  const bgResp = await fetch(url);
  if (!bgResp.ok) throw new Error("Image failed");
  const bgBuffer = Buffer.from(await bgResp.arrayBuffer());

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ---- Headline sizing rule: big solid white text, no outline, never overflow ----
  // Max usable width = 980px (40px margin each side). Arial Black caps run
  // roughly 0.62x font-size per character. Cap size at 130px for short
  // punchy headlines, shrink for longer ones, floor at 48px.
  const MAX_HEADLINE_WIDTH = 980;
  const CHAR_WIDTH_FACTOR = 0.62;
  const headlineLen = Math.max(pkg.headline.length, 1);
  let headlineFontSize = Math.floor(MAX_HEADLINE_WIDTH / (headlineLen * CHAR_WIDTH_FACTOR));
  headlineFontSize = Math.min(130, Math.max(48, headlineFontSize));

  // ---- Poll bar sizing rule: big bottom text, scaled to never overflow ----
  const MAX_POLL_WIDTH = 900;
  const pollLen = Math.max(pkg.poll_question.length, 1);
  let pollFontSize = Math.floor(MAX_POLL_WIDTH / (pollLen * 0.52));
  pollFontSize = Math.min(52, Math.max(30, pollFontSize));

  // Square 1:1 format per Appendix B (navy / American red / white / gold palette)
  const overlaySvg = `
<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0.78"/>
      <stop offset="38%" stop-color="#000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="42%" stop-color="#000" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.94"/>
    </linearGradient>
  </defs>

  <rect width="1080" height="1080" fill="url(#top)"/>
  <rect width="1080" height="1080" fill="url(#bot)"/>

  <!-- ========== HEADLINE ========== -->
  <text x="540" y="150"
        font-family="Arial Black, Impact, sans-serif"
        font-size="${headlineFontSize}"
        font-weight="900"
        fill="#FFFFFF"
        text-anchor="middle"
        textLength="${Math.min(MAX_HEADLINE_WIDTH, headlineFontSize * headlineLen * CHAR_WIDTH_FACTOR)}"
        lengthAdjust="spacingAndGlyphs">
    ${esc(pkg.headline)}
  </text>

  <!-- ========== BOTTOM POLL BAR ========== -->
  <rect x="45" y="820" width="990" height="230" rx="30" ry="30" fill="#0A1F44" fill-opacity="0.96"/>

  <text x="540" y="900"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${pollFontSize}"
        font-weight="700"
        fill="#FFFFFF"
        text-anchor="middle"
        textLength="${Math.min(MAX_POLL_WIDTH, pollFontSize * pollLen * 0.52)}"
        lengthAdjust="spacingAndGlyphs">
    ${esc(pkg.poll_question)}
  </text>

  <!-- YES -->
  <circle cx="290" cy="990" r="48" fill="#2F6FED" stroke="#FFFFFF" stroke-width="5"/>
  <text x="290" y="1007" font-size="50" text-anchor="middle" fill="#FFFFFF">👍</text>
  <text x="365" y="1008"
        font-family="Arial Black, Arial, sans-serif"
        font-size="56"
        font-weight="800"
        fill="#FFFFFF">YES</text>

  <!-- NO -->
  <circle cx="710" cy="990" r="48" fill="#B31942" stroke="#FFFFFF" stroke-width="5"/>
  <text x="710" y="1007" font-size="50" text-anchor="middle" fill="#FFFFFF">❤️</text>
  <text x="785" y="1008"
        font-family="Arial Black, Arial, sans-serif"
        font-size="56"
        font-weight="800"
        fill="#FFFFFF">NO</text>
</svg>`;

  return sharp(bgBuffer)
    .resize(1080, 1080)
    .composite([{ input: Buffer.from(overlaySvg) }])
    .jpeg({ quality: 94 })
    .toBuffer();
}

// ---------- Caption ----------
function buildCaption(pkg) {
  return `🇺🇸 BE HONEST.

${pkg.summary}

${pkg.quote_or_stat}

${pkg.poll_question}

👍 YES — ${pkg.left_explain}
❤️ NO — ${pkg.right_explain}

Drop your honest take below. No spin. Just the question. 👇

Follow The US Verdict for America's pulse, measured daily. 🇺🇸

${pkg.hashtags_main.join(" ")}`;
}

function postingTimeTable() {
  const now = new Date();
  const estTime = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  const sriTime = now.toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false });
  return `| Time Zone | Current Time |
| :--- | :--- |
| US (EST/EDT) | ${estTime} |
| Sri Lanka (SLST) | ${sriTime} |`;
}

// ---------- Telegram ----------
async function sendToTelegram(imageBuffer, pkg) {
  const form = new FormData();
  form.append("chat_id", TG_CHAT_ID);
  form.append("photo", new Blob([imageBuffer], { type: "image/jpeg" }), "post.jpg");

  const photoResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form
  });
  if (!photoResp.ok) throw new Error("sendPhoto failed: " + await photoResp.text());

  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: buildCaption(pkg) })
  });

  const extraTags = pkg.hashtags_extra?.join(" ") || "";
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: `🏷 Pinned comment tags:\n${extraTags}\n\n🕒 Posting time:\n${postingTimeTable()}`
    })
  });
}

// ---------- Run ----------
(async () => {
  console.log("Fetching story...");
  const story = await pickTopStory();
  console.log("Story:", story.title);

  console.log("Writing package...");
  const pkg = await writePostPackage(story);
  console.log("Headline:", pkg.headline);

  console.log("Building image...");
  const image = await buildImage(pkg);

  console.log("Sending...");
  await sendToTelegram(image, pkg);
  console.log("Done.");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
