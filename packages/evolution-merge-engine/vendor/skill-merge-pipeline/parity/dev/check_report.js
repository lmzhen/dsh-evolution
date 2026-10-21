import fs from "node:fs";
function read(p) { return fs.readFileSync(p, "utf8"); }
for (const dir of ["g63_native", "g63_parity"]) {
  const base = "D:/dsh/skill-merge/out/" + dir;
  if (!fs.existsSync(base)) { console.log(dir + ": MISSING"); continue; }
  const r = JSON.parse(read(base + "/report.json"));
  const raw = read(base + "/report.json");
  console.log(dir + ": schema=" + r.schemaVersion + " stages=" + r.stages.length + " total_ms=" + r.timings.total_ms + " diag=" + r.diagnostics.length + " used=" + JSON.stringify(r.used_mode));
  console.log("  config keys=" + Object.keys(r.config).length + " has_rank_checkpoint=" + Object.prototype.hasOwnProperty.call(r.config, "rank_checkpoint"));
  console.log("  CRLF=" + raw.includes("\r\n") + " loneLF=" + /[^\r]\n/.test(raw) + " first=" + JSON.stringify(raw.slice(0, 18)));
}