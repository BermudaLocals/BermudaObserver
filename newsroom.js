// ============================================================
// BERMUDA OBSERVER — AI NEWSROOM PIPELINE
// Polls Bermuda RSS feeds, rewrites items as original
// BermudaObserver articles via an OpenAI-compatible LLM
// provider chain (NVIDIA -> OpenRouter -> Groq, whichever has
// a key), attaches theme-matched generated photography
// (NVIDIA -> pollinations.ai -> Pexels -> local pool), ingests
// Bermuda obituaries, persists to data/.
// Never crashes the host server: every failure degrades to
// storing the RSS summary marked as a brief.
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('rss-parser');

const DATA_DIR = path.join(__dirname, 'data');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
const OBITS_FILE = path.join(DATA_DIR, 'obituaries.json');
const GEN_DIR = path.join(__dirname, 'public', 'images', 'gen');
const SEED_DIR = path.join(__dirname, 'data-seed');

const POLL_MS = 30 * 60 * 1000;          // every 30 minutes
const MAX_ARTICLES = 120;                // rolling store cap
const MAX_OBITS = 60;                    // rolling obituary cap
const MAX_NEW_PER_RUN = 12;              // bound work per poll
const MAX_REWRITES_PER_RUN = 8;          // bound LLM spend per poll
const GEN_CAP = 200;                     // max files in public/images/gen
const LLM_TIMEOUT_MS = 120000;
const IMG_TIMEOUT_MS = 60000;            // hard cap so a slow image provider can't stall a poll

// LLM providers, tried in order; a provider is used only when its
// env key exists. Model fail counts reset every run (see run()) so
// one transient error can't permanently disable a model.
const LLM_PROVIDERS = [
  {
    name: 'nvidia',
    env: 'NVIDIA_API_KEY',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: [
      process.env.LLM_MODEL || 'moonshotai/kimi-k3',  // verified live on this key
      'openai/gpt-oss-20b',                           // verified live on this key
      'deepseek-ai/deepseek-v4.1-flash',
      'z-ai/glm-5.3-flash',
      'nvidia/nemotron-3-super-120b-a12b'
    ]
  },
  {
    name: 'openrouter',
    env: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['deepseek/deepseek-chat-v3-0324:free', 'moonshotai/kimi-k2:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    extraHeaders: { 'HTTP-Referer': 'https://bermudaobserver.com', 'X-Title': 'BermudaObserver' }
  },
  {
    name: 'groq',
    env: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['openai/gpt-oss-120b']
  }
];

// google: titles arrive as "Headline - Source Name" and need splitting.
// Royal Gazette's own feed returns an empty body and tnnbda.com is
// captcha-walled to bots, so both come via Google News site: searches.
const FEEDS = [
  { name: 'Bernews', url: 'https://bernews.com/feed/' },
  { name: 'Royal Gazette', url: 'https://news.google.com/rss/search?q=site%3Aroyalgazette.com&hl=en-US&gl=US&ceid=US:en', google: true },
  { name: 'TNN', url: 'https://news.google.com/rss/search?q=site%3Atnnbda.com&hl=en-US&gl=US&ceid=US:en', google: true },
  { name: 'Google News — Bermuda', url: 'https://news.google.com/rss/search?q=bermuda&hl=en-US&gl=US&ceid=US:en', google: true },
  { name: 'Google News — Bermuda Business', url: 'https://news.google.com/rss/search?q=bermuda%20business&hl=en-US&gl=US&ceid=US:en', google: true },
  { name: 'Google News — Bermuda Sports', url: 'https://news.google.com/rss/search?q=bermuda%20sports&hl=en-US&gl=US&ceid=US:en', google: true }
];

// Obituary sources — verified live. legacy.com itself 403s bots and
// bernews has no obituary category feed (404), so both go via Google News.
const OBIT_FEEDS = [
  { name: 'Legacy.com — Bermuda', url: 'https://news.google.com/rss/search?q=site%3Alegacy.com+bermuda&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Bermuda Obituaries', url: 'https://news.google.com/rss/search?q=bermuda+obituary&hl=en-US&gl=US&ceid=US:en' }
];

const CATEGORIES = ['news', 'business', 'tourism', 'sports', 'government', 'weather'];

// Image themes, checked in order against title + body.
const THEMES = [
  { id: 'soccer', re: /\b(soccer|football|fifa|goalscorer|striker|premier league|fa cup)\b/i, subject: 'a football (soccer) match in progress, players challenging for the ball on a grass pitch', pexels: 'soccer' },
  { id: 'cricket', re: /\b(cricket|cup match|wicket|batsman|batsmen|bowler|innings)\b/i, subject: 'a cricket match, a batsman playing a shot on a green oval field', pexels: 'cricket' },
  { id: 'hockey', re: /\b(hockey|field hockey|ice hockey)\b/i, subject: 'a field hockey match, players with hockey sticks contesting the ball', pexels: 'hockey' },
  { id: 'rugby', re: /\b(rugby|scrum|ruck|ruck and maul)\b/i, subject: 'a rugby match, players driving into a tackle on a grass field', pexels: 'rugby' },
  { id: 'sailing', re: /\b(sailing|sailors?|sailboats?|regatta|yachts?|yachting|america'?s cup|dinghy)\b/i, subject: 'racing sailboats with white sails heeling on turquoise water', pexels: 'sailing' },
  { id: 'golf', re: /\b(golf|golfers?|pga|birdie|fairway|tee off)\b/i, subject: 'a golfer mid-swing on a manicured seaside golf course', pexels: 'golf' },
  { id: 'tennis', re: /\b(tennis|wimbledon|racket sport)\b/i, subject: 'a tennis player serving on an outdoor hard court', pexels: 'tennis' },
  { id: 'athletics', re: /\b(athletics|track and field|marathon|sprinters?|triathlon|ironman|race walk)\b/i, subject: 'athletes sprinting down the straight of an athletics track', pexels: 'running track' },
  { id: 'swimming', re: /\b(swimming|swimmers?|freestyle|backstroke|open water swim)\b/i, subject: 'a competitive swimmer mid-stroke in a pool lane', pexels: 'swimming' },
  { id: 'basketball', re: /\b(basketball|nba|slam dunk|hoops)\b/i, subject: 'a basketball player driving to the hoop in an indoor arena', pexels: 'basketball' },
  { id: 'boxing', re: /\b(boxing|boxers?|heavyweight|knockout|title fight)\b/i, subject: 'two boxers exchanging punches under bright ring lights', pexels: 'boxing' },
  { id: 'motorsport', re: /\b(motorsport|formula one|grand prix|rally|motocross|motorcycle racing|karting)\b/i, subject: 'a racing car at speed on a circuit', pexels: 'race car' },
  { id: 'hurricane', re: /\b(hurricane|tropical storm|cyclone|gale|storm|weather|forecast|rainfall|flooding)\b/i, subject: 'dark storm clouds and heavy waves over a small island coastline', pexels: 'storm ocean' },
  { id: 'crime', re: /\b(crime|police|court|arrested?|charg(?:ed|es)|sentenc(?:e|ed|ing)|murder|shooting|stabbing|robbery|magistrates?|supreme court|trial|jailed)\b/i, subject: 'a courthouse exterior with stone columns and steps', pexels: 'courthouse' },
  { id: 'government', re: /\b(government|premier|minister|ministry|parliament|senate|senator|plp|oba|throne speech|legislation|election|house of assembly)\b/i, subject: 'a stately colonial government building with a Bermuda flag', pexels: 'parliament building' },
  // tourism before business: travel stories often mention "economy/business",
  // but finance stories rarely mention cruises or beaches.
  { id: 'tourism', re: /\b(tourism|tourists?|hotels?|resorts?|cruise|visitors?|flights?|airport|beach|pink sand)\b/i, subject: 'a cruise ship anchored off a pink sand beach with turquoise water', pexels: 'bermuda beach' },
  { id: 'business', re: /\b(business|economy|economic|banks?|banking|insurance|reinsurance|fintech|markets?|company|stocks?|financial|finance|budget|investment|real estate|stock exchange)\b/i, subject: 'modern glass office buildings of a financial district', pexels: 'finance office' },
  { id: 'obituary', re: /\b(obituar(?:y|ies)|memorial|funeral|passed away|in memoriam|celebration of life)\b/i, subject: 'a quiet memorial scene of white flowers and soft candlelight', pexels: 'memorial flowers' },
  { id: 'bermuda', re: /[\s\S]*/, subject: 'a Bermuda coastline with pastel houses and turquoise water', pexels: 'bermuda' }
];

// Local photo pool (files live in public/images — see credits in index.html)
const LOCAL_POOL = {
  news: ['coastline', 'harbor', 'reef'],
  government: ['cottages', 'town', 'harbor-sunset'],
  business: ['town', 'harbor-sunset', 'cottages'],
  tourism: ['beach', 'cruise', 'reef'],
  sports: ['cricket', 'boats', 'coastline'],
  weather: ['reef', 'coastline'],
  jobs: ['town', 'harbor-sunset'],
  classifieds: ['harbor', 'cottages'],
  obituaries: ['sunset']
};
const LOCAL_CREDIT = {
  beach: 'Andrea Powell / Pexels',
  town: 'Christy Rice / Pexels',
  cricket: 'Lorien le Poer Trench / Pexels',
  sunset: 'Life_As_Pixels / Pexels'
};
const POOL_DEFAULT_CREDIT = 'Brandon Morrison / Pexels';

const parser = new Parser({ timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BermudaObserver/1.0)' } });

let articles = [];
let obituaries = [];
let obitKeys = new Set();
let seen = { urls: {}, titles: {} };
let lastRun = null;
let lastError = null;    // last LLM chain failure, surfaced via getStatus()
let lastRewrite = null;  // last successful rewrite { at, provider, model }
let running = false;
let modelFails = {};     // per-run counters, reset at the top of every run()
let imgBreaker = { nvidia: false, pollinations: false }; // per-run circuit breakers

// ------------------------------------------------------------
// STORAGE
// ------------------------------------------------------------
function loadStore() {
  try {
    if (fs.existsSync(ARTICLES_FILE)) articles = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
    if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    if (fs.existsSync(OBITS_FILE)) obituaries = JSON.parse(fs.readFileSync(OBITS_FILE, 'utf8'));
  } catch (e) { console.warn('[newsroom] store load failed, starting fresh:', e.message); }
  articles = Array.isArray(articles) ? articles : [];
  obituaries = Array.isArray(obituaries) ? obituaries : [];
  seen.urls = seen.urls || {}; seen.titles = seen.titles || {};
  obitKeys = new Set(obituaries.map(o => (o.name || '').toLowerCase().replace(/[^a-z]/g, '')));
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 1));
    fs.writeFileSync(OBITS_FILE, JSON.stringify(obituaries, null, 1));
    // cap seen maps so the file can't grow forever
    const cap = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));
    fs.writeFileSync(SEEN_FILE, JSON.stringify({ urls: cap(seen.urls, 5000), titles: cap(seen.titles, 5000) }));
  } catch (e) { console.warn('[newsroom] store save failed:', e.message); }
}

// data/ is gitignored, so a fresh deploy (Railway) starts empty. data-seed/ IS
// committed: merge any seeded articles/obits not already in the store, and mark
// them seen so the next poll doesn't re-ingest duplicates of what we restored.
function mergeSeed() {
  try {
    const seedArticlesFile = path.join(SEED_DIR, 'articles.json');
    if (fs.existsSync(seedArticlesFile)) {
      const seedArticles = JSON.parse(fs.readFileSync(seedArticlesFile, 'utf8'));
      if (Array.isArray(seedArticles) && seedArticles.length) {
        const have = new Set(articles.map(a => a && a.id));
        let added = 0;
        for (const a of seedArticles) {
          if (!a || !a.id || have.has(a.id)) continue;
          articles.push(a); have.add(a.id); added++;
          if (a.url) seen.urls[canonUrl(a.url)] = seen.urls[canonUrl(a.url)] || Date.now();
          if (a.title) seen.titles[titleKey(a.title)] = seen.titles[titleKey(a.title)] || Date.now();
        }
        if (added) {
          articles.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
          articles = articles.slice(0, MAX_ARTICLES);
        }
        console.log(`[newsroom] seed merge: ${added} articles restored (${articles.length} total)`);
      }
    }
    const seedObitsFile = path.join(SEED_DIR, 'obituaries.json');
    if (fs.existsSync(seedObitsFile)) {
      const seedObits = JSON.parse(fs.readFileSync(seedObitsFile, 'utf8'));
      if (Array.isArray(seedObits) && seedObits.length) {
        let added = 0;
        for (const o of seedObits) {
          const key = ((o && o.name) || '').toLowerCase().replace(/[^a-z]/g, '');
          if (!key || obitKeys.has(key)) continue;
          obitKeys.add(key); obituaries.push(o); added++;
        }
        if (added) {
          obituaries.sort((a, b) => new Date(b.date) - new Date(a.date));
          obituaries = obituaries.slice(0, MAX_OBITS);
        }
        console.log(`[newsroom] seed merge: ${added} obituaries restored (${obituaries.length} total)`);
      }
    }
  } catch (e) { console.warn('[newsroom] seed merge failed (continuing):', e.message); }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
const stripHtml = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const byPubDateDesc = (a, b) => new Date(b.isoDate || b.pubDate || 0) - new Date(a.isoDate || a.pubDate || 0);
const toTitleCase = s => (s || '').toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function canonUrl(u) {
  try {
    const url = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ocid'].forEach(p => url.searchParams.delete(p));
    return (url.hostname.replace(/^www\./, '') + url.pathname + url.search).toLowerCase().replace(/\/$/, '');
  } catch { return (u || '').toLowerCase().trim(); }
}

const titleKey = t => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const hash = s => crypto.createHash('sha1').update(s || '').digest('hex').slice(0, 12);

function classify(text) {
  const t = ' ' + (text || '').toLowerCase() + ' ';
  if (/\b(cricket|cup match|football|rugby|sailing|regatta|golf|golfer|tennis|athletics|triathlon|swimming|boxing|boxers?|e?sports?)\b/.test(t)) return 'sports';
  if (/\b(storm|hurricane|weather|forecast|rainfall|gale)\b/.test(t)) return 'weather';
  if (/\b(tourism|tourists?|hotel|resort|cruise|visitors?|flights?|airport|restaurant|beach)\b/.test(t)) return 'tourism';
  if (/\b(business|economy|economic|bank|banking|insurance|reinsurance|fintech|market|company|stocks?|financial|finance|budget|investment|real estate)\b/.test(t)) return 'business';
  if (/\b(government|premier|minister|ministry|parliament|senate|senator|plp|oba|throne speech|legislation|election)\b/.test(t)) return 'government';
  return 'news';
}

const detectTheme = text => THEMES.find(t => t.re.test(' ' + (text || '') + ' '));

function localImage(name) {
  return { url: '/images/' + name + '.jpg', credit: LOCAL_CREDIT[name] || POOL_DEFAULT_CREDIT };
}

function pickImage(category, text) {
  const t = (text || '').toLowerCase();
  if (/cricket|cup match/.test(t)) return localImage('cricket');
  if (/sail|regatta|yacht|boat|marine|fishing/.test(t)) return localImage('boats');
  if (/cruise/.test(t)) return localImage('cruise');
  if (/beach|pink sand|horseshoe/.test(t)) return localImage('beach');
  if (/hurricane|storm|weather|forecast/.test(t)) return localImage('coastline');
  if (/hotel|resort|airport|flight|visitor|tourist/.test(t)) return localImage('harbor-sunset');
  const pool = LOCAL_POOL[(category || 'news').toLowerCase()];
  if (pool) return localImage(pool[parseInt(hash(text), 16) % pool.length]);
  return null;
}

async function pexelsImage(query) {
  if (!process.env.PEXELS_API_KEY || !query) return null;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(query + ' bermuda') + '&per_page=1&orientation=landscape', {
      headers: { Authorization: process.env.PEXELS_API_KEY }, signal: ctrl.signal
    });
    clearTimeout(to);
    if (!res.ok) return null;
    const d = await res.json();
    const p = d.photos && d.photos[0];
    return p ? { url: p.src.large2x || p.src.large, credit: p.photographer + ' / Pexels' } : null;
  } catch { return null; }
}

// ------------------------------------------------------------
// GENERATED IMAGES — NVIDIA -> pollinations.ai -> Pexels -> local pool
// ------------------------------------------------------------
function saveGenImage(id, buf) {
  if (!fs.existsSync(GEN_DIR)) fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(path.join(GEN_DIR, id + '.jpg'), buf);
  capGenDir();
  return '/images/gen/' + id + '.jpg';
}

function capGenDir() {
  try {
    const files = fs.readdirSync(GEN_DIR).filter(f => f.endsWith('.jpg'))
      .map(f => ({ f, t: fs.statSync(path.join(GEN_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(GEN_CAP).forEach(x => { try { fs.unlinkSync(path.join(GEN_DIR, x.f)); } catch { } });
  } catch { }
}

const imagePrompt = subject => 'photorealistic editorial news photograph of ' + subject + ', Bermuda setting where natural, no text, no words, no watermark';

async function nvidiaImage(prompt, id) {
  if (!process.env.NVIDIA_API_KEY || imgBreaker.nvidia) return null;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), IMG_TIMEOUT_MS);
    const res = await fetch('https://integrate.api.nvidia.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.NVIDIA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'stabilityai/stable-diffusion-3-medium', prompt, n: 1, size: '1280x720', response_format: 'b64_json' }),
      signal: ctrl.signal
    });
    clearTimeout(to);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const b64 = d.data && d.data[0] && d.data[0].b64_json;
    if (!b64) throw new Error('no image in response');
    return { url: saveGenImage(id, Buffer.from(b64, 'base64')), credit: 'AI-generated / NVIDIA' };
  } catch (e) {
    imgBreaker.nvidia = true; // not offered on this key — don't retry every article this run
    console.warn('[newsroom] NVIDIA image failed (skipped for rest of run):', e.message);
    return null;
  }
}

async function pollinationsImage(prompt, id) {
  if (imgBreaker.pollinations) return null;
  try {
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
      '?width=1280&height=720&nologo=true&seed=' + (parseInt(hash(id), 16) % 100000);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), IMG_TIMEOUT_MS);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BermudaObserver/1.0)' }, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!type.includes('image') || buf.length < 10000) throw new Error('bad image (' + type + ', ' + buf.length + 'b)');
    return { url: saveGenImage(id, buf), credit: 'AI-generated / pollinations.ai' };
  } catch (e) {
    imgBreaker.pollinations = true; // one hang must not multiply across every article this run
    console.warn('[newsroom] pollinations image failed (skipped for rest of run):', e.message);
    return null;
  }
}

async function themedImage(theme, category, text, id) {
  const prompt = imagePrompt(theme.subject);
  let img = await nvidiaImage(prompt, id);
  if (!img) img = await pollinationsImage(prompt, id);
  if (!img) img = await pexelsImage(theme.pexels);
  if (!img) img = pickImage(category, text) || localImage('hero');
  return img;
}

// ------------------------------------------------------------
// LLM REWRITE
// ------------------------------------------------------------
const REWRITE_SYSTEM = `You are a BermudaObserver staff writer in Hamilton, Bermuda. Rewrite the provided news item as an ORIGINAL BermudaObserver article with a fresh Bermuda angle. Rules:
- Never copy or closely paraphrase sentences from the source; write entirely new prose.
- New original headline (not the source headline).
- Article body of 150-350 words, 2-4 paragraphs, factual and neutral in tone.
- Respond with JSON only, no markdown fences: {"headline":"...","article":"...","category":"news|business|tourism|sports|government|weather"}`;

function extractJson(content) {
  const m = (content || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    if (typeof d.headline === 'string' && typeof d.article === 'string' && d.article.split(/\s+/).length >= 40) return d;
  } catch { }
  return null;
}

async function llmAttempt(provider, model, userMsg) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env[provider.env],
        'Content-Type': 'application/json',
        ...(provider.extraHeaders || {})
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: REWRITE_SYSTEM }, { role: 'user', content: userMsg }],
        max_tokens: 6000,
        temperature: 0.7
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.detail || (j.error && j.error.message) || ''; } catch { }
      throw new Error('HTTP ' + res.status + (detail ? ' — ' + String(detail).slice(0, 160) : ''));
    }
    const data = await res.json();
    const parsed = extractJson(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    if (!parsed) throw new Error('unusable response');
    return parsed;
  } finally { clearTimeout(to); }
}

async function llmRewrite(item) {
  const userMsg = `Source outlet: ${item.sourceName}\nSource headline: ${item.title}\nSource summary: ${item.summary || '(none)'}`;
  for (const provider of LLM_PROVIDERS) {
    if (!process.env[provider.env]) continue;
    for (const model of provider.models) {
      if ((modelFails[provider.name + '/' + model] || 0) >= 1) continue; // one shot per model per run
      try {
        const parsed = await llmAttempt(provider, model, userMsg);
        lastRewrite = { at: new Date().toISOString(), provider: provider.name, model };
        console.log('[newsroom] rewritten with', provider.name + '/' + model);
        return parsed;
      } catch (e) {
        modelFails[provider.name + '/' + model] = (modelFails[provider.name + '/' + model] || 0) + 1;
        lastError = { at: new Date().toISOString(), provider: provider.name, model, message: e.message };
        console.warn('[newsroom] LLM', provider.name + '/' + model, 'failed:', e.message);
      }
    }
  }
  return null;
}

// ------------------------------------------------------------
// ARTICLE BUILD
// ------------------------------------------------------------
async function buildArticle(raw, feed, allowRewrite) {
  // Google News titles arrive as "Headline - Source Name"; split them.
  let title = (raw.title || '').trim();
  let sourceName = feed.name;
  if (feed.google) {
    const i = title.lastIndexOf(' - ');
    if (i > 10) { sourceName = title.slice(i + 3).trim(); title = title.slice(0, i).trim(); }
  } else if (raw.creator && !/^(test|admin|administrator|editor|webmaster|staff)$/i.test(raw.creator.trim())) {
    sourceName = raw.creator.trim(); // only trust real bylines, not feed placeholders
  }
  const summary = stripHtml(raw.contentSnippet || raw.content || raw.summary || '').slice(0, 400);

  let rewritten = null;
  if (allowRewrite) rewritten = await llmRewrite({ title, summary, sourceName });

  let category, body, excerpt, finalTitle, brief;
  if (rewritten) {
    finalTitle = rewritten.headline.trim();
    body = rewritten.article.trim();
    // Keywords win when they have an opinion; the LLM's category is used
    // only when the classifier is neutral ('news'). Stops 'boxing' → 'weather'.
    const kw = classify(finalTitle + ' ' + body);
    const llmCat = (rewritten.category || '').toLowerCase();
    category = kw !== 'news' ? kw : (CATEGORIES.includes(llmCat) ? llmCat : 'news');
    excerpt = body.split(/\n+/)[0].slice(0, 200);
    brief = false;
  } else {
    finalTitle = title;
    body = null;
    category = classify(title + ' ' + summary);
    excerpt = summary.slice(0, 200) || 'Read the full story via the original source.';
    brief = true;
  }

  const id = hash(canonUrl(raw.link) || finalTitle);
  const fullText = finalTitle + ' ' + (body || summary);
  const image = await themedImage(detectTheme(fullText), category, fullText, id);

  return {
    id,
    title: finalTitle,
    excerpt,
    summary: excerpt,
    body,
    category,
    source: sourceName,
    url: raw.link,
    published_at: raw.isoDate || (raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString()),
    image: image.url,
    imageCredit: image.credit,
    brief,
    attribution: 'Based on reporting by ' + sourceName
  };
}

// ------------------------------------------------------------
// OBITUARIES
// ------------------------------------------------------------
function parseObit(item, feedName) {
  const rawTitle = (item.title || '').trim();
  if (!rawTitle || !item.link) return null;
  if (!/obituar/i.test(rawTitle)) return null;
  if (!/\bbermuda\b/i.test(rawTitle)) return null; // drop lookalike notices from elsewhere
  const parts = rawTitle.split(' - ').map(s => s.trim()).filter(Boolean);
  const nameM = (parts[0] || '').match(/^(.*?)\s+obituar/i);
  const name = toTitleCase((nameM ? nameM[1] : parts[0]).trim());
  if (name.length < 3) return null;
  const outlet = parts.slice(1).find(p => /gazette|bernews|legacy|sun|times|news/i.test(p) && !/bermuda/i.test(p));
  const ageM = (rawTitle + ' ' + (item.contentSnippet || '')).match(/\baged?\s*[:\-]?\s*(\d{1,3})\b/i);
  return {
    name,
    age: ageM ? parseInt(ageM[1], 10) : null,
    date: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()),
    source: outlet || feedName,
    url: item.link,
    message: stripHtml(item.contentSnippet || item.content || '').slice(0, 240) || ('Obituary notice for ' + name + '.')
  };
}

async function pollObituaries() {
  let added = 0;
  for (const feed of OBIT_FEEDS) {
    let parsed;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (e) {
      console.warn('[newsroom] obituary feed', feed.name, 'failed:', e.message);
      continue;
    }
    for (const item of (parsed.items || []).slice().sort(byPubDateDesc)) {
      let ob = null;
      try { ob = parseObit(item, feed.name); } catch { }
      if (!ob) continue;
      const key = ob.name.toLowerCase().replace(/[^a-z]/g, '');
      if (!key || obitKeys.has(key)) continue;
      obitKeys.add(key);
      obituaries.unshift(ob);
      added++;
    }
  }
  obituaries.sort((a, b) => new Date(b.date) - new Date(a.date));
  obituaries = obituaries.slice(0, MAX_OBITS);
  obitKeys = new Set(obituaries.map(o => (o.name || '').toLowerCase().replace(/[^a-z]/g, '')));
  return added;
}

// ------------------------------------------------------------
// POLL CYCLE
// ------------------------------------------------------------
async function run() {
  if (running) return;
  running = true;
  modelFails = {};                                   // per-run reset: a transient error must not kill a model forever
  imgBreaker = { nvidia: false, pollinations: false };
  const stats = [];
  let processed = 0, rewritesLeft = MAX_REWRITES_PER_RUN, obitsAdded = 0;
  try {
    for (const feed of FEEDS) {
      if (processed >= MAX_NEW_PER_RUN) break;
      let parsed;
      try {
        parsed = await parser.parseURL(feed.url);
      } catch (e) {
        stats.push({ feed: feed.name, fetched: 0, kept: 0, error: e.message });
        continue;
      }
      const items = (parsed.items || []).slice().sort(byPubDateDesc); // freshest first within the per-run cap
      let kept = 0;
      for (const item of items) {
        if (processed >= MAX_NEW_PER_RUN) break;
        if (!item.title || !item.link) continue;
        const uKey = canonUrl(item.link), tKey = titleKey(item.title);
        if (seen.urls[uKey] || seen.titles[tKey]) continue;
        seen.urls[uKey] = seen.titles[tKey] = Date.now();
        processed++; kept++;
        try {
          const art = await buildArticle(item, feed, rewritesLeft > 0);
          if (!art.brief) rewritesLeft--;
          articles.unshift(art);
        } catch (e) {
          console.warn('[newsroom] item failed, stored as brief:', e.message);
        }
      }
      stats.push({ feed: feed.name, fetched: (parsed.items || []).length, kept });
    }
    articles.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    articles = articles.slice(0, MAX_ARTICLES);
    try { obitsAdded = await pollObituaries(); } catch (e) { console.warn('[newsroom] obituary poll failed:', e.message); }
    saveStore();
  } catch (e) {
    console.warn('[newsroom] run failed:', e.message);
  } finally {
    lastRun = { at: new Date().toISOString(), processed, obitsAdded, stats };
    console.log('[newsroom] poll complete:', JSON.stringify(lastRun));
    running = false;
  }
}

function start() {
  loadStore();
  mergeSeed();
  saveStore();
  console.log(`[newsroom] starting — ${articles.length} stored articles, ${obituaries.length} obituaries, polling every ${POLL_MS / 60000}min`);
  setTimeout(run, 3000);              // run once at boot (don't block listen)
  setInterval(run, POLL_MS);          // then on schedule
}

module.exports = {
  start,
  getArticles: () => articles,
  getObituaries: () => obituaries,
  getStatus: () => ({
    articles: articles.length,
    briefs: articles.filter(a => a.brief).length,
    rewritten: articles.filter(a => !a.brief).length,
    obituaries: obituaries.length,
    lastError,
    lastRewrite,
    lastRun
  })
};
