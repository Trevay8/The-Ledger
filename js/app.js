/* The Ledger – client app (no build step, no dependencies) */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  const state = { news: null, metrics: null, yields: null, library: null, loadedAt: 0 };
  const ui = JSON.parse(safeGet('ui') || '{}');

  // ------------------------------------------------------------ storage
  function safeGet(k) { try { return localStorage.getItem('ledger:' + k); } catch { return null; } }
  function safeSet(k, v) { try { localStorage.setItem('ledger:' + k, v); } catch {} }
  const readSet = new Set(JSON.parse(safeGet('read') || '[]'));
  const saved = new Map(JSON.parse(safeGet('saved') || '[]'));
  const persistRead = () => safeSet('read', JSON.stringify([...readSet].slice(-1500)));
  const persistSaved = () => safeSet('saved', JSON.stringify([...saved]));
  const persistUi = () => safeSet('ui', JSON.stringify(ui));

  // ------------------------------------------------------------ utils
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function dayLabel(iso) {
    const d = new Date(iso), t = new Date();
    const k = (x) => x.toDateString();
    if (k(d) === k(t)) return 'Today';
    t.setDate(t.getDate() - 1);
    if (k(d) === k(t)) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  }
  function fmtAsOf(d) {
    if (!d) return '';
    if (/^\d{4}-Q\d$/.test(d)) return d.replace('-', ' ');
    if (/^\d{4}-\d{2}$/.test(d)) return new Date(d + '-01').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ------------------------------------------------------------ data
  async function getJSON(path, bust) {
    const r = await fetch(path + (bust ? `?t=${Date.now()}` : ''), { cache: bust ? 'no-store' : 'default' });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  async function load(bust = false) {
    const res = await Promise.allSettled([
      getJSON('data/news.json', bust), getJSON('data/metrics.json', bust),
      getJSON('data/prime-yields.json', bust), getJSON('data/research-library.json', bust),
    ]);
    const [n, m, y, l] = res.map((r) => (r.status === 'fulfilled' ? r.value : null));
    if (n) state.news = n;
    if (m) state.metrics = m;
    if (y) state.yields = y;
    if (l) state.library = l;
    state.loadedAt = Date.now();
    $('#drawerFoot').innerHTML = state.news ? `Data refreshed<br>${esc(new Date(state.news.generated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}<br>Auto-updates every 3h` : '';
  }

  // ------------------------------------------------------------ components
  function sparkline(arr, w = 64, h = 22) {
    if (!arr || arr.length < 2) return '';
    const min = Math.min(...arr), max = Math.max(...arr), rng = max - min || 1;
    const pts = arr.map((v, i) => `${((i / (arr.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / rng) * (h - 4)).toFixed(1)}`).join(' ');
    const up = arr[arr.length - 1] >= arr[0];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--blue)' : 'var(--blue-soft)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function changeHtml(m) {
    if (m.value == null || m.prev == null) return `<span class="chg flat">${m.changeLabel === 'unchanged 12m+' ? 'no change 12m+' : '—'}</span>`;
    let diff, txt;
    if (m.group === 'fx') {
      diff = ((m.value - m.prev) / m.prev) * 100;
      txt = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
    } else if (m.unit === 'bps') {
      diff = m.value - m.prev;
      txt = `${diff >= 0 ? '+' : ''}${diff}bps`;
    } else if (m.group === 'rates' || m.group === 'bonds') {
      diff = Math.round((m.value - m.prev) * 100);
      txt = `${diff >= 0 ? '+' : ''}${diff}bps`;
    } else {
      diff = +(m.value - m.prev).toFixed(2);
      txt = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp`;
    }
    const cls = Math.abs(diff) < 1e-9 ? 'flat' : diff > 0 ? 'up' : 'down';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■';
    const lbl = m.changeLabel && m.changeLabel.startsWith('last move') ? 'last move' : m.changeLabel === 'prev' ? 'vs prior' : m.changeLabel || '';
    return `<span class="chg ${cls}">${arrow} ${txt}<span class="lbl">${esc(lbl)}</span></span>`;
  }

  function fmtValue(m) {
    if (m.value == null) return '—';
    if (m.unit === 'bps') return `${m.value}<small>bps</small>`;
    if (m.group === 'fx') return m.value.toFixed(4);
    return `${m.value.toFixed(2)}<small>%</small>`;
  }

  function tile(m) {
    const asof = m.changeLabel && m.changeLabel.startsWith('last move') && m.prevDate
      ? `last move ${fmtAsOf(m.prevDate)}`
      : `as of ${fmtAsOf(m.date)}`;
    return `<div class="tile${m.stale ? ' stale' : ''}${m.value == null ? ' missing' : ''}" title="${esc(m.source || '')}">
      <div class="tile-top"><span class="tile-label">${esc(m.label)}</span><span class="region">${esc(m.region)}</span></div>
      <div class="tile-value">${fmtValue(m)}</div>
      <div class="tile-foot"><div>${changeHtml(m)}<div class="asof">${esc(m.value == null ? 'unavailable' : asof)}</div></div>${sparkline(m.spark)}</div>
    </div>`;
  }

  function itemHtml(it, opts = {}) {
    const read = readSet.has(it.id);
    const tags = [];
    if (opts.showAbout && it.about && it.about !== it.source) tags.push(`<span class="tag blue">${esc(it.about)}</span>`);
    if (it.period) tags.push(`<span class="tag white">${esc(it.period)}</span>`);
    if (opts.showCat) tags.push(`<span class="tag">${it.cat === 're' ? 'RE' : 'MACRO'}</span>`);
    const also = it.also?.length ? `<span class="also">+${it.also.length} more</span>` : '';
    return `<article class="item${read ? ' read' : ''}${opts.lead ? ' lead' : ''}" data-id="${esc(it.id)}">
      ${opts.rank ? `<span class="rank">${String(opts.rank).padStart(2, '0')}</span>` : ''}
      <div class="item-body">
        <div class="item-meta"><span class="src">${esc(it.source)}</span>${it.sub ? '<span class="star" title="Subscribed">★</span>' : ''}${it.paywall ? '<span class="lock" title="Paywalled">🔒︎</span>' : ''}<span>· ${ago(it.date)}</span>${tags.join('')}${also}</div>
        <a class="item-title" href="${esc(it.link)}" target="_blank" rel="noopener" data-open="${esc(it.id)}">${esc(it.title)}</a>
        ${it.summary && !opts.compact ? `<div class="item-sum">${esc(it.summary)}</div>` : ''}
      </div>
      <button class="save-btn${saved.has(it.id) ? ' on' : ''}" data-save="${esc(it.id)}" aria-label="Save">${saved.has(it.id) ? '★' : '☆'}</button>
    </article>`;
  }

  function dealHtml(it) {
    const d = it.deal || {};
    const amt = d.amount ? `<div class="deal-amt">${esc(d.amount.label)}</div>` : '<div class="deal-amt na">n/d</div>';
    return `<article class="item${readSet.has(it.id) ? ' read' : ''}" data-id="${esc(it.id)}">
      ${amt}
      <div class="item-body">
        <a class="item-title" href="${esc(it.link)}" target="_blank" rel="noopener" data-open="${esc(it.id)}">${esc(it.title)}</a>
        <div class="deal-tags">
          <span class="tag blue">${esc(d.sector || 'Mixed')}</span><span class="tag white">${esc(d.type || 'Deal')}</span><span class="tag">${esc(d.region || '')}</span>
        </div>
        <div class="item-meta" style="margin:7px 0 0"><span class="src">${esc(it.source)}</span>${it.paywall ? '<span class="lock">🔒︎</span>' : ''}<span>· ${ago(it.date)}</span></div>
      </div>
      <button class="save-btn${saved.has(it.id) ? ' on' : ''}" data-save="${esc(it.id)}" aria-label="Save">${saved.has(it.id) ? '★' : '☆'}</button>
    </article>`;
  }

  function groupedByDay(items, render) {
    let html = '', last = '';
    for (const it of items) {
      const d = dayLabel(it.date);
      if (d !== last) { html += `<div class="day-head">${esc(d)}</div>`; last = d; }
      html += render(it);
    }
    return html;
  }

  function emptyState(title, msg) {
    return `<div class="empty"><b>${esc(title)}</b>${esc(msg)}</div>`;
  }

  function chips(name, options, current) {
    return `<div class="chips" role="tablist">${options
      .map(([v, label, n]) => `<button class="chip${v === current ? ' on' : ''}" data-chip="${name}" data-val="${esc(v)}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ''}</button>`)
      .join('')}</div>`;
  }

  // ------------------------------------------------------------ pages
  const allItems = () => {
    const n = state.news || {};
    return [...(n.markets || []), ...(n.reports || []), ...(n.deals || [])];
  };
  const metric = (id) => state.metrics?.metrics?.find((m) => m.id === id);

  function renderHome() {
    const n = state.news;
    const now = new Date();
    const stale = n && Date.now() - Date.parse(n.generated) > 8 * 3600e3;
    let html = `<div class="dateline"><b>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
      <span><span class="live-dot${stale ? ' stale' : ''}"></span>${n ? 'updated ' + ago(n.generated) + ' ago' : 'loading'}</span></div>`;

    // Metrics
    const groups = [['rates', 'Policy & money markets'], ['inflation', 'Inflation'], ['bonds', 'Government bonds'], ['macro', 'Growth & labour'], ['fx', 'FX']];
    html += `<section class="section"><div class="section-head"><h2 class="section-title">Key Metrics</h2></div>`;
    if (state.metrics?.metrics) {
      for (const [g, label] of groups) {
        const ms = state.metrics.metrics.filter((m) => m.group === g);
        if (!ms.length) continue;
        html += `<div class="sub-title">${label}</div><div class="tiles">${ms.map(tile).join('')}</div>`;
      }
    } else html += `<div class="tiles">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
    html += `</section>`;

    // Headlines
    html += `<section class="section"><div class="section-head"><h2 class="section-title">Top Headlines</h2><a class="section-link" href="#/markets">All news →</a></div>`;
    if (n) {
      const byId = new Map(n.markets.map((x) => [x.id, x]));
      const hs = n.headlines.map((id) => byId.get(id)).filter(Boolean);
      html += hs.length
        ? `<div class="list">${hs.map((it, i) => itemHtml(it, i === 0 ? { lead: true } : { rank: i + 1, compact: true })).join('')}</div>`
        : emptyState('No headlines yet', 'The first data refresh hasn’t run.');
    } else html += '<div class="skeleton"></div>';
    html += `</section>`;

    // Prime yields
    html += renderYieldsSection();

    // Latest deals
    if (n?.deals?.length) {
      html += `<section class="section"><div class="section-head"><h2 class="section-title">Latest Deals</h2><a class="section-link" href="#/deals">All deals →</a></div>
        <div class="list">${n.deals.slice(0, 4).map(dealHtml).join('')}</div></section>`;
    }
    view.innerHTML = html;
  }

  function renderYieldsSection() {
    const y = state.yields;
    if (!y) return '';
    const region = ui.yRegion || 'UK';
    const bench = region === 'UK' ? metric('gilt10') : metric('bund10');
    const benchLbl = region === 'UK' ? '10Y gilt' : '10Y Bund';
    const rows = y.markets.filter((r) => r.region === region);
    const sectors = [...new Set(rows.map((r) => r.sector))];
    let body = '';
    for (const s of sectors) {
      body += `<tr class="grp"><td colspan="4">${esc(s)}</td></tr>`;
      for (const r of rows.filter((x) => x.sector === s)) {
        const qoq = r.prev != null ? Math.round((r.yield - r.prev) * 100) : null;
        const qoqHtml = qoq == null ? '<span class="gap">—</span>' : `<span class="chg ${qoq > 0 ? 'up' : qoq < 0 ? 'down' : 'flat'}">${qoq > 0 ? '+' : ''}${qoq}</span>`;
        const gap = bench?.value != null ? Math.round((r.yield - bench.value) * 100) : null;
        body += `<tr><td>${esc(r.market)}${r.conf === 'est' ? '<span class="est" title="Estimate – verify">EST</span>' : ''}</td>
          <td class="y">${r.yield.toFixed(2)}%</td><td>${qoqHtml}</td><td class="gap">${gap == null ? '—' : (gap > 0 ? '+' : '') + gap}</td></tr>`;
      }
    }
    return `<section class="section"><div class="section-head"><h2 class="section-title">Prime Yields</h2>
      <div class="seg" role="tablist"><button data-yregion="UK" class="${region === 'UK' ? 'on' : ''}">UK</button><button data-yregion="Europe" class="${region === 'Europe' ? 'on' : ''}">Europe</button></div></div>
      <div class="card"><table class="ytable"><thead><tr><th>Market</th><th>Yield</th><th>QoQ bps</th><th>vs ${benchLbl}</th></tr></thead><tbody>${body}</tbody></table>
      <div class="note">${esc(y.asOf)} · ${esc(y.note)} Spread uses live ${benchLbl}${bench?.value != null ? ` (${bench.value.toFixed(2)}%)` : ''}.</div></div></section>`;
  }

  function renderMarkets() {
    const n = state.news;
    if (!n) return (view.innerHTML = '<div class="skeleton"></div>');
    const f = ui.mFilter || 'all';
    const q = (ui.mQuery || '').toLowerCase();
    const items = n.markets;
    const filt = items.filter((it) =>
      (f === 'all' || (f === 'subs' ? it.sub : it.cat === f)) &&
      (!q || (it.title + ' ' + it.source + ' ' + (it.summary || '')).toLowerCase().includes(q)));
    const cnt = (fn) => items.filter(fn).length;
    view.innerHTML =
      chips('mFilter', [['all', 'All', items.length], ['re', 'Real Estate', cnt((x) => x.cat === 're')], ['macro', 'Macro', cnt((x) => x.cat === 'macro')], ['subs', 'My Subs ★', cnt((x) => x.sub)]], f) +
      `<input class="search" type="search" placeholder="Search headlines, sources…" value="${esc(ui.mQuery || '')}" data-search="mQuery">` +
      `<div class="list" id="mList">${filt.length ? groupedByDay(filt.slice(0, ui.mLimit || 60), (it) => itemHtml(it, { showCat: f === 'all' || f === 'subs' })) : emptyState('Nothing here', 'Try another filter.')}</div>` +
      (filt.length > (ui.mLimit || 60) ? `<button class="more-btn" data-more="mLimit">Show more (${filt.length - (ui.mLimit || 60)})</button>` : '');
  }

  function renderReports() {
    const n = state.news;
    const f = ui.rFilter || 'all';
    const items = n?.reports || [];
    const filt = items.filter((it) => f === 'all' || it.group === f);
    const lib = state.library;
    let html = chips('rFilter', [['all', 'All', items.length], ['brokers', 'Brokers', items.filter((x) => x.group === 'brokers').length], ['data', 'Data & Industry', items.filter((x) => x.group === 'data').length], ['managers', 'Fund Managers', items.filter((x) => x.group === 'managers').length]], f);
    html += `<section class="section"><div class="section-head"><h2 class="section-title">Latest research coverage</h2></div>
      <div class="list">${filt.length ? groupedByDay(filt.slice(0, ui.rLimit || 40), (it) => itemHtml(it, { showAbout: true })) : emptyState('No research items yet', 'Feeds refresh every 3 hours.')}</div>
      ${filt.length > (ui.rLimit || 40) ? `<button class="more-btn" data-more="rLimit">Show more</button>` : ''}</section>`;
    if (lib) {
      const groups = lib.groups.filter((g) => f === 'all' || g.id === f);
      html += `<section class="section"><div class="section-head"><h2 class="section-title">Research Library</h2></div>`;
      for (const g of groups) {
        html += `<div class="sub-title">${esc(g.label)}</div><div class="lib">${g.items.map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener"><b>${esc(i.name)}</b><span>${esc(i.tip)}</span></a>`).join('')}</div>`;
      }
      html += `</section><section class="section"><div class="section-head"><h2 class="section-title">Release Calendar</h2></div>
        <div class="card"><table class="cal">${lib.calendar.map((c) => `<tr><td>${esc(c.what)}</td><td>${esc(c.when)}</td></tr>`).join('')}</table></div></section>`;
    }
    view.innerHTML = html;
  }

  function renderDeals() {
    const n = state.news;
    if (!n) return (view.innerHTML = '<div class="skeleton"></div>');
    const deals = n.deals || [];
    const sec = ui.dSector || 'all', typ = ui.dType || 'all', reg = ui.dRegion || 'all';
    const filt = deals.filter((d) => (sec === 'all' || d.deal?.sector === sec) && (typ === 'all' || d.deal?.type === typ) && (reg === 'all' || d.deal?.region === reg));
    const sort = ui.dSort || 'date';
    if (sort === 'size') filt.sort((a, b) => (b.deal?.amount?.sort || 0) - (a.deal?.amount?.sort || 0));

    // stats (approx € equivalent)
    const eurgbp = metric('eurgbp')?.value || 0.86;
    const totalEur = filt.reduce((s, d) => {
      const a = d.deal?.amount; if (!a) return s;
      const m = a.value * (a.unit === 'bn' ? 1000 : 1);
      return s + (a.cur === '£' ? m / eurgbp : a.cur === '$' ? m * 0.92 : m);
    }, 0);
    const totalGbp = totalEur * eurgbp;
    const disclosed = filt.filter((d) => d.deal?.amount).length;
    const fmtVol = (m) => (m >= 1000 ? `£${(m / 1000).toFixed(1)}bn` : `£${Math.round(m)}m`);

    const count = (k, v) => deals.filter((d) => d.deal?.[k] === v).length;
    const sectors = ['Logistics', 'Office', 'Living', 'Retail', 'Alternatives', 'Mixed'];
    const types = ['Acquisition', 'Disposal', 'Fundraise', 'JV', 'Debt', 'M&A'];

    view.innerHTML = `<div class="stats">
        <div class="stat"><b>${filt.length}</b><span>deals (21d)</span></div>
        <div class="stat"><b>${disclosed ? fmtVol(totalGbp) : '—'}</b><span>disclosed value</span></div>
        <div class="stat"><b>${disclosed}</b><span>with price</span></div>
      </div>
      <div class="filters-label">Sector</div>${chips('dSector', [['all', 'All', deals.length], ...sectors.map((s) => [s, s, count('sector', s)])], sec)}
      <div class="filters-label">Type</div>${chips('dType', [['all', 'All'], ...types.map((t) => [t, t, count('type', t)])], typ)}
      <div style="display:flex;justify-content:space-between;gap:8px;margin:6px 0 4px">
        <div class="seg">${['all', 'UK', 'Europe'].map((r) => `<button data-dregion="${r}" class="${reg === r ? 'on' : ''}">${r === 'all' ? 'All' : r}</button>`).join('')}</div>
        <div class="seg">${[['date', 'Latest'], ['size', 'Size']].map(([v, l]) => `<button data-dsort="${v}" class="${sort === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="list">${filt.length ? (sort === 'date' ? groupedByDay(filt.slice(0, ui.dLimit || 60), dealHtml) : filt.slice(0, ui.dLimit || 60).map(dealHtml).join('')) : emptyState('No deals match', 'Loosen the filters.')}</div>
      ${filt.length > (ui.dLimit || 60) ? `<button class="more-btn" data-more="dLimit">Show more</button>` : ''}
      <div class="note">Deals are auto-detected from headlines, so sector/type tags can be wrong. Values are as reported; the total converts € to £ at the live ECB rate.</div>`;
  }

  function renderSaved() {
    const items = [...saved.values()].sort((a, b) => Date.parse(b.savedAt || b.date) - Date.parse(a.savedAt || a.date));
    view.innerHTML = `<section class="section"><div class="section-head"><h2 class="section-title">Saved for later</h2><span class="asof">${items.length} items</span></div>
      <div class="list">${items.length ? items.map((it) => (it.deal ? dealHtml(it) : itemHtml(it, { showAbout: true }))).join('') : emptyState('Nothing saved', 'Tap ☆ on any story to keep it here, e.g. deals to mention in interviews.')}</div></section>`;
  }

  function renderSources() {
    const n = state.news;
    const m = state.metrics;
    let html = `<section class="section"><div class="section-head"><h2 class="section-title">Metrics feeds</h2></div><div class="card">`;
    html += (m?.metrics || []).map((x) => `<div class="status-row"><span class="${x.ok ? 'ok' : 'err'}">${x.ok ? '●' : '○'} ${esc(x.label)}</span><span>${esc(x.source || '')}${x.error ? ' · ' + esc(x.error) : ''}</span></div>`).join('') || emptyState('No data', '');
    html += `</div></section><section class="section"><div class="section-head"><h2 class="section-title">News feeds</h2></div><div class="card">`;
    html += (n?.sourceStatus || []).map((s) => `<div class="status-row"><span class="${s.ok ? 'ok' : 'err'}">${s.ok ? '●' : '○'} ${esc(s.name)} <span class="asof">${esc(s.section)}</span></span><span>${s.ok ? s.count + ' items' : esc(s.error)}</span></div>`).join('') || emptyState('No data', '');
    html += `</div><div class="note">Feeds refresh every 3 hours via GitHub Actions. Edit scripts/sources.mjs to add or remove sources, and data/prime-yields.json each quarter.</div></section>`;
    view.innerHTML = html;
  }

  // ------------------------------------------------------------ router
  const ROUTES = {
    home: ['', renderHome], markets: ['Market Updates', renderMarkets], reports: ['Quarterly Reports', renderReports],
    deals: ['Recent Deals', renderDeals], saved: ['Saved', renderSaved], sources: ['Sources', renderSources],
  };
  let current = 'home';
  function route() {
    const r = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    current = ROUTES[r] ? r : 'home';
    const [name, fn] = ROUTES[current];
    $('#pageName').textContent = name;
    document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('active', a.dataset.route === current));
    fn();
  }
  const rerender = () => ROUTES[current][1]();

  // ------------------------------------------------------------ events
  const drawer = $('#drawer'), scrim = $('#scrim'), menuBtn = $('#menuBtn');
  function setDrawer(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { scrim.hidden = false; requestAnimationFrame(() => scrim.classList.add('show')); }
    else { scrim.classList.remove('show'); setTimeout(() => (scrim.hidden = true), 200); }
  }
  menuBtn.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
  scrim.addEventListener('click', () => setDrawer(false));
  drawer.addEventListener('click', (e) => { if (e.target.closest('a')) setDrawer(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

  // swipe from left edge to open drawer, swipe left to close
  let tx = null, ty = null;
  document.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx, dy = Math.abs(e.changedTouches[0].clientY - ty);
    if (dy < 50) {
      if (tx < 24 && dx > 60) setDrawer(true);
      else if (drawer.classList.contains('open') && dx < -60) setDrawer(false);
    }
    tx = null;
  }, { passive: true });

  view.addEventListener('click', (e) => {
    const t = e.target;
    const chip = t.closest('[data-chip]');
    if (chip) { ui[chip.dataset.chip] = chip.dataset.val; ['mLimit', 'rLimit', 'dLimit'].forEach((k) => delete ui[k]); persistUi(); return rerender(); }
    const yr = t.closest('[data-yregion]');
    if (yr) { ui.yRegion = yr.dataset.yregion; persistUi(); return rerender(); }
    const dr = t.closest('[data-dregion]');
    if (dr) { ui.dRegion = dr.dataset.dregion; persistUi(); return rerender(); }
    const ds = t.closest('[data-dsort]');
    if (ds) { ui.dSort = ds.dataset.dsort; persistUi(); return rerender(); }
    const more = t.closest('[data-more]');
    if (more) { ui[more.dataset.more] = (ui[more.dataset.more] || 60) + 60; return rerender(); }
    const sv = t.closest('[data-save]');
    if (sv) {
      const id = sv.dataset.save;
      if (saved.has(id)) { saved.delete(id); toast('Removed from saved'); }
      else {
        const it = allItems().find((x) => x.id === id) || saved.get(id);
        if (it) { saved.set(id, { ...it, savedAt: new Date().toISOString() }); toast('Saved ★'); }
      }
      persistSaved();
      return rerender();
    }
    const open = t.closest('[data-open]');
    if (open) {
      readSet.add(open.dataset.open);
      persistRead();
      open.closest('.item')?.classList.add('read');
    }
  });

  let searchTimer;
  view.addEventListener('input', (e) => {
    const s = e.target.closest('[data-search]');
    if (!s) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      ui[s.dataset.search] = s.value;
      const pos = s.selectionStart;
      rerender();
      const ns = view.querySelector('[data-search]');
      if (ns) { ns.focus(); ns.setSelectionRange(pos, pos); }
    }, 180);
  });

  const refreshBtn = $('#refreshBtn');
  async function refresh(manual) {
    refreshBtn.classList.add('spin');
    try {
      await load(true);
      rerender();
      if (manual) toast(state.news ? `Data from ${ago(state.news.generated)} ago` : 'Refreshed');
    } catch {
      if (manual) toast('Offline: showing cached data');
    } finally {
      refreshBtn.classList.remove('spin');
    }
  }
  refreshBtn.addEventListener('click', () => refresh(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 20 * 60e3) refresh(false);
  });
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

  // ------------------------------------------------------------ boot
  route();
  load(false).then(route).catch(() => { view.innerHTML = emptyState('Couldn’t load data', 'Check your connection and tap refresh.'); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
