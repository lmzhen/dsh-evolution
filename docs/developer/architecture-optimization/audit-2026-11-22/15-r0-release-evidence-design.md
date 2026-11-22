# R0 设计：发布证据绑定实际产物

范围：E3（release evidence 只校验 `artifactSha256` 形状，未绑定实际 dist 产物；旧 spike 可被沿用）。
目标架构关系：Assurance 平面的第一条要求；目标架构 `artifact-bound evidence` 的 R0 落地。

## 1. 已读依据

- `audit-2026-11-22/08-tests-debt.md:19-23,91`：旧 spike、只形状校验、dist 未比对。
- `audit-2026-11-22/10-system-framework.md`：I7 验证绑定事实、E1-E7。
- `audit-2026-11-22/11-target-architecture.md`：Assurance 链 `artifact hash → measured commit`。
- 当前实现：
  - `packages/scripts/lib-release-evidence.mjs:46,174`：artifact 只校验 64 hex；spike commit 有 measuredCommit 比对。
  - `packages/scripts/assemble-release-evidence.mjs`：不接收 dist，`evidence.artifacts` 不存在。
  - `packages/scripts/verify-release-evidence.mjs`：只验 JSON 形状/平台线。
  - `packages/evolution-host/tests/release-evidence.spec.ts`：fixture artifact hash 为 `b`*64，无真实 dist。
- 发布链：`.github/workflows/release.yml:307,321` 的 assemble/verify 调用点；dist 在该步已存在。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 旧 spike/旧 artifact 可被装配 | I7 | 发布证据可“证明”未测量的树；审计假绿 | 不直接影响运行字节，但可直接放行错误发布；必须在发布门解决 |

不变量：release evidence 的 `artifactSha256` 必须能在**本次 dist 的 tarball 集合**中找到；`measuredCommit` 必须与 spikes/traceability 同树。局部修法（加一个形状检查）不够，必须把 dist 哈希集合写入 evidence，并在校验时复算。

## 3. 设计

### 3.1 新模块 `lib-release-artifacts.mjs`

```js
readDistArtifacts(dir): { count, files: [{ name, sha256 }] } // only *.tgz, sorted name
verifyEvidenceArtifacts(evidence, dir): string[]           // exact set (name+sha) match
```

- 只认 `.tgz`：这些才是 npm 发布字节；
- 无 `.tgz` → throw/`cannot decide`；
- hash 用 `node:crypto`；文件读取失败 → `cannot decide`。

### 3.2 schema

evidence v2 增可选的 `artifacts`：

```json
"artifacts": { "count": 22, "files": [{ "name": "...tgz", "sha256": "..." }] }
```

- staging 可无（本地）；
- release 必需（validateReleaseEvidence）；
- 每条 spike 的 `artifactSha256` 必须在 `artifacts.files[].sha256` 集合里；否则 release 拒绝；
- `artifacts` 的名称/哈希形状必须合法；count 等于 files 长度。

### 3.3 assemble

新增 `--dist <dir>`：

- dist 缺失/无 tarball 且 `--release` → exit 2（cannot decide，不写半证据）；
- 有 dist → 读取并写入 `assembled.artifacts`；
- release 时 `--dist` 必需；非 release 可选；
- 保留 `--measured-commit` 覆盖 spike commit 的逻辑（已是同树检查），新增 `/!\b/` 不需要。

### 3.4 verify

新增 `--dist <dir>`：

- 有 dist → `verifyEvidenceArtifacts` 复算文件集合并与 evidence `artifacts` 比对；
- release 工作流必须传 `--dist packages/evolution/dist`；
- 无 dist 时仍做 schema/measuredCommit 校验（兼容本地测试），但发布 workflow 不会无 dist。

### 3.5 workflow

`assemble` / `verify` 命令都加 `--dist packages/evolution/dist`，与 `dist/release-evidence.json` 同目录；发布前先 `pack`。

## 4. 测试

- `releasable()` 增加 `artifacts`（files `family.tgz`，sha=`b`*64），spike 已用 b；release 形状继续通过。
- 新增拒绝用例：无 artifacts；artifact 文件哈希不在 spike 集合；files count 不符。
- assemble 测试 helper 创建临时 dist `family.tgz`，把测试 spike 的 hash 改成其真实 sha，并传 `--dist`；所有需要 `validateReleaseEvidence(release:true)` 的测试继续通过。
- 新增 assemble 无 `--dist` + `--release` → exit 2。
- 新增 verify 用临时 dist：一致通过、篡改 evidence artifacts 失败。
- 该组测试不依赖真实发布；不触发 workflow。

## 5. 影响与回退

- 只影响 scripts + release workflow + 证据测试；无运行时插件行为。
- 旧 `release-evidence-rehearsal.json` 的 artifact hash 与新 dist 不匹配是**预期失败**：下一轮发布前必须重新测量，不允许沿用旧 spike。
- 回退：删除 artifacts/dist 检查即可恢复旧行为；不涉及数据迁移。

## 6. 实现结果（2026-11-22，未发布）

- 新增 `packages/scripts/lib-release-artifacts.mjs`：只认 dist 下的 `*.tgz`，计算 name+sha256
  集合并与 evidence `artifacts` 精确比对。
- `assemble-release-evidence.mjs` 新增 `--dist`；`--release` 无 dist 直接 exit 2；有 dist 时把
  `artifacts` 写入 evidence。
- `verify-release-evidence.mjs` 新增 `--dist`；release workflow 的 assemble/verify 都传
  `packages/evolution/dist`。
- `lib-release-evidence.mjs` release 门新增：`artifacts` 必需、count/files 一致、每条 spike 的
  `artifactSha256` 必须命中实际 dist tarball 集合。
- 测试：release-evidence.spec 13 tests passed；新增“无 dist 不能 release”“artifact 不匹配拒绝”
  两个负例。
- 注意：`release-evidence-rehearsal.json` 里的旧 artifact hash 与新 dist 不匹配是**预期失败**；
  下一次发布前必须重新测量 S1-S4，不得沿用旧 spike。未发布。

## 追加：--dist 必须写入 assembled.artifacts

- 复核发现 assemble 只读 --dist，未把 artifacts 赋给 assembled；release 校验因此误报缺 artifacts。
- 已修复：读取后写入 assembled.artifacts；release-evidence.spec 15 tests passed。
