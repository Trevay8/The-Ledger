// Fetches news feeds + macro metrics and writes data/news.json and data/metrics.json.
// Runs in GitHub Actions (Node 20+, zero dependencies).
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SOURCES } from './sources.mjs';

const OUT = new URL('../data/', import.meta.url);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGES_URL = process.env.PAGES_URL || '';
const NOW = Date.now();
const HOUR = 3600e3;

// ---------------------------------------------------------------- helpers
async function get(url, { timeout = 25000, accept, tries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          Accept: accept || 'application/rss+xml, application/xml, text/xml, text/csv, application/json, */*',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const stripHtml = (s = '') => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = stripHtml(tag(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      if (m) link = decode(m[1]);
    }
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const src = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    items.push({
      title: stripHtml(tag(b, 'title')),
      link: link.trim(),
      date: date && !isNaN(Date.parse(stripHtml(date))) ? new Date(stripHtml(date)).toISOString() : null,
      summary: stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')),
      publisher: src ? stripHtml(src[1]) : null,
    });
  }
  return items.filter((x) => x.title && x.link);
}

// ---------------------------------------------------------------- classification
const PAYWALLED = /^(FT|Financial Times|CoStar|EG|Estates Gazette|React News|Property Week|PERE|Bloomberg|The Wall Street Journal|WSJ|The Times|The Telegraph|Real Estate Capital Europe|Green Street|The Economist|Reuters Breakingviews)/i;
const SUB_PUBS = /^(FT|Financial Times|CoStar|Green Street)/i;

const DEAL_RX = /\b(acquir\w*|buys?|bought|sells?|sold|sale of|disposal|dispos\w+|offload\w*|snaps? up|purchas\w+|forward[- ]fund\w*|joint venture|JV|final close|first close|closes? fund|refinanc\w+|loan|financing|lends?|merger|takeover|bid for|agrees? to buy|swoops)\b|\b(raises?|raised)\b.*\bfund|\bfund\b.*\b(raises?|raised)\b/i;

// Relevance vocab
const RE_RX = /\b(property|properties|real estate|REITs?|offices?|logistics|warehous\w*|industrial|retail parks?|shopping cent\w+|malls?|residential|housing|homes?|landlords?|tenants?|lettings?|leas(e|es|ing)|rents?|rental|student accommodation|PBSA|build[- ]to[- ]rent|BTR|hotels?|data cent\w+|life sciences?|self[- ]storage|care homes?|portfolios?|valuations?|yields?|developers?|development|sq ft|square feet|acres|towers?|buildings?|estates?|planning|construction|housebuild\w*|mortgages?|house prices|commercial property|investment volumes?|vacancy|occupiers?|asset manag\w+|private equity|funds?|Blackstone|Brookfield|Landsec|British Land|SEGRO|Unite|Grainger|Derwent|Great Portland|LondonMetric|Tritax|Vonovia|Unibail)\b/i;
const RE_STRICT_RX = /\b(property|properties|real estate|REITs?|offices?|logistics (hub|park|cent\w+|portfolio|warehouse|site|scheme|asset)s?|warehous\w*|industrial (estate|park|portfolio|units?|scheme|property)|retail parks?|shopping cent\w+|malls?|residential|housing|homes|landlords?|lettings?|rents?|rental|student accommodation|PBSA|build[- ]to[- ]rent|BTR|single[- ]family|SFH|hotels?|data cent\w+|life sciences?|self[- ]storage|care homes?|assisted living|senior living|sq ft|square feet|acres|towers?|buildings?|house prices|commercial property|investment volumes?|vacancy|occupiers?|sale[- ]and[- ]leaseback|Landsec|British Land|SEGRO|Unite|Grainger|Derwent|Great Portland|LondonMetric|Tritax|Vonovia|Unibail|Wereldhave|Hammerson)\b/i;
const MACRO_RX = /\b(inflation|CPI|interest rates?|rates? (cut|rise|hike|decision)s?|Bank of England|BoE|ECB|Federal Reserve|Fed|central banks?|MPC|gilts?|bonds?|bund|treasur(y|ies)|Budget|Reeves|Chancellor|Lagarde|Bailey|Starmer|GDP|growth|recession|econom(y|ic|ies)|unemployment|jobs|wages|pay growth|labour market|tax(es)?|borrowing|deficit|debt|sterling|pound|euro|eurozone|FTSE|stocks?|markets?|tariffs?|trade|oil|energy|PMI|retail sales|spending|OBR|IMF|OECD|banks?|lenders?|credit|insolvenc\w+)\b/i;
const LIFESTYLE_RX = /\b(House ?& ?Home|getaways?|holiday|interiors?|gardens?|garden design|recipes?|wine|travel|style|fashion|crossword|Special$|podcast|quiz|horoscope|celebrity|premiere|football|cricket|Strictly|odd jobs|dream home|property of the week|homes for sale|on the market:|what you can buy)\b/i;
const JUNK_RX = /(^home\b|forum:|conference:|summit:|awards?:|stock price|latest news\b|^my |^sign in|^subscribe|quote of|\$[A-Z]{2,5}\b|shares of|earnings call|\(NYSE|\(NASDAQ|\.N\)|webinar|^events?\b|job vacanc|careers)/i;
const NON_EU_RX = /\b(U\.S\.|US|USA|American|New York|NYC|Manhattan|Brooklyn|Texas|Houston|Austin|California|Los Angeles|San Francisco|Florida|Miami|Chicago|Atlanta|Dallas|Denver|Boston|Seattle|Phoenix|Washington|D\.C\.|Philadelphia|Nashville|Charlotte|Las Vegas|Canada|Toronto|Montreal|Vancouver|Mexico|China|Chinese|Hong Kong|Japan|Tokyo|Singapore|Korea|Seoul|Australia|Sydney|Melbourne|India|Indian|Delhi|NCR|Mumbai|Bengaluru|Bangalore|Hyderabad|Chennai|Pune|APAC|Asia|Asian|Dubai|UAE|Saudi|Riyadh|Qatar|Africa|Nigeria|Nigerian|Lagos|Brazil|Paraguay|Argentina)\b/;
const RESI_RX = /\b(residential|build[- ]to[- ]rent|BTR|multi-?family|PBSA|student (accommodation|housing|beds?|homes)|co[- ]living|senior living|later living|retirement (homes|living|communities)|single[- ]family|SFH|rental (homes|housing|market|growth|sector)|apartments?|flats|housing|homes|landlords?|tenants?|rents?|private rented|PRS|affordable housing|social housing|house prices|housebuild\w*|Vonovia|LEG Immobilien|Heimstaden|Grainger|Unite (Students|Group)|Empiric|Quintain|Greystar|Get Living|Aroundtown|TAG Immobilien|Adler Group)\b/i;
const LOGI_RX = /\b(logistics|warehous\w*|industrial (property|properties|real estate|estates?|parks?|space|market|units?|portfolio|assets?|sector|occupiers?|take-up|rents?|vacancy|investment)|big[- ]box|big shed|last[- ]mile|urban logistics|multi[- ]let|distribution (cent\w+|hubs?|parks?|warehouses?)|cold storage|Prologis|SEGRO|Tritax|VGP|Montea|CTP|Panattoni|GLP|P3 Logistic\w*|Logicor|Mileway|WDP|Warehouses De Pauw|Urban Logistics REIT|LondonMetric|Catena|Sagax|Industrials REIT)\b/i;
const LOGI_CONTEXT_RX = /\b(property|properties|real estate|rents?|rental|take-up|vacancy|yields?|invest\w*|acquir\w*|buys?|sells?|sold|develop\w*|leas(e|es|ed|ing)|lets?|pre-let|sq ft|sq m|m²|square (feet|metres)|portfolio|REIT|parks?|scheme|occupiers?|warehous\w*|space|site|fund\w*|capital|Prologis|SEGRO|Tritax|VGP|Montea|CTP|Panattoni|GLP|Logicor|Mileway|WDP|LondonMetric)\b/i;
const NAMED_PLAYER_RX = /\b(Vonovia|LEG Immobilien|Heimstaden|Grainger|Unite|Empiric|Aroundtown|TAG Immobilien|Get Living|Quintain|Prologis|SEGRO|Tritax|VGP|Montea|CTP|Panattoni|GLP|P3|Logicor|Mileway|WDP|LondonMetric|Catena|Sagax)\b/;

const COUNTRIES = [
  ['UK', null],
  ['Germany', /\b(German\w*|Berlin|Munich|Frankfurt|Hamburg|Düsseldorf|Cologne|Stuttgart|Leipzig|Vonovia|LEG Immobilien|TAG Immobilien|Aroundtown)\b/],
  ['France', /\b(France|French|Paris|Lyon|Marseille|Lille)\b/],
  ['Spain', /\b(Spain|Spanish|Madrid|Barcelona|Valencia|Seville|Malaga)\b/],
  ['Netherlands', /\b(Netherlands|Dutch|Amsterdam|Rotterdam|Utrecht|Eindhoven|The Hague|Venlo)\b/],
  ['Ireland', /\b(Ireland|Irish|Dublin|Cork)\b/],
  ['Nordics', /\b(Nordic\w*|Sweden|Swedish|Stockholm|Gothenburg|Denmark|Danish|Copenhagen|Finland|Finnish|Helsinki|Norway|Norwegian|Oslo|Heimstaden|Catena|Sagax)\b/],
  ['Poland/CEE', /\b(Poland|Polish|Warsaw|Czech|Prague|Hungary|Budapest|Romania|Bucharest|Slovakia|CEE|CTP)\b/],
  ['Italy', /\b(Italy|Italian|Milan|Rome|Turin)\b/],
];
function countryOf(title, source) {
  for (const [c, rx] of COUNTRIES) if ((rx || UK_RX).test(title)) return c;
  if (/^(Property Week|EG|React News|Property Industry Eye|City AM|PBSA News|BTR News)$/.test(source)) return 'UK';
  return 'Europe';
}
const REPORT_KIND_RX = /\b(report|research|outlook|survey|index|Q[1-4]|H[12]|take-up|forecast|study|barometer|figures|data (shows|reveals)|market in minutes|snapshot|briefing|review of|predicts|expects|finds)\b/i;
const INSIGHT_RX = /(\bopinion\b|\bcomment\b|\bcolumn\b|\bblog\b|\banalysis\b|^why |^how |^what |^is |^can |\?$|lessons|the case for|time to|\bview:|explained|deep dive|interview)/i;
function kindOf(x) {
  if (x.deal || (DEAL_RX.test(x.title) && (AMOUNT_RX.test(x.title) || /\b(acquir\w*|buys?|sells?|sold|forward[- ]fund\w*|joint venture|JV|pre-let)\b/i.test(x.title)))) return 'Deal';
  if (x.group || REPORT_KIND_RX.test(x.title) || (x.hint === 'report' && REPORT_RX.test(x.title))) return 'Report';
  if (INSIGHT_RX.test(x.title)) return 'Insight';
  return 'Update';
}

const STRICT_SOURCES = new Set(['ft-economy', 'ft-markets', 'bbc-business', 'guardian-business', 'sky-business', 'reuters-macro', 'ecb', 'boe']);
const UK_PRESS = new Set(['pie', 'reactnews', 'eg', 'propertyweek', 'cityam-property']);
const AMOUNT_RX = /([£€$])\s?(\d+(?:[.,]\d+)?)\s?(bn|billion|m\b|mn|million)/i;
const REPORT_RX = /\b(report|research|survey|outlook|index|data|figures|quarter|Q[1-4]|H[12]|yields?|volumes?|vacanc\w+|rents?|forecast|market|analysis|finds|reveals|says|predicts|expects|warns|study|barometer|snapshot|review)\b/i;

const UK_RX = /\b(UK|U\.K\.|Britain|British|England|English|Scotland|Scottish|Wales|Welsh|London|Manchester|Birmingham|Leeds|Bristol|Edinburgh|Glasgow|Liverpool|Cambridge|Oxford|Midlands|Mayfair|City of London|West End|Canary Wharf|Sheffield|Newcastle|Nottingham|Cardiff|Belfast)\b|£/;
const EU_RX = /\b(Europe|European|EU|Eurozone|euro zone|German\w*|Berlin|Munich|Frankfurt|Hamburg|Düsseldorf|France|French|Paris|Lyon|Spain|Spanish|Madrid|Barcelona|Netherlands|Dutch|Amsterdam|Rotterdam|Italy|Italian|Milan|Rome|Ireland|Irish|Dublin|Nordic|Sweden|Swedish|Stockholm|Denmark|Danish|Copenhagen|Finland|Helsinki|Norway|Oslo|Poland|Polish|Warsaw|Belgium|Brussels|Portugal|Lisbon|Austria|Vienna|Switzerland|Swiss|Zurich|Czech|Prague)\b|€/;

function dealInfo(text) {
  const t = text;
  let type = 'Acquisition';
  if (/\b(final close|first close|closes? fund|fundrais\w*|raises?|raised)\b/i.test(t) && /\bfund|vehicle|capital\b/i.test(t)) type = 'Fundraise';
  else if (/\b(refinanc\w+|loan|financing|lends?|lender|debt)\b/i.test(t)) type = 'Debt';
  else if (/\b(joint venture|JV|partnership|partners with)\b/i.test(t)) type = 'JV';
  else if (/\b(sells?|sold|disposal|dispos\w+|offload\w*|sale of)\b/i.test(t) && !/\b(buys?|acquir\w*)\b/i.test(t)) type = 'Disposal';
  else if (/\b(merger|takeover|bid for|tender offer)\b/i.test(t)) type = 'M&A';

  let sector = 'Mixed';
  if (/\b(logistics|warehous\w*|industrial|distribution|last[- ]mile|multi[- ]let|sheds?)\b/i.test(t)) sector = 'Logistics';
  else if (/\b(student|PBSA|build[- ]to[- ]rent|BTR|residential|homes|apartments|flats|senior living|later living|co[- ]living|single[- ]family|housing|living)\b/i.test(t)) sector = 'Living';
  else if (/\boffices?\b/i.test(t)) sector = 'Office';
  else if (/\b(retail|shopping|mall|supermarket|high street|outlet)\b/i.test(t)) sector = 'Retail';
  else if (/\b(data cent\w+|life science\w*|lab\w*|self[- ]storage|hotels?|hospitality|healthcare|care homes?|leisure|infrastructure)\b/i.test(t)) sector = 'Alternatives';

  const m = t.match(AMOUNT_RX);
  let amount = null;
  if (m) {
    const n = parseFloat(m[2].replace(',', '.'));
    const unit = /b/i.test(m[3]) ? 'bn' : 'm';
    amount = { cur: m[1], value: n, unit, label: `${m[1]}${m[2]}${unit}`, sort: n * (unit === 'bn' ? 1000 : 1) * (m[1] === '£' ? 1.17 : m[1] === '$' ? 0.92 : 1) };
  }
  const region = UK_RX.test(t) ? 'UK' : EU_RX.test(t) ? 'Europe' : null;
  return { type, sector, amount, region };
}

const STOP = new Set('the a an and or of to in on for with at by from as is are be its it this that after over into amid new says will has have than more up down'.split(' '));
const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9£€ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  let i = 0;
  for (const w of a) if (b.has(w)) i++;
  return i / (a.size + b.size - i || 1);
}

// ---------------------------------------------------------------- news
async function fetchNews() {
  const status = [];
  const raw = [];
  await pool(SOURCES, 6, async (src) => {
    try {
      const xml = await get(src.url);
      const items = parseFeed(xml);
      status.push({ id: src.id, name: src.name, section: src.section, ok: true, count: items.length });
      for (const it of items) raw.push({ ...it, src });
    } catch (e) {
      status.push({ id: src.id, name: src.name, section: src.section, ok: false, count: 0, error: String(e.message || e) });
    }
  });

  const maxAge = { markets: 7 * 24, reports: 60 * 24, deals: 21 * 24, sector: 60 * 24 };
  const seen = new Map();
  const out = { markets: [], reports: [], deals: [] };
  const sectorRaw = [];

  for (const r of raw) {
    const { src } = r;
    let title = r.title;
    let publisher = src.name;
    if (src.kind === 'gnews') {
      // Google News titles end with " - Publisher"
      const pub = r.publisher || (title.match(/ - ([^-]+)$/) || [])[1];
      if (pub) title = title.replace(new RegExp(`\\s+-\\s+${pub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      // site:-restricted queries keep the configured name; open searches show the real publisher
      if (!src.url.includes('site%3A') || src.section !== 'markets') publisher = pub || src.name;
      r.summary = ''; // gnews descriptions are just the title + publisher
    }
    const date = r.date && !isNaN(Date.parse(r.date)) ? r.date : new Date(NOW).toISOString();
    const ageH = (NOW - Date.parse(date)) / HOUR;
    if (ageH > maxAge[src.section]) continue;

    // tidy titles
    title = title.replace(/^(News|EXCLUSIVE|Exclusive|Analysis|Opinion)\s*[|:]\s*/, '').replace(/:\s*The [A-Z][\w ]+ Deal Sheet$/, '').trim();
    if (title.length < 20 || JUNK_RX.test(title) || LIFESTYLE_RX.test(title)) continue;

    // relevance gates
    const nonEu = NON_EU_RX.test(title) && !UK_RX.test(title) && !EU_RX.test(title);
    if (src.section === 'markets') {
      if (STRICT_SOURCES.has(src.id) && !MACRO_RX.test(title) && !RE_RX.test(title)) continue;
      if (src.cat === 're' && !STRICT_SOURCES.has(src.id) && !UK_PRESS.has(src.id) && !RE_RX.test(title) && !MACRO_RX.test(title)) continue;
      if (src.id === 'ft-property' && !RE_RX.test(title)) continue;
      if (nonEu && src.cat === 're') continue; // US/APAC property stories
    }
    if (src.section === 'reports') {
      const own = (r.publisher || '').toLowerCase().includes(src.name.toLowerCase().split(' ')[0]);
      if (nonEu) continue;
      if (!RE_STRICT_RX.test(title)) continue;
      if (!own && !UK_RX.test(title) && !EU_RX.test(title)) continue;
    }

    const text = `${title} ${r.summary}`;
    const paywall = !!src.paywall || PAYWALLED.test(publisher);
    const sub = !!src.sub || SUB_PUBS.test(publisher);
    const item = {
      id: hash(r.link),
      title,
      link: r.link,
      source: publisher,
      date,
      summary: r.summary.length > 260 ? r.summary.slice(0, 257).replace(/\s\S*$/, '') + '…' : r.summary,
      cat: src.cat,
      paywall,
      sub,
      w: src.weight || 1,
    };

    if (src.section === 'reports') {
      if (!REPORT_RX.test(title)) continue;
      item.group = src.group;
      item.about = src.name;
      item.period = (title.match(/\b(Q[1-4]\s?(?:20)?\d{2}|H[12]\s?(?:20)?\d{2}|20\d{2} outlook)\b/i) || [])[0] || null;
    }

    if (src.section === 'sector') {
      if (nonEu) continue;
      const rx = src.sector === 'resi' ? RESI_RX : LOGI_RX;
      if (!rx.test(title)) continue;
      if (src.sector === 'logi' && !LOGI_CONTEXT_RX.test(title)) continue;
      if (!UK_RX.test(title) && !EU_RX.test(title) && !src.url.includes('site%3A') && !NAMED_PLAYER_RX.test(title)) continue;
      sectorRaw.push({ ...item, sector: src.sector, hint: src.hint });
      continue;
    }

    // dedupe across sections by title
    const key = `${src.section}:${title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.set(key, true);

    if (src.section !== 'deals') out[src.section].push(item);

    // Deals: anything from deal queries, or deal-like RE stories from the trade press.
    const isDealCandidate = src.section === 'deals' || (src.section === 'markets' && src.cat === 're' && DEAL_RX.test(title));
    if (isDealCandidate && DEAL_RX.test(title)) {
      if (nonEu) continue;
      if (!RE_STRICT_RX.test(title)) continue; // must actually be about real estate
      if (/\b(consult\w*|software|tech\w* (firm|platforms?)|technology platforms?|law firm|boutique|agency|brand|shares|stock|premiere|charity|dinner|bank stake|reshuffle|appoints?|hires?|CEO|chief executive|mechatronics|water|terminal|shipping|ports?)\b/i.test(title)) continue;
      const d = dealInfo(text);
      if (!d.region) {
        // UK trade press with no explicit geography = assume UK
        if (UK_PRESS.has(src.id)) d.region = 'UK';
        else continue;
      }
      const dkey = `dealx:${title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)}`;
      if (seen.has(dkey)) continue;
      seen.set(dkey, true);
      out.deals.push({ ...item, deal: d });
    }
  }

  // Remove near-duplicate deals (same story from multiple outlets) – keep the earliest/best source.
  const COMMON_CAPS = new Set('uk london europe european the an in on for and with new first real estate property fund partners capital group investment investments management report says exclusive news its acquires buys sells sale deal million billion from to of at by as after amid over'.split(' '));
  const caps = (t) => new Set((t.match(/\b([A-Z][\w&'’-]{2,}|\d+(?:\.\d+)?)\b/g) || []).filter((w) => !COMMON_CAPS.has(w)));
  const dedupeFuzzy = (arr) => {
    // distinctive tokens = capitalised words / numbers that appear in only a few titles
    const toks = (t) => new Set(((t.match(/\b([A-Z][\w&'’-]{2,}|\d+(?:\.\d+)?)\b/g) || []).map((w) => w.toLowerCase())).filter((w) => !COMMON_CAPS.has(w)));
    const df = new Map();
    for (const it of arr) for (const w of toks(it.title)) df.set(w, (df.get(w) || 0) + 1);
    const rare = (t) => new Set([...toks(t)].filter((w) => df.get(w) <= 4 && !/^\d{1,2}$/.test(w)));
    const kept = [];
    for (const it of arr.sort((a, b) => (b.sub - a.sub) || (Date.parse(b.date) - Date.parse(a.date)))) {
      const ws = words(it.title);
      const rs = rare(it.title);
      const amt = it.deal?.amount?.sort;
      const dup = kept.find((k) => {
        const shared = [...rs].filter((w) => k._r.has(w)).length;
        return jaccard(k._w, ws) >= 0.5 || shared >= 2 || (amt && k.deal?.amount?.sort === amt && shared >= 1);
      });
      if (dup) {
        dup.also = [...new Set([...(dup.also || []), it.source])].filter((s) => s !== dup.source);
        continue;
      }
      it._w = ws;
      it._r = rs;
      kept.push(it);
    }
    kept.forEach((k) => { delete k._w; delete k._r; });
    return kept;
  };
  out.markets = dedupeFuzzy(out.markets);
  out.deals = dedupeFuzzy(out.deals);
  out.reports = dedupeFuzzy(out.reports);

  // Sector pages: dedicated queries + matching stories from the general feeds
  for (const [key, rx] of [['resi', RESI_RX], ['logi', LOGI_RX]]) {
    const pool_ = [
      ...sectorRaw.filter((x) => x.sector === key),
      ...[...out.markets, ...out.reports, ...out.deals]
        .filter((x) => x.cat === 're' && rx.test(x.title) && (key !== 'logi' || LOGI_CONTEXT_RX.test(x.title)) && !(NON_EU_RX.test(x.title) && !UK_RX.test(x.title) && !EU_RX.test(x.title)))
        .map((x) => ({ ...x })),
    ].map((x) => {
      const { hint, sector, ...rest } = x;
      return { ...rest, kind: kindOf(x), country: countryOf(x.title, x.source) };
    });
    out[key] = dedupeFuzzy(pool_);
  }

  // Headlines ranking
  const MACRO_BOOST = /\b(Bank of England|BoE|ECB|interest rates?|rate cut|rate rise|inflation|gilts?|bond yields?|Budget|Reeves|Lagarde|Bailey|recession|GDP|Treasury)\b/i;
  const RE_BOOST = /\b(real estate|property|REIT|yields?|logistics|offices?|portfolio|fund|landlord|developer|valuations?)\b/i;
  const score = (it) => {
    const ageH = Math.max(0, (NOW - Date.parse(it.date)) / HOUR);
    let s = it.w * Math.exp(-ageH / 20);
    if (it.sub) s *= 1.25;
    if (it.cat === 're' && RE_BOOST.test(it.title)) s *= 1.2;
    if (MACRO_BOOST.test(it.title)) s *= 1.2;
    if (it.also?.length) s *= 1 + 0.3 * Math.min(3, it.also.length);
    return s;
  };
  const ranked = [...out.markets].sort((a, b) => score(b) - score(a));
  // keep a healthy RE/macro mix: max 6 macro in top 10
  const headlines = [];
  let macro = 0;
  const perSource = {};
  for (const it of ranked) {
    if (headlines.length >= 10) break;
    if (!RE_RX.test(it.title) && !MACRO_RX.test(it.title)) continue;
    const t = it.title;
    const local = UK_RX.test(t) || EU_RX.test(t) || /\b(BoE|ECB|gilts?|Reeves|Bailey|Lagarde|FTSE|sterling|Bank of England|MPC|OBR|Starmer|Landsec|British Land|SEGRO)\b/.test(t);
    if (NON_EU_RX.test(t) && !local) continue;
    if (!local && !['Property Week', 'EG', 'React News', 'Property Industry Eye', 'City AM'].includes(it.source)) continue;
    if ((perSource[it.source] = (perSource[it.source] || 0) + 1) > 3) continue;
    if (it.cat === 'macro' && macro >= 5) continue;
    if (it.cat === 'macro') macro++;
    headlines.push(it.id);
  }

  const byDate = (a, b) => Date.parse(b.date) - Date.parse(a.date);
  for (const k of Object.keys(out)) out[k] = out[k].sort(byDate).slice(0, k === 'markets' ? 300 : k === 'resi' || k === 'logi' ? 200 : 160).map(({ w, ...rest }) => rest);
  status.sort((a, b) => a.section.localeCompare(b.section) || a.id.localeCompare(b.id));
  return { generated: new Date(NOW).toISOString(), headlines, ...out, sourceStatus: status };
}

// ---------------------------------------------------------------- metrics
const fmtBoeDate = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}/${d.getUTCFullYear()}`;

async function boe(code) {
  const from = new Date(NOW - 400 * 24 * HOUR);
  const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${fmtBoeDate(from)}&Dateto=now&SeriesCodes=${code}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;
  const csv = await get(url, { accept: 'text/csv,*/*' });
  const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const s = rows
    .map(([d, v]) => [new Date(d + ' UTC').toISOString().slice(0, 10), parseFloat(v)])
    .filter(([d, v]) => d && !isNaN(v));
  if (!s.length) throw new Error('BoE: empty');
  return s;
}

async function ecb(flow, key, n = 400) {
  const url = `https://data-api.ecb.europa.eu/service/data/${flow}/${key}?lastNObservations=${n}&format=csvdata`;
  const csv = await get(url, { accept: 'text/csv' });
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  const s = lines.slice(1).map((l) => l.split(',')).map((c) => [c[ti], parseFloat(c[vi])]).filter(([, v]) => !isNaN(v));
  if (!s.length) throw new Error('ECB: empty');
  return s;
}

async function bundesbank10y() {
  const url = 'https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A?lastNObservations=300';
  const csv = await get(url, { accept: 'application/vnd.sdmx.data+csv;version=1.0.0' });
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(/[,;]/);
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  const s = lines.slice(1).map((l) => l.split(/[,;]/)).map((c) => [c[ti], parseFloat(c[vi])]).filter(([d, v]) => d && !isNaN(v));
  if (!s.length) throw new Error('Bundesbank: empty');
  return s;
}

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
async function ons(path, cdid, dataset, freq = 'months') {
  const url = `https://www.ons.gov.uk/${path}/timeseries/${cdid}/${dataset}/data`;
  const j = JSON.parse(await get(url, { accept: 'application/json' }));
  const arr = j[freq] || [];
  const s = arr
    .map((o) => {
      let d = o.date;
      if (freq === 'months') {
        const [y, m] = d.split(' ');
        d = `${y}-${MONTHS[m.toUpperCase()]}`;
      } else if (freq === 'quarters') {
        const [y, q] = d.split(' ');
        d = `${y}-${q}`;
      }
      return [d, parseFloat(o.value)];
    })
    .filter(([, v]) => !isNaN(v));
  if (!s.length) throw new Error('ONS: empty');
  return s.slice(-40);
}

async function eurostat(dataset, params) {
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?${params}&lastTimePeriod=24&format=JSON`;
  const j = JSON.parse(await get(url, { accept: 'application/json' }));
  const idx = j.dimension?.time?.category?.index || {};
  const s = Object.entries(idx)
    .sort((a, b) => a[1] - b[1])
    .map(([t, i]) => [t.replace(/^(\d{4})M(\d{2})$/, '$1-$2'), j.value?.[i]])
    .filter(([, v]) => typeof v === 'number');
  if (!s.length) throw new Error('Eurostat: empty');
  return s;
}
// Euro-area codes changed when Bulgaria joined (2026): try all, keep the freshest series.
async function euroArea(dataset, params) {
  const res = await Promise.allSettled(['EA21', 'EA', 'EA20'].map((geo) => eurostat(dataset, `geo=${geo}&${params}`)));
  const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw res[0].reason;
  return ok.sort((a, b) => (b.at(-1)[0] > a.at(-1)[0] ? 1 : -1))[0];
}

async function firstOk(...fns) {
  let err;
  for (const f of fns) {
    try {
      return await f();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

// change logic: 'step' = last change in a policy rate; 'prev' = previous observation; 'month' = vs ~1 month ago
function summarise(series, mode) {
  const last = series[series.length - 1];
  let prev = null;
  let prevDate = null;
  let changeLabel = '';
  if (mode === 'step') {
    for (let i = series.length - 2; i >= 0; i--) {
      if (series[i][1] !== last[1]) {
        prev = series[i][1];
        prevDate = series[i + 1][0];
        break;
      }
    }
    changeLabel = prevDate ? `last move ${prevDate}` : 'unchanged 12m+';
  } else if (mode === 'month') {
    const target = Date.parse(last[0]) - 30 * 24 * HOUR;
    const p = [...series].reverse().find(([d]) => Date.parse(d) <= target) || series[0];
    prev = p[1];
    prevDate = p[0];
    changeLabel = '1M';
  } else {
    const p = series[series.length - 2];
    if (p) {
      prev = p[1];
      prevDate = p[0];
      changeLabel = 'prev';
    }
  }
  return { value: last[1], date: last[0], prev, prevDate, changeLabel };
}

const sparkOf = (series, n) => series.slice(-n).map(([, v]) => +v.toFixed(3));

const METRICS = [
  // group, id, label, region, unit, mode, sparkN, source, fetcher
  ['rates', 'boe-rate', 'BoE Bank Rate', 'UK', '%', 'step', 30, 'Bank of England', () => boe('IUDBEDR')],
  ['rates', 'ecb-dfr', 'ECB Deposit Rate', 'EZ', '%', 'step', 30, 'ECB', () => ecb('FM', 'D.U2.EUR.4F.KR.DFR.LEV')],
  ['rates', 'sonia', 'SONIA', 'UK', '%', 'month', 60, 'Bank of England', () => boe('IUDSOIA')],
  ['rates', 'euribor3m', '3M Euribor', 'EZ', '%', 'prev', 24, 'ECB', () => ecb('FM', 'M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA', 36)],

  ['inflation', 'uk-cpi', 'UK CPI (YoY)', 'UK', '%', 'prev', 24, 'ONS', () => ons('economy/inflationandpriceindices', 'd7g7', 'mm23')],
  ['inflation', 'uk-core', 'UK Core CPI', 'UK', '%', 'prev', 24, 'ONS', () => ons('economy/inflationandpriceindices', 'dko8', 'mm23')],
  ['inflation', 'ez-hicp', 'EZ HICP (YoY)', 'EZ', '%', 'prev', 24, 'Eurostat', () => euroArea('prc_hicp_minr', 'unit=RCH_A&coicop18=TOTAL')],
  ['inflation', 'ez-core', 'EZ Core HICP', 'EZ', '%', 'prev', 24, 'Eurostat', () => euroArea('prc_hicp_minr', 'unit=RCH_A&coicop18=TOT_X_NRG_FOOD')],

  ['bonds', 'gilt10', '10Y Gilt', 'UK', '%', 'month', 60, 'Bank of England', () => firstOk(() => boe('IUDMNPY'), () => boe('IUDMNZC'))],
  ['bonds', 'gilt5', '5Y Gilt', 'UK', '%', 'month', 60, 'Bank of England', () => firstOk(() => boe('IUDSNPY'), () => boe('IUDSNZC'))],
  ['bonds', 'bund10', '10Y Bund', 'DE', '%', 'month', 60, 'Bundesbank', () => firstOk(bundesbank10y, () => ecb('YC', 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y'))],
  ['bonds', 'ea10', 'EA AAA 10Y', 'EZ', '%', 'month', 60, 'ECB', () => ecb('YC', 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y')],

  ['macro', 'uk-gdp', 'UK GDP (QoQ)', 'UK', '%', 'prev', 12, 'ONS', () => ons('economy/grossdomesticproductgdp', 'ihyq', 'qna', 'quarters')],
  ['macro', 'uk-unemp', 'UK Unemployment', 'UK', '%', 'prev', 24, 'ONS', () => ons('employmentandlabourmarket/peoplenotinwork/unemployment', 'mgsx', 'lms')],
  ['macro', 'ez-unemp', 'EZ Unemployment', 'EZ', '%', 'prev', 24, 'Eurostat', () => euroArea('une_rt_m', 's_adj=SA&age=TOTAL&sex=T&unit=PC_ACT')],
  ['fx', 'eurgbp', 'EUR/GBP', 'FX', '', 'month', 60, 'ECB', () => ecb('EXR', 'D.GBP.EUR.SP00.A', 300)],
  ['fx', 'gbpusd', 'GBP/USD', 'FX', '', 'month', 60, 'ECB (derived)', async () => {
    const [usd, gbp] = await Promise.all([ecb('EXR', 'D.USD.EUR.SP00.A', 300), ecb('EXR', 'D.GBP.EUR.SP00.A', 300)]);
    const g = new Map(gbp);
    return usd.filter(([d]) => g.has(d)).map(([d, v]) => [d, v / g.get(d)]);
  }],
];

async function fetchMetrics(previous) {
  const prevById = new Map((previous?.metrics || []).map((m) => [m.id, m]));
  const results = await pool(METRICS, 5, async ([group, id, label, region, unit, mode, sparkN, source, fn]) => {
    try {
      const series = await fn();
      return { group, id, label, region, unit, source, ...summarise(series, mode), spark: sparkOf(series, sparkN), ok: true };
    } catch (e) {
      const old = prevById.get(id);
      console.warn(`metric ${id} failed: ${e.message}`);
      if (old) return { ...old, ok: false, stale: true, error: String(e.message || e) };
      return { group, id, label, region, unit, source, value: null, ok: false, error: String(e.message || e) };
    }
  });

  // Derived: Gilt–Bund spread
  const g = results.find((m) => m.id === 'gilt10');
  const b = results.find((m) => m.id === 'bund10');
  if (g?.value != null && b?.value != null) {
    results.push({
      group: 'bonds', id: 'gilt-bund', label: 'Gilt–Bund Spread', region: 'UK/DE', unit: 'bps', source: 'Derived',
      value: Math.round((g.value - b.value) * 100), prev: g.prev != null && b.prev != null ? Math.round((g.prev - b.prev) * 100) : null,
      date: g.date, changeLabel: '1M', ok: g.ok && b.ok,
    });
  }
  return { generated: new Date(NOW).toISOString(), metrics: results };
}

// ---------------------------------------------------------------- main
async function loadPrevious(name) {
  if (PAGES_URL) {
    try {
      return JSON.parse(await get(`${PAGES_URL.replace(/\/$/, '')}/data/${name}?t=${NOW}`, { tries: 1 }));
    } catch {}
  }
  try {
    return JSON.parse(await readFile(new URL(name, OUT), 'utf8'));
  } catch {
    return null;
  }
}

await mkdir(OUT, { recursive: true });
const [prevMetrics, prevNews] = await Promise.all([loadPrevious('metrics.json'), loadPrevious('news.json')]);
const [news, metrics] = await Promise.all([fetchNews(), fetchMetrics(prevMetrics)]);

// If a whole section came back empty (e.g. Google blocked us), keep last good copy.
for (const k of ['markets', 'reports', 'deals', 'resi', 'logi']) {
  if (!news[k].length && prevNews?.[k]?.length) {
    news[k] = prevNews[k];
    news.stale = [...(news.stale || []), k];
  }
}
if (!news.headlines.length && prevNews?.headlines) news.headlines = prevNews.headlines;

await writeFile(new URL('news.json', OUT), JSON.stringify(news));
await writeFile(new URL('metrics.json', OUT), JSON.stringify(metrics, null, 1));

const ok = news.sourceStatus.filter((s) => s.ok).length;
console.log(`News: ${news.markets.length} markets, ${news.reports.length} reports, ${news.deals.length} deals, ${news.resi?.length} resi, ${news.logi?.length} logi, ${news.headlines.length} headlines; sources ok ${ok}/${news.sourceStatus.length}`);
for (const s of news.sourceStatus) console.log(`  ${s.ok ? 'OK ' : 'ERR'} ${s.section.padEnd(8)} ${s.id.padEnd(18)} ${s.ok ? s.count : s.error}`);
console.log('Metrics:');
for (const m of metrics.metrics) console.log(`  ${m.ok ? 'OK ' : 'ERR'} ${m.id.padEnd(12)} ${m.value ?? '-'} ${m.date ?? ''} ${m.error ?? ''}`);
for (const k of ['resi', 'logi']) {
  console.log(`Sector ${k}:`);
  for (const x of (news[k] || []).slice(0, 25)) console.log(`  [${x.kind}] [${x.country}] ${x.source} | ${x.title.slice(0, 100)}`);
}
