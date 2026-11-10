/* Jarvis: Trevay's personal assistant PWA (no build step, no dependencies) */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  const sheet = $('#sheet');
  const D = { brief: null, apps: null, net: null, cards: null, tt: null, club: null, income: null };

  // ------------------------------------------------------------ storage (per-device)
  const KEY = 'jarvis:';
  function load(k, fallback) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
  function save(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} }
  const S = {
    tasks: load('tasks', []),            // [{id,text,due,area,done}]
    dismissed: load('dismissed', []),    // urgent ids cleared
    appEdits: load('appEdits', {}),      // id -> {status,next}
    myApps: load('myApps', []),          // user-added applications
    cards: load('cards', {}),            // id -> {box,due}
    slots: load('slots', null),          // timetable override
    netDone: load('netDone', {}),        // name -> ISO date of local follow-up
    ui: load('ui', { deck: 'all', appFilter: 'live', netFilter: 'action' }),
    seeded: load('seeded', {}),
    clubEvents: load('clubEvents', []), // [{id,title,date,time,stage,speaker,room,checks:{}}]
    income: load('income', { revenue: [], notes: {}, ideas: {} }),
  };
  const persist = (k) => save(k, S[k]);

  // ------------------------------------------------------------ utils
  const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const parseDay = (s) => { if (!s) return null; const d = new Date(s.length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? null : d; };
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysFrom = (s) => { const d = parseDay(s); if (!d) return null; const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.round((x - today0()) / 86400000); };
  const fmtDay = (s) => { const d = parseDay(s); return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; };
  const fmtShort = (s) => { const d = parseDay(s); return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-'; };
  const fmtTime = (s) => (s && s.length > 10 ? s.slice(11, 16) : '');
  function rel(s) {
    const n = daysFrom(s);
    if (n === null) return '';
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n}d` : `${-n}d ago`;
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  const AREA = { msc: ['MSc', 'accent'], club: ['Club', 'violet'], apps: ['Apps', 'warn'], network: ['Network', 'good'], income: ['Income', 'good'], life: ['Life', ''] };
  const areaTag = (a) => { const [l, c] = AREA[a] || ['General', '']; return `<span class="tag ${c}">${l}</span>`; };

  // ------------------------------------------------------------ data
  async function getJSON(p, bust) {
    const r = await fetch(p + (bust ? `?t=${Date.now()}` : ''), { cache: bust ? 'no-store' : 'default' });
    if (!r.ok) throw new Error(p + ' ' + r.status);
    return r.json();
  }
  async function fetchAll(bust = false) {
    const files = { brief: 'brief', apps: 'applications', net: 'network', cards: 'flashcards', tt: 'timetable', club: 'club', income: 'income' };
    await Promise.all(Object.entries(files).map(async ([k, f]) => {
      try { D[k] = await getJSON(`data/${f}.json`, bust); } catch (e) { console.warn(e); }
    }));
    // seed club tasks once
    if (D.club && !S.seeded.club) {
      for (const t of D.club.seedTasks || []) S.tasks.push({ id: uid(), text: t.text, due: t.due, area: 'club', done: false });
      S.seeded.club = true; persist('tasks'); persist('seeded');
    }
  }

  // ------------------------------------------------------------ derived
  const timetable = () => S.slots || (D.tt && D.tt.slots) || [];
  const moduleInfo = (code) => (D.tt?.modules || []).find((m) => m.code === code || m.name === code) || { name: code, colour: '#5b6880' };

  function applications() {
    const base = (D.apps?.items || []).map((a) => ({ ...a, ...(S.appEdits[a.id] || {}) }));
    return [...S.myApps.map((a) => ({ ...a, ...(S.appEdits[a.id] || {}) })), ...base];
  }
  const DEAD = new Set(['Rejected', 'Withdrawn']);

  function networkActions() {
    const out = { book: [], follow: [], close: [], active: [] };
    for (const p of D.net?.people || []) {
      const localFu = S.netDone[p.name];
      const lastTouch = localFu || p.followup || p.sent;
      const age = lastTouch ? -daysFrom(lastTouch) : null;
      if (p.status === 'Replied') out.book.push(p);
      else if (p.status === 'Outreach Sent' && !localFu && age !== null && age >= 10) out.follow.push({ ...p, age });
      else if ((p.status === 'Follow-up Sent' || p.status === 'No Response' || (p.status === 'Outreach Sent' && localFu)) && age !== null && age >= 21) out.close.push({ ...p, age });
      else if (p.status === 'Connected') out.active.push(p);
    }
    return out;
  }

  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  function dueCards(deck) {
    const t = Date.now();
    return (D.cards?.cards || []).filter((c) => (deck === 'all' || c.deck === deck) && (!S.cards[c.id] || S.cards[c.id].due <= t));
  }

  function urgentItems() {
    const items = [];
    for (const u of D.brief?.urgent || []) if (!S.dismissed.includes(u.id)) items.push({ ...u, kind: 'brief' });
    for (const t of S.tasks) {
      if (t.done || !t.due) continue;
      const n = daysFrom(t.due);
      if (n !== null && n <= 2) items.push({ id: t.id, title: t.text, due: t.due, area: t.area, priority: n < 0 ? 'high' : 'medium', kind: 'task' });
    }
    const na = networkActions();
    if (na.follow.length) items.push({ id: 'net-follow', title: `${na.follow.length} networking follow-ups are due`, detail: 'Outreach sent 10+ days ago with no follow-up logged. One short nudge each.', area: 'network', priority: 'medium', kind: 'link', href: '#/network' });
    if (na.book.length) items.push({ id: 'net-book', title: `${na.book.length} people replied. Get calls in the diary`, detail: na.book.slice(0, 4).map((p) => p.name).join(', ') + (na.book.length > 4 ? '…' : ''), area: 'network', priority: 'medium', kind: 'link', href: '#/network' });
    const rank = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || (daysFrom(a.due) ?? 99) - (daysFrom(b.due) ?? 99));
  }

  function eventsForDay(d) {
    const key = isoDay(d), dow = d.getDay();
    const evs = (D.brief?.events || []).filter((e) => e.date.slice(0, 10) === key).map((e) => ({ time: e.allDay ? '' : fmtTime(e.date), title: e.title, where: e.where, area: e.area, tentative: e.tentative }));
    const term = D.tt?.term;
    const inTerm = !term || (key >= term.start && key <= term.end);
    if (inTerm) for (const s of timetable().filter((s) => s.day === dow)) evs.push({ time: s.start, title: moduleInfo(s.module).name + (s.type ? ` (${s.type})` : ''), where: s.room, area: 'msc' });
    const ch = D.income?.challenge;
    if (ch && key >= ch.start && key <= ch.end) evs.push({ time: ch.main, title: 'AI Income Challenge session', where: `VIP ${ch.vip} · main ${ch.main}`, area: 'income' });
    for (const ev of S.clubEvents.filter((x) => x.date === key)) evs.push({ time: ev.time || '', title: 'Club event: ' + ev.title, where: [ev.room, ev.stage].filter(Boolean).join(' · '), area: 'club' });
    for (const t of S.tasks.filter((t) => !t.done && t.due === key)) evs.push({ time: '', title: '☐ ' + t.text, area: t.area });
    return evs.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  }

  // ------------------------------------------------------------ components
  function rowUrgent(u) {
    const due = u.due ? `<span>${esc(fmtDay(u.due))} · ${esc(rel(u.due))}</span>` : '';
    const open = u.link ? `<a class="mini" href="${esc(u.link)}" target="_blank" rel="noopener">Open</a>` : u.href ? `<a class="mini" href="${u.href}">View</a>` : '';
    const clear = u.kind === 'brief' ? `<button class="mini ghost" data-dismiss="${esc(u.id)}">Done</button>` : u.kind === 'task' ? `<button class="mini ghost" data-task-done="${esc(u.id)}">Done</button>` : '';
    return `<div class="row p-${esc(u.priority || 'low')}">
      <div class="row-body"><div class="row-title">${esc(u.title)}</div>${u.detail ? `<div class="row-sub">${esc(u.detail)}</div>` : ''}
      <div class="row-meta">${areaTag(u.area)}${due}</div></div>
      <div class="row-actions">${open}${clear}</div></div>`;
  }

  function taskRow(t) {
    const n = daysFrom(t.due);
    const dueTxt = t.due ? `<span style="color:${n !== null && n < 0 && !t.done ? 'var(--bad)' : 'inherit'}">${esc(fmtDay(t.due))} · ${esc(rel(t.due))}</span>` : '';
    return `<div class="row ${t.done ? 'done' : ''}">
      <button class="check ${t.done ? 'on' : ''}" data-toggle="${esc(t.id)}" aria-label="Toggle done">✓</button>
      <div class="row-body" data-edit-task="${esc(t.id)}"><div class="row-title">${esc(t.text)}</div><div class="row-meta">${areaTag(t.area)}${dueTxt}</div></div></div>`;
  }

  function taskList(area) {
    const list = S.tasks.filter((t) => !area || t.area === area).sort((a, b) => a.done - b.done || (a.due || '9').localeCompare(b.due || '9'));
    const open = list.filter((t) => !t.done), done = list.filter((t) => t.done).slice(0, 5);
    return `<div class="list">${open.map(taskRow).join('') || '<div class="empty">Nothing on the list.</div>'}${done.map(taskRow).join('')}</div>
      <button class="add-btn" data-add-task="${area || ''}">+ Add task</button>`;
  }

  function agenda(fromOffset, days, hideEmpty) {
    const out = [];
    for (let i = fromOffset; i < fromOffset + days; i++) {
      const d = today0(); d.setDate(d.getDate() + i);
      const evs = eventsForDay(d);
      if (hideEmpty && !evs.length) continue;
      out.push(`<div class="day ${i === 0 ? 'today' : ''}"><div class="day-label">${d.toLocaleDateString('en-GB', { weekday: 'short' })}<b>${d.getDate()}</b></div><div>${
        evs.length ? evs.map((e) => `<div class="ev ${e.tentative ? 'tentative' : ''}"><div class="ev-time">${esc(e.time || '')}</div><div><div class="ev-title">${esc(e.title)}</div>${e.where ? `<div class="ev-where">${esc(e.where)}</div>` : ''}</div></div>`).join('') : '<div class="day-empty">Clear</div>'
      }</div></div>`);
    }
    return out.join('') || '<div class="empty">Nothing scheduled.</div>';
  }

  // ------------------------------------------------------------ pages
  const pages = {};

  pages.home = () => {
    const now = new Date(), h = now.getHours();
    const greet = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
    const urgent = urgentItems();
    const live = applications().filter((a) => !DEAD.has(a.status)).length;
    const na = networkActions();
    const weekEvents = [...Array(7)].reduce((n, _, i) => { const d = today0(); d.setDate(d.getDate() + i); return n + eventsForDay(d).length; }, 0);
    const due = dueCards('all').length;
    const gen = D.brief?.generated ? new Date(D.brief.generated) : null;

    return `<div class="hello"><h1>${greet}, Trevay.</h1><p>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}. ${urgent.length ? `${urgent.length} thing${urgent.length > 1 ? 's' : ''} need${urgent.length > 1 ? '' : 's'} you.` : 'Nothing urgent.'}</p></div>
      <div class="stats">
        <div class="stat ${urgent.length ? 'hot' : ''}"><b>${urgent.length}</b><span>Urgent</span></div>
        <div class="stat"><b>${weekEvents}</b><span>This week</span></div>
        <div class="stat"><a href="#/apps"><b>${live}</b><span>Live apps</span></a></div>
        <div class="stat"><a href="#/msc"><b>${due}</b><span>Cards due</span></a></div>
      </div>

      <section class="section"><div class="section-head"><span class="section-title">Needs your attention</span></div>
        <div class="list">${urgent.map(rowUrgent).join('') || '<div class="empty">You\'re clear. Go study.</div>'}</div></section>

      <section class="section"><div class="section-head"><span class="section-title">Next 7 days</span></div>
        <div class="card agenda">${agenda(0, 7)}</div></section>

      <section class="section"><div class="section-head"><span class="section-title">Further out</span></div>
        <div class="card agenda">${agenda(7, 30, true)}</div></section>

      <section class="section"><div class="section-head"><span class="section-title">My tasks</span></div>${taskList('')}</section>

      <div class="src-line">Brief synced ${gen ? esc(gen.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })) : '-'} from ${esc((D.brief?.sources || []).join(', '))}${D.brief?.pending_sources?.length ? '<br>Pending: ' + esc(D.brief.pending_sources.join(', ')) : ''}</div>`;
  };

  pages.msc = () => {
    const now = new Date(), dow = now.getDay();
    const slots = timetable();
    const todays = slots.filter((s) => s.day === dow).sort((a, b) => a.start.localeCompare(b.start));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const slotRow = (s, i) => { const m = moduleInfo(s.module); return `<div class="slot" style="border-left-color:${esc(m.colour)}" data-edit-slot="${i}"><div class="slot-time">${esc(s.start)}–${esc(s.end)}</div><div class="slot-body"><div class="row-title">${esc(m.name)}${s.type ? ` <span class="tag">${esc(s.type)}</span>` : ''}</div>${s.room ? `<div class="row-sub">${esc(s.room)}</div>` : ''}</div></div>`; };

    const todayHtml = todays.length ? `<div class="list">${todays.map((s) => slotRow(s, slots.indexOf(s))).join('')}</div>`
      : `<div class="card"><div class="row-title">${dow === 0 || dow === 6 ? 'Weekend. No lectures.' : slots.length ? 'No lectures today.' : 'Timetable not loaded yet'}</div><div class="row-sub">${slots.length ? 'Use the time for flashcards below.' : esc(D.tt?.note || '')}</div></div>`;

    const week = [1, 2, 3, 4, 5].map((d) => { const s = slots.filter((x) => x.day === d).sort((a, b) => a.start.localeCompare(b.start)); return s.length ? `<div class="sub" style="font:600 11px var(--mono);color:var(--muted);margin:12px 0 6px;letter-spacing:.08em">${days[d].toUpperCase()}</div><div class="list">${s.map((x) => slotRow(x, slots.indexOf(x))).join('')}</div>` : ''; }).join('');

    return `<section class="section" style="margin-top:0"><div class="section-head"><span class="section-title">Today · ${esc(now.toLocaleDateString('en-GB', { weekday: 'long' }))}</span></div>${todayHtml}</section>
      <section class="section"><div class="section-head"><span class="section-title">Tutor · Flashcards</span><a class="section-link" href="#/msc" data-reset-cards>Reset</a></div><div id="fcArea"></div></section>
      <section class="section"><div class="section-head"><span class="section-title">Week timetable</span></div>${week || '<div class="empty">No slots yet.</div>'}<button class="add-btn" data-add-slot>+ Add lecture / seminar</button></section>
      <section class="section"><div class="section-head"><span class="section-title">MSc tasks & deadlines</span></div>${taskList('msc')}</section>
      <div class="src-line">${esc(D.cards?.note || '')}</div>`;
  };

  let fc = { queue: [], i: 0, flipped: false, deck: null };
  function buildQueue() {
    const deck = S.ui.deck;
    let q = dueCards(deck);
    if (!q.length) q = (D.cards?.cards || []).filter((c) => deck === 'all' || c.deck === deck);
    q = q.slice().sort(() => Math.random() - 0.5);
    fc = { queue: q, i: 0, flipped: false, deck };
  }
  function renderCards() {
    const el = $('#fcArea'); if (!el || !D.cards) return;
    if (fc.deck !== S.ui.deck || !fc.queue.length) buildQueue();
    const decks = [{ id: 'all', name: 'All' }, ...D.cards.decks];
    const total = (D.cards.cards || []).filter((c) => S.ui.deck === 'all' || c.deck === S.ui.deck);
    const mastered = total.filter((c) => (S.cards[c.id]?.box || 0) >= 4).length;
    const chips = `<div class="chips">${decks.map((d) => `<button class="chip ${S.ui.deck === d.id ? 'on' : ''}" data-deck="${d.id}">${esc(d.name)}<span class="n">${dueCards(d.id).length}</span></button>`).join('')}</div>`;
    const c = fc.queue[fc.i];
    if (!c) { el.innerHTML = chips + '<div class="empty">Deck done. Nice.</div>'; return; }
    const deckName = D.cards.decks.find((d) => d.id === c.deck)?.name || c.deck;
    el.innerHTML = `${chips}
      <div class="progress"><i style="width:${Math.round((mastered / Math.max(total.length, 1)) * 100)}%"></i></div>
      <div class="fc-wrap"><div class="fc ${fc.flipped ? 'flip' : ''}" id="fc">
        <div class="fc-face fc-front"><div class="fc-meta"><span>${esc(deckName)} · ${esc(c.topic)}</span><span>${fc.i + 1}/${fc.queue.length}</span></div><div class="fc-q">${esc(c.q)}</div><div class="fc-hint">Tap to reveal</div></div>
        <div class="fc-face fc-back"><div class="fc-meta"><span>${esc(deckName)} · ${esc(c.topic)}</span><span>Answer</span></div><div class="fc-a">${esc(c.a)}</div></div>
      </div></div>
      ${fc.flipped ? `<div class="grade"><button class="g0" data-grade="0">Again<small>back to start</small></button><button class="g1" data-grade="1">Good<small>${BOX_DAYS[Math.min((S.cards[c.id]?.box || 0) + 1, 5)]}d</small></button><button class="g2" data-grade="2">Easy<small>${BOX_DAYS[Math.min((S.cards[c.id]?.box || 0) + 2, 5)]}d</small></button></div>` : ''}
      <div class="note">${mastered}/${total.length} mastered · spaced repetition (1, 3, 7, 14, 30 days) · progress saved on this device</div>`;
  }
  function grade(g) {
    const c = fc.queue[fc.i]; if (!c) return;
    const cur = S.cards[c.id]?.box || 0;
    const box = g === 0 ? 0 : Math.min(cur + g, 5);
    S.cards[c.id] = { box, due: Date.now() + BOX_DAYS[box] * 86400000 - 3600000 };
    persist('cards');
    if (g === 0) fc.queue.push(c);
    fc.i++; fc.flipped = false;
    renderCards();
  }

  pages.club = () => {
    const c = D.club || {};
    const stages = c.stages || [];
    const evs = S.clubEvents.slice().sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    const upcoming = evs.filter((e) => e.stage !== 'Done'), past = evs.filter((e) => e.stage === 'Done');
    const evCard = (e) => {
      const checks = c.checklist || [], done = checks.filter((k) => e.checks?.[k]).length;
      const n = daysFrom(e.date);
      const warn = n !== null && n >= 0 && n <= 14 && done < checks.length - 2;
      return `<div class="row ${warn ? 'p-high' : ''}" data-edit-event="${esc(e.id)}"><div class="row-body">
        <div class="row-title">${esc(e.title)}</div>
        <div class="row-sub">${e.date ? esc(fmtDay(e.date)) + (e.time ? ' · ' + esc(e.time) : '') + ' · ' + esc(rel(e.date)) : 'Date TBC'}${e.room ? ' · ' + esc(e.room) : ''}</div>
        ${e.speaker ? `<div class="row-sub" style="color:var(--text)">${esc(e.speaker)}</div>` : ''}
        <div class="progress" style="margin:8px 0 4px"><i style="width:${Math.round((done / Math.max(checks.length, 1)) * 100)}%"></i></div>
        <div class="row-meta"><span class="tag violet">${esc(e.stage)}</span><span>${done}/${checks.length} checklist</span>${warn ? '<span style="color:var(--bad)">behind for its date</span>' : ''}</div></div></div>`;
    };
    const pipe = stages.map((st) => `<div class="stat"><b>${evs.filter((e) => e.stage === st).length}</b><span>${esc(st)}</span></div>`).join('');
    return `<div class="hello"><h1>Bayes Real Estate Club</h1><p>${esc(c.role || '')}</p></div>
      <div class="stats" style="grid-template-columns:repeat(${Math.min(stages.length, 5)},minmax(0,1fr))">${pipe}</div>
      <section class="section"><div class="section-head"><span class="section-title">Upcoming events</span></div>
        <div class="list">${upcoming.map(evCard).join('') || '<div class="empty">No events planned yet. Add the first one.</div>'}</div>
        <button class="add-btn" data-add-event>+ Plan an event</button></section>
      <section class="section"><div class="section-head"><span class="section-title">Club to-dos</span></div>${taskList('club')}</section>
      <section class="section"><div class="section-head"><span class="section-title">Open threads</span></div><div class="list">${(c.threads || []).map((t) => `<div class="row"><div class="row-body"><div class="row-title">${esc(t.who)}</div><div class="row-sub">${esc(t.what)}</div><div class="row-meta"><span class="tag warn">${esc(t.status)}</span><span>${esc(rel(t.date))}</span></div></div><div class="row-actions"><a class="mini" href="${esc(t.link)}" target="_blank" rel="noopener">Open</a></div></div>`).join('') || '<div class="empty">None.</div>'}</div></section>
      ${past.length ? `<section class="section"><div class="section-head"><span class="section-title">Done</span></div><div class="list">${past.map(evCard).join('')}</div></section>` : ''}
      <section class="section"><div class="section-head"><span class="section-title">Links</span></div><div class="card">${(c.links || []).map((l) => `<div class="kv"><span>${esc(l.label)}</span><a class="section-link" href="${esc(l.url)}" target="_blank" rel="noopener">Open ↗</a></div>`).join('')}</div></section>
      <div class="src-line">${esc(c.note || '')}</div>`;
  };

  pages.income = () => {
    const inc = D.income || {}, g = inc.goal || { low: 500, high: 2000, currency: '£' }, ch = inc.challenge;
    const cur = g.currency || '£';
    const now = new Date(), mKey = isoDay(now).slice(0, 7);
    const rev = S.income.revenue.slice().sort((a, b) => b.date.localeCompare(a.date));
    const month = rev.filter((r) => r.date.startsWith(mKey)).reduce((n, r) => n + (+r.amount || 0), 0);
    const total = rev.reduce((n, r) => n + (+r.amount || 0), 0);
    const pct = Math.min(100, Math.round((month / g.low) * 100));
    let days = '';
    if (ch) {
      const s0 = parseDay(ch.start), e0 = parseDay(ch.end);
      for (let d = new Date(s0), i = 1; d <= e0; d.setDate(d.getDate() + 1), i++) {
        const k = isoDay(d), note = S.income.notes[k] || '', n = daysFrom(k);
        days += `<div class="row ${n === 0 ? 'p-medium' : ''}" data-income-note="${k}"><div class="row-body"><div class="row-title">${esc(fmtDay(k))}${n === 0 ? ' · today' : ''}</div>
          <div class="row-sub">${note ? esc(note) : n !== null && n < 0 ? '<span style="color:var(--dim)">No notes. What was the one takeaway?</span>' : `VIP ${esc(ch.vip)} · main ${esc(ch.main)}`}</div></div>
          <div class="row-actions"><span class="mini ${note ? '' : 'ghost'}">${note ? '✓ Notes' : 'Add notes'}</span></div></div>`;
      }
    }
    const fitTag = (f) => `<span class="tag ${f === 'high' ? 'good' : 'warn'}">${esc(f)} fit</span>`;
    const ideaState = (id) => S.income.ideas[id] || 'Idea';
    return `<div class="hello"><h1>Second revenue stream</h1><p>Target ${cur}${g.low}-${cur}${g.high}/month by end of ${esc(new Date(g.by || '2026-12-31').getFullYear())}.</p></div>
      <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="stat"><b>${cur}${month.toLocaleString('en-GB')}</b><span>This month</span></div>
        <div class="stat"><b>${pct}%</b><span>of ${cur}${g.low} floor</span></div>
        <div class="stat"><b>${cur}${total.toLocaleString('en-GB')}</b><span>All time</span></div>
      </div>
      <div class="progress" style="margin-top:10px"><i style="width:${pct}%"></i></div>
      <div class="card" style="margin-top:14px;border-color:rgba(251,191,36,.35)"><div class="row-meta" style="margin:0 0 6px"><span class="tag warn">Straight talk</span></div><div class="row-sub" style="color:var(--text);margin:0">${esc(inc.pushback || '')}</div></div>
      ${ch ? `<section class="section"><div class="section-head"><span class="section-title">${esc(ch.name)}</span><a class="section-link" href="${esc(ch.inbox)}" target="_blank" rel="noopener">Links ↗</a></div><div class="list">${days}</div><div class="note">${esc(ch.note)}</div></section>` : ''}
      <section class="section"><div class="section-head"><span class="section-title">Product ideas</span></div><div class="list">${(inc.ideas || []).map((i) => `<div class="row" data-idea="${esc(i.id)}"><div class="row-body"><div class="row-title">${esc(i.title)}</div><div class="row-sub">${esc(i.why)}</div><div class="row-meta">${fitTag(i.fit)}<span>${esc(i.price)}</span><span class="tag accent">${esc(ideaState(i.id))}</span></div></div></div>`).join('')}</div>
        <div class="note">Tap an idea to move it along: Idea → Validating → Building → Live → Dropped.</div></section>
      <section class="section"><div class="section-head"><span class="section-title">Revenue log</span></div><div class="card">${rev.slice(0, 12).map((r) => `<div class="kv" data-del-rev="${esc(r.id)}"><span>${esc(fmtShort(r.date))} · ${esc(r.what)}</span><span class="mono">${cur}${(+r.amount).toLocaleString('en-GB')}</span></div>`).join('') || '<div class="empty" style="padding:14px">No sales yet. First £1 is the hardest.</div>'}</div>
        <button class="add-btn" data-add-rev>+ Log a sale</button></section>
      <section class="section"><div class="section-head"><span class="section-title">Side-income tasks</span></div>${taskList('income')}</section>`;
  };

  const STATUS = ['Networking', 'Applied', 'Recommended', 'Assessment', 'Interview', 'Superday', 'Offer', 'Rejected', 'Withdrawn'];
  const statusTag = (s) => { const c = { Offer: 'good', Superday: 'accent', Interview: 'accent', Recommended: 'accent', Assessment: 'warn', Applied: '', Networking: 'violet', Rejected: 'bad', Withdrawn: 'bad' }[s] ?? ''; return `<span class="tag ${c}">${esc(s)}</span>`; };

  pages.apps = () => {
    const all = applications();
    const f = S.ui.appFilter;
    const shown = all.filter((a) => f === 'all' || (f === 'live' ? !DEAD.has(a.status) : DEAD.has(a.status)));
    const live = all.filter((a) => !DEAD.has(a.status));
    const progressed = all.filter((a) => ['Recommended', 'Assessment', 'Interview', 'Superday', 'Offer'].includes(a.status)).length;
    const stale = live.filter((a) => a.status === 'Applied' && (-daysFrom(a.updated || a.applied) || 0) > 30).length;
    return `<div class="stats">
        <div class="stat"><b>${all.length}</b><span>Tracked</span></div>
        <div class="stat"><b>${live.length}</b><span>Live</span></div>
        <div class="stat"><b>${progressed}</b><span>Progressed</span></div>
        <div class="stat ${stale ? 'hot' : ''}"><b>${stale}</b><span>Silent 30d+</span></div>
      </div>
      <div class="chips" style="margin-top:14px">${[['live', 'Live'], ['all', 'All'], ['closed', 'Closed']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-app-filter="${k}">${l}</button>`).join('')}</div>
      <div class="list">${shown.map((a) => `<div class="row" data-edit-app="${esc(a.id)}"><div class="row-body">
          <div class="row-title">${esc(a.company)}</div><div class="row-sub">${esc(a.role)}</div>
          ${a.next ? `<div class="row-sub" style="color:var(--text)">→ ${esc(a.next)}</div>` : ''}
          <div class="row-meta">${statusTag(a.status)}<span>Applied ${esc(fmtShort(a.applied))}</span><span>Updated ${esc(rel(a.updated || a.applied) || '-')}</span></div></div>
          ${a.link ? `<div class="row-actions"><a class="mini" href="${esc(a.link)}" target="_blank" rel="noopener" data-stop>Email</a></div>` : ''}</div>`).join('') || '<div class="empty">Nothing here.</div>'}</div>
      <button class="add-btn" data-add-app>+ Log an application</button>
      <a class="add-btn" style="text-align:center" href="${esc(D.apps?.notion || 'https://app.notion.com/p/9465c8a92106464182112695c99b8b77')}" target="_blank" rel="noopener">Open tracker in Notion ↗</a>
      <div class="src-line">${esc(D.apps?.note || '')}<br>Tap an application to update its status. Edits stay on this device.</div>`;
  };

  pages.network = () => {
    const na = networkActions();
    const people = D.net?.people || [];
    const sen = ['Analyst', 'Associate', 'VP / Director', 'Principal', 'Partner / MD'];
    const replied = people.filter((p) => ['Replied', 'Connected'].includes(p.status)).length;
    const f = S.ui.netFilter, q = (S.ui.netQ || '').toLowerCase();
    const card = (p, extra = '') => `<div class="row"><div class="row-body"><div class="row-title">${esc(p.name)} <span style="color:var(--muted);font-weight:500">· ${esc(p.firm)}</span></div>
        <div class="row-sub">${esc(p.role)}${p.note ? ` · ${esc(p.note)}` : ''}</div>
        <div class="row-meta"><span class="tag ${p.status === 'Replied' || p.status === 'Connected' ? 'good' : p.status === 'No Response' ? 'bad' : ''}">${esc(p.status)}</span>${p.alum ? '<span class="tag accent">Bayes/Cass</span>' : ''}<span>${esc(p.seniority)}</span>${p.sent ? `<span>sent ${esc(fmtShort(p.sent))}</span>` : ''}${S.netDone[p.name] || p.followup ? `<span>last nudge ${esc(fmtShort(S.netDone[p.name] || p.followup))}</span>` : ''}${extra}</div></div>
        ${f !== 'all' && p.status !== 'Replied' && p.status !== 'Connected' ? `<div class="row-actions"><button class="mini" data-nudged="${esc(p.name)}">Nudged</button></div>` : ''}</div>`;

    let body;
    if (f === 'action') {
      body = `<div class="section-head" style="margin-top:6px"><span class="section-title">Book a call (${na.book.length})</span></div><div class="list">${na.book.map((p) => card(p)).join('') || '<div class="empty">None.</div>'}</div>
        <div class="section-head" style="margin-top:22px"><span class="section-title">Follow-up due (${na.follow.length})</span></div><div class="list">${na.follow.sort((a, b) => b.age - a.age).map((p) => card(p, `<span style="color:var(--warn)">${p.age}d quiet</span>`)).join('') || '<div class="empty">All followed up.</div>'}</div>
        <div class="section-head" style="margin-top:22px"><span class="section-title">Final nudge or close (${na.close.length})</span></div><div class="list">${na.close.sort((a, b) => b.age - a.age).slice(0, 12).map((p) => card(p, `<span>${p.age}d since last touch</span>`)).join('') || '<div class="empty">None.</div>'}</div>`;
    } else {
      const list = people.filter((p) => !q || `${p.name} ${p.firm} ${p.role}`.toLowerCase().includes(q));
      body = `<input class="search" id="netSearch" placeholder="Search name, firm, role" value="${esc(S.ui.netQ || '')}"><div class="list">${list.map((p) => card(p)).join('')}</div>`;
    }
    return `<div class="stats">
        <div class="stat"><b>${people.length}</b><span>In tracker</span></div>
        <div class="stat"><b>${replied}</b><span>Warm</span></div>
        <div class="stat ${na.follow.length ? 'hot' : ''}"><b>${na.follow.length}</b><span>Follow-ups due</span></div>
        <div class="stat"><b>${people.filter((p) => p.alum).length}</b><span>Bayes/Cass</span></div>
      </div>
      <div class="card" style="margin-top:10px"><div class="row-meta" style="margin:0 0 6px">Coverage by seniority (your goal: analysts to partners)</div>${sen.map((s) => { const n = people.filter((p) => p.seniority === s).length; return `<div class="kv"><span>${s}</span><span class="mono">${n} ${'▮'.repeat(Math.min(n, 20))}</span></div>`; }).join('')}</div>
      <div class="chips" style="margin-top:14px">${[['action', 'Action list'], ['all', 'Everyone']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-net-filter="${k}">${l}</button>`).join('')}<a class="chip" href="${esc(D.net?.notion || '#')}" target="_blank" rel="noopener">Open Notion ↗</a></div>
      ${body}
      <div class="src-line">${esc(D.net?.source || '')}. "Nudged" logs a follow-up on this device only. Update Notion too.</div>`;
  };

  // ------------------------------------------------------------ sheets (forms)
  function openSheet(html, onSubmit, onDelete) {
    sheet.innerHTML = `<form method="dialog" id="sheetForm">${html}<div class="btns">${onDelete ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}<button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`;
    const form = $('#sheetForm', sheet);
    form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(form))); sheet.close(); render(); });
    $('[data-cancel]', sheet).onclick = () => sheet.close();
    if (onDelete) $('[data-del]', sheet).onclick = () => { onDelete(); sheet.close(); render(); };
    sheet.showModal();
  }
  const areaOptions = (sel) => Object.entries(AREA).map(([k, [l]]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');

  function taskSheet(t, area) {
    const isNew = !t; t = t || { text: '', due: '', area: area || 'life' };
    openSheet(`<h2 class="sheet-title">${isNew ? 'New task' : 'Edit task'}</h2>
      <div class="field"><label>Task</label><input name="text" required value="${esc(t.text)}" autofocus></div>
      <div class="field-row"><div class="field"><label>Due</label><input type="date" name="due" value="${esc(t.due || '')}"></div>
      <div class="field"><label>Area</label><select name="area">${areaOptions(t.area)}</select></div></div>`,
    (v) => { if (isNew) S.tasks.push({ id: uid(), done: false, ...v }); else Object.assign(t, v); persist('tasks'); },
    isNew ? null : () => { S.tasks = S.tasks.filter((x) => x !== t); persist('tasks'); });
  }

  function appSheet(a) {
    const isNew = !a; a = a || { company: '', role: '', status: 'Applied', applied: isoDay(new Date()), next: '' };
    openSheet(`<h2 class="sheet-title">${isNew ? 'Log application' : esc(a.company)}</h2>
      ${isNew ? `<div class="field"><label>Company</label><input name="company" required></div><div class="field"><label>Role</label><input name="role" required></div><div class="field"><label>Applied</label><input type="date" name="applied" value="${esc(a.applied)}"></div><div class="field"><label>Link</label><input name="link" placeholder="https://"></div>` : `<div class="row-sub" style="margin:-6px 0 12px">${esc(a.role)}</div>`}
      <div class="field"><label>Status</label><select name="status">${STATUS.map((s) => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Next step</label><textarea name="next" rows="2">${esc(a.next || '')}</textarea></div>`,
    (v) => {
      v.updated = isoDay(new Date());
      if (isNew) { S.myApps.unshift({ id: 'my-' + uid(), ...v }); persist('myApps'); }
      else { S.appEdits[a.id] = { ...(S.appEdits[a.id] || {}), status: v.status, next: v.next, updated: v.updated }; persist('appEdits'); }
    },
    isNew || !a.id.startsWith('my-') ? null : () => { S.myApps = S.myApps.filter((x) => x.id !== a.id); persist('myApps'); });
  }

  function slotSheet(idx) {
    const slots = timetable().slice();
    const isNew = idx == null; const s = isNew ? { day: 1, start: '09:00', end: '11:00', module: (D.tt?.modules || [])[0]?.code || '', room: '', type: 'Lecture' } : slots[idx];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    openSheet(`<h2 class="sheet-title">${isNew ? 'Add to timetable' : 'Edit slot'}</h2>
      <div class="field"><label>Module</label><select name="module">${(D.tt?.modules || []).map((m) => `<option value="${esc(m.code)}" ${s.module === m.code ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field-row"><div class="field"><label>Day</label><select name="day">${days.map((d, i) => `<option value="${i + 1}" ${s.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="field"><label>Type</label><select name="type">${['Lecture', 'Seminar', 'Workshop', 'Lab'].map((t) => `<option ${s.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      <div class="field-row"><div class="field"><label>Start</label><input type="time" name="start" value="${esc(s.start)}"></div><div class="field"><label>End</label><input type="time" name="end" value="${esc(s.end)}"></div></div>
      <div class="field"><label>Room</label><input name="room" value="${esc(s.room || '')}" placeholder="e.g. 106 Bunhill Row, 2003"></div>`,
    (v) => { v.day = +v.day; if (isNew) slots.push(v); else slots[idx] = v; S.slots = slots; persist('slots'); },
    isNew ? null : () => { slots.splice(idx, 1); S.slots = slots; persist('slots'); });
  }

  function eventSheet(ev) {
    const c = D.club || {}, isNew = !ev;
    ev = ev || { title: '', date: '', time: '18:00', stage: (c.stages || ['Idea'])[0], speaker: '', room: '', checks: {} };
    openSheet(`<h2 class="sheet-title">${isNew ? 'Plan an event' : 'Edit event'}</h2>
      <div class="field"><label>Event</label><input name="title" required value="${esc(ev.title)}" placeholder="e.g. Careers in REPE panel"></div>
      <div class="field-row"><div class="field"><label>Date</label><input type="date" name="date" value="${esc(ev.date)}"></div><div class="field"><label>Time</label><input type="time" name="time" value="${esc(ev.time)}"></div></div>
      <div class="field-row"><div class="field"><label>Stage</label><select name="stage">${(c.stages || []).map((s) => `<option ${ev.stage === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div><div class="field"><label>Room</label><input name="room" value="${esc(ev.room)}"></div></div>
      <div class="field"><label>Speakers / partners</label><input name="speaker" value="${esc(ev.speaker)}"></div>
      <div class="field"><label>Checklist</label>${(c.checklist || []).map((k, i) => `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font:14px var(--sans);color:var(--text);padding:3px 0"><input type="checkbox" name="ck${i}" ${ev.checks?.[k] ? 'checked' : ''} style="width:auto"> ${esc(k)}</label>`).join('')}</div>`,
    (v) => {
      const checks = {}; (c.checklist || []).forEach((k, i) => { if (v['ck' + i]) checks[k] = true; });
      const data = { title: v.title, date: v.date, time: v.time, stage: v.stage, room: v.room, speaker: v.speaker, checks };
      if (isNew) S.clubEvents.push({ id: uid(), ...data }); else Object.assign(ev, data);
      persist('clubEvents');
    },
    isNew ? null : () => { S.clubEvents = S.clubEvents.filter((x) => x !== ev); persist('clubEvents'); });
  }
  function noteSheet(day) {
    openSheet(`<h2 class="sheet-title">Challenge notes · ${esc(fmtDay(day))}</h2>
      <div class="field"><label>Key takeaways / actions</label><textarea name="note" rows="6" placeholder="One idea worth testing, one action for this week">${esc(S.income.notes[day] || '')}</textarea></div>`,
    (v) => { S.income.notes[day] = v.note.trim(); persist('income'); });
  }
  function revSheet() {
    openSheet(`<h2 class="sheet-title">Log a sale</h2>
      <div class="field"><label>What sold</label><input name="what" required placeholder="e.g. Waterfall model template"></div>
      <div class="field-row"><div class="field"><label>Amount (£, net)</label><input name="amount" type="number" step="0.01" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${isoDay(new Date())}"></div></div>`,
    (v) => { S.income.revenue.push({ id: uid(), ...v }); persist('income'); });
  }
  const IDEA_STAGES = ['Idea', 'Validating', 'Building', 'Live', 'Dropped'];

  // ------------------------------------------------------------ router
  const TITLES = { home: 'Today', msc: 'MSc REI', club: 'RE Club', apps: 'Applications', network: 'REPE Network', income: 'Side Income' };
  function route() { const r = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0]; return pages[r] ? r : 'home'; }
  function render() {
    const r = route();
    view.innerHTML = pages[r]();
    $('#pageName').textContent = TITLES[r];
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
    if (r === 'msc') renderCards();
  }

  // ------------------------------------------------------------ events
  view.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-edit-task], [data-edit-app], [data-edit-slot], [data-edit-event], [data-income-note], [data-idea], [data-del-rev], a[data-reset-cards], a[data-stop]');
    if (!t) { if (e.target.closest('#fc')) { fc.flipped = !fc.flipped; renderCards(); } return; }
    const d = t.dataset;
    if ('stop' in d) return;
    if (d.dismiss) { S.dismissed.push(d.dismiss); persist('dismissed'); render(); toast('Cleared'); }
    else if (d.taskDone || d.toggle) { const task = S.tasks.find((x) => x.id === (d.taskDone || d.toggle)); if (task) { task.done = !task.done; persist('tasks'); render(); } }
    else if (d.editTask) { taskSheet(S.tasks.find((x) => x.id === d.editTask)); }
    else if ('addTask' in d) { taskSheet(null, d.addTask || 'life'); }
    else if (d.editApp) { appSheet(applications().find((a) => a.id === d.editApp)); }
    else if ('addApp' in d) { appSheet(null); }
    else if (d.appFilter) { S.ui.appFilter = d.appFilter; persist('ui'); render(); }
    else if (d.netFilter) { S.ui.netFilter = d.netFilter; persist('ui'); render(); }
    else if (d.nudged) { S.netDone[d.nudged] = isoDay(new Date()); persist('netDone'); render(); toast('Follow-up logged'); }
    else if (d.deck) { S.ui.deck = d.deck; persist('ui'); fc.deck = null; renderCards(); }
    else if (d.grade) { grade(+d.grade); }
    else if (d.editSlot != null) { slotSheet(+d.editSlot); }
    else if ('addSlot' in d) { slotSheet(null); }
    else if (d.editEvent) { eventSheet(S.clubEvents.find((x) => x.id === d.editEvent)); }
    else if ('addEvent' in d) { eventSheet(null); }
    else if (d.incomeNote) { noteSheet(d.incomeNote); }
    else if ('addRev' in d) { revSheet(); }
    else if (d.delRev) { if (confirm('Delete this sale?')) { S.income.revenue = S.income.revenue.filter((r) => r.id !== d.delRev); persist('income'); render(); } }
    else if (d.idea) { const cur = IDEA_STAGES.indexOf(S.income.ideas[d.idea] || 'Idea'); S.income.ideas[d.idea] = IDEA_STAGES[(cur + 1) % IDEA_STAGES.length]; persist('income'); render(); }
    else if ('resetCards' in d) { e.preventDefault(); if (confirm('Reset flashcard progress?')) { S.cards = {}; persist('cards'); fc.deck = null; renderCards(); } }
  });
  view.addEventListener('input', (e) => {
    if (e.target.id === 'netSearch') { S.ui.netQ = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#netSearch'); s.focus(); s.setSelectionRange(pos, pos); }
  });
  document.addEventListener('keydown', (e) => {
    if (route() !== 'msc' || sheet.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); fc.flipped = !fc.flipped; renderCards(); }
    else if (fc.flipped && ['1', '2', '3'].includes(e.key)) grade(+e.key - 1);
  });

  $('#refreshBtn').addEventListener('click', async () => {
    const b = $('#refreshBtn'); b.classList.add('spin');
    await fetchAll(true); render(); b.classList.remove('spin'); toast('Up to date');
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  // ------------------------------------------------------------ boot
  view.innerHTML = '<div class="empty">Loading…</div>';
  fetchAll().then(render);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
