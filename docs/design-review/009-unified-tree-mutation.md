# 009 — 统一技能树变更内核（unified tree mutation kernel, design）

Status: 设计声明，2026-09-01 起草。触发：P1-3 问题合集（P1：合并执行层 package-integrity 检查缺失、自动审查注入冲突；P2：c 式 demote 无执行面、写入放大；P3：无锁并发无守卫挂载点）——这些问题的共因集中在**确定性执行面（act seam）**：每个 mutator 各自复制"校验→两阶段写→回滚→审计→事件"，操作形态单一，结构完整性无人负责。

## 问题到层级的映射（先分层，再定方案）

| 问题 | 层级 | 归类 | 处置 |
|---|---|---|---|
| ① 合并执行层无 package-integrity 机械检查 | act（执行前校验层） | **一致性缺口：结构完整性无统一校验** | 内核校验通道 + 完整性校验器 |
| ①b 自动审查注入中断主任务 | deploy（通道回退策略） | **配置面缺口**（reviewMode fallback 未配置化） | **独立**：`skillReviewTrigger:'completion'`（已给方案，不属内核） |
| ② c 式 demote 无执行面 | act（操作语义） | **形态缺口：consolidate 只有 append 一种形态** | 内核 + `mode:'append'\|'reference'` 参数化 |
| ③ 写放大（A2 每读一写） | sensing（信号写入频率） | **域不同：频率与精度分层** | **独立**：维持观察项；真实体感加聚合节流（不属内核） |
| ④ 无锁并发（1-1/6） | act（前置守卫） | **无统一守卫挂载点** | 内核 preconditions 挂载点（实现延后至触发条件） |
| release-log 定案项（2/3-3） | — | 已定案 | 不涉及 |

## 架构（一个内核 + 两条独立线）

```
skill store mutators ──► SkillTreeChange 内核（applyTreeChange，单一提交点）
                          │  preconditions（方向守卫挂载点，当前空）
                          │  预读 previous（回滚素材，内核持有，调用方不可编造）
                          │  validate 通道：保护(protection 模式) + 语义校验(调用方) + 通用校验
                          │     ├─ supportLinkIntegrity（引用完整性校验器，纯函数）
                          │     ├─ 字节/字符限量 + scanContentThreats（每 write）
                          │  两阶段写（全部成功后提交）
                          │  失败回滚（逐字节恢复；previous null → remove）
                          │  audit（before=预读/after=写入值）+ notifyMutation（单一事件出口）
                          │
     sensing 独立线：skill-usage 观察写放大（不并入内核，域不同，维持观察）
     deploy 独立线：review 通道配置（不并入内核，配置面）
```

## 内核 API（core 内部，不导出；经 SkillLibrary 公开方法测试）

```ts
interface TreeWrite { target: string; content: string }           // 数据面
interface TreeChangePlan {
  name: string
  origin: WriteOrigin
  protection: 'write' | 'delete' | 'none'                          // write=writeProtection; delete=deleteProtection
  writes: TreeWrite[]                                              // 顺序即提交顺序（SKILL.md 最后）
  validate?: (ctx: { dir: string; currentMd: string | null }) => string | null   // 语义校验（源存在/目标池等）
  preconditions?: Array<(ctx: { dir: string }) => Promise<string | null>>         // 方向守卫挂载点（R1-1）
  integrityCheck?: boolean                                          // 批量结构操作开（consolidate/demote/restructure），单文件编辑(patch)关
  auditAction: string
  auditSummary: string
  eventAction: string
}
async function applyTreeChange(plan: TreeChangePlan): Promise<SkillActionResult>
```

内核固定序列（每个 mutator 不再各自复制）：
1. `badName` + 存在性（`requireExisting` 由 protection 语义隐含）→ 2. protection 检查 → 3. preconditions → 4. 预读全部 writes 的 previous（`readText` catch null；**调用方无权传入 previous**——防止编造回滚素材）→ 5. validate 通道（调用方语义 + integrityCheck 时 `supportLinkIntegrity` + 每 write 限量/威胁）→ 6. 顺序写 → 7. 任一失败：reverse 恢复（previous null → remove）→ 8. audit（before/after 用预读+写入值）→ 9. `notifyMutation({ action: eventAction, name, filePath: dir })`。

## 引用完整性校验器（纯函数，可单独测）

```ts
/** body 中 references/templates/scripts/assets 相对引用的悬空问题。 */
function supportLinkIntegrity(content: string, dir: string): string[]   // 返回问题行文案
```
- 语义：扫描 body 中 `(references|templates|scripts|assets)/<file>` 相对引用，校验 `join(dir, ref)` 存在；缺失即问题。
- 作用域：**批量结构操作**（一次改多文件：consolidate/demote/restructure）开启；**单文件编辑（patch/update）豁免**（模型逐步编辑的完整性由自身负责，与 008 判断层边界一致）。
- 对 ① 的行为：`consolidate(mode:'append')` 时 source 含支持文件或 body 相对引用（文件随源归档后悬空）→ **拒绝**：`Consolidation rejected: source X carries support files / relative links — use mode:'reference' or archive whole package instead.`——修复即"拒绝 + 指引"，与原版 Package integrity 规则的"安全路径"选项对齐。

## 形态参数化（② 的落位）

```ts
async consolidate(target: string, sources: string[], origin: WriteOrigin = 'foreground', options?: { mode?: 'append' | 'reference' }): Promise<SkillActionResult>
```
- `'append'`（现状语义，兼容默认）：source body 追加进 target；**integrityCheck 开启**——检测到风险即拒绝（指引 reference）。
- `'reference'`：source 的 SKILL.md body（去 frontmatter）写入 `target/references/<source>.md`，source 整包归档（absorbedInto）；**source body 内含支持目录相对链接 → 拒绝**（引用会随归档失去归属，demo 层 re-home 改造明确不做——LLM 判断层职责，另题设计）。
- 公开面：nominator 输出加可选 `mode`（模型可见；默认 append）；review/tool 的 `absorbed_into` 语义不变。

## 迁移策略（风险岛，测试金矿=存量绿测）

- **009-I（低风险核）**：内核 + `consolidate` 重构为 plan 构造器 + 完整性校验器。行为变化点=含引用 source 的 append 合并被拒绝（**这是修复本身**）；存量 consolidate 测试（>5 用例）是回归金矿；新增：完整性拒绝（support 文件/相对链接两态）+ 回滚仍绿。
- **009-II（中风险）**：`mode:'reference'` 执行面 + demote 用例 + nominator/prompt 的 mode 字段。
- **009-R（纯重构，随 I 或独立）**：`restructure` 迁移到内核（零行为变化；测试全绿为验收）。
- **archive 不迁移**（单文件 move+counterfallback，改造收益低于风险，保持独立——文档留痕）。
- 顺序：I → R → II；每批 main-only，CI 双绿，无版本动作（延续 008 程序纪律；总程序完成后一次性 0.2.0）。

## 边界与否决（明确不做）

- 写放大（sensing）与审查注入（deploy）**不进内核**——域不同，各自已有方案（观察项 / 1 行配置）。
- re-home（把 source 支持文件复制进 target 并重写链接）**不做**——LLM 判断层职责，与"自动重写从不扫库"边界一致；本方案只做"拒绝+指引"。
- verifyPromptBundle / 3-3（create-new-umbrella 边界）维持定案。
