# The Ledger

A personal commercial-awareness app (PWA) for UK & European real estate and macro.

**Live:** https://trevay8.github.io/The-Ledger/

## Pages
- **Home**: key metrics (BoE/ECB rates, SONIA, Euribor, UK/EZ CPI, gilts, Bunds, GDP, unemployment, FX), top 10 headlines, prime yields with spread vs the 10Y gilt/Bund, latest deals
- **Market Updates**: real estate + macro news, filterable (RE / Macro / My Subs) and searchable
- **Quarterly Reports**: research coverage from brokers, data bodies and fund managers, plus a research library and release calendar
- **Recent Deals**: UK & Europe deals auto-tagged by sector, type and region, with prices extracted
- **Saved**: anything you star

## How it works
`.github/workflows/update.yml` runs every 6 hours (or on manual trigger): `scripts/fetch-data.mjs` pulls the RSS feeds and the official data APIs (BoE, ECB, ONS, Eurostat, Bundesbank), writes `data/*.json`, then deploys the site to GitHub Pages. There's no server and it costs nothing.

## Maintenance
| What | Where | When |
|---|---|---|
| Prime yields | `data/prime-yields.json`: move `yield` → `prev`, enter new `yield`, set `conf` to `verified` | Quarterly |
| News sources | `scripts/sources.mjs` | Whenever |
| Research links / calendar | `data/research-library.json` | Whenever |

Edit the files on github.com and commit. The site redeploys automatically. To force a refresh, go to **Actions → Refresh data & deploy → Run workflow**.

## Install on your phone
- **iPhone:** open the link in Safari → Share → *Add to Home Screen*
- **Android:** open in Chrome → ⋮ → *Install app*

---

# Jarvis

Trevay's personal assistant PWA. It lives in `jarvis/`.

**Live (once merged to main):** https://trevay8.github.io/The-Ledger/jarvis/

## Tabs
- **Home**: what's urgent, the next 7 days, further-out events, and your tasks
- **MSc REI**: today's lectures, the week timetable, and a flashcard tutor with spaced repetition, built from your lecture notes
- **RE Club**: Bayes Real Estate Club to-dos and open threads
- **Applications**: internship and graduate application tracker
- **Network**: REPE outreach action list (book a call, follow-up due, close out), built from the Notion REPE Network Tracker

## How data gets in
`jarvis/data/*.json` is written by Claude from Gmail, Google Calendar, Notion and Drive (and Outlook once connected). Anything you add or edit in the app (tasks, status changes, timetable slots, flashcard progress) is saved on that device only.

**Notion is the master copy** for applications and networking. Edit there and Jarvis picks up the changes on the next morning refresh. A static page can't write to Notion directly, because the browser blocks those calls.

Tabs added since launch: **Income** (side-revenue goal, AI Income Challenge notes, product ideas, revenue log). The **Club** tab now has an event pipeline with a checklist for each event.
