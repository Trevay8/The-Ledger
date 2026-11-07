// Feed configuration for The Ledger.
// Edit this file to add/remove sources. Everything is fetched by scripts/fetch-data.mjs
// inside GitHub Actions every 3 hours.
//
// kind:     "rss" (direct RSS/Atom feed) or "gnews" (Google News RSS search query)
// section:  "markets" (Market Updates), "reports" (Quarterly Reports), "deals" (Recent Deals)
// cat:      "re" (real estate) or "macro"
// group:    reports only: "brokers" | "data" | "managers"
// sub:      true if you have a subscription (gets a ranking boost + badge)
// paywall:  true if articles sit behind a paywall

const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;

export const SOURCES = [
  // ---------- MARKET UPDATES: subscriptions ----------
  { id: 'ft-property', name: 'FT', kind: 'rss', url: 'https://www.ft.com/property?format=rss', section: 'markets', cat: 're', sub: true, paywall: true, weight: 1.3 },
  { id: 'ft-economy', name: 'FT', kind: 'rss', url: 'https://www.ft.com/global-economy?format=rss', section: 'markets', cat: 'macro', sub: true, paywall: true, weight: 1.2 },
  { id: 'ft-markets', name: 'FT', kind: 'rss', url: 'https://www.ft.com/markets?format=rss', section: 'markets', cat: 'macro', sub: true, paywall: true, weight: 1.1 },
  { id: 'costar', name: 'CoStar', kind: 'gnews', url: gnews('site:costar.com (UK OR London OR Europe) when:7d'), section: 'markets', cat: 're', sub: true, paywall: true, weight: 1.3 },
  { id: 'greenstreet', name: 'Green Street', kind: 'gnews', url: gnews('site:greenstreet.com when:30d'), section: 'markets', cat: 're', sub: true, paywall: true, weight: 1.2 },

  // ---------- MARKET UPDATES: real estate trade press ----------
  { id: 'pie', name: 'Property Industry Eye', kind: 'rss', url: 'https://propertyindustryeye.com/feed/', section: 'markets', cat: 're', weight: 0.9 },
  { id: 'reactnews', name: 'React News', kind: 'gnews', url: gnews('"React News" when:30d'), section: 'markets', cat: 're', weight: 1.0 },
  { id: 'eg', name: 'EG', kind: 'gnews', url: gnews('"Estates Gazette" when:14d'), section: 'markets', cat: 're', weight: 1.0 },
  { id: 'cityam-property', name: 'City AM', kind: 'rss', url: 'https://www.cityam.com/category/property/feed/', section: 'markets', cat: 're', weight: 0.9 },
  { id: 'propertyweek', name: 'Property Week', kind: 'gnews', url: gnews('site:propertyweek.com when:7d'), section: 'markets', cat: 're', paywall: true, weight: 1.0 },
  { id: 'ipe-ra', name: 'IPE Real Assets', kind: 'gnews', url: gnews('site:realassets.ipe.com when:14d'), section: 'markets', cat: 're', weight: 1.0 },
  { id: 'pere-g', name: 'PERE', kind: 'gnews', url: gnews('site:perenews.com when:30d'), section: 'markets', cat: 're', paywall: true, weight: 1.1 },
  { id: 'bisnow', name: 'Bisnow', kind: 'gnews', url: gnews('site:bisnow.com/london when:7d'), section: 'markets', cat: 're', weight: 0.9 },
  { id: 'reuters-re', name: 'Reuters', kind: 'gnews', url: gnews('site:reuters.com (property OR "real estate") (UK OR Britain OR Europe) when:7d'), section: 'markets', cat: 're', weight: 1.1 },

  // ---------- MARKET UPDATES: macro ----------
  { id: 'bbc-business', name: 'BBC', kind: 'rss', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', section: 'markets', cat: 'macro', weight: 0.9 },
  { id: 'guardian-business', name: 'Guardian', kind: 'rss', url: 'https://www.theguardian.com/uk/business/rss', section: 'markets', cat: 'macro', weight: 0.8 },
  { id: 'sky-business', name: 'Sky News', kind: 'rss', url: 'https://feeds.skynews.com/feeds/rss/business.xml', section: 'markets', cat: 'macro', weight: 0.8 },
  { id: 'reuters-macro', name: 'Reuters', kind: 'gnews', url: gnews('site:reuters.com ("Bank of England" OR ECB OR gilts OR inflation OR "euro zone") when:3d'), section: 'markets', cat: 'macro', weight: 1.1 },
  { id: 'boe', name: 'Bank of England', kind: 'rss', url: 'https://www.bankofengland.co.uk/rss/news', section: 'markets', cat: 'macro', weight: 1.2 },
  { id: 'ecb', name: 'ECB', kind: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html', section: 'markets', cat: 'macro', weight: 0.7 },

  // ---------- QUARTERLY REPORTS: brokers ----------
  ...[
    ['cbre', 'CBRE', '"CBRE" (research OR report OR outlook OR survey) (UK OR Europe) when:30d'],
    ['jll', 'JLL', '"JLL" (research OR report OR outlook) (UK OR Europe) when:30d'],
    ['savills', 'Savills', '"Savills" (research OR report OR outlook OR "prime yields") when:30d'],
    ['knightfrank', 'Knight Frank', '"Knight Frank" (research OR report OR outlook OR index) when:30d'],
    ['cushman', 'Cushman & Wakefield', '"Cushman & Wakefield" (research OR report OR outlook) (UK OR Europe) when:30d'],
    ['colliers', 'Colliers', '"Colliers" (research OR report OR outlook) (UK OR Europe) when:30d'],
  ].map(([id, name, q]) => ({ id: `r-${id}`, name, kind: 'gnews', url: gnews(q), section: 'reports', group: 'brokers', cat: 're', weight: 1 })),

  // ---------- QUARTERLY REPORTS: data & industry bodies ----------
  ...[
    ['msci', 'MSCI', '"MSCI" (property OR "real estate" OR "real assets") index (UK OR Europe) when:30d'],
    ['inrev', 'INREV', 'INREV when:60d'],
    ['bpf', 'BPF', '"British Property Federation" when:30d'],
    ['rics', 'RICS', 'RICS (commercial OR residential OR property) survey when:30d'],
    ['gs-r', 'Green Street', '"Green Street" (CPPI OR "commercial property price index" OR research) when:45d'],
  ].map(([id, name, q]) => ({ id: `r-${id}`, name, kind: 'gnews', url: gnews(q), section: 'reports', group: 'data', cat: 're', weight: 1 })),

  // ---------- QUARTERLY REPORTS: fund managers ----------
  ...[
    ['cbreim', 'CBRE IM', '"CBRE Investment Management" when:45d'],
    ['nuveen', 'Nuveen', '"Nuveen Real Estate" when:45d'],
    ['pgim', 'PGIM', '"PGIM Real Estate" when:45d'],
    ['mg', 'M&G', '"M&G Real Estate" when:45d'],
    ['blackstone', 'Blackstone', 'Blackstone real estate (Europe OR UK) when:30d'],
    ['aew', 'AEW', '"AEW" real estate research Europe when:60d'],
    ['lasalle', 'LaSalle', '"LaSalle Investment Management" when:60d'],
  ].map(([id, name, q]) => ({ id: `r-${id}`, name, kind: 'gnews', url: gnews(q), section: 'reports', group: 'managers', cat: 're', weight: 1 })),

  // ---------- RECENT DEALS (plus deal-like items auto-pulled from RE feeds above) ----------
  ...[
    ['d-logistics', '(acquires OR acquired OR buys OR sells OR "sale of") (logistics OR warehouse OR industrial) (UK OR Europe OR Germany OR France OR Spain OR Netherlands) when:10d'],
    ['d-office', '(acquires OR buys OR sells OR "agreed to buy") office (London OR Paris OR Frankfurt OR Madrid OR Amsterdam OR Milan OR Dublin) when:10d'],
    ['d-living', '(acquires OR buys OR sells OR "forward fund" OR "joint venture") ("student accommodation" OR PBSA OR "build-to-rent" OR BTR OR "residential portfolio") (UK OR Europe) when:14d'],
    ['d-retail', '(acquires OR buys OR sells) ("shopping centre" OR "retail park" OR "retail portfolio") (UK OR Europe) when:14d'],
    ['d-alts', '(acquires OR buys OR sells OR "joint venture") ("data centre" OR "life sciences" OR "self storage" OR hotel OR healthcare) real estate (UK OR Europe) when:14d'],
    ['d-funds', '("final close" OR "first close" OR "raises" OR fundraise) real estate fund (Europe OR UK OR European) when:21d'],
    ['d-jv', '"real estate" "joint venture" (UK OR Europe OR European) when:14d'],
  ].map(([id, q]) => ({ id, name: 'Google News', kind: 'gnews', url: gnews(q), section: 'deals', cat: 're', weight: 1 })),
];
