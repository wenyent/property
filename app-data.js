// Data layer for the static site. Loads data/sales.json and data/stations.json
// (written by scripts/update-data.js on a schedule) and answers the same questions
// the old local server did, entirely in the browser.
// Falls back to fictional demo data if the real files are missing, or with ?demo=1.

const SQM_TO_SQFT = 10.7639;
const GROWTH_YEARS = 5;
const MIN_SALES = 1; // rank on any sale in both years; check details in Project lookup
const RADII = [500, 1000, 1500];
const SALE_TYPES = { "2": "Sub sale", "3": "Resale" };
const PROP_TYPES = { C: "Condominium", A: "Apartment" };

const DB = { demo: false, fetchedAt: null, lastError: null, projects: {}, stations: [], window: null };

async function getJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadData() {
  const forceDemo = new URLSearchParams(location.search).has("demo");
  let sales = null, stations = null;
  if (!forceDemo) {
    try { sales = await getJson("data/sales.json"); } catch { /* not generated yet */ }
    try { stations = await getJson("data/stations.json"); } catch { /* not generated yet */ }
  }
  if (!sales) {
    DB.demo = true;
    sales = await getJson("data/demo-sales.json");
    stations = await getJson("data/demo-stations.json");
  } else if (!stations) {
    DB.lastError = "MRT station data isn't available yet, so the By MRT tab won't work until the next update.";
  }
  DB.fetchedAt = sales.updatedAt;
  DB.stations = stations ? stations.stations : [];

  let endYear = 0;
  for (const p of sales.projects) {
    const id = `${p.n}|${p.s}`;
    const list = p.t.map(([date, price, sqm, floorRange, st, pt]) => {
      const sqft = sqm * SQM_TO_SQFT;
      const year = Number(date.slice(0, 4));
      if (year > endYear) endYear = year;
      return {
        date, year, price, sqft: Math.round(sqft), psf: Math.round((price / sqft) * 100) / 100,
        floorRange, saleType: SALE_TYPES[st] || st, propertyType: PROP_TYPES[pt] || pt,
      };
    });
    DB.projects[id] = {
      id, project: p.n, street: p.s, marketSegment: p.g, district: p.d, tenure: p.te,
      x: p.x, y: p.y, sales: list,
    };
  }
  DB.window = { startYear: endYear - GROWTH_YEARS, endYear };
}

// ---------- stats ----------

const mean = (nums) => nums.reduce((a, b) => a + b, 0) / nums.length;
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarise(sales) {
  if (!sales.length) return null;
  const psfs = sales.map((s) => s.psf);
  const byYear = {};
  for (const s of sales) (byYear[s.year] ||= []).push(s.psf);
  return {
    count: sales.length, avgPsf: mean(psfs), medianPsf: median(psfs),
    minPsf: Math.min(...psfs), maxPsf: Math.max(...psfs),
    byYear: Object.keys(byYear).sort().map((y) => ({ year: Number(y), count: byYear[y].length, avgPsf: mean(byYear[y]) })),
  };
}

function growthFor(sales, { startYear, endYear }, minSales = MIN_SALES) {
  const start = [], end = [];
  for (const s of sales) {
    if (s.year === startYear) start.push(s.psf);
    else if (s.year === endYear) end.push(s.psf);
  }
  const g = { startYear, endYear, minSales, startSales: start.length, endSales: end.length, ok: false };
  if (start.length < minSales || end.length < minSales) return g;
  const startPsf = mean(start), endPsf = mean(end);
  return {
    ...g, ok: true, startPsf, endPsf,
    growthPct: (endPsf / startPsf - 1) * 100,
    annualPct: (Math.pow(endPsf / startPsf, 1 / GROWTH_YEARS) - 1) * 100,
  };
}

const inRange = (min, max) => (s) => s.sqft >= min && s.sqft <= max;

function topGrowers({ segment, minSqft, maxSqft, limit = 50 }) {
  const rows = [];
  for (const p of Object.values(DB.projects)) {
    if (segment && segment !== "ALL" && p.marketSegment !== segment) continue;
    const g = growthFor(p.sales.filter(inRange(minSqft, maxSqft)), DB.window);
    if (!g.ok) continue;
    rows.push({
      id: p.id, project: p.project, street: p.street, marketSegment: p.marketSegment,
      startPsf: g.startPsf, endPsf: g.endPsf, startSales: g.startSales, endSales: g.endSales,
      growthPct: g.growthPct, annualPct: g.annualPct,
    });
  }
  rows.sort((a, b) => b.growthPct - a.growthPct);
  return { ...DB.window, minSales: MIN_SALES, eligible: rows.length, rows: rows.slice(0, limit) };
}

function distanceToStation(p, st) {
  if (!p.x || !p.y) return null; // URA has no location for this project
  let best = Infinity;
  for (const [E, N] of st.exits) best = Math.min(best, Math.hypot(E - p.x, N - p.y));
  return best;
}

function nearMrt({ station, radius, minSqft, maxSqft, limit = 50 }) {
  const st = DB.stations.find((s) => s.name === station);
  if (!st) return { error: "Station not found" };
  const win = DB.window;
  const rows = [], notEnough = [], poolStart = [], poolEnd = [];
  for (const p of Object.values(DB.projects)) {
    const d = distanceToStation(p, st);
    if (d == null || d > radius) continue;
    const sales = p.sales.filter(inRange(minSqft, maxSqft));
    for (const s of sales) {
      if (s.year === win.startYear) poolStart.push(s.psf);
      else if (s.year === win.endYear) poolEnd.push(s.psf);
    }
    const g = growthFor(sales, win);
    const row = { id: p.id, project: p.project, street: p.street, marketSegment: p.marketSegment,
      distance: Math.round(d), startSales: g.startSales, endSales: g.endSales };
    if (!g.ok) { if (sales.length) notEnough.push(row); continue; }
    rows.push({ ...row, startPsf: g.startPsf, endPsf: g.endPsf, growthPct: g.growthPct, annualPct: g.annualPct });
  }
  rows.sort((a, b) => b.growthPct - a.growthPct);
  notEnough.sort((a, b) => a.distance - b.distance);
  const area = poolStart.length && poolEnd.length
    ? { startPsf: mean(poolStart), endPsf: mean(poolEnd), startSales: poolStart.length, endSales: poolEnd.length,
        growthPct: (mean(poolEnd) / mean(poolStart) - 1) * 100,
        annualPct: (Math.pow(mean(poolEnd) / mean(poolStart), 1 / GROWTH_YEARS) - 1) * 100 }
    : null;
  return { station: st.name, kind: st.kind, radius, ...win, minSales: MIN_SALES,
    eligible: rows.length, rows: rows.slice(0, limit), notEnough, area };
}

// ---------- same endpoints the page used with the local server ----------

function status() {
  return { demo: DB.demo, fetchedAt: DB.fetchedAt, refreshing: false, lastError: DB.lastError };
}

async function api(path) {
  const url = new URL(path, location.href);
  const q = url.searchParams;
  const min = Number(q.get("minSqft")) || 0;
  const max = Number(q.get("maxSqft")) || Infinity;
  switch (url.pathname.split("/api/")[1]) {
    case "projects": {
      const seg = q.get("segment");
      const projects = Object.values(DB.projects)
        .filter((p) => !seg || seg === "ALL" || p.marketSegment === seg)
        .map((p) => ({ id: p.id, project: p.project, street: p.street, marketSegment: p.marketSegment, count: p.sales.length }))
        .sort((a, b) => a.project.localeCompare(b.project));
      return { ...status(), projects };
    }
    case "top":
      return { ...status(), ...topGrowers({ segment: q.get("segment"), minSqft: min, maxSqft: max }) };
    case "stations":
      return { error: DB.lastError, stations: DB.stations.map((s) => ({ name: s.name, kind: s.kind })) };
    case "mrt": {
      const radius = Number(q.get("radius"));
      return { ...status(), ...nearMrt({ station: q.get("station"), radius: RADII.includes(radius) ? radius : 500, minSqft: min, maxSqft: max }) };
    }
    case "search": {
      const p = DB.projects[q.get("id")];
      if (!p) return { error: "Project not found" };
      const sales = p.sales.filter(inRange(min, max)).sort((a, b) => b.date.localeCompare(a.date));
      return { project: p.project, street: p.street, marketSegment: p.marketSegment,
        stats: summarise(sales), growth: growthFor(sales, DB.window), sales };
    }
    default:
      return { error: "Unknown request" };
  }
}
