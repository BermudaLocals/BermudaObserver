/* Reviewed media shared by the newsroom, SSR and browser. Stock is illustrative,
   never evidence of a named event. Only the exact editorial hub uses C-GRJP art. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoryMedia = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HUB_ID = 'ca7a9c9f9763';
  const HUB_URL = '/c-grjp-missing-air-ambulance-bermuda-boston/';
  const HUB_IMAGE = '/images/c-grjp-coming-in-blind.png';
  // Reviewed legacy duplicates only; unrelated aviation reporting keeps its own URL.
  const HUB_ALIASES = ['a20b0a4eb69c', 'db6a00e752ce', 'bf08b6105822',
    'c8314975b651', 'e9403735a2df', 'fd3174505d12', '8524423228d6',
    '9fd055505125', 'cb4249525e8c', 'e295a7d3e4e7', '47fda8e35607'];
  const STOCK = {
    soccer: ['soccer.jpg', 'Football stock photograph', 'Pexels / photo 274422'],
    cricket: ['cricket.jpg', 'Cricket stock photograph', 'Lorien le Poer Trench / Pexels'],
    sailing: ['boats.jpg', 'Boats on Bermuda waters', 'Brandon Morrison / Pexels'],
    weather: ['coastline.jpg', 'Bermuda coastline', 'Brandon Morrison / Pexels'],
    tourism: ['beach.jpg', 'Beach scenery', 'Andrea Powell / Pexels'],
    shipping: ['harbor.jpg', 'Bermuda harbour scenery', 'Brandon Morrison / Pexels'],
    general: ['town.jpg', 'Houses and palm trees', 'Christy Rice / Pexels']
  };
  function isHub(a) { return !!a && a.id === HUB_ID; }
  function articleUrl(a) {
    return isHub(a) || (a && HUB_ALIASES.includes(a.id)) ? HUB_URL : '/article/' + encodeURIComponent(a.id) + '/';
  }
  function media(a) {
    if (isHub(a)) return {
      image: HUB_IMAGE,
      imageAlt: "Editorial illustration for C-GRJP's reported 'coming in blind' ATC exchange; not documentary imagery",
      imageCredit: 'Bermuda Observer — supplied editorial illustration. Aircraft, weather, chart and rescue scenes are illustrative, not authenticated photographs or flight records.',
      imageLabel: 'Editorial illustration · not documentary evidence', imageKind: 'illustration'
    };
    // Title only: a passing mention in a long article must not select another sport.
    const title = (a && a.title) || '';
    let key = 'general';
    if (/\b(football|soccer|fifa|concacaf|nations league|premier league|khano smith|reggie lambe|dandy town|trojans|wanderers)\b/i.test(title)) key = 'soccer';
    else if (/\b(cricket|cricketer|bcb|cup match|david hemp)\b/i.test(title)) key = 'cricket';
    else if (/\b(sailing|regatta|sailor|danmark trophy|bromby|gold cup|fishing)\b/i.test(title)) key = 'sailing';
    else if (/\b(weather|forecast|storm|hurricane|shower|fay)\b/i.test(title)) key = 'weather';
    else if (/\b(shipping|port of hamilton|cruise)\b/i.test(title)) key = 'shipping';
    else if (/\b(tourism|beach|visitors)\b/i.test(title)) key = 'tourism';
    const stock = STOCK[key];
    return {
      image: '/images/' + stock[0], imageAlt: stock[1] + ' — illustrative, not a photograph of this event',
      imageCredit: stock[2] + ' — illustrative stock; not a photograph of this event.',
      imageLabel: 'Illustrative stock · not an event photograph', imageKind: 'stock'
    };
  }
  function normalize(a) { return Object.assign({}, a, media(a)); }
  return { HUB_ID, HUB_URL, HUB_IMAGE, HUB_ALIASES, isHub, articleUrl, media, normalize };
});
