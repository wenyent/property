// Pulls URA private residential transactions + LTA MRT station exits and writes the
// compact data files the website reads:  site/data/sales.json  and  site/data/stations.json
//
// Run:  node scripts/update-data.js
// Key:  URA_ACCESS_KEY environment variable (GitHub secret), or "uraAccessKey" in config.json (local only).
// Needs Node 18+. No dependencies.

const fs = require("fs");
const path = require("path");
const { toSVY21 } = require("./svy21");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "site", "data");
const SALES_FILE = path.join(DATA_DIR, "sales.json");
const STATIONS_FILE = path.join(DATA_DIR, "stations.json");
const URA_BASE = "https://eservice.ura.gov.sg/uraDataService";
const MRT_DATASET = "d_b39d3a0871985372d7e1637193335da5";
const MRT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const KEEP_PROPERTY_TYPES = new Set(["Condominium", "Apartment"]); // no ECs, no landed
const KEEP_SALE_TYPES = new Set(["2", "3"]);                         // 2 = sub sale, 3 = resale (no new launches)

// ---------- cleaning ----------
function cleanSale(t) {
  if (!KEEP_PROPERTY_TYPES.has(t.propertyType)) return null;
  if (!KEEP_SALE_TYPES.has(String(t.typeOfSale))) return null;
  if (String(t.noOfUnits) !== "1") return null; // bulk sale
  const price = Number(t.price), sqm = Number(t.area);
  if (!(price > 0) || !(sqm > 0)) return null;
  const s = String(t.contractDate).padStart(4, "0"); // "mmyy"
  const month = parseInt(s.slice(0, 2), 10), year = 2000 + parseInt(s.slice(2, 4), 10);
  const date = `${year}-${String(month).padStart(2, "0")}`;
  return [date, price, sqm, String(t.floorRange), Number(t.typeOfSale)];
}
const saleKey = (r) => r.join("|"); // same month + price + area + floor + type = same caveat

// Adds new sales to the existing data; never deletes, so history grows past URA's 5-year window.
function mergeSales(existing, rawProjects) {
  const byId = new Map((existing.projects || []).map((p) => [p.id, { ...p, s: [...p.s], _keys: new Set(p.s.map(saleKey)) }]));
  let added = 0;
  for (const p of rawProjects) {
    const id = `${p.project}|${p.street}`;
    for (const t of p.transaction || []) {
      const row = cleanSale(t);
      if (!row) continue;
      let proj = byId.get(id);
      if (!proj) { proj = { id, project: p.project, street: p.street, seg: p.marketSegment, x: 0, y: 0, s: [], _keys: new Set() }; byId.set(id, proj); }
      proj.seg = p.marketSegment || proj.seg;
      if (Number(p.x) && Number(p.y)) { proj.x = Math.round(Number(p.x) * 10) / 10; proj.y = Math.round(Number(p.y) * 10) / 10; }
      const k = saleKey(row);
      if (!proj._keys.has(k)) { proj._keys.add(k); proj.s.push(row); added++; }
    }
  }
  const projects = [...byId.values()].map(({ _keys, ...p }) => p).sort((a, b) => a.id.localeCompare(b.id));
  return { added, projects };
}

// ---------- URA ----------
async function uraJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`URA returned an unexpected response (HTTP ${res.status}): ${text.slice(0, 200)}`); }
}
async function fetchFromUra(key) {
  const h = (extra = {}) => ({ AccessKey: key, "User-Agent": "Mozilla/5.0", ...extra });
  const tok = await uraJson(`${URA_BASE}/insertNewToken/v1`, h());
  if (tok.Status !== "Success" || !tok.Result) throw new Error("URA token request failed. Check the access key. " + (tok.Message || ""));
  const all = [];
  for (const batch of [1, 2, 3, 4]) {
    const json = await uraJson(`${URA_BASE}/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`, h({ Token: tok.Result }));
    if (json.Status !== "Success") throw new Error(`URA batch ${batch} failed. ` + (json.Message || ""));
    all.push(...(json.Result || []));
  }
  return all;
}

// ---------- MRT stations ----------
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
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
    const { E, N } = toSVY21(lat, lon);
    st.exits.push([Math.round(E * 10) / 10, Math.round(N * 10) / 10]);
    byName.set(name, st);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
async function downloadMrtExits() {
  const poll = await (await fetch(`https://api-open.data.gov.sg/v1/public/api/datasets/${MRT_DATASET}/poll-download`)).json();
  const url = poll?.data?.url;
  if (!url) throw new Error("data.gov.sg did not return a download link for MRT exits.");
  return (await fetch(url)).json();
}

// ---------- files ----------
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f); // atomic replace
}

async function main() {
  const cfg = readJson(path.join(ROOT, "config.json"), {});
  const key = (process.env.URA_ACCESS_KEY || cfg.uraAccessKey || "").trim();
  let failed = false;

  // MRT stations: refresh every 30 days (independent of URA)
  const st = readJson(STATIONS_FILE, { fetchedAt: null, stations: [] });
  const stAge = st.fetchedAt ? Date.now() - new Date(st.fetchedAt).getTime() : Infinity;
  if (stAge > MRT_MAX_AGE_MS || !st.stations.length) {
    try {
      const stations = stationsFromGeoJson(await downloadMrtExits());
      if (!stations.length) throw new Error("MRT exits file had no stations.");
      writeJson(STATIONS_FILE, { fetchedAt: new Date().toISOString(), stations });
      console.log(`Saved ${stations.length} MRT/LRT stations.`);
    } catch (err) { console.error("MRT stations not updated: " + err.message); failed = true; }
  } else console.log("MRT stations are fresh; skipped.");

  // URA sales
  if (!key) { console.error("No URA access key. Set URA_ACCESS_KEY (or uraAccessKey in config.json)."); process.exit(1); }
  try {
    console.log("Fetching URA transactions...");
    const existing = readJson(SALES_FILE, { fetchedAt: null, projects: [] });
    const { added, projects } = mergeSales(existing, await fetchFromUra(key));
    writeJson(SALES_FILE, { fetchedAt: new Date().toISOString(), projects });
    console.log(`Done. ${added} new sales added; ${projects.length} projects stored.`);
  } catch (err) { console.error(err.message); failed = true; }
  if (failed) process.exit(1);
}

module.exports = { cleanSale, mergeSales, stationsFromGeoJson, main };
if (require.main === module) main();
