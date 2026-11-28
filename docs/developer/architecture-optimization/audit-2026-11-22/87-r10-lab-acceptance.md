# DCR-85 本机隔离验收记录（lab85）

本页只记录**已经在本机隔离环境里跑过的证据**；未跑的项目单独列在“未完成”，不冒充真机验收。

## 环境

- 安装源：`D:\dsh\dsh-evolution-mirror\packages\dist`，本机重新打包的 0.61.0 candidate；
- candidate 源：mirror HEAD `4bb57856`（含 snapshot restore `.unit-*` 修复）；overlay 先 `build-lib`，再同步 lib 到 mirror 后打包；
- tarball：20 个，`@lmzhen/*`；
- `all` tarball sha256：`288C781911995EB07D60CB51BD8B31740A312C0747D6ACB9C6FDF1FD290671A6`；
- 隔离 home：`D:\dsh-homes\lab-dcr85`，profile `web`；
- 安装命令：`install-layered.mjs --from-dist packages\dist --home D:\dsh-homes\lab-dcr85 --profile web --mode all`；
- 宿主：全局 `dsh`（平台 0.2.2-rc.5），`DSH_HOME=D:\dsh-homes\lab-dcr85`，端口 3099；
- 首次启动约 6–8 分钟（客户端 bundle 首次构建），之后可服务。

## 已验证

| 项 | 结果 |
|---|---|
| profile 依赖 | 只有 `@lmzhen/dsh-evolution-all 0.61.0`；`installForm=full` |
| 安装包 | `node_modules\@lmzhen` 下 **20/20** 包，版本全部 0.61.0 |
| diagnostics | `GET /api/dsh-evolution/diagnostics` → 200；`family-version=0.61.0`；`platform-line=0.2.2-rc.5` |
| merge 状态 | fresh home `GET /api/dsh-evolution/merge/view` → 200，`wireVersion=1`；不是 503 |
| v2 迁移 stage | `/evolution migrate state --to v2` → success；结果提示重启后激活、重启前旧介质可写 |
| 重启激活 | 重启后 `evolution/state/.migrated-to-store-v2.json`：`mode=store-v2`，`generation=1795704000718`，`commitId=d53f2f02e048…`；`evolution/store-v2/head.json` 存在 |
| 激活后读 | 重启后 `merge/view` 仍 200、`diagnostics` 200（family-version 0.61.0） |
| 回退 | `/evolution migrate state --revert` → success；marker 改为 `mode=legacy`，`generation=1795704000719`，保留 `commitId/lastActiveCommitId=d53f2f02e048…`；`store-v2/head.json` 字节仍在（未被删除或回灌） |
| re-stage | 回退后再次 `--to v2` → 重启激活；旧 store 归档为 `store-v2-rollback-1795704000719-1795712504922`，新 marker `mode=store-v2`、`generation=1795712528234`、新 commit；归档 head 仍指向旧 commit `fb17c1e2…`；`merge/view` 200 |
| 技能整理页 | 技能 / 数据总览 / 待我确认 / 合并建议 四个 tab 均加载 |
| 合并建议页 | 打开后计数区显示 待复核/待我确认/待合并/已忽略/已过期 = 0；高级/历史/刷新可见 |
| 响应式 | 1440×1000、1024×768、390×844 截图；390 下 tab 横排、数据总览卡片单列、无横向溢出 |
| 跨进程读 | 独立 Node reader 进程与 writer 进程同时跑：writer 每 10ms 提交一次 feedback，reader 每 10ms 读一次 state，150/150 成功，avg 22.87ms，max 50ms（同一 store 文件，无读者锁） |
| crash-before-commit | 3 次在 writer 提交前 kill -9；head 保持上一提交、`kernel.query(['state'])` 均成功，没有半发布 head |
| crash-after-head | 3 次轮询到 head 已前进后立刻 kill -9；3/3 后续 `kernel.query(['state'])` 成功，head/commit/object 可读，无半发布 |
| Key 空 | `credentials/describe(SILICONFLOW_API_KEY,BAMBOO_API_KEY)` → 两者 `configured:false`、`writable:true` |
| Key 有 | `credentials/set(SILICONFLOW_API_KEY, fake)` → describe `configured:true`、`source:file`、`masked:"sk-fake-••••••••3456"`（不回显完整值） |
| Key 清除 | `credentials/unset(SILICONFLOW_API_KEY)` → describe 回到 `configured:false` |
| 双 host 只读 | 同一 lab home 同时起 3099/3100 两个 host；两者 auth 303、`merge/view` 200、`diagnostics` 200/200 且长度一致 |
| 完整 family suite | CI `cohort validate (0.2.2-rc.5)` 的 gate-03 实际执行 `vitest run packages/evolution -c packages/evolution/scripts/vitest.family.config.mjs --maxWorkers=2`，exit=0，耗时 181615ms；CI 绿即全量 suite 通过，本机重复跑因慢盘 80+ 分钟不作为判据 |

### 截图

- `D:\dsh\_lab85_1440.png`（首页，1440）
- `D:\dsh\_lab85_wb_1440.png`（技能整理-技能，1440）
- `D:\dsh\_lab85_wb_1024.png`（技能整理-技能，1024）
- `D:\dsh\_lab85_wb_390.png`（技能整理-技能，390）
- `D:\dsh\_lab85_stats_1440.png`（数据总览，1440）
- `D:\dsh\_lab85_stats_390.png`（数据总览，390）
- `D:\dsh\_lab85_pending_390.png`（待我确认，390）
- `D:\dsh\_lab85_merge_1440.png`（合并建议，1440）

## 0.61.1 发布后 fresh profile（2026-11-28）

- 发布：`v0.61.1` tag CI（run 46116924926 attempt 2）全绿，20 个包发布成功；`@lmzhen/dsh-evolution-core@0.61.1`、`@lmzhen/dsh-evolution-all@0.61.1` 均可从 registry 读取；未建 GitHub Release。
- fresh home：`D:\dsh-homes\fresh0611`，只复制 profile 骨架与 credentials，`pnpm add @lmzhen/dsh-evolution-all@0.61.1` + `pnpm install --force`；host 3098 启动后 auth=303、`diagnostics`=200。
- 真实 scan：`/evolution merge scan` 返回 200 启动，run `e069a377…` 约 41s 后 `state=failed`；report note 为 `SCAN_FAILED @pipeline: UnreadableError ... node_modules/@lmzhen/models/registry.json (ENOENT)`，即 `mergeModelsRoot` 为空时 fail loud，而不是 Key 错误。
- 把 `mergeModelsRoot` 配到 merge-engine 自带 `vendor/skill-merge-pipeline` 后，doctor 显示 `models [warn] 缺少 int8/pca64`；发布包只带 `models/registry.json` 与 `pca64/`，不带 int8 权重。
- 清掉本机 6 个 11-23 遗留 web host（3091–3096，各累计 ~67h CPU）后复测：fresh 空库 scan 在 1s 内 `succeeded`；3080 也能正常启动并响应。此前的 20+ 分钟无响应主要是这 6 个旧 host 的 CPU 争用，不能归因于 scan body。
- 3080 配置 `D:\dsh\skill-merge\models` 后 doctor `models [ok]`，scan 仍失败，report note 指向 `node_modules/@lmzhen/models/registry.json`。定位为发布包内 engine bundle 的 `defaultRegistryPath()` 按 `lib/../..` 解析，结果落到 `@lmzhen/models`；实际 registry 随包在 `.../dsh-evolution-merge-engine/lib/vendor/skill-merge-pipeline/models/registry.json`。
- 本批修掉 5 个真实缺陷：`engineConfigFromRoot` 补 `models_dir`；`mergeModelsRoot` 改为 scan 时读取 live params；发布 bundle 的 worker 路径多退一级导致静默回退进程内 engine；worker 动态 import 未把 Windows 绝对路径转 `file://` URL；worker `process.disconnect()` 在 IPC 结果落地前关闭，父进程误报 `worker exited with code 0`。
- 另修 engine 打包：`scripts/build.mjs` 把 bundle 内 `defaultRegistryPath()` 指向包内 `lib/vendor/skill-merge-pipeline/models/registry.json`，不再要求外部 `@lmzhen/models`。
- 修复后复测 3080：scan 200 启动，约 3.3s `succeeded`，`scope.candidatePairs=170`，host `merge/view` 持续 200；worker 已真实使用子进程，不再回退进程内。
- 旧 web home `D:\dsh-homes\web` 从 0.59.5 升到 0.61.1 后启动错误仍多，但清理旧 host 后可出 token，说明之前“启动卡死”也混入了 CPU 争用。
- 结论：0.61.1 已发布包仍带上述 worker/registry 路径问题，需 0.61.2；修复源码后真实 scan 可在 3s 级完成且 host 保持可读。Key 错误态仍未取得（本轮 170 候选对未触发检索错误），HMR 未验证。

## 未完成

- 双 host 只读并发已通过（3099/3100 同 lab home，均 200）；host 写 + host 读的并发压力尚未在干净机器复验：外部 writer 高压时出现 host 请求 10s 超时和 head rename EPERM，无法区分磁盘/杀软/两 host 同读争用，未归因到锁，不作为无锁读反例。
- HMR 替换 store service 的真机验证；
- Key 错误态：空/有/清除已通过 credentials RPC 验证；真实 scan 用 fake retrieval key 启动后 host 20+ 分钟无响应，未拿到错误态。该次真实扫描暴露并修复了 P1-REPORTS（merge report 用错 surface，见 80/86）；错误态仍需一次能正常结束的扫描。
- scan 运行形态：engine screen 和 candidate selection 已移子进程，但真实 host 仍在完整 scan body/row/report 阶段 CPU 阻塞 20+ 分钟且事件循环无响应；已确认不是 MVCC 读锁，仍需整体 worker 化，不能宣称 scan 可接受。
- 迁移后重启的**完整** UI 再验收（本轮只做了 API + 迁移/回退）；
- 正式版本确认、tag、唯一一次发布、发布后 fresh npm 安装验收。
