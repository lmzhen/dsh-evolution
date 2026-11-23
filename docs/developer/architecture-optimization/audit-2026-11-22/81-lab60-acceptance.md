# 0.60.0 候选真机验收记录（lab60）

## 候选

- 源：`D:\dsh\harness-rc3` overlay；measured family commit `c11f59df`；
- 打包：`prepare-release.mjs --scope @lmzhen --version 0.60.0`（正式 pack），20 个 tarball；all tarball sha256 `200514eece4bd19f8dfa2ccddc4c41ce9c6946daa80ec5237ffb7994f0477cf7`；
- 安装：`install-layered.mjs --from-dist packages/evolution/dist --home D:\dsh-homes\lab60 --profile web --mode all`，复制 20 个包；
- 宿主：全局 `dsh --profile web --port 3091`，平台版本 0.2.2-rc.5；
- 状态：`/evolution migrate state` 已执行，store=71 bytes，marker 存在；重启后 auto 使用 store。

## 真机证据

| 项 | 结果 |
|---|---|
| 家族包 | 20/20 复制到 profile；`doctor --json` `installForm=full`、`bundles=@lmzhen/dsh-evolution-all`、`family-version=0.60.0` |
| 服务 | `doctor` services review/curator/approval/skillUsage/io 全部 true；`capabilityAbsence=[]` |
| 技能整理页 | 标题、技能 / 数据总览 / 待我确认 / 合并建议 四个 tab 均加载 |
| 数据总览 | 1440/1024/390 三档截图；390 下卡片单列、无横向溢出 |
| 待我确认 | 空状态文案正常 |
| 合并建议 | `/api/dsh-evolution/merge/view` 200；首次 fresh home 自动 bootstrap 了 schema4 + pre1b backup，页面不再 503 |
| 迁移命令 | `/evolution migrate state --dry-run` 成功返回 review=0/pending=0/curator=no；实际迁移写 store + marker |
| 重启 | 迁移后重启宿主无 activation 失败，auto 选 store，页面继续可用 |
| 截图 | `D:\dsh\_after_store_1440.png`、`D:\dsh\_lab60_1024.png`、`D:\dsh\_lab60_390.png` |

全量 family 套件（最终 HEAD）：448 files / 2457 tests passed（1518.48s）。

合并 scan 在无模型 key 的隔离宿主上启动后进入 `failed`（screening 阶段），不是 state bootstrap 失败；合并页 200 已证明状态可读。真实模型合并需另配 key 的宿主，不在本候选的 UI 验收范围。

## 本轮修复的启动/新装 P1

1. **IO provider 就绪竞态**：`authority-plugin` / `state/store-plugin` 只 inject 了 `evolutionIo` registry，registry 在 provider 注册前就存在，导致 `apply` 拿到空 provider。新增 `EvolutionIoRegistry.whenReady()`，两个插件 `await` 后再构造。
2. **命令处理器 ctx 无服务**：`/evolution migrate state` 在真实 command context 上 `ctx.get('evolutionIo')` / `ctx.evolutionStateStorage` 不可用（restricted child）。改为 `ctx.inject(['evolutionIo','evolutionStateStorage'], scoped => ...)`，并在 scoped context 上迁移。
3. **auto + marker 的 mount 顺序**：`EvolutionState` 构造时 store provider 尚未注册，看到 marker 就抛 “no store provider registered”。auto 的 marker/store 校验改为第一次状态操作时执行；mount 阶段只校验固定 pin。
4. **fresh merge bootstrap**：新 home 无 `merge/` 目录时，readiness 读不到状态、state lock 无父目录、pre1b backup 把 `reports` 目录当文件读。修复：
   - missing parent 的读返回 null 而非 needs-repair；
   - bootstrap 先创建 merge 子目录；
   - pre1b `walk` 用平台错误/“not a regular file” 判定目录；
   - `migrateMergeStateToV4` 直接走 `normalizePairLedger`（不再先让 v3 gate 把 schema4 判成 forward-only）。
5. **fresh merge 测试**：`row-tx-transact.spec` 增加空 home bootstrap 用例。

## 未完成

- 正式 release pack 需要 bump 全部 manifest 后重新打包（当前是 dev-build 0.60.0 候选，不能直接当最终产物）；
- S1–S4/traceability release evidence 已在最终 dist 上记录（rehearsal 绑定 `c11f59df` 与 all tarball sha256）；正式发布仍走 CI 证据装配；
- 独立复核最终 HEAD 确认 P0=0 / P1=0；
- D1c domain fallback、P2 台账中的 defer 项按 `80-p2-ledger.md`。

## 复核后修复（P1）

- legacy v2/v1 → v4 迁移重新经过 v3 gate，再 normalize；新增 `state-migrate-v4.spec` 验证 v2 迁移；
- v3 pending journal 也必须先过 v3 gate；新增 journal repair 用例；
- readiness 使用 `probeText` 三态：unreadable 返回 `merge-state-needs-repair`，不再把未知读成空状态；目录/不可读测试覆盖。
