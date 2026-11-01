// Condo Hunt — calculations that run in the visitor's browser (also loadable in Node for tests).
// Input: the compact files written by scripts/update-data.js (data/sales.json, data/stations.json).
(function (root) {
  const SQM_TO_SQFT = 10.7639;
  const GROWTH_YEARS = 5;
  const MIN_SALES = 1; // rank on any sale in both years; check details in Individual Development Lookup
  const SALE_TYPES = { 2: "Sub sale", 3: "Resale" };
  const RADII = [500, 1000, 1500];

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  function median(nums) {
    const s = [...nums].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Expand compact rows: [ "YYYY-MM", price, sqm, floorRange, saleTypeCode ]
  function build(salesJson, stationsJson) {
    const projects = (salesJson.projects || []).map((p) => ({
      id: p.id, project: p.project, street: p.street, marketSegment: p.seg, x: p.x || 0, y: p.y || 0,
      sales: p.s.map(([date, price, sqm, floorRange, type]) => {
        const sqftExact = sqm * SQM_TO_SQFT;
        return { date, year: Number(date.slice(0, 4)), price, sqm, sqft: Math.round(sqftExact),
          psf: Math.round((price / sqftExact) * 100) / 100, floorRange, saleType: SALE_TYPES[type] || "Resale" };
      }),
    }));
    return { fetchedAt: salesJson.fetchedAt || null, projects, stations: (stationsJson && stationsJson.stations) || [] };
  }

  function growthWindow(store) {
    let endYear = 0;
    for (const p of store.projects) for (const s of p.sales) if (s.year > endYear) endYear = s.year;
    return { startYear: endYear - GROWTH_YEARS, endYear };
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
    return { ...g, ok: true, startPsf, endPsf,
      growthPct: (endPsf / startPsf - 1) * 100,
      annualPct: (Math.pow(endPsf / startPsf, 1 / GROWTH_YEARS) - 1) * 100 };
  }

  function summarise(sales) {
    if (!sales.length) return null;
    const psfs = sales.map((s) => s.psf), byYear = {};
    for (const s of sales) (byYear[s.year] ||= []).push(s.psf);
    return { count: sales.length, avgPsf: mean(psfs), medianPsf: median(psfs),
      minPsf: Math.min(...psfs), maxPsf: Math.max(...psfs),
      byYear: Object.keys(byYear).sort().map((y) => ({ year: Number(y), count: byYear[y].length, avgPsf: mean(byYear[y]) })) };
  }

  const inSize = (min, max) => (s) => s.sqft >= min && s.sqft <= max;

  function topGrowers(store, { segment, minSqft = 0, maxSqft = Infinity, minSales = MIN_SALES, limit = 50 }) {
    const win = growthWindow(store), rows = [];
    let eligible = 0;
    for (const p of store.projects) {
      if (segment && segment !== "ALL" && p.marketSegment !== segment) continue;
      const g = growthFor(p.sales.filter(inSize(minSqft, maxSqft)), win, minSales);
      if (!g.ok) continue;
      eligible++;
      rows.push({ id: p.id, project: p.project, street: p.street, marketSegment: p.marketSegment,
        startPsf: g.startPsf, endPsf: g.endPsf, startSales: g.startSales, endSales: g.endSales,
        growthPct: g.growthPct, annualPct: g.annualPct });
    }
    rows.sort((a, b) => b.growthPct - a.growthPct);
    return { startYear: win.startYear, endYear: win.endYear, minSales, eligible, rows: rows.slice(0, limit) };
  }

  function distanceToStation(p, st) {
    if (!p.x || !p.y) return null;
    let best = Infinity;
    for (const [E, N] of st.exits) best = Math.min(best, Math.hypot(E - p.x, N - p.y));
    return best;
  }

  function nearMrt(store, { station, radius, minSqft = 0, maxSqft = Infinity, minSales = MIN_SALES, limit = 50 }) {
    const st = store.stations.find((s) => s.name === station);
    if (!st) return { error: "Station not found" };
    const win = growthWindow(store), rows = [], notEnough = [], poolStart = [], poolEnd = [];
    for (const p of store.projects) {
      const d = distanceToStation(p, st);
      if (d == null || d > radius) continue;
      const sales = p.sales.filter(inSize(minSqft, maxSqft));
      for (const s of sales) {
        if (s.year === win.startYear) poolStart.push(s.psf);
        else if (s.year === win.endYear) poolEnd.push(s.psf);
      }
      const g = growthFor(sales, win, minSales);
      const row = { id: p.id, project: p.project, street: p.street, marketSegment: p.marketSegment,
        distance: Math.round(d), startSales: g.startSales, endSales: g.endSales };
      if (!g.ok) { notEnough.push(row); continue; }
      rows.push({ ...row, startPsf: g.startPsf, endPsf: g.endPsf, growthPct: g.growthPct, annualPct: g.annualPct });
    }
    rows.sort((a, b) => b.growthPct - a.growthPct);
    notEnough.sort((a, b) => a.distance - b.distance);
    const area = poolStart.length >= minSales && poolEnd.length >= minSales
      ? { startPsf: mean(poolStart), endPsf: mean(poolEnd), startSales: poolStart.length, endSales: poolEnd.length,
          growthPct: (mean(poolEnd) / mean(poolStart) - 1) * 100,
          annualPct: (Math.pow(mean(poolEnd) / mean(poolStart), 1 / GROWTH_YEARS) - 1) * 100 }
      : null;
    return { station: st.name, kind: st.kind, radius, ...win, minSales, eligible: rows.length, rows: rows.slice(0, limit), notEnough, area };
  }

  function projectSearch(store, { id, minSqft = 0, maxSqft = Infinity }) {
    const p = store.projects.find((x) => x.id === id);
    if (!p) return { error: "Project not found" };
    const sales = p.sales.filter(inSize(minSqft, maxSqft)).sort((a, b) => b.date.localeCompare(a.date));
    return { project: p.project, street: p.street, marketSegment: p.marketSegment,
      stats: summarise(sales), growth: growthFor(sales, growthWindow(store)), sales };
  }

  function listProjects(store) {
    return store.projects.map((p) => ({ id: p.id, project: p.project, street: p.street, marketSegment: p.marketSegment, count: p.sales.length }))
      .sort((a, b) => a.project.localeCompare(b.project));
  }

  const api = { build, topGrowers, nearMrt, projectSearch, listProjects, growthWindow, growthFor, RADII };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CondoData = api;
})(typeof window !== "undefined" ? window : globalThis);
