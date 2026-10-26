# 需求裁决记录（A1–A17，2026-10-25）

> 依据：artifacts/audit-0.30.18/requirements-inventory.md §4；优先级 D1–D13 > v2/v2.1 > v1 > wire（字段）> gates > integration。
> 本表把审计发现的 17 条文档矛盾逐条裁成唯一口径，并记录回写位置。

| # | 裁决 | 回写位置 |
| --- | --- | --- |
| A1 | undo 的 --run 必填，省略不猜最新；v1 的可选文本作废 | v1 FR-LIFE-06/FR-SCOPE-10/变更记录；v2 冻结于 V2-LIFE-01 |
| A2 | skipped 到期标 expired、不删、不自动复活；计入 counts.expired | v1 FR-LIFE-15/FR-DATA-08/§2.13/变更记录；v2 §10.2；wire §15.1 |
| A3 | cancel 无 id 只停 merge run（全部），不误伤其它 kind | v1 FR-SCOPE-10；v2 GAP-CMD-05 |
| A4 | disabledReason 闭集：expired/invalid/not-retryable/source-gone/owned/unavailable | wire §9/§15.2；v2 §10.1 |
| A5 | confirm：reject/discard/restore/pair=true；approve/retry=false；status/report/cancel=false | wire §9/§15.2；v2 §10.1 |
| A6 | CommandSurface 以 wire §10 为准：wireVersion/prefix/commands/fallback；CommandSpec 含 rowActions/defaults，无 actions/inputSchema | v2 §10.1；wire §10 |
| A7 | 7 个只读信封是投影；panel 只 4 条 GET（view/rows/body/history）；RunView/RunDetail/RunsView 不要求 HTTP；DoctorView 走全局 doctor | v2 §10.1/NFR-09/GAP-QUERY-01；wire §2/§15 |
| A8 | NFR-09/10 优先级定为 P1 | v2 §5 |
| A9 | V2-* 是变更记录，GAP-* 是验收权威；同主题只按 GAP 计分，不重复 | v2 §10.1 去重注 |
| A10 | “覆盖”分真改写/仅适用；真改写按 v2，适用/细化按 v1+补充判据 | v2 §10.1 去重注 |
| A11 | v1 §2.13 的“唯一裁决面”降为“未被 D/v2 改写时有效” | v1 §2.13 |
| A12 | 0.30.18 是实际交付基线，已含 wire v1/v3/UI 与 /merge；0.31/0.32 仅为历史计划标签 | v2 §10.5 表后注 |
| A13 | v2 P1 组接受 gate 覆盖 + 已知 P2；按 gates §0 补正式 waiver：fallback/risk/re-gate 见 gates §13.1 | gates §13.1；RG8 result.waiver |
| A14 | approved 归 fuse 队列，active.fuse 含 approved；queue=fuse 同时返回 approved+fuse | wire §4/§5；v2 §10.2 |
| A15 | skipped-ttl expired 计入 counts.expired；queue=skipped 普通页也返回它们；expiredOnly 仍只对 pending | wire §4/§5；v2 §10.2 |
| A16 | D2 的 parser/help 归属改为 ADR-3（v2 §10.1/wire §10），不是 D9 | merge-design-decisions.md D2 |
| A17 | /merge 在 0.30.18 保留，0.31 弃用提示，0.32 删除；GAP-WIRE-03 的“无 /merge”只适用于 0.32 | v2 GAP-WIRE-03；wire §15 |
| A18 | 错误行数按 NFR-07 分层：语法/形状错误两行，运行期错误三行；FR-SCOPE-03/04、GAP-CMD-02 中“参数错两行/错误 id 两行”按此改写，不再要求运行期错误压成两行 | v1 FR-SCOPE-03/04、GAP-CMD-02；NFR-07 |
| A19 | 避免过度门禁：删去不可观察或纯实现细节的判据（forced=false、固定 20 数量、§8 文档项、二次准入的结构证明、8+3 分支矩阵、merge 级 crash 精确注入），保留行为不变量；以封闭 rule 集、真实 merged outcome、unit-written crash、candidates retry 成功路径等更宽但可复验的证据保证质量 | FR-SCOPE-04/10、FR-EXEC-13、FR-VAL-01/07、FR-LIFE-05、FR-UI-07、GAP-UI-02、GAP-P0-03、GAP-CMD-02、GAP-VAL-03 |

## 结论

A1–A19 已全部裁成唯一口径并回写。A13 是发布范围豁免，不代表 P1 已实现；P1 缺口仍以 0.30.18 审计报告为准。A19 删除不可观察/纯实现细节判据，保留行为不变量；不改变已交付行为。
