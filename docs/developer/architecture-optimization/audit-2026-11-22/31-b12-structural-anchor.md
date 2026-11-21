# B1-2 部分：结构写入输入树绑定 + delete 预览

范围：02-tool-skill-manage P1-2 的第一步。目标：审批预览与回放至少绑定同一组输入字节，避免“批准时重读当前库”落到另一份树；delete 不再盲批。

## 1. 已读依据

- `audit-2026-11-22/02-tool-skill-manage.md:46-52`：delete/restructure/extract 无 plan/anchor；extract 预览与回放不同字节；restructure 预览不可用。
- `packages/tool-skill-manage/src/index.ts`：
  - staging 只为 update/patch/write_file/remove_file 写 `staged_from_sha256`；
  - `planFromStaged` 不覆盖 delete/restructure/extract；
  - `previewSkillWrite` 对 delete/restructure 返回 no preview；extract 预览按 staged 时字节计算。
- `SkillLibrary`：`read`/`listSupportFiles`/`readSupportFile` 三态；`archive`/`restructure`/`extract` 在回放时从当前库重读。
- `approval-preview.spec.ts` 现有 preview 真实注册测试。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 结构动作回放重读当前树 | I4 因果顺序/I7 | 操作者批准的是暂存时字节，回放可能执行另一棵树；delete/restructure 还盲批 | 仅结构动作的审批回放；不损坏未审批内容 |

完整修法是 PlanService 把结构动作也 plan 化；本轮先做**输入绑定**（tree digest）和 delete 预览，作为可独立回退的安全收敛。

## 3. 设计

### 3.1 tree digest

新增 `stagedTreeDigest(library, names)`：

- 对每个 skill：
  - body：`read(name)`；null → `absent`；
  - support：`listSupportFiles(name)` 三态；unknown → 整体 unknown；
  - 每个 support path 排序后 `readSupportFile`，null → absent；
- 汇总为 `contentHash(parts.join('\n'))`。

staging（delete/restructure/extract）：
- names = 目标 skill；extract 额外收集 `extract[].to_skill`；
- digest 不可读 → 拒绝暂存；
- `operation.staged_tree_sha256 = digest`。

replay：
- action 是结构动作且 args 带 digest；
- 重新计算 digest；不一致 → `SKILL_STALE_VERSION: 结构写入的输入树...`，不执行。

这保证“预览时读到的树”和“回放时读到的树”同一组字节（预览本身仍由 staging 时库计算）。

### 3.2 delete 预览

`previewSkillWrite` 对 `delete`：
- 读当前 body；absent → unavailable；
- 返回 `{available:true,path:'SKILL.md',before,after:null}`。

### 3.3 未完成

- restructure 仍无字节预览（需要导出 restructure planner/projection）；
- extract 的完整 `ExtractPlanDraft` 仍不在 pending 中，回放仍重新 build；
- 因此 B1-2 仍不能标记 fully closed；本轮只消除输入树漂移和 delete 盲批。

## 4. 测试

- `approval-preview.spec.ts`：delete 预览 before=BODY、after=null。
- `approval-preview + tool-skill-manage`：53 tests passed。
- tree digest 的拒绝路径由代码+现有结构动作测试覆盖；后续 PlanService 组补 staged→mutate→approve 的端到端负例。

## 5. 实现结果（2026-11-22，未发布）

- 新增 `stagedTreeDigest`；delete/restructure/extract 暂存写入 `staged_tree_sha256`，回放重算比对。
- delete 预览返回 before body / after null。
- approval-preview + tool-skill-manage：2 files / 53 tests passed；build 0。
- B1-2 仍未 fully closed：restructure 字节预览、extract 完整 plan 待 PlanService 组。
