import fs from "node:fs";
const dirs = process.argv.slice(2);
const crlf = s => s.includes("\r\n");
for (const d of dirs) {
  const base = d.endsWith("/") ? d : d + "/";
  const rep = fs.readFileSync(base + "report.json", "utf8");
  const cfg = fs.readFileSync(base + "config.json", "utf8");
  const md = fs.readFileSync(base + "candidates.md", "utf8");
  const csv = fs.readFileSync(base + "candidates.csv", "utf8");
  const pairs = fs.readFileSync(base + "pairs.csv", "utf8");
  console.log(d + ": report CRLF=" + crlf(rep) + " sortedFirst=" + JSON.stringify(rep.slice(0, 22)) + " config CRLF=" + crlf(cfg) + " md CRLF=" + crlf(md) + " csv CRLF=" + crlf(csv) + " pairs CRLF=" + crlf(pairs));
  console.log("  csv head=" + JSON.stringify(csv.slice(0, 40)));
}