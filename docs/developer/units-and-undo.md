# 单元、撤销与版本：技能历史的底层规则

这一页面向要改 `evolution-core` / `evolution-curator` / 技能历史的人，解释树改动为何产生多条记录、如何按单元撤销，以及跨技能撤销的安全判定。不涉及目录物理布局。

## 1. 一个单元 = 一次树改动

- 一次改动铸一个 `unitId`，它写下的每个路径都带这个 id。
- 同一单元只有一条记录带 `unitHead`；其余只有 `unitId`。
- `unitHead` 两种形态，互斥：
  - **代表片**：`{ moves, sources }`，`moves` 是全量路径清单，`sources` 是写过的技能。
  - **路标**：`{ skill }`，只说明“这个单元的记录在另一个技能的索引里”。
- 判别式永远是 `unitHead.moves !== undefined`；不要拿 `unitId` 判别。

## 2. 撤销：回哪份字节

- 每个路径回“该单元为它铸的基线”；没有基线才回退到最早记录的 `beforeHash`。
- 用最新记录的 `beforeHash` 会回到单元中间态，这是要避免的“半切”。
- 路径在单元前不存在：撤销=删除，并锚定最新记录；别人手改过就拒绝。
- 决策是纯函数；任何无法判定的情形都拒绝并点名，不拼碎片。

## 3. 跨技能单元

- 成员解析只按已知 key 打开索引，禁止目录扫描。
- 三向校验：并集缺项=missing；片内多出=foreign；同路径重复=duplicated；任一非空则 CANNOT DECIDE。
- 路标可跳的条件：目标技能存在且索引仍持这个 `unitId`；否则 `stale-route-stub`。
- 路标的 `undoable` 是 `undefined`（wire 上不出现），不能写 false；聚合时跳过路标。

## 4. 剪枝

- 按单元 all-or-nothing；保留窗口默认 20 条。
- 当前 `keep` 仍按条目计；如果观测到跨条单元比例升高，再切到按单元计。

## 5. 验证

```bash
# 家族 spec：按文件跑，别整目录
pnpm exec vitest run <unit-head/unit-members spec> --maxWorkers=1
```

- 孤路标读数进 curator 报告（`routeStubs`），只读，不构成门禁。
- 语料里没有跨条单元时，跨技能分支不会被触发；不要因为没报错就当已验。

## 6. 回退

- 单文件：`git checkout -- <path>`（先确认在哪个 checkout）。
- 单元级：用 `undoUnit` 本身。预检拒绝时零写；执行期支撑文件或正文写入失败不做补偿回滚，可能只完成部分路径，结果会列出已回退项，此时应从备份恢复。
