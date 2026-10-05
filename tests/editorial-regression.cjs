'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const media = require('../public/story-media');
const ssr = require('../ssr');
const newsroom = require('../newsroom');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data-seed/articles.json')));
const hub = seed.find(media.isHub);
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
check('hub title, summary and illustration are current', () => {
  assert.match(hub.title, /Reportedly.*Coming In Blind/);
  assert.equal(hub.summary, hub.excerpt);
  assert.equal(hub.image, media.HUB_IMAGE);
  assert.equal(hub.editorialRevision, 1);
});
for (const file of ['index.html', 'public/index.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  check(file + ' inline scripts syntax', () => {
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/src=/.test(m[1])) continue;
      if (/application\/ld\+json/.test(m[1])) JSON.parse(m[2]);
      else new vm.Script(m[2], { filename: file });
    }
  });
  check(file + ' static headline, image and real hub anchor', () => {
    assert.equal(html.match(/<h1 class="hero-title" id="hero-title">([^<]+)<\/h1>/)[1], hub.title);
    assert.match(html, /<a class="hero-(slide active|card)"[^>]*href="\/c-grjp-missing-air-ambulance-bermuda-boston\/"/);
    assert.ok(html.includes('src="' + hub.image + '"'));
    assert.ok(html.includes('Editorial illustration · not documentary evidence'));
    assert.ok(html.includes('findIndex(StoryMedia.isHub)'));
    assert.ok(html.includes('modal-image-credit'));
    assert.ok(!html.includes('allArticles.findIndex(a => a && /c-grjp'));
  });
}
check('all stored image files and all policy mappings exist', () => {
  const runtime = fs.existsSync(path.join(root, 'data/articles.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'data/articles.json'))) : [];
  for (const a of [...seed, ...runtime]) {
    for (const src of [a.image, media.media(a).image]) {
      if (src && src.startsWith('/images/')) assert.ok(fs.statSync(path.join(root, 'public', src)).size > 0, src);
    }
  }
});
check('SSR headline, title, schema and media agree', () => {
  const html = ssr.renderArticle(hub, seed, {canonical: ssr.SITE + media.HUB_URL});
  const escaped = hub.title.replace(/'/g, '&#39;');
  assert.ok(html.includes('<h1>' + escaped + '</h1>'));
  assert.ok(html.includes('<title>' + escaped + ' | Bermuda Observer</title>'));
  const schema = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.ok(schema.some(s => s.headline === hub.title));
  assert.ok(html.includes(hub.image));
  assert.ok(html.includes('Matthew McDonald / JetPhotos'));
  assert.ok(html.includes('Latest Status'));
  assert.ok(!html.includes('Official Statement'));
});
check('one exact-section identity composite, no sonar or misleading archives', () => {
  const html = ssr.renderArticle(hub, seed);
  assert.equal((html.match(/class="inline-graphic"/g) || []).length, 1);
  assert.ok(html.includes('c-grjp-bermuda-search-operation.png'));
  assert.ok(!/sonar-search\.png|flight-data-raises-questions\.png|electrical-trouble\.png|search-enters-new-phase\.png|heartbeat[^"]*\.png/i.test(html));
  const unmatched = ssr.renderArticle({...hub, body: 'An unrelated paragraph about a Gulfstream jet.'}, []);
  assert.ok(!unmatched.includes('class="inline-graphic"'));
});
check('unrelated Gulfstream or air ambulance article receives no hub treatment', () => {
  const a = {id:'unrelated',title:'New Gulfstream service for Bermuda',body:'An air ambulance is mentioned in this unrelated report.',category:'news',source:'Original publisher',url:'https://example.org/source'};
  const html = ssr.renderArticle(a, []);
  assert.ok(!html.includes('inline-graphic"><img'));
  assert.ok(!html.includes('statement-box">'));
  assert.ok(!html.includes('c-grjp-coming-in-blind.png'));
  assert.ok(html.includes('Original publisher'));
  assert.ok(html.includes('https://example.org/source'));
  assert.equal(media.articleUrl(a), '/article/unrelated/');
});
check('football is football, cricket is cricket, golf is explicitly illustrative scenery', () => {
  assert.equal(media.media({title:'Football: Dandy Town Win'}).image, '/images/soccer.jpg');
  assert.equal(media.media({title:'Cricket: Cup Match'}).image, '/images/cricket.jpg');
  assert.equal(media.media({title:'Golf Championship'}).image, '/images/town.jpg');
  assert.match(media.media({title:'Golf Championship'}).imageAlt, /not a photograph of this event/);
});
check('seed revision updates existing hub only, never newer runtime corrections', () => {
  const old = {...hub, title:'Old headline',editorialRevision:0};
  const other = {id:'other', title:'Unchanged'};
  const corrected = newsroom.applyEditorialSeed([old, other], [hub, {...other,title:'Bad overwrite',editorialRevision:9}]);
  assert.equal(corrected[0].title, hub.title);
  assert.equal(corrected[1], other);
  assert.equal(newsroom.applyEditorialSeed([{...hub,editorialRevision:2,title:'Future'}],[hub])[0].title,'Future');
});
check('rolling retention protects the old hub without changing publication dates', () => {
  const old = {...hub,published_at:'2000-01-01T00:00:00Z'};
  const retained = newsroom.retainArticles([old,...Array.from({length:125}, (_,i)=>({id:'n'+i,published_at:'2026-10-05T00:00:00Z'}))]);
  assert.equal(retained.length,120);
  assert.equal(retained[0],old);
});
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bo-regression-'));
  let child;
  try {
    for (const f of ['server.js','newsroom.js','ssr.js']) fs.copyFileSync(path.join(root,f),path.join(dir,f));
    for (const f of ['node_modules','data-seed','public']) fs.symlinkSync(path.join(root,f),path.join(dir,f),'dir');
    fs.mkdirSync(path.join(dir,'data'));
    // Exercise a persistent stale runtime hub, rather than only a fresh seed.
    fs.writeFileSync(path.join(dir,'data/articles.json'),JSON.stringify([{...hub,title:'Stale persisted title',editorialRevision:0},seed.find(a=>a.id==='400a8d80f507')]));
    let logs = '';
    child = spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:'18325',NEWSROOM_DISABLE_POLL:'1'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',c=>logs+=c); child.stderr.on('data',c=>logs+=c);
    const base = 'http://127.0.0.1:18325';
    let ready = false;
    for(let i=0;i<50;i++) {
      if(child.exitCode !== null) throw Error('Test server exited: '+logs);
      try { if((await fetch(base+'/api/health')).ok) {ready=true;break;} } catch {}
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(ready,'Server readiness: '+logs);
    const arts = await (await fetch(base+'/api/news')).json();
    check('local API serves migrated title and media, not stale persistent hub',()=> {
      const a=arts.find(media.isHub);assert.equal(a.title,hub.title);assert.equal(a.image,hub.image);
      assert.ok(arts.every(a=>!media.HUB_ALIASES.includes(a.id)));
    });
    const html=await (await fetch(base+media.HUB_URL)).text();
    check('local HTTP hub serves current title and exact canonical',()=> {
      assert.ok(html.includes(hub.title.replace(/'/g,'&#39;')));
      assert.ok(html.includes(ssr.SITE+media.HUB_URL));
      assert.ok(html.includes('not authenticated photographs or flight records'));
    });
    for(const a of arts){
      const res=await fetch(base+a.image);
      assert.equal(res.status,200,a.image);assert.match(res.headers.get('content-type'),/^image\//);
    }
    check('every local API image returns real image bytes, not SPA fallback',()=>{});
    const redirect=await fetch(base+'/article/'+media.HUB_ALIASES[0]+'/',{redirect:'manual'});
    check('legacy duplicate URL redirects directly to hub',()=>{assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),media.HUB_URL);});
    const non=arts.find(a=>a.id==='400a8d80f507');
    const nonres=await fetch(base+media.articleUrl(non),{redirect:'manual'});
    const nonhtml=await nonres.text();
    check('non-hub article HTTP retains its own title and source attribution',()=>{assert.equal(nonres.status,200);assert.ok(nonhtml.includes(non.title));assert.ok(!nonhtml.includes('c-grjp-coming-in-blind.png'));});
    console.log('ALL '+checks+' REGRESSION CHECKS PASSED');
  } finally {
    if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
