"use strict";
const WHEN_RE = /何时用|何时使用|When to Use|触发|适用场景/i;
const BOUND_RE = /不适用|不要用|边界|不覆盖|not cover|does not|限定|前提/;
function sections(body) {
  const out = [];
  let cur = ["(引言)", []];
  for (const line of String(body).split(/\r?\n/)) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) { out.push([cur[0], cur[1].join("\n").trim()]); cur = [m[1].trim(), []]; continue; }
    cur[1].push(line);
  }
  out.push([cur[0], cur[1].join("\n").trim()]);
  return out;
}
function headExtract(skill, maxChars) {
  const mc = maxChars || 2400;
  const parts = [String(skill.description).trim()];
  const secs = sections(skill.body_core || skill.body);
  if (secs.length) parts.push(secs[0][1]);
  const when = secs.filter(([h]) => WHEN_RE.test(h)).map(([, t]) => t);
  if (when.length) parts.push(when[0]);
  const bound = String(skill.body_core || skill.body).split(/\r?\n/).map(l => l.trim()).filter(l => BOUND_RE.test(l));
  if (bound.length) parts.push(bound.slice(0, 6).join("\n"));
  return parts.filter(p => p).join("\n\n").slice(0, mc);
}
function bodyExcerpt(skill, maxChars) { return String(skill.body_core || skill.body).trim().slice(0, maxChars || 4000); }
export { sections, headExtract, bodyExcerpt };