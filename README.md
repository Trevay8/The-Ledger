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
`.github/workflows/update.yml` runs every 3 hours: `scripts/fetch-data.mjs` pulls the RSS feeds and the official data APIs (BoE, ECB, ONS, Eurostat, Bundesbank), writes `data/*.json`, then deploys the site to GitHub Pages. There's no server and it costs nothing.

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
