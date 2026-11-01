# Condo Hunt

Find Singapore condos whose price per square foot ($psf) has grown the most.
Data: URA private residential transactions (resale and sub sale) and LTA MRT station exits.

The site is static. All calculations run in the visitor's browser. A GitHub Action refreshes
the data every morning (5:47am Singapore time) and republishes the site.

## Put it on GitHub (no coding)

1. **Create the repository.** On github.com click **+** > **New repository**. Name it `property`,
   keep it **Public** (free GitHub Pages needs public), tick nothing else, click **Create repository**.
2. **Upload the files.** On the new repo page click **uploading an existing file**. Unzip this
   folder on your computer, then drag in everything inside it (the folders `.github`, `scripts`,
   `site`, `docs` and the files `README.md`, `.gitignore`, `package.json`, `config.example.json`, `start.bat`).
   Click **Commit changes**.
   - **Do not upload `config.json`.** It holds your private key. The `.gitignore` file also keeps it out.
   - If the `.github` folder did not upload (some computers hide folders that start with a dot):
     click **Add file** > **Create new file**, type `.github/workflows/update-and-deploy.yml` as the
     name, paste in everything from `docs/update-and-deploy.yml.txt`, and click **Commit changes**.
3. **Add your URA key as a secret.** Repo **Settings** > **Secrets and variables** > **Actions** >
   **New repository secret**. Name: `URA_ACCESS_KEY`. Secret: paste your key. Click **Add secret**.
4. **Turn on Pages.** Repo **Settings** > **Pages** > under **Build and deployment**, set
   **Source** to **GitHub Actions**.
5. **Run it once.** Open the **Actions** tab > **Update data and deploy** > **Run workflow** > **Run workflow**.
   The first run takes a few minutes. A green tick means it worked.
6. **Open your site** at `https://YOUR-GITHUB-USERNAME.github.io/property/`
   (the link also appears in the finished run, under the deploy step).

After that it updates itself daily. To force an update, repeat step 5.

## Run it on your own computer

1. Install Node.js LTS from nodejs.org.
2. Copy `config.example.json` to `config.json` and paste your URA key.
3. Double-click `start.bat`. It updates the data, then opens http://localhost:3000.

## If something goes wrong

- **Run shows a yellow warning "Data update failed".** The site still deployed with the old data.
  Open the **Update data from URA and LTA** step to read the reason. A wrong or not-yet-active key
  shows "check the access key". URA may also block requests from GitHub's servers, which are outside
  Singapore. If so, run `start.bat` at home to update, then upload the new `site/data/sales.json`
  and `site/data/stations.json` to the repo (**Add file** > **Upload files**, into `site/data`).
- **Site says "Last updated: not yet".** No data has loaded yet. Run the workflow (step 5).
- **Daily updates stopped.** GitHub pauses scheduled runs after 60 days without any repo activity.
  Open the Actions tab and re-enable the workflow, or run it manually.
- **Before promoting the site publicly,** read URA's terms about republishing their transaction data.

## What is where

- `site/` is the website (`index.html`, `app-data.js`, and `data/` with the latest data).
- `scripts/update-data.js` fetches and cleans the data. `scripts/svy21.js` converts MRT coordinates to URA's map system.
- `.github/workflows/update-and-deploy.yml` is the daily update and publish job.
