# 全量测试真绿：family config alias 顺序、release artifacts、jsdom 环境

范围：E4 的真实收尾 + E3 装配遗漏 + 测试环境依赖。
- `vitest.family.config.mjs` 虽然打印 alias=1129/1129，但全量套件 441 个文件里 306 个因
  `Cannot find package '@deepseek-ai/dsh-evolution-*/…'` 0 test 失败；
- `assemble-release-evidence` 读取 `--dist` 后没有把 `artifacts` 写进 assembled 文档；
- `sorting-panel.client.spec.ts` 声明 `happy-dom`，但仓库没有安装 happy-dom，`localStorage` 为 undefined。

## 1. E4：alias 顺序

- adapter 的 alias 列表把短前缀放在长 subpath 前；Vite alias 按顺序匹配，`/ports`、`/values` 等被短前缀截走或失去具体替换。
- 修复：在过滤后按 `find` 长度降序排序，长 subpath 先匹配。
- 验证：`approval.spec.ts` 单文件 35 tests passed；全量套件恢复。

## 2. E3：--dist artifacts 写入

- `assemble-release-evidence` 只读取 `artifacts`，assembled 对象里漏了 `artifacts` 字段。
- 修复：读取 dist 后写入 `assembled.artifacts`；release 缺 dist 仍 exit 2。
- 验证：release-evidence.spec 15 tests passed，real run-gates ledger 用例不再因缺 artifacts 失败。

## 3. 测试环境

- `happy-dom` 不在依赖闭包里；测试的 `@vitest-environment happy-dom` 静默退回 node，`localStorage` undefined。
- 修复：环境改为 `jsdom`；在 jsdom 下补一个 `localStorage` 内存实现（Node 的 jsdom 没有可用 origin 时可能不给全局 storage）。
- 验证：sorting-panel 3 tests passed。

## 4. 全量套件

- 修复前：441 files / 2425 tests，306 failed files / 4 failed tests。
- alias 修复后：439 passed files / 2421 passed tests；剩余 2 files 是上述 release-evidence + sorting-panel，已分别修复。
- 全量套件复跑 `vitest.family.config.mjs`, `--maxWorkers=2`：**441 files / 2425 tests passed**（983.97s）。
