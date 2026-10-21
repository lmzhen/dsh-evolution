import test from "node:test";
import assert from "node:assert/strict";
import { measure, FIXED } from "../bench/fixed.js";

// 计时预算门禁在 npm test 脚本末尾串行执行（node bench/run.js），避免并行测试文件争 CPU 造成误报；
// 这里只守固定口径合同与「指标存在且为正」，保证 bench 口径不被悄悄改掉。
test("bench 固定口径：45 技能 / 90 文本", async () => {
  const r = await measure();
  assert.equal(r.skills, FIXED.skills);
  assert.equal(r.texts, FIXED.texts);
  assert.ok(r.load_ms > 0 && r.encode_ms > 0 && r.total_ms > 0);
});