"use strict";
// C1 契约实现：由 schema 派生的 CLI 解析/校验/help（不 process.exit，错误抛 UsageError）。
import { CLI_OPTIONS, CLI_BY_FLAG, CONFIG_FIELDS } from "./config/schema.js";
import { UsageError } from "./errors.js";

const USAGE = "用法: skill-merge scan --corpus <dir> [--corpus ...] --out <dir> [选项]";

function convert(flag, opt, rawVal) {
  const kind = opt.kind;
  if (kind === "string" || kind === "multi") return rawVal;
  if (kind === "enum") {
    if (!opt.choices.includes(rawVal)) {
      throw new UsageError("参数 " + flag + " 取值非法: " + rawVal + "（可选: " + opt.choices.join("/") + "）", { where: "cli" });
    }
    return rawVal;
  }
  if (kind === "int") {
    const n = Number(rawVal);
    if (!Number.isInteger(n) || String(rawVal).trim() === "") {
      throw new UsageError("参数 " + flag + " 需要整数，收到: " + rawVal, { where: "cli" });
    }
    if (opt.min !== undefined && n < opt.min) throw new UsageError("参数 " + flag + " 不能小于 " + opt.min, { where: "cli" });
    if (opt.max !== undefined && n > opt.max) throw new UsageError("参数 " + flag + " 不能大于 " + opt.max, { where: "cli" });
    return n;
  }
  if (kind === "float") {
    const n = Number(rawVal);
    if (!Number.isFinite(n) || String(rawVal).trim() === "") {
      throw new UsageError("参数 " + flag + " 需要数值，收到: " + rawVal, { where: "cli" });
    }
    if (opt.min !== undefined && n < opt.min) throw new UsageError("参数 " + flag + " 不能小于 " + opt.min, { where: "cli" });
    if (opt.max !== undefined && n > opt.max) throw new UsageError("参数 " + flag + " 不能大于 " + opt.max, { where: "cli" });
    return n;
  }
  throw new UsageError("内部错误：未知 CLI 类型 " + kind, { where: "cli" });
}

function parseCli(argv) {
  const corpus = [];
  let out = null;
  let help = false;
  const overrides = {};
  const provenance = {};
  const internal = {};
  const warnings = [];

  function assign(opt, val) {
    if (opt.flag === "--corpus") {
      if (String(val).trim() === "") throw new UsageError("参数 --corpus 不能为空", { where: "cli" });
      corpus.push(val); return;
    }
    if (opt.flag === "--out") {
      if (String(val).trim() === "") throw new UsageError("参数 --out 不能为空", { where: "cli" });
      out = val; return;
    }
    if (opt.deprecated) warnings.push("参数 " + opt.flag + " 已废弃，将在后续版本删除");
    if (opt.internal) { internal[opt.internal] = val; return; }
    if (opt.cfgKey) { overrides[opt.cfgKey] = val; provenance[opt.cfgKey] = "cli"; }
  }

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "-h" || raw === "--help") { help = true; continue; }
    if (!raw.startsWith("--")) throw new UsageError("不支持位置参数: " + raw + "（--help 查看用法）", { where: "cli" });
    const eq = raw.indexOf("=");
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
    const opt = CLI_BY_FLAG.get(flag);
    if (!opt) throw new UsageError("未知参数: " + flag + "（--help 查看可用参数）", { where: "cli" });
    if (opt.kind === "bool") {
      if (inline !== undefined) throw new UsageError("参数 " + flag + " 是布尔开关，不接受取值", { where: "cli" });
      assign(opt, opt.value);
      continue;
    }
    let rawVal = inline;
    if (rawVal === undefined) {
      i += 1;
      if (i >= argv.length) throw new UsageError("参数缺值: " + flag, { where: "cli" });
      rawVal = argv[i];
    }
    assign(opt, convert(flag, opt, rawVal));
  }

  if (help) return { help: true, helpText: formatHelp() };
  if (!corpus.length) throw new UsageError("缺少必填参数 --corpus（可多次传）", { where: "cli" });
  if (out === null) throw new UsageError("缺少必填参数 --out", { where: "cli" });
  return { help: false, overrides, corpus, out, internal, warnings, provenance };
}

function fieldDefault(key) {
  const f = CONFIG_FIELDS.find(x => x.key === key);
  return f ? f.default : undefined;
}

function formatHelp() {
  const lines = [USAGE, "", "选项:"];
  for (const opt of CLI_OPTIONS) {
    if (opt.kind === "help") continue;
    const flag = "--" + opt.flag;
    let sig = flag;
    if (opt.kind === "int") sig += " <int>";
    else if (opt.kind === "float") sig += " <number>";
    else if (opt.kind === "enum") sig += " <" + opt.choices.join("|") + ">";
    else if (opt.kind === "string") sig += " <value>";
    else if (opt.kind === "multi") sig += " <dir>（可多次）";
    const tags = [];
    if (opt.required) tags.push("必填");
    if (opt.deprecated) tags.push("已废弃");
    if (opt.debug) tags.push("调试");
    const def = opt.cfgKey ? fieldDefault(opt.cfgKey) : undefined;
    const defText = def === undefined || def === "" || (def && typeof def === "object") ? "" : "（默认 " + def + "）";
    lines.push("  " + sig.padEnd(34) + opt.doc + defText + (tags.length ? " [" + tags.join("/") + "]" : ""));
  }
  lines.push("  --help                             显示本帮助");
  lines.push("", "退出码: 0 成功 / 2 用法或配置错误 / 1 运行期失败");
  return lines.join(String.fromCharCode(10));
}

export { parseCli, formatHelp, USAGE };