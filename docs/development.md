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
node packages/scripts/gen-gate-manifest.mjs
node packages/scripts/gen-checks-fact.mjs
node packages/scripts/verify-probes.mjs packages
node packages/scripts/verify-traceability.mjs packages --strict
node packages/scripts/run-gates.mjs local --only gate-XX
```

- 改 action/脚本后，先重生成 manifest，否则门禁会判 stale。
- `verify-traceability --strict` 是 52 项覆盖账本；不要用 alias 过。
- probe 的 mutation 锚点必须唯一；红 baseline 不能证明 mutation。
- 文档 canonical facts 在 `packages/scripts/family-facts.json`；一个事实只有一个 home。

## 4. 文档规则

- 用户文档在 `README.md`/`README.zh.md`/`INSTALL.md`/`docs/`；包文档在各包 README。
- 不复制事实：安装形态、命令表、参数表、事件表、平台线各有唯一 home；其它文档引用。
- 过时内容直接删，不要保留“历史版本”段落；历史在 CHANGELOG/git。
- 命令/参数以代码注册为准，不以 README 为准。

## 5. 加一个功能

### 加参数

1. 在 core `params.ts` 注册（id、namespace、exposure、type、默认值）。
2. 在消费包 Config 里声明同名键；E3 才会进设置卡。
3. 设置页生成物 `generated-params.ts` 由脚本重建；不要手改。
4. 更新 `docs/configuration.md` 和包 README。

### 加工具

1. 用 `ctx.tools.register` 注册（apply + effect）。
2. 写清 schema、isConcurrencySafe、权限/审批路径。
3. 写工具不得绕过 core write-gates。
4. 更新命令手册 §模型工具。

### 加面板

1. 用 `registerSidebarPanel` / `settings.section`。
2. 路由路径先加到 core `HOST_ROUTES`，再生成 client-kit 镜像。
3. 只读面板不要把写操作做成按钮；写操作给命令复制或明确审批。

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
