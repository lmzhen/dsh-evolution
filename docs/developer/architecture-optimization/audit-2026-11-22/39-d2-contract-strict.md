# D2 设计：契约检测对准当前声明线并去掉 family 路径误报

范围：05-platform-seam P1-2：
- `verify-platform-contract` 把 family 自己的 `packages/evolution*` 路径当成平台 citation，对 rc.5 报 208~212 条“recorded difference”；
- gate-18 本地形态带 `--accept-recorded`，因此这些误报不影响绿，检测面对声明线没有判决；
- 默认 strict 对 rc.5 实际 red。

## 1. 已读依据

- `audit-2026-11-22/05-platform-seam.md:23-28`：位置、读数、建议。
- `packages/scripts/verify-platform-contract.mjs`：
  - `FAMILY_OWNED_UNDER_PACKAGES = Set(['docs','scripts'])`；
  - citation 过滤只跳过 `packages/docs`/`packages/scripts`；
  - `packages/evolution*` 被当成平台路径去 upstream 解析；
  - gate-18 local argv 带 `--accept-recorded`。
- 实测 `--upstream D:/dsh/_upstream/dsh-upstream-0.2.2-rc.5`：
  - 修复前 strict exit 1，212 recorded differences；
  - 其中大量是 `packages/evolution/...` family 路径。

## 2. 设计

- citation 过滤新增：`packages/evolution` 与 `packages/evolution-*` 一律跳过——它们是 family 自己（mirror 或 overlay）的路径，不是平台 citation。
- gate-18 本地矩阵去掉 `--accept-recorded`，与 CI strict 形态一致。
- gate-manifest/checks fact/mutation ledger 同步重生成。

## 3. 验证

- strict（无 `--accept-recorded`）：
  - 30 anchors、178 citations（0 broken）、18 imported symbols、36 service names，exit 0；
- `run-gates local --only gate-18`: pass 1/fail 0；
- `verify-check-registry --strict`: 7 pass / 1 registered / 0 fail（mutation 23/23）；
- gate-manifest/doc/arch/test-lines 0。

## 4. 残余

- `setup-mirror-tests.mjs` 的开发类型线仍指旧 build line；它不在本仓、且本仓测试通过 overlay 解析，不能由仓库脚本改。发布前以 `platform-line.json` + CI strict 为准。
- 锚点文本仍录制自 0.1.5-rc.2；对 rc.5 strict 已 0 差异，说明依赖面未移动；后续平台移动由 strict 直接红。

## 5. 回退

- 恢复 citation 过滤与 `--accept-recorded`；无产品代码变更。

## 6. 实现结果（2026-11-22，未发布）

- citation 过滤 family packages/evolution*；gate-18 本地去掉 --accept-recorded。
- strict 对 rc.5 exit 0（178 citations / 0 broken）。
- gate-18 local pass；registry 7 pass / 1 registered / 0 fail；mutation 23/23。
