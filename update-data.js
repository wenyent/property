// Pulls URA private residential transactions and LTA MRT station exits, and writes
// the data files the website reads:
//   site/data/sales.json     condo/apartment resale + sub-sale transactions (history kept, new sales merged in)
//   site/data/stations.json  MRT/LRT stations with exit locations (SVY21 metres)
//
// Runs in GitHub Actions on a schedule (key from the URA_ACCESS_KEY secret),
// or locally (key from URA_ACCESS_KEY or config.json). Requires Node 18+.

const fs = require("fs");
const path = require("path");
const { toSVY21 } = require("./svy21");

const ROOT = path.join(__dirname, "..");
const SALES_FILE = path.join(ROOT, "site", "data", "sales.json");
const STATIONS_FILE = path.join(ROOT, "site", "data", "stations.json");
const CONFIG_FILE = path.join(ROOT, "config.json");

const URA_BASE = "https://eservice.ura.gov.sg/uraDataService";
const MRT_DATASET = "d_b39d3a0871985372d7e1637193335da5";
const MRT_MAX_AGE_DAYS = 30;

// Scope rules
const KEEP_PROPERTY_TYPES = { Condominium: "C", Apartment: "A" }; // no ECs, no landed
const KEEP_SALE_TYPES = new Set(["2", "3"]);                      // 2 = sub sale, 3 = resale

// ---------- helpers ----------

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

function accessKey() {
  if (process.env.URA_ACCESS_KEY) return process.env.URA_ACCESS_KEY.trim();
  return String(readJson(CONFIG_FILE, {}).uraAccessKey || "").trim();
}

// ---------- URA ----------

async function uraJson(url, headers) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`URA returned an unexpected response (HTTP ${res.status}): ${text.slice(0, 200)}`); }
}

async function fetchUra(key) {
  const tok = await uraJson(`${URA_BASE}/insertNewToken/v1`, { AccessKey: key });
  if (tok.Status !== "Success" || !tok.Result) {
    throw new Error("URA token request failed — check the access key. " + (tok.Message || ""));
  }
  const all = [];
  for (const batch of [1, 2, 3, 4]) {
    const json = await uraJson(
      `${URA_BASE}/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`,
      { AccessKey: key, Token: tok.Result }
    );
    if (json.Status !== "Success") throw new Error(`URA batch ${batch} failed. ` + (json.Message || ""));
    console.log(`URA batch ${batch}/4: ${(json.Result || []).length} projects`);
    all.push(...(json.Result || []));
  }
  return all;
}

// ---------- cleaning + merging ----------
// Compact format (keeps the file small for the website):
//   project: { n: name, s: street, g: segment, d: district, te: tenure, x, y, t: [sale, ...] }
//   sale:    [ "YYYY-MM", price, sqm, floorRange, saleType "2"|"3", propertyType "C"|"A" ]

function cleanSale(t) {
  const pt = KEEP_PROPERTY_TYPES[t.propertyType];
  if (!pt) return null;
  if (!KEEP_SALE_TYPES.has(String(t.typeOfSale))) return null;
  if (String(t.noOfUnits) !== "1") return null; // bulk sale
  const price = Number(t.price), sqm = Number(t.area);
  if (!(price > 0) || !(sqm > 0)) return null;
  const mmyy = String(t.contractDate).padStart(4, "0");
  const date = `20${mmyy.slice(2, 4)}-${mmyy.slice(0, 2)}`;
  return [date, price, sqm, t.floorRange || "", String(t.typeOfSale), pt];
}

const saleKey = (s) => s.slice(0, 5).join("|");

function mergeInto(store, rawProjects) {
  const byId = new Map(store.projects.map((p) => [`${p.n}|${p.s}`, p]));
  let added = 0;
  for (const rp of rawProjects) {
    const id = `${rp.project}|${rp.street}`;
    for (const t of rp.transaction || []) {
      const sale = cleanSale(t);
      if (!sale) continue;
      let p = byId.get(id);
      if (!p) {
        p = { n: rp.project, s: rp.street, g: rp.marketSegment, d: t.district, te: t.tenure, t: [] };
        byId.set(id, p);
        store.projects.push(p);
        p._keys = new Set();
      }
      if (!p._keys) p._keys = new Set(p.t.map(saleKey));
      const k = saleKey(sale);
      if (p._keys.has(k)) continue;
      p._keys.add(k);
      p.t.push(sale);
      added++;
    }
    const p = byId.get(id);
    if (p) {
      p.g = rp.marketSegment || p.g;
      if (Number(rp.x) && Number(rp.y)) { p.x = Math.round(Number(rp.x)); p.y = Math.round(Number(rp.y)); }
    }
  }
  for (const p of store.projects) {
    delete p._keys;
    p.t.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }
  store.projects.sort((a, b) => a.n.localeCompare(b.n));
  return added;
}

// ---------- MRT ----------

function titleCase(s) { return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

function exitProp(props, key) {
  if (props[key] != null) return String(props[key]);
  const m = String(props.Description || "").match(new RegExp(`<th>${key}</th>\\s*<td>(.*?)</td>`, "i"));
  return m ? m[1] : "";
}

function stationsFromGeoJson(gj) {
  const byName = new Map();
  for (const ft of gj.features || []) {
    const [lon, lat] = ft.geometry?.coordinates || [];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const raw = exitProp(ft.properties || {}, "STATION_NA").trim();
    if (!raw) continue;
    const kind = /\bLRT\b/i.test(raw) ? "LRT" : "MRT";
    const name = titleCase(raw.replace(/\s+(MRT|LRT)\s+STATION$/i, "").replace(/\s+STATION$/i, "").trim());
    const st = byName.get(name) || { name, kind, exits: [] };
    const p = toSVY21(lat, lon);
    st.exits.push([Math.round(p.E), Math.round(p.N)]);
    byName.set(name, st);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function updateStations() {
  const current = readJson(STATIONS_FILE, null);
  const ageDays = current ? (Date.now() - new Date(current.updatedAt).getTime()) / 864e5 : Infinity;
  if (ageDays < MRT_MAX_AGE_DAYS && !process.argv.includes("--force-mrt")) {
    console.log(`MRT stations are ${Math.floor(ageDays)} days old, skipping.`);
    return;
  }
  const poll = await (await fetch(
    `https://api-open.data.gov.sg/v1/public/api/datasets/${MRT_DATASET}/poll-download`
  )).json();
  const url = poll?.data?.url;
  if (!url) throw new Error("data.gov.sg did not return a download link for MRT exits.");
  const stations = stationsFromGeoJson(await (await fetch(url)).json());
  if (!stations.length) throw new Error("MRT exits file had no stations.");
  writeJson(STATIONS_FILE, { updatedAt: new Date().toISOString(), stations });
  console.log(`Saved ${stations.length} MRT/LRT stations.`);
}

// ---------- main ----------

async function main() {
  const key = accessKey();
  if (!key) {
    console.log("No URA access key set (URA_ACCESS_KEY secret or config.json). Skipping update.");
    return;
  }
  let failed = false;

  try {
    const store = readJson(SALES_FILE, { updatedAt: null, projects: [] });
    const added = mergeInto(store, await fetchUra(key));
    store.updatedAt = new Date().toISOString();
    writeJson(SALES_FILE, store);
    const total = store.projects.reduce((n, p) => n + p.t.length, 0);
    const kb = Math.round(fs.statSync(SALES_FILE).size / 1024);
    console.log(`Sales: ${added} new, ${total} total across ${store.projects.length} projects (${kb} KB).`);
  } catch (err) {
    console.error("Sales update failed: " + err.message);
    failed = true;
  }

  try { await updateStations(); }
  catch (err) { console.error("MRT update failed (keeping previous stations): " + err.message); }

  if (failed) process.exit(1);
}

module.exports = { cleanSale, mergeInto, stationsFromGeoJson };
if (require.main === module) main();
