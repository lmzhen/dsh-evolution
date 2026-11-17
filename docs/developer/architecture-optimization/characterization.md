# 行为基线与 characterization（Phase 0）

> 目的：在改架构前，把“今天成立的行为”固定为可重复的基线；后续每个 Phase 用同一组夹具证明等价，除已记录 bug 修复。
> 当前只登记**已实测**的定向基线；全量 lane 来自 0.49.0 发布证据，进入发布门再重跑。
> Phase 0 的 merge 全量执行位置见 27 的 **DCR-1**：148 个 pre-tag spec 保留在 pre-tag lane，不在开发机裸跑。
> **DCR-2** 后 0.50 只验收 rc.3；下面 rc.1 的行只作 0.49 历史基线，不再作为发布门。

## 0. 一键基线验证

```bash
node packages/scripts/verify-architecture-baseline.mjs \
  --overlay D:\line-b6 --json
```

检查三件事：`v0.49.0` tag/commit、7 个必需文档、3 个 spec 的逐文件计数（9/30/37）。2026-11-16 实测 exit 0；日志 `D:\dsh\_phase0-baseline-verify4.log`。


## 0.1 双版本编译矩阵

```bash
node packages/scripts/verify-platform-matrix.mjs \
  --rc1-types "C:\Users\limengzhen\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai" \
  --rc3-root D:\dsh\harness-rc3 \
  --deps-root D:\line-b6 --json
```

- 编译对象：插件 **host 生产源码**（排除 client/tests），不是平台源码。
- rc.1 声明来自本机安装的 `@deepseek-ai/dsh@0.2.2-rc.1`（326 个包）；rc.3 声明来自源码 worktree 构建出的 `lib/types`（327 个包）。
- 2026-11-16 实测：rc1 **0 error**，rc3 **0 error**；日志 `D:\dsh\_phase0-matrix5.log`。
- 边界：只证明 host 声明兼容；client props、运行时行为、rc.3 真机仍不在这一步。

## 0.2 扩展行为基线（2026-11-16）

| 范围 | 用例数 | 结果 | 日志 |
|---|---:|---|---|
| `evolution-review/tests` + `evolution-curator/tests` | 129 | 19 files / 129 passed | `D:\dsh\_phase0-review-curator.log` |
| `evolution-merge/tests` 中 `@tier fast` 的 7 个 spec | 19 | 7 files / 19 passed | `D:\dsh\_phase0-merge-fast.log` |
| `evolution-core/tests/restricted-preset.spec.ts`（Phase 1 并发修复后） | 9 | 9 passed，含不同 allow 并发串台回归测试 | `D:\dsh\_phase1-preset-test3.log` |
| 合计（含 §1 的 75） | **232** | 全绿 | 见上 |

`evolution-merge/tests` 全量（148 个 `pre-tag` spec）在本机 Windows 上跑超过 13 分钟仍未结束（`runtime-approve`/`runtime-scan` 的 detached run 报 EPERM/ENOENT 临时文件错误）；已停止，不把“跑完”当成已验。全量 merge 放到 pre-tag lane / 发布门，用 tier 选行，不再用裸 `vitest` 全目录。

## 0.1b rc.3 运行测试线（DCR-2）

- overlay：`D:\dsh\harness-rc3\packages\evolution`（family source 复制，保持 overlay 布局，使 `evolution-core/tsconfig.json` 的 `../../core/*` references 可解析）。
- 配置：`D:\dsh\harness-rc3\vitest.family.config.mts`；family 包别名指向 overlay `src`，平台包别名指向 `packages/**/lib/index.js`，`@deepseek-ai/cordis` 指向 vendor source。
- 当前覆盖：platform-lifecycle（含 projections 晚挂载）+ subagent-channel + restricted-preset + write-gates + host-routes + tool-skill-manage + action-table + extract-prompt，**96/96**；日志 `D:\dsh\_rc3-tests-extract-subpath2.log`。
- 这是 0.50 的主测试线；rc.1 overlay 只保留 0.49 历史基线，不再作为 DCR-2 发布门。

## 1. 已实测基线（2026-11-16）

| # | spec | 用例数 | 覆盖的行为 | 命令（在 `D:\line-b6` 下） |
|---|---|---:|---|---|
| 1 | `packages/evolution/evolution-core/tests/subagent-channel.spec.ts` | 8 | 受限 preset、一次 run、双轮 open/continue、dispose、错误/取消 | `node node_modules/vitest/vitest.mjs run packages/evolution/evolution-core/tests/subagent-channel.spec.ts --maxWorkers=1 --reporter=dot` |
| 2 | `packages/evolution/tool-skill-manage/tests/write-gates.spec.ts` | 30 | 写门禁顺序、确认 gate、审批暂存、拒绝/路径/保护技能 | 同上，换 spec |
| 3 | `packages/evolution/tool-skill-manage/tests/tool-skill-manage.spec.ts` | 37 | skill_manage 的 create/edit/update/patch/delete/read/list/restore 等用户路径 | 同上，换 spec |

合计 **75/75**。三个 spec 一起跑时必须 `--maxWorkers=1`：并行 worker 下 `tool-skill-manage` 有两个时序敏感用例会偶发失败（本次基线验证实测 2 个 flaky，单文件跑 37/37 通过）；这不是产品回归，但基线命令必须固定串行。

日志：

- `D:\dsh\_rc3-channel-test2.log`
- `D:\dsh\_rc3-writegates-test.log`
- `D:\dsh\_rc3-tsm-test.log`

## 2. 这组夹具保护的不变量

| 不变量 | 由哪组 spec 保护 |
|---|---|
| 子代理必须走受限 preset（allow 集空 = 不可用） | subagent-channel |
| 一次 run 完成 → `ok`；完成但无 structured → `no-structured`；aborted 分离 | subagent-channel |
| 双轮 `open → continue → dispose` 的 childId/stopReason/text 语义 | subagent-channel |
| 写门禁顺序：参数 → missing → policy → read-before-write → confirm | write-gates |
| 确认 gate 的 `ask` 路由与取消/超时 | write-gates |
| create/update/patch 的严格作者门、extract 的 dry-run/apply | tool-skill-manage |
| 用户可见 action 的成功/失败形状与 message 关键词 | tool-skill-manage |

## 3. 未纳入本轮实测（后续 Phase 补）

| 范围 | 原因 | 补的时点 |
|---|---|---|
| merge 全量 pre-tag（148 spec） | 本机裸跑 13+ 分钟未结束，detached run 临时文件 EPERM/ENOENT；不是“已验” | pre-tag lane / Phase 2 前用 tier 跑 |
| evolution-review / maintenance / curator | 依赖子代理通道；Phase 2 后回归 | Phase 2 |
| 客户端 UI（menu/modal/tabs/workbench） | 需要 rc.3 真机（npm `next` 安装）；当前没有运行中的 rc.3 宿主 | Phase 5 |
| rc.3 真机 | rc.3 未上 npm，只有源码 worktree | Phase 1 末/发布门 |
| 全量 lane gate | 0.49.0 证据已存在；Phase 0 不重跑 | Phase 7/发布门 |

## 4. 后续 Phase 的夹具要求

- **Phase 1（端口）**：新增端口时序测试（服务晚挂载/消失）、`ensureRestrictedPreset` 不同 key 并发测试；旧 75 必须保持绿。
- **Phase 2（子代理内核）**：把 `run/open/continue` 的输入→输出写成 JSON fixture（成功/无 structured/失败/取消/非 completed），新旧路径对拍。
- **Phase 3（技能管线）**：每个 action 一个 fixture（参数、plan、结果、journal/usage），preview/apply 共用 plan 的证据。
- **Phase 4（组合）**：生成物语义 fixture（行 id 集、依赖闭包、install 归属）；不做字节比较。
- **Phase 5（客户端）**：rc.3 一张真实 UI 截图 + console 无 slot crash（DCR-2）；不把单测当 UI 验收。
- **Phase 6（错误）**：失败路径 fixture（平台缺服务、超时、取消、守卫拒绝、LLM 限流）。
- **Phase 7（包边界）**：依赖图/导出清单 fixture；架构规则脚本。

## 5. 复现前提

- mirror 是发布载体，缺平台依赖；测试在 overlay `D:\line-b6\packages\evolution` 跑。
- 当前 overlay 的源码需与 mirror 同步；本文件的 75 个用例是在 2026-11-16 将 3 个改动文件复制到 overlay 后跑的。
- `pnpm exec vitest` 从 overlay 根运行；spec 路径用 `packages/evolution/...`。


