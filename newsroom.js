// ============================================================
// BERMUDA OBSERVER — AI NEWSROOM PIPELINE
// Polls Bermuda RSS feeds, rewrites items as original
// BermudaObserver articles via an OpenAI-compatible LLM,
// attaches local/Pexels photography, persists to data/.
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

const POLL_MS = 30 * 60 * 1000;          // every 30 minutes
const MAX_ARTICLES = 120;                // rolling store cap
const MAX_NEW_PER_RUN = 12;              // bound work per poll
const MAX_REWRITES_PER_RUN = 8;          // bound LLM spend per poll
const LLM_TIMEOUT_MS = 120000;
const LLM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// Boss's model first; models that repeatedly fail are skipped for
// the lifetime of this process so a hanging model can't stall a run.
const LLM_MODELS = [
  process.env.LLM_MODEL || 'moonshotai/kimi-k3',
  'nvidia/nemotron-3-super-120b-a12b',
  'deepseek-ai/deepseek-v4-flash-0731',
  'openai/gpt-oss-20b'
];

const FEEDS = [
  { name: 'Bernews', url: 'https://bernews.com/feed/' },
  { name: 'Royal Gazette', url: 'https://www.royalgazette.com/rss/' },
  { name: 'Google News — Bermuda', url: 'https://news.google.com/rss/search?q=bermuda&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Bermuda Business', url: 'https://news.google.com/rss/search?q=bermuda%20business&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Bermuda Sports', url: 'https://news.google.com/rss/search?q=bermuda%20sports&hl=en-US&gl=US&ceid=US:en' }
];

const CATEGORIES = ['news', 'business', 'tourism', 'sports', 'government', 'weather'];

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
let seen = { urls: {}, titles: {} };
let lastRun = null;
let running = false;
const modelFails = {};

// ------------------------------------------------------------
// STORAGE
// ------------------------------------------------------------
function loadStore() {
  try {
    if (fs.existsSync(ARTICLES_FILE)) articles = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8'));
    if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch (e) { console.warn('[newsroom] store load failed, starting fresh:', e.message); }
  articles = Array.isArray(articles) ? articles : [];
  seen.urls = seen.urls || {}; seen.titles = seen.titles || {};
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 1));
    // cap seen maps so the file can't grow forever
    const cap = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));
    fs.writeFileSync(SEEN_FILE, JSON.stringify({ urls: cap(seen.urls, 5000), titles: cap(seen.titles, 5000) }));
  } catch (e) { console.warn('[newsroom] store save failed:', e.message); }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
const stripHtml = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

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
  return null; // no local fit -> try Pexels
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

async function llmRewrite(item) {
  if (!process.env.NVIDIA_API_KEY) return null;
  const userMsg = `Source outlet: ${item.sourceName}\nSource headline: ${item.title}\nSource summary: ${item.summary || '(none)'}`;
  for (const model of LLM_MODELS) {
    if ((modelFails[model] || 0) >= 1) continue; // one shot per model per run
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.NVIDIA_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: REWRITE_SYSTEM }, { role: 'user', content: userMsg }],
          max_tokens: 6000,
          temperature: 0.7
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const parsed = extractJson(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
      if (!parsed) throw new Error('unusable response');
      console.log('[newsroom] rewritten with', model);
      return parsed;
    } catch (e) {
      modelFails[model] = (modelFails[model] || 0) + 1;
      console.warn('[newsroom] LLM', model, 'failed:', e.message);
    }
  }
  return null;
}

// ------------------------------------------------------------
// ARTICLE BUILD
// ------------------------------------------------------------
async function buildArticle(raw, feedName, allowRewrite) {
  // Google News titles arrive as "Headline - Source Name"; split them.
  let title = (raw.title || '').trim();
  let sourceName = feedName;
  if (feedName.startsWith('Google News')) {
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

  let image = pickImage(category, finalTitle + ' ' + (body || summary));
  if (!image) {
    image = await pexelsImage(finalTitle.split(/\s+/).slice(0, 3).join(' ')) || localImage('hero');
  }

  return {
    id: hash(canonUrl(raw.link) || finalTitle),
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
// POLL CYCLE
// ------------------------------------------------------------
async function run() {
  if (running) return;
  running = true;
  const stats = [];
  let processed = 0, rewritesLeft = MAX_REWRITES_PER_RUN;
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
      let kept = 0;
      for (const item of (parsed.items || [])) {
        if (processed >= MAX_NEW_PER_RUN) break;
        if (!item.title || !item.link) continue;
        const uKey = canonUrl(item.link), tKey = titleKey(item.title);
        if (seen.urls[uKey] || seen.titles[tKey]) continue;
        seen.urls[uKey] = seen.titles[tKey] = Date.now();
        processed++; kept++;
        try {
          const art = await buildArticle(item, feed.name, rewritesLeft > 0);
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
    saveStore();
  } catch (e) {
    console.warn('[newsroom] run failed:', e.message);
  } finally {
    lastRun = { at: new Date().toISOString(), processed, stats };
    console.log('[newsroom] poll complete:', JSON.stringify(lastRun));
    running = false;
  }
}

function start() {
  loadStore();
  console.log(`[newsroom] starting — ${articles.length} stored articles, polling every ${POLL_MS / 60000}min`);
  setTimeout(run, 3000);              // run once at boot (don't block listen)
  setInterval(run, POLL_MS);          // then on schedule
}

module.exports = {
  start,
  getArticles: () => articles,
  getStatus: () => ({
    articles: articles.length,
    briefs: articles.filter(a => a.brief).length,
    rewritten: articles.filter(a => !a.brief).length,
    lastRun
  })
};
