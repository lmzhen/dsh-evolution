"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CONFIG_FIELDS, CLI_OPTIONS, DEFAULTS } from "../src/config/schema.js";
import { makeConfig, FIELD_BY_KEY } from "../src/config.js";
import { parseCli, formatHelp } from "../src/cli.js";
import { UsageError } from "../src/errors.js";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = ["--corpus", "C:/data/skills", "--out", "out/x"];
function parse(extra) { return parseCli(BASE.concat(extra || [])); }
function expectUsage(argv, matcher) {
  try { parseCli(argv); } catch (e) {
    assert.ok(e instanceof UsageError, "应抛 UsageError，实际 " + e.constructor.name);
    assert.match(String(e.message), matcher);
    return e;
  }
  assert.fail("应抛 UsageError: " + JSON.stringify(argv));
}

test("schema 是唯一真相源：DEFAULTS 与字段表一致", () => {
  assert.equal(Object.keys(DEFAULTS).length, CONFIG_FIELDS.length);
  for (const f of CONFIG_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULTS, f.key), "缺默认值: " + f.key);
    assert.equal(typeof f.doc, "string");
    assert.ok(["string", "int", "float", "bool", "enum", "json"].includes(f.type), f.key + " 类型非法");
  }
  assert.equal(DEFAULTS.judge, "stub");
  assert.equal(DEFAULTS.lsh_floor, 0.1);
  assert.deepEqual(DEFAULTS.embed_floor_presets["local"], { body: 0.95, summary: 0.6 });
});

test("CLI 选项表映射到已知 cfgKey 或 internal，flag 唯一", () => {
  const seen = new Set();
  for (const opt of CLI_OPTIONS) {
    assert.ok(!seen.has(opt.flag), "flag 重复: " + opt.flag);
    seen.add(opt.flag);
    if (opt.cfgKey) assert.ok(FIELD_BY_KEY.has(opt.cfgKey), "未知 cfgKey: " + opt.cfgKey);
  }
});

test("合法参数解析：类型/枚举/布尔/多值/映射", () => {
  const r = parse(["--judge", "deepseek", "--judge-effort", "high", "--rounds", "3",
    "--lexical-body-min", "0.8", "--lsh-threshold=0.05", "--seed-mode", "fixed",
    "--no-caution", "--skip-stage4", "--randomize", "--only-new",
    "--embed-local", "m1", "--embed-local-last", "m2", "--ledger", "led.json",
    "--corpus", "C:/data/more"]);
  assert.equal(r.help, false);
  assert.deepEqual(r.corpus, ["C:/data/skills", "C:/data/more"]);
  assert.equal(r.out, "out/x");
  assert.equal(r.overrides.judge, "deepseek");
  assert.equal(r.overrides.judge_effort, "high");
  assert.equal(r.overrides.round_count, 3);
  assert.equal(r.overrides.body_gate, 0.8);
  assert.equal(r.overrides.lsh_floor, 0.05);
  assert.equal(r.overrides.seed_mode, "fixed");
  assert.equal(r.overrides.l0_caution, false);
  assert.equal(r.overrides.skip_stage4, true);
  assert.equal(r.overrides.randomize_seed, true);
  assert.equal(r.overrides.emit_only_new, true);
  assert.equal(r.overrides.embedder_model, "m1");
  assert.equal(r.overrides.embedder_model_last, "m2");
  assert.equal(r.overrides.ledger_path, "led.json");
  assert.equal(r.provenance.round_count, "cli");
});

test("makeConfig(overrides) 不污染 DEFAULTS", () => {
  const c = makeConfig({ judge: "deepseek" });
  assert.equal(c.judge, "deepseek");
  assert.equal(DEFAULTS.judge, "stub");
  c.embed_floor_presets.local.body = 0.5;
  assert.equal(DEFAULTS.embed_floor_presets.local.body, 0.95);
});

test("非法输入全部 UsageError（I5 修复口径）", () => {
  expectUsage(BASE.concat(["--bogus"]), /未知参数/);
  expectUsage(["C:/data/skills", "--out", "o"], /位置参数/);
  expectUsage(BASE.concat(["--judge"]), /缺值/);
  expectUsage(BASE.concat(["--judge", "bogus"]), /取值非法/);
  expectUsage(BASE.concat(["--rounds", "abc"]), /需要整数/);
  expectUsage(BASE.concat(["--rounds", "0"]), /不能小于 1/);
  expectUsage(BASE.concat(["--rank-cap", "1.5"]), /需要整数/);
  expectUsage(BASE.concat(["--lsh-threshold", "abc"]), /需要数值/);
  expectUsage(BASE.concat(["--lsh-threshold=1.5"]), /不能大于 1/);
  expectUsage(BASE.concat(["--randomize=1"]), /布尔开关/);
  expectUsage(["--out", "o"], /缺少必填参数 --corpus/);
  expectUsage(["--corpus", "c"], /缺少必填参数 --out/);
});

test("--help 生成帮助且包含关键项", () => {
  const r = parseCli(["--help"]);
  assert.equal(r.help, true);
  assert.match(r.helpText, /--corpus/);
  assert.match(r.helpText, /--judge/);
  assert.match(r.helpText, /退出码: 0 成功 \/ 2 用法或配置错误 \/ 1 运行期失败/);
  assert.match(formatHelp(), /--embed-local-last/);
});

test("废弃/调试参数：warning 与 internal 分流", () => {
  const r = parse(["--semantic-projection", "summary"]);
  assert.equal(r.internal.semanticProjection, "summary");
  expectUsage(BASE.concat(["--parity-order", "ref.json"]), /未知参数/);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /已废弃/);
});

test("run.js：非法参数 exit 2，--help exit 0", () => {
  const runJs = path.join(__dirname, "..", "src", "run.js");
  const bad = spawnSync(process.execPath, [runJs, "--corpus", "c", "--out", "o", "--judge", "bogus"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /USAGE|取值非法/);
  const badInt = spawnSync(process.execPath, [runJs, "--corpus", "c", "--out", "o", "--rounds", "abc"], { encoding: "utf8" });
  assert.equal(badInt.status, 2);
  const help = spawnSync(process.execPath, [runJs, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--corpus/);
});