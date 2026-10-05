require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const newsroom = require('./newsroom');
const ssr = require('./ssr');
const app = express();
const PORT = process.env.PORT || 3025;
app.use(cors()); app.use(express.json());

// ── SSR SEO ROUTES (before static + catch-all) ──
// Canonical authoritative hub for the C-GRJP story. ONE URL, updated in place.
const CGRJP_HUB = '/c-grjp-missing-air-ambulance-bermuda-boston';
function findCGRJP() {
  const arts = newsroom.getArticles();
  return arts.find(a => a && a.id === 'ca7a9c9f9763')
      || arts.find(a => a && /c-grjp|air ambulance/i.test((a.title || '') + (a.body || '')));
}
app.get([CGRJP_HUB, CGRJP_HUB + '/'], (req, res) => {
  const a = findCGRJP();
  if (!a) return res.redirect('/');
  res.send(ssr.renderArticle(a, newsroom.getArticles(), {
    canonical: ssr.SITE + CGRJP_HUB + '/',
    seoTitle: 'C-GRJP: Bermudians Identified as Marilyn Bean and Son Sergio Lottimore | Bermuda Observer',
    h1: 'C-GRJP Air Ambulance: Bermudians Identified as Marilyn Bean and Son Sergio Lottimore'
  }));
});
// SSR article pages for every story — Google-indexable, shareable URLs.
app.get('/article/:id/:slug?', (req, res) => {
  const a = newsroom.getArticles().find(x => x && x.id === req.params.id);
  if (!a) return res.redirect('/');
  // C-GRJP-family stories all canonicalise to the single hub URL.
  if (/c-grjp|air ambulance|gulfstream g100/i.test((a.title || '') + (a.body || ''))) {
    return res.redirect(301, CGRJP_HUB + '/');
  }
  res.send(ssr.renderArticle(a, newsroom.getArticles()));
});
// Trust pages (E-E-A-T).
app.get('/about', (req, res) => res.send(ssr.renderAbout()));
app.get('/contact', (req, res) => res.send(ssr.renderContact()));
app.get('/editorial-standards', (req, res) => res.send(ssr.renderEditorial()));
app.get('/corrections', (req, res) => res.send(ssr.renderCorrections()));
// Real XML sitemap.
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(ssr.renderSitemap(newsroom.getArticles(), ssr.SITE + CGRJP_HUB + '/'));
});

app.use(express.static(path.join(__dirname, 'public')));
const HEADLINES = [
  {
    id: 10,
    title: 'LexAI Launches Free Crown and Anchor Legal Guide',
    source: 'Bermuda Observer',
    category: 'business',
    time: 'Just now',
    breaking: false,
    summary: 'AI legal platform LexAI has published a comprehensive free guide to Crown and Anchor table operation in Bermuda -- including the $1,750 permit fee, Liquor Licence Act 1974 requirements, and criminal penalties for false applications.',
    body: `LexAI, an AI legal intelligence platform built for the Caribbean and Bermuda, has added a dedicated Bermuda Gaming and Crown and Anchor module to its Legal Library -- the free, public-facing section that requires no account or subscription.

KEY REQUIREMENTS TO OPERATE A CROWN AND ANCHOR TABLE IN BERMUDA:

1. You must hold an approved Bermuda liquor licence (Liquor Licence Act 1974).
2. A Crown and Anchor Permit from the Bermuda Gaming Commission (BGC) is required.
3. Application fee: $1,750 -- must be paid in full.
4. Only approximately 5 permits are issued per year island-wide.
5. Apply at bgc.bm/crown-anchor-application.

CRIMINAL WARNING: Section 1(iv) of the Liquor Licence Act 1974 makes it a criminal offence to knowingly furnish false information in any application.

PATI Act 2010: All information submitted to the BGC may be subject to public disclosure.

The guide also covers casino gaming (Casino Gaming Act 2014, max 3 licences, hotels/resorts only), betting shops (Betting Act 2021), cruise ship casinos (40-50 permits/year), lotteries and raffles, and confirms that online gambling remains illegal in Bermuda -- no licences have ever been issued.

Access the full guide free at lexai.llc -- navigate to Legal Library section.`,
    author: 'Bermuda Observer Staff',
    date: '2026-07-15T23:39:00.000Z'
  },
  {id:1,title:'Bermuda Government Announces New AI Initiative',source:'Royal Gazette',category:'government',time:'2h ago',summary:'The Government of Bermuda has launched a new AI initiative aimed at improving public services.'},
  {id:2,title:'Hamilton Harbour Development Project Receives Final Approval',source:'Bernews',category:'business',time:'4h ago',summary:'The long-awaited Hamilton Harbour development project has received its final approval.'},
  {id:3,title:'Bermuda Tourism Reports Record Visitor Numbers for Q1 2026',source:'Bermuda Sun',category:'tourism',time:'6h ago',summary:'Tourism officials report a 23% increase in visitor arrivals compared to last year.'},
  {id:4,title:'BDA Fintech Hub Welcomes 5 New Member Companies',source:'Royal Gazette',category:'business',time:'8h ago',summary:'The Bermuda Business Development Agency announced five new fintech companies joining its hub.'},
  {id:5,title:'Weather Alert: Tropical Storm Watch Issued for Bermuda',source:'Bernews',category:'weather',time:'1h ago',summary:'The Bermuda Weather Service has issued a tropical storm watch as a system develops.'},
  {id:6,title:'Cup Match 2026 Dates Confirmed by Cricket Associations',source:'Bermuda Sun',category:'sports',time:'12h ago',summary:'Cricket associations have confirmed the dates for this year\'s Cup Match Classic.'},
  {id:7,title:'New Affordable Housing Units to Break Ground in Devonshire',source:'Royal Gazette',category:'government',time:'1d ago',summary:'Construction is set to begin on 120 new affordable housing units.'},
  {id:8,title:'Bermuda Stock Exchange Lists First Digital Asset Security',source:'Bernews',category:'business',time:'1d ago',summary:'The BSX has completed the listing of its first digital asset security token.'},
];
app.get('/api/headlines', (req,res) => {
  const {category} = req.query;
  let r = HEADLINES;
  if (category && category !== 'all') r = r.filter(h => h.category === category);
  res.json({headlines:r, lastUpdated: new Date().toISOString()});
});
// AI newsroom: original rewritten Bermuda stories (array — the shape fetchNews() expects).
// 503 while the first poll is still running so the frontend uses its built-in fallback.
app.get('/api/news', (req,res) => {
  const a = newsroom.getArticles();
  if (!a.length) return res.status(503).json({error:'newsroom warming up, first poll in progress'});
  res.json(a);
});
app.get('/api/news/status', (req,res) => res.json(newsroom.getStatus()));
// Bermuda obituaries, newest first; [] until the first poll ingests some — never errors.
app.get('/api/obituaries', (req,res) => res.json(newsroom.getObituaries()));
app.get('/api/health', (req,res) => res.json({status:'ok',service:'BermudaObserver'}));
app.get('*', (req,res) => { const f = path.join(__dirname,'public','index.html'); require('fs').existsSync(f) ? res.sendFile(f) : res.json({status:'ok',service:'BermudaObserver',api:'/api/headlines'}); });
app.listen(PORT, () => console.log(`🇧🇲 BermudaObserver :${PORT}`));
newsroom.start();
