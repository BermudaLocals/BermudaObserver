// ═══════════════════════════════════════════════════════════
// BERMUDA OBSERVER — SSR SEO LAYER
// Server-rendered article pages, trust pages, sitemap.
// Google sees full HTML — not an empty SPA shell.
// ═══════════════════════════════════════════════════════════
const path = require('path');
const media = require('./public/story-media');

const SITE = 'https://bermudaobserver.com';
const SITE_NAME = 'Bermuda Observer';
const DEFAULT_IMG = SITE + '/images/hero.jpg';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugify(t) {
  return String(t || 'story').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'story';
}

function fmtDate(iso, opts) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', Object.assign({
      year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Atlantic/Bermuda'
    }, opts || {}));
  } catch (e) { return ''; }
}
function fmtDateTime(iso) {
  return fmtDate(iso, { hour: 'numeric', minute: '2-digit', hour12: true }) + ' ADT';
}

// Reviewed hub-only graphic; no keyword matching or unmatched appendices.
const CGRJP_PLACEMENT = [{
  section: 'Police Identify the Two Bermudians Aboard C-GRJP',
  src: '/images/c-grjp-bermuda-search-operation.png',
  alt: 'Supplied editorial composite naming Marilyn Lavonne Bean and Sergio Wayne Lottimore; not authenticated incident imagery',
  cap: 'Bermuda Observer — supplied editorial composite accompanying the Bermuda Police identity update. Portraits supplied by the user; their provenance is not independently verified here. Aircraft and rescue scenes are illustrative, not photographs of the incident.'
}];
function inlineGraphicFig(g) {
  return '<figure class="inline-graphic"><img src="' + esc(g.src) + '" alt="' + esc(g.alt) + '" loading="lazy"><figcaption>' + esc(g.cap) + '</figcaption></figure>';
}
function bodyToHtmlInline(body) {
  const used = new Set();
  return String(body || '').split(/\n{2,}/).map(p => {
    const t = p.trim();
    let html = bodyToHtml(t);
    CGRJP_PLACEMENT.forEach((g, i) => {
      if (!used.has(i) && t === g.section) { used.add(i); html += inlineGraphicFig(g); }
    });
    return html;
  }).join('\n');
}
function imgAlt(src, fallbackTitle) { return esc(fallbackTitle || 'Illustrative news image'); }

function artImage(a) {
  let img = a && a.image;
  if (!img) return DEFAULT_IMG;
  if (/^https?:\/\//.test(img)) return img;
  return SITE + img;
}

function bodyToHtml(body) {
  if (!body) return '';
  return String(body).split(/\n{2,}/).map(p => {
    const t = p.trim();
    if (!t) return '';
    // Section sub-heads (short lines, no terminal period) become <h2>
    if (t.length < 60 && !/[.!?]$/.test(t) && !/^UPDATE/i.test(t) && t.split(' ').length <= 7) {
      return '<h2>' + esc(t) + '</h2>';
    }
    return '<p>' + esc(t).replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
}

function jsonLdArticle(a, canonicalUrl, imgUrl, h1) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: h1 || a.title,
    description: (a.excerpt || a.summary || '').slice(0, 300),
    image: [imgUrl],
    datePublished: a.published_at || a.date || new Date().toISOString(),
    dateModified: a.updated_at || a.published_at || a.date || new Date().toISOString(),
    author: [{ '@type': 'Person', name: a.author || 'Bermuda Observer Staff' }],
    publisher: {
      '@type': 'NewsMediaOrganization',
      name: SITE_NAME,
      url: SITE,
      logo: { '@type': 'ImageObject', url: SITE + '/images/bermuda-observer-editorial-logo.png' },
      sameAs: [
        'https://www.instagram.com/bermudaobserver/',
        'https://www.youtube.com/@BermudaObserver'
      ]
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
    isAccessibleForFree: true,
    inLanguage: 'en'
  };
  return '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>';
}

function head(opts) {
  const o = opts || {};
  const title = o.title || SITE_NAME;
  const desc = o.desc || 'Bermuda Observer — Bermuda\'s AI-powered news. Original reporting, breaking news, government, business, sports, tourism and obituaries.';
  const canonical = o.canonical || SITE;
  const img = o.image || DEFAULT_IMG;
  const type = o.type || 'website';
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<link rel="canonical" href="' + esc(canonical) + '">\n' +
    '<meta name="robots" content="index,follow,max-image-preview:large">\n' +
    '<meta name="google-site-verification" content="upe0gWiZrpKnzJ2EdxR66-4ifUmCDBEHA-KplvFB5cE">\n' +
    '<link rel="icon" type="image/png" href="/images/bermuda-observer-favicon.png">\n' +
    '<link rel="apple-touch-icon" href="/images/bermuda-observer-app-icon.png">\n' +
    '<meta property="og:site_name" content="' + SITE_NAME + '">\n' +
    '<meta property="og:type" content="' + type + '">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + esc(canonical) + '">\n' +
    '<meta property="og:image" content="' + esc(img) + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + esc(title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<meta name="twitter:image" content="' + esc(img) + '">\n' +
    (o.extraHead || '') + '\n' +
    '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;0,800;0,900;1,700&display=swap" rel="stylesheet">\n' +
    '<style>' + BASE_CSS + '</style>\n</head>\n<body>';
}

const BASE_CSS = `
:root{--ocean:#0a3d6b;--ocean-light:#1565a0;--sand:#f8f6f0;--coral:#e63946;--text:#1a1a1a;--muted:#5a6b7a;--gold:#ffd700;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--text);background:var(--sand);line-height:1.65;}
.wrap{max-width:760px;margin:0 auto;padding:0 18px;}
.topbar{background:#061e35;color:#fff;padding:10px 0;}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;}
.brand{font-family:'Playfair Display',serif;font-weight:900;font-size:22px;color:#fff;text-decoration:none;}
.brand span{color:var(--gold);}
.home-link{color:#9fc3e0;font-size:13px;text-decoration:none;}
article{padding:28px 0 60px;}
.kicker{display:inline-block;background:var(--coral);color:#fff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px 12px;border-radius:4px;margin-bottom:16px;}
h1{font-family:'Playfair Display',serif;font-size:clamp(26px,5vw,42px);line-height:1.15;font-weight:900;margin-bottom:14px;color:#0a1a2a;}
.standfirst{font-size:18px;color:var(--muted);margin-bottom:18px;font-weight:400;}
.byline{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:13px;color:var(--muted);border-top:1px solid #e2ddd2;border-bottom:1px solid #e2ddd2;padding:12px 0;margin-bottom:8px;}
.byline .author{font-weight:600;color:var(--ocean);}
.updated-stamp{display:inline-flex;align-items:center;gap:6px;background:#fff7e0;border:1px solid var(--gold);color:#7a5c00;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;}
figure{margin:22px 0;}
figure img{width:100%;height:auto;border-radius:10px;display:block;}
figcaption{font-size:12px;color:var(--muted);padding:8px 2px 0;}
.article-body p{font-size:17px;margin-bottom:18px;}
.article-body h2{font-family:'Playfair Display',serif;font-size:22px;margin:28px 0 12px;color:var(--ocean);}
.video-embed{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;margin:22px 0;background:#000;}
.video-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.attribution{background:#eef4f9;border-left:4px solid var(--ocean-light);padding:14px 16px;font-size:13px;color:var(--muted);border-radius:0 8px 8px 0;margin:24px 0;}
.attribution a{color:var(--ocean-light);}
.related{margin-top:40px;padding-top:24px;border-top:2px solid var(--ocean);}
.related h3{font-family:'Playfair Display',serif;font-size:20px;margin-bottom:14px;}
.related a{display:block;padding:10px 0;color:var(--ocean);text-decoration:none;font-weight:600;border-bottom:1px solid #e2ddd2;}
.related a:hover{color:var(--coral);}
.trust-nav{background:#fff;border-top:1px solid #e2ddd2;padding:20px 0;margin-top:20px;}
.trust-nav .wrap{display:flex;flex-wrap:wrap;gap:8px 22px;font-size:13px;}
.trust-nav a{color:var(--muted);text-decoration:none;}
.trust-nav a:hover{color:var(--ocean);}
footer{background:#030d1a;color:#7a8fa5;padding:26px 0;font-size:12px;text-align:center;}
.brand-logo{height:30px;width:auto;margin-right:9px;vertical-align:middle;border-radius:5px;}
.statement-box{margin:24px 0;padding:20px 22px;background:#f4f8fb;border-left:4px solid var(--ocean);border-radius:0 10px 10px 0;}
.statement-label{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--ocean);font-weight:700;margin-bottom:10px;}
.statement-box p{margin:0 0 12px;font-size:15.5px;line-height:1.65;}
.statement-sig{font-size:13px;color:var(--muted);padding-top:10px;border-top:1px solid #dfe8f0;}
.statement-sig a{color:var(--ocean);text-decoration:none;}
.foot-social{margin-bottom:12px;}
.foot-social a{display:inline-block;margin:0 10px;padding:6px 14px;border:1px solid #2a3d52;border-radius:20px;color:#9fb3c8;text-decoration:none;font-size:12px;}
.foot-social a:hover{color:#fff;border-color:#4a6a8a;}
.inline-graphic{margin:26px 0;background:#fff;border:1px solid #e8e4da;border-radius:10px;overflow:hidden;}
.inline-graphic img{width:100%;height:auto;display:block;}
.inline-graphic figcaption{padding:11px 14px;font-size:13px;color:var(--muted);line-height:1.5;border-top:1px solid #f0ece2;}
@media(max-width:480px){.byline{gap:6px 12px;}h1{font-size:27px;}}
`;

function trustNav() {
  return '<div class="trust-nav"><div class="wrap">' +
    '<a href="/about">About Bermuda Observer</a>' +
    '<a href="/contact">Contact</a>' +
    '<a href="/editorial-standards">Editorial Standards</a>' +
    '<a href="/corrections">Corrections Policy</a>' +
    '</div></div>';
}
function pageFoot() {
  return trustNav() +
    '<footer><div class="wrap">' +
    '<div class="foot-social">' +
    '<a href="https://www.instagram.com/bermudaobserver/" target="_blank" rel="noopener">Instagram</a>' +
    '<a href="https://www.youtube.com/@BermudaObserver" target="_blank" rel="noopener">YouTube</a>' +
    '</div>' +
    '&copy; ' + new Date().getFullYear() + ' Bermuda Observer &middot; Where North East West South = News &middot; Bermuda\'s AI-Powered News &middot; Part of the Digital King Empire' +
    '</div></footer></body></html>';
}

function topBar() {
  return '<div class="topbar"><div class="wrap">' +
    '<a class="brand" href="/"><img class="brand-logo" src="/images/bermuda-observer-monogram-logo.png" alt="Bermuda Observer logo — Bermuda\'s AI-powered news">Bermuda<span>Observer</span></a>' +
    '<a class="home-link" href="/">&#8592; All News</a>' +
    '</div></div>';
}

// ── Article SSR page ──
function renderArticle(a, allArticles, opts) {
  a = media.normalize(a);
  const o = opts || {};
  const slug = slugify(a.title);
  const canonical = o.canonical || (SITE + '/article/' + a.id + '/' + slug + '/');
  const imgUrl = artImage(a);
  const imgPath = a.image && !/^https?:/.test(a.image) ? a.image : null;
  const h1 = o.h1 || a.title;
  const seoTitle = o.seoTitle || (a.title + ' | ' + SITE_NAME);
  const desc = (a.excerpt || a.summary || '').slice(0, 160);
  const published = fmtDateTime(a.published_at || a.date);
  const updated = fmtDateTime(a.updated_at || a.published_at || a.date);
  const author = a.author || a.attribution || 'Bermuda Observer Staff';
  const isCgrjp = media.isHub(a);

  // Related: same category or keyword overlap, excluding self.
  const rel = (allArticles || []).filter(x => x.id !== a.id)
    .filter(x => x.category === a.category || /c-grjp|air ambulance|gulfstream|nantucket|bermuda/i.test((x.title||'')) && /c-grjp|air ambulance|gulfstream|nantucket/i.test((a.title||'') + (a.body||'')))
    .slice(0, 5);

  let html = head({ title: seoTitle, desc, canonical, image: imgUrl, type: 'article', extraHead: jsonLdArticle(a, canonical, imgUrl, h1) });
  html += topBar();
  html += '<article class="wrap">';
  html += '<span class="kicker">' + esc((a.category || 'news').toUpperCase()) + '</span>';
  html += '<h1>' + esc(h1) + '</h1>';
  if (desc) html += '<p class="standfirst">' + esc((a.excerpt || a.summary || '').slice(0, 220)) + '</p>';
  html += '<div class="byline">' +
    '<span class="author">By ' + esc(author) + '</span>' +
    (published ? '<span>Published: ' + esc(published) + '</span>' : '') +
    (updated ? '<span class="updated-stamp">&#8635; Updated: ' + esc(updated) + '</span>' : '') +
    '</div>';
  if (isCgrjp) {
    html += '<div class="statement-box">' +
      '<div class="statement-label">Latest Status &mdash; Summary of Supplied Reporting</div>' +
      '<p><strong>C-GRJP DEBRIS RECOVERED OFF NANTUCKET &mdash; COAST GUARD SUSPENDS SEARCH FOR SIX.</strong></p>' +
      '<p>Debris associated with the missing Bermuda-to-Boston medical transport aircraft C-GRJP has been located in the waters off Nantucket as the U.S. Coast Guard concludes its active search for the six people aboard. Approximately 2,840 square miles of ocean were searched. The extensive debris field lies roughly 20 miles off Nantucket in water approximately 80&ndash;90 feet deep. The six people aboard &mdash; four Canadian nationals and two Bermudians &mdash; remain unaccounted for. The cause of the incident has not been determined. Our thoughts remain with those aboard, their families and loved ones.</p>' +
      '<div class="statement-sig">Bermuda Observer &middot; <em>Where North East West South = News.</em> &middot; <a href="https://www.instagram.com/bermudaobserver/" target="_blank" rel="noopener">Follow on Instagram</a> &middot; <a href="https://www.youtube.com/@BermudaObserver" target="_blank" rel="noopener">Watch on YouTube</a></div>' +
      '</div>';
  }
  if (a.video) {
    html += '<div class="video-embed"><iframe src="' + esc(a.video) + '" title="C-GRJP missing air ambulance video report" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>';
  }
  if (imgPath || a.image) {
    html += '<figure><img src="' + esc(imgUrl) + '" alt="' + esc(a.imageAlt) + '" loading="eager" fetchpriority="high">' +
      (a.imageCredit ? '<figcaption>' + esc(a.imageCredit) + '</figcaption>' : '') + '</figure>';
  }
  // C-GRJP articles: graphics embedded inline at their matching sections; others: plain body
  html += '<div class="article-body">' +
    (isCgrjp ? bodyToHtmlInline(a.body || a.content || a.excerpt || a.summary)
             : bodyToHtml(a.body || a.content || a.excerpt || a.summary)) +
    '</div>';
  if (isCgrjp && a.fileImage) {
    html += '<figure><img src="' + esc(a.fileImage) + '" alt="C-GRJP on the ground — credited aircraft file photo, not incident photography" loading="lazy"><figcaption>' + esc(a.fileImageCredit) + '</figcaption></figure>';
  }
  if (a.url && a.url !== '#') {
    html += '<div class="attribution">Based on reporting by ' + esc(a.source || 'the original publisher') + ' &mdash; <a href="' + esc(a.url) + '" target="_blank" rel="noopener">read the original &#8599;</a></div>';
  }
  if (rel.length) {
    html += '<div class="related"><h3>Related Coverage</h3>';
    for (const r of rel) {
      const rslug = media.articleUrl(r);
      html += '<a href="' + rslug + '">' + esc(r.title) + '</a>';
    }
    html += '</div>';
  }
  html += '</article>' + pageFoot();
  return html;
}

// ── Trust pages ──
function trustPage(title, heading, inner) {
  return head({ title: title + ' | ' + SITE_NAME, desc: heading, canonical: SITE + '/' + slugify(title) }) +
    topBar() +
    '<article class="wrap"><h1 style="margin-top:26px;">' + esc(heading) + '</h1><div class="article-body">' + inner + '</div></article>' +
    pageFoot();
}
function renderAbout() {
  return trustPage('About', 'About Bermuda Observer',
    '<p>Bermuda Observer is Bermuda\'s AI-powered newsroom, delivering original reporting and curated coverage of Bermuda news, government, business, sports, tourism and community life.</p>' +
    '<p>We combine an automated news-gathering pipeline with human editorial oversight. Original investigative and breaking stories are reported and written by our editorial team; aggregated stories are clearly attributed to their original publishers with links to the source.</p>' +
    '<p>Bermuda Observer is part of the Digital King Empire family of Bermudian digital platforms, alongside Bermuda ePass, Bermuda Locals and LexAI.</p>');
}
function renderContact() {
  return trustPage('Contact', 'Contact Bermuda Observer',
    '<p>News tips, corrections and enquiries:</p>' +
    '<p><strong>Email:</strong> <a href="mailto:news@bermudaobserver.com">news@bermudaobserver.com</a></p>' +
    '<p>For breaking news and aviation, marine or public-safety matters, please include any primary sources (official statements, tracking data, photographs) so our team can verify information quickly.</p>' +
    '<p>We aim to acknowledge all editorial correspondence within one business day.</p>');
}
function renderEditorial() {
  return trustPage('Editorial Standards', 'Editorial Standards',
    '<p>Bermuda Observer follows these core principles:</p>' +
    '<p><strong>Accuracy first.</strong> We distinguish clearly between confirmed facts, officially released information, and analysis or interpretation. Unverified reports are labelled as such.</p>' +
    '<p><strong>Attribution.</strong> Aggregated stories credit the original publisher and link to the source. Original reporting is bylined.</p>' +
    '<p><strong>Sourcing.</strong> We rely on primary sources &mdash; government statements, official agencies, court records and verifiable data &mdash; wherever possible.</p>' +
    '<p><strong>Independence.</strong> Advertising and house promotions are kept separate from editorial content.</p>' +
    '<p><strong>Accountability.</strong> Errors are corrected promptly and transparently in line with our <a href="/corrections">Corrections Policy</a>.</p>');
}
function renderCorrections() {
  return trustPage('Corrections', 'Corrections Policy',
    '<p>Bermuda Observer is committed to accuracy. When we get something wrong, we fix it.</p>' +
    '<p><strong>How to request a correction:</strong> Email <a href="mailto:news@bermudaobserver.com">news@bermudaobserver.com</a> with the article URL, the information you believe is incorrect, and any supporting evidence.</p>' +
    '<p><strong>What we do:</strong> Substantive errors are corrected in the article text with an &ldquo;Updated&rdquo; timestamp. Where a correction changes the meaning of a story, a note is added at the foot of the article recording what was changed and when.</p>' +
    '<p>Minor typographical errors may be fixed without a formal note.</p>');
}

// ── Sitemap ──
function renderSitemap(articles, hubUrl) {
  const urls = [
    { loc: SITE + '/', pri: '1.0', freq: 'hourly' },
    { loc: hubUrl, pri: '0.9', freq: 'hourly' },
    { loc: SITE + '/about', pri: '0.3', freq: 'monthly' },
    { loc: SITE + '/contact', pri: '0.3', freq: 'monthly' },
    { loc: SITE + '/editorial-standards', pri: '0.3', freq: 'monthly' },
    { loc: SITE + '/corrections', pri: '0.3', freq: 'monthly' },
  ];
  for (const a of articles || []) {
    if (!a || !a.id || !a.title) continue;
    const isHub = media.isHub(a);
    urls.push({
      loc: isHub ? hubUrl : (SITE + '/article/' + a.id + '/' + slugify(a.title) + '/'),
      lastmod: (a.updated_at || a.published_at || a.date || '').slice(0, 10) || undefined,
      pri: isHub ? '0.9' : '0.7', freq: isHub ? 'hourly' : 'daily'
    });
  }
  const seen = new Set();
  const items = urls.filter(u => { if (seen.has(u.loc)) return false; seen.add(u.loc); return true; })
    .map(u => '  <url><loc>' + esc(u.loc) + '</loc>' +
      (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') +
      '<changefreq>' + u.freq + '</changefreq><priority>' + u.pri + '</priority></url>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + items + '\n</urlset>';
}

module.exports = { renderArticle, renderAbout, renderContact, renderEditorial, renderCorrections, renderSitemap, slugify, SITE };
