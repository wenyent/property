# Condo $psf Lookup

A free website for checking Singapore condo and apartment prices per square foot, and finding the projects whose $psf grew the most over the last 5 years.

- **Top growers:** pick CCR / RCR / OCR and a size range (default 650–800 sqft) to see the 50 projects with the highest growth in average $psf from 2021 to 2026.
- **By MRT:** pick an MRT or LRT station and a radius of 500m, 1km or 1.5km to see the area's overall growth and the top growers nearby.
- **Project lookup:** shows one project's average $psf, its growth, a year-by-year breakdown and every sale.

**Scope:** URA private residential transactions, condominiums and apartments only (no HDB, ECs or landed). Resale and sub sale only. Bulk sales are excluded.

**Growth:** average $psf in the latest year compared with 5 years earlier, within the chosen size range. A project needs at least one sale in each of those two years. Sale counts are shown in brackets, so check projects with few sales in Project lookup.

**Data**

- [URA Data Service API](https://eservice.ura.gov.sg/maps/api/) (private residential transactions)
- [LTA MRT Station Exit](https://data.gov.sg/datasets/d_b39d3a0871985372d7e1637193335da5/view), data.gov.sg, under the Singapore Open Data Licence

Both are refreshed by a scheduled GitHub Action every morning. Earlier sales are kept, so the history grows beyond URA's 5-year window.

---

## How it works

```
GitHub Action (daily, 5:47am SGT)
  └─ scripts/update-data.js  → pulls URA sales + MRT exits using the URA_ACCESS_KEY secret
       └─ writes site/data/sales.json and site/data/stations.json, commits them
  └─ publishes the site/ folder to GitHub Pages
Visitors' browsers load site/index.html + the data files and do all the calculations.
```

The URA key is stored as a GitHub secret. It is never in the code or visible to visitors.

---

## Setup (one time, about 10 minutes, no coding)

1. **Create the repository.** On GitHub, click **New repository**. Name it, for example, `condo-psf`, and set it to **Public**. GitHub Pages is free for public repositories.
2. **Upload the files.** In the new repo, click **Add file → Upload files**. Drag in *everything inside* this folder, including the `.github` folder, then click **Commit changes**.
   - Never upload a `config.json` that contains your key.
   - If the `.github` folder doesn't upload, use [GitHub Desktop](https://desktop.github.com) instead: *File → Add local repository*, then *Publish*.
3. **Add your URA key as a secret.** Go to **Settings → Secrets and variables → Actions → New repository secret**. Set Name to `URA_ACCESS_KEY` and Secret to your key, then save.
4. **Turn on Pages.** Go to **Settings → Pages**, and under *Build and deployment → Source* choose **GitHub Actions**.
5. **Run the first update.** On the **Actions** tab, enable workflows if GitHub asks. Then open **Update data and publish site → Run workflow**. It takes 1–3 minutes.
6. **Open your site** at `https://<your-username>.github.io/<repo-name>/`. The link also appears in the finished workflow run and in Settings → Pages.

Until the first update finishes, the site shows fictional demo data with a yellow banner.

## Day to day

- Data updates automatically every morning. To update immediately, go to **Actions → Update data and publish site → Run workflow**.
- Anyone with the link can use the site. Nothing to install.
- **If an update fails,** open the failed run on the Actions tab and read the "Fetch latest URA sales" step:
  - *"check the access key":* re-enter the secret, or check that your URA account is activated.
  - *HTTP 403 or an "unexpected response":* URA may be blocking GitHub's servers, which are outside Singapore. Use the local option below to update from your own computer, then upload the two files in `site/data/` (or push them with GitHub Desktop).
- GitHub pauses scheduled workflows in repositories with no activity for 60 days. The daily data commits normally count as activity. If it does pause, the Actions tab has a button to re-enable it.

## Run it on your own computer (optional)

Needs [Node.js](https://nodejs.org) 18 or later.

1. Copy `config.example.json` to `config.json` and paste your URA key into it. `config.json` is excluded from git by `.gitignore`.
2. Double-click `start.bat` on Windows, or run `node scripts/update-data.js` then `node scripts/preview.js`.
3. Open http://localhost:3000. Add `?demo=1` to the address to view the demo data.

## Before sharing widely

The site republishes URA transaction data. Check [URA's Data Service terms of use](https://eservice.ura.gov.sg/maps/api/) for conditions on redistribution and attribution before promoting the link publicly. The figures are for research only and are not financial advice.

## Files

| Path | What it is |
|---|---|
| `site/index.html`, `site/app-data.js` | The website: the page and the calculations |
| `site/data/sales.json`, `stations.json` | Generated data, updated by the Action |
| `site/data/demo-*.json` | Fictional demo data |
| `scripts/update-data.js` | Pulls URA and MRT data |
| `scripts/svy21.js` | Converts between map coordinates and latitude/longitude, for MRT distances |
| `scripts/preview.js`, `start.bat` | Local preview |
| `.github/workflows/update-and-deploy.yml` | Daily update and publish |
