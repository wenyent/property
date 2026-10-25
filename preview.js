// Serves the site folder locally so you can preview it: node scripts/preview.js
// (Opening site/index.html directly doesn't work, because browsers block loading
// the data files from a file:// page.)
const http = require("http");
const fs = require("fs");
const path = require("path");

const SITE = path.join(__dirname, "..", "site");
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.normalize(path.join(SITE, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Preview at http://localhost:${PORT}  (add ?demo=1 for demo data)`));
