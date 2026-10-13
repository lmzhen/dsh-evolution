# 单元、可逆与路标（skill history 的内容侧契约）

一次**树改动**（重构/搬段/删除支持文件）会在技能的历史索引里留下**多条**记录。本页说明这些记录
如何被归成**一个单元**、这个单元如何**整体撤销**、以及当单元**跨技能**时如何路由与判定。

> 面向：改 `evolution-core` / `evolution-curator` / `evolution-skill-history` 的人；
> 以及要判断"这次撤销是否安全"的运维者。**不覆盖**目录/索引的物理布局。

## 1 一个单元 = 一次树改动

- 一次树改动铸 **一个 `unitId`**，它写下的**每个路径**都带上这个 id（同 id 的记录＝同一单元）。
- 索引里每个单元只有**一条**记录携带 `unitHead`（"单元头"），其余记录只有 `unitId`。
- `unitHead` 有且只有**两种形态**，互斥：
  - **代表性片**：`{ moves, sources }` —— `moves` 是该单元的**全量清单**（逐条：`path`、`kind`（`created`|`moved`）、`to`、`beforeRef`（此前不存在则省略）、`afterRef`），`sources` 列出它写过哪些技能；
  - **路标**：`{ skill }` —— 只说明"这个单元的记录在**另一个技能**的索引里"。
- **判别式永远是 `unitHead.moves !== undefined`**（路标也带 `unitId`，拿它判别必错）。
- 写入端两条硬规则：`kind` 判 **`previous === null`**（不是 `undefined`）；`path` 抄循环里既有的
  `rel`，**不要**自己拼路径。同一目标写两次时，清单保留**最后一次**写入的 `afterRef`。

## 2 撤销：`undoUnit`

- 逐路径的"回哪份字节"＝**该单元为这个路径铸的基线**；没有基线才回退到**最早**那条之后记录的
  `beforeHash`（用**最新**那条的 `beforeHash` 会把文件回退到单元中间态 —— 正是要防的"半切"）。
- 路径在单元前**不存在** ⇒ 撤销＝**删除**，并锚定在**最新**那条记录上（别人手改过就**拒绝**，不删）。
- 决策是**纯函数**（`packages/evolution-curator/src/unit-undo-plan.ts`），IO 与主机不进决策层。
- 任何无法判定的情形 ⇒ **拒绝并点名对象**，**不得**用剩下的片段拼一个撤销。

## 3 跨技能单元与孤路标

- 成员解析**只按已知 key** 打开索引（`sources[]`；代表片自身在首位、去重），**禁止目录扫描**。
- 三向校验用**各片自己的 `moves`**：`∪各片 ⊇ 清单` ⇒ `missing`；每片 ⊆ 清单 ⇒ `foreign`；同一 `path`
  出现两次 ⇒ `duplicated`。任一项非空 ⇒ 调用方 **CANNOT DECIDE 并点名**。
- **可跳判据**（路标）＝ **目标技能存在**（其索引可读）**∧ 该索引仍持这个 `unitId`**；不可跳即
  `stale-route-stub`，逐条点名 `{skill, v, owner, reason}`（`owner-absent`／`unit-absent`）。
- 路标的 `undoable` 是 **`undefined`**（该键在 wire 上**不出现**），**绝不为 `false`** —— `false` 等于
  宣称"本索引能证明它不可撤销"。聚合时**跳过路标**，否则它的 `hash` 会污染同单元兄弟片的判定。

## 4 剪枝

- 剪枝**按单元**（all-or-nothing）：保留窗口（默认 20 条）只保留**最后一个单元**是常态；跨单元的
  记录不会各留一半。
- 计数口径：今天 `keep` 仍按**条目**计；若将来观测到"超过窗口且出现跨条单元"的比例升高，才切换
  到按单元计（判据与工具见下）。

## 5 读数与验证

```powershell
# 家族 spec：唯一入口 + 按文件跑（整目录会出 5s 假红）
Set-Location D:\dsh\deepseek-harness
npx.cmd vitest run -c D:\dsh\_tools\vitest-family-preflight.mjs unit-head unit-members
# 语料侧的剪枝口径审计（条目/单元/豁免/最大片数）
node D:\dsh\_research\skill-graph-design\tools\a3-audit.mjs
```

- **孤路标读数**已进 curator 运行报告（`routeStubs: { skills, stubs, reason, detail }`，**只读报告、
  不构成门禁**；判红须先入台账并定判据）。
- 语料里若还没有跨条单元（`maxShards = 1`），上述跨技能分支**不会被触发** ⇒ 那几条判据属"观察期"，
  不要因为"没报错"就当已验。

## 6 回退

- 单文件：`git checkout -- <path>`（先 `git rev-parse --show-toplevel` 确认在镜像里改）。
- 单元级：用 `undoUnit` 本身（这就是它的用途）——它拒绝时**不会**留下半成品。
