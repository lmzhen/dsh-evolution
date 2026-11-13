# 开发：改这个家族前先知道的

## 1. 两种布局

- **mirror**：`packages/` 扁平布局，发布载体。`package.json` 可能指向 `lib/`，构建后才存在。
- **overlay**：`packages/evolution/`，CI/本地测试用；平台依赖和 `node_modules` 在这里。

镜像里的 `@deepseek-ai/*` 名字发布时改成 `@lmzhen/*`；不要手改生成物。

## 2. 构建/测试

```bash
cd dsh-evolution-mirror
node packages/scripts/build-lib.mjs
pnpm exec vitest run <spec> --maxWorkers=1
```

- 真实宿主/overlay 测试在 overlay 里跑；mirror 缺平台依赖。
- 测试分 tier：fast / pre-tag / ci-only；不要为了快把 ci-only 改 fast。
- 共享文件被多包覆盖时，先看 `@tier` 与 spec 的 fixture 边界。

## 3. 门禁

```bash
node packages/scripts/gen-gate-manifest.mjs        # registry -> gate-manifest.json + CONTRIBUTING 表
node packages/scripts/gen-checks-fact.mjs
node packages/scripts/verify-probes.mjs packages
node packages/scripts/verify-traceability.mjs packages --strict
node packages/scripts/run-gates.mjs local --only gate-XX
node packages/scripts/run-gates.mjs local --lane ci-static --concurrency 4 --overlay <line>
```

- **门的唯一源是 `packages/scripts/gates/registry.mjs`**（四个域文件 + helpers）：改门先改那里，再跑生成器；`gate-manifest.json` 与 CONTRIBUTING 表都是生成物，手改会被 `--check` 判 stale。
- 每行有 `lanes`（`local`/`pre-tag`/`ci-static`/`ci-unit`/`ci-release`/`ci-windows`/`ci-setup`）；CI 的 action 按 lane 调 runner，不再维护第二份命令列表。CI 专属实参/环境写在该行的 `ci:{argv,env,cwd}` 覆盖里（只在 CI 生效）。
- `--concurrency N`（默认 1）打开有界并发，`--fail-fast` 在首个 fail 后不再启动新行；`--json-out <path>` 写逐行 verdict 工件（CI 上传为 `evolution-gates-*`）。
- 改 action/脚本后，先重生成 manifest，否则门禁会判 stale。
- `verify-traceability --strict` 是 52 项覆盖账本；不要用 alias 过。
- probe 的 mutation 锚点必须唯一；红 baseline 不能证明 mutation。**改了 mutation 目标文件后必须重跑 probes 重签账本**（否则 `verify-check-registry` 的 mutation-coverage 轴会红）。
- 文档 canonical facts 在 `packages/scripts/family-facts.json`；一个事实只有一个 home。

## 4. 文档规则

用户文档在 `README.md`/`README.zh.md`/`INSTALL.md`/`docs/`；包文档在各包 README。跨文件事实先登记 `packages/scripts/family-facts.json` 的 home，再决定写哪里。

| 事实 | 唯一 home | 其他文档的写法 |
|---|---|---|
| 安装形态对会话的精确影响 | `packages/INSTALL.md` | 根 README 与 `INSTALL.md` 只保留选择摘要并链接 |
| 命令注册与用户用法 | 注册事实在 `evolution-commands/src/registry.ts` 和 merge 的命令定义；用户说明在 `docs/commands.md` | 其他文档只列常用入口并链接，不另维护全量表 |
| 参数 id、默认值、分组和生效时机 | core `params.ts` 及生成物 | `docs/configuration.md` 只写用户可改项和边界 |
| 功能触发、条件与限制 | `docs/features.md` | 入门和索引引用，不重复整套规则 |
| 数据路径、备份、升级后恢复 | `docs/operations.md` | 其他文档链接，不复制路径表 |
| 包职责与持久数据分工 | `docs/developer/architecture.md` | 包 README 写包内机制，不另画全家族数据图 |

- 中英文 README 表达同一事实和边界；修改一侧时必须同步另一侧。
- 过时内容直接删，不要保留“历史版本”段落；历史在 CHANGELOG/git。
- 命令/参数以代码注册为准，不以 README 为准。

## 5. 加一个功能

### 加参数

1. 在 core `params.ts` 注册（id、namespace、exposure、type、默认值）。
2. 在消费包 Config 里声明同名键；E3 才会进设置卡。
3. 设置页生成物 `generated-params.ts` 由脚本重建；不要手改。
4. 用户可改参数更新 `docs/configuration.md`；包内机制写入包 README。默认值只在各自 home 保留一份。

### 加工具

1. 用 `ctx.tools.register` 注册（apply + effect）。
2. 写清 schema、isConcurrencySafe、权限/审批路径。
3. 写工具不得绕过 core write-gates。
4. 更新命令手册 §模型工具。

### 加界面视图

1. 页面/侧栏入口由 `evolution-ui` 的 workbench 页持有；新功能用 `registerWorkbenchView` 注册到 `evolution.workbench.view` 子槽，不要再注册 `sidebar.panellist`/`main` 或自建 `settings.section`。
2. 参数编辑只走平台 `settings.plugin.item`；读写都走平台 `configForms`（family 不再有 `/api/dsh-evolution/settings/*` 路由）。
3. 路由路径先加到 core `HOST_ROUTES`，再生成 client-kit 镜像。
4. 只读视图不要把写操作做成按钮；写操作给命令复制或明确审批。

### 加包

- 先判断是否真的需要新包：优先放进已有能力边界，不要按文件拆微包。
- 新包必须有：`package.json`（name/exports/engines/dsh 如适用）、`src/index.ts`、README、tests、probe（如适用）。
- 新包要进 bundle row / 依赖闭包 / 发布清单；不要只加目录。

## 6. 合并/提交前

- [ ] 没有 runtime src 变更时，说明是文档/测试/工具变更
- [ ] `git diff --stat` 看过；生成物没有手改
- [ ] 相关 spec + 组测试通过
- [ ] strict traceability / verify-probes 通过（如涉及 probe）
- [ ] 文档与代码一致；过时段落删除
- [ ] 不把内部实验路径/临时报告提交
