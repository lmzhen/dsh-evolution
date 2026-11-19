# 多版本支持：目标架构、问题台账与迁移计划

> 状态：设计基准（2026-11-19），尚未实现。实现期间以本文为**唯一设计源**；任何架构/范围变更先写 DCR，再改代码。
>
> 适用基线：family `0.57.0`、DSH `0.2.2-rc.5`、22 个发布包（P0 拆包后）；下一发布窗口暂定 `0.58.0`。
>
> 关联执行入口：[architecture-optimization/README.md](./README.md)
> 端口清单：[platform-ports.md](./platform-ports.md)
> 行为基线：[characterization.md](./characterization.md)

## 0. 结论

多版本支持不是“给每个包加一堆版本 if”，而是把版本从业务代码里拿掉：

> **能力契约 + 单一适配包 + 单一兼容包络 + 有界 cohort + 只含家族行的 bundle patch。**

目标不是同时支持所有历史版本，而是：

- 一个 artifact 支持一个**明确列出、逐版本验证过**的平台 cohort；
- 同一 cohort 内，bundle 根、每个可安装包、每个 row 使用同一份兼容范围；
- 跨 minor/代际使用**并行发行线**，不把旧线塞进同一个 all；
- 平台 API 差异集中在唯一适配包，feature 包不随平台版本变化。

## 1. 当前基线

- 发布包：重构前 20 个；P0 拆出 `evolution-platform-contract` 与 `evolution-adapter` 后 22 个（`packages/evolution-*`、`memory`、`tool-skill-manage`）；源码包 23 个（含一个退休 preset 目录）。
- 版本事实源：`platform-line.json`，当前 `version=floor=0.2.2-rc.5`。
- 生成结果：每个发布 manifest 的 `@deepseek-ai/dsh-*` peers = `^0.2.2-rc.5`，`engines.dsh` = `>=0.2.2-rc.5 <0.2.3-0`；`all` bundle 只带 engines，row 包同时带 peers/engines。
- 平台耦合：`evolution-core` 直接 import 14 个平台包；其余 16 个包只 import Cordis/Schemastery 与家族服务。`ctx.get()` 的家族服务访问遍布各包，但平台包导入集中在 core。
- bundle：`all`/`host`/`preset` 三份 patch 除家族 row 外，只剩一个平台 `tool-skill` 覆盖（60 字符 catalog cap）。
- 验证：`verify-platform-matrix.mjs` 已存在但未进 gate；release evidence 是单平台线；`platform-line.generated.ts` 只导出常量，未被业务使用。

## 2. 全量问题台账

### 2.1 声明/发布层

| 编号 | 事实 | 后果 |
|---|---|---|
| D1 | 源码 manifest 用 `workspace:^`，兼容范围只在发布时生成 | 源码、测试、文档没有同一份支持集合；改多版本只能改全局 floor，隐含宣称 20 包全支持 |
| D2 | `platform-line.json` 只有一个 `version`/`floor`，同 tuple 范围 | 无法表达“支持 rc.3、rc.4、rc.5，但不支持 rc.6”；floor 与 version 的语义容易被误读为“整个 minor 都支持” |
| D3 | `engines` 与 peers 分别生成、平台只看 engines | 两套声明可能漂移；peers 写得再准，启动也不参与判定 |
| D4 | 发布 evidence 是单平台线 | 多版本时无法证明每个 cohort 成员都经过安装/启动验证 |

### 2.2 平台判定层

平台代码事实（`@deepseek-ai/dsh-app-boot`、`plugin-manager`）：

| 编号 | 事实 | 后果 |
|---|---|---|
| P1 | `evaluatePluginCompatibility` 只读单个 manifest；有 `engines.dsh` 就忽略 peers | 无法从 bundle 根推断全部 row 兼容；不能依赖 peer 做精确准入 |
| P2 | `prepareProfileEntries` 对每 row 独立检查；不兼容 row 直接 `disabled`，只写 stderr | 可能“安装成功、bundle 根正常、某个 row 静默消失”；doctor 必须补 row 存活诊断 |
| P3 | `profile.ts` 只对 bundle 根检查一次；bundle patch 支持文件数组，但不支持按版本选择 | 静态 patch 无法自然表达版本差异；不能把平台 row 覆盖放进默认 bundle |
| P4 | 安装时拒绝不兼容版本，不会自动回退到旧兼容版本 | 用户必须 pin 版本；不能用“平台自己会选旧版”做多版本策略 |
| P5 | 平台没有向插件暴露稳定的 runtime version/capability 服务 | 业务代码只能 `ctx.get()` 可选服务或猜版本；猜版本必须禁止 |

### 2.3 代码架构层

| 编号 | 事实 | 后果 |
|---|---|---|
| C1 | `evolution-core` 同时含域逻辑与平台端口适配；直接 import 平台包 | 平台一变，core 必改；core 又拖着全部业务，无法独立矩阵编译 |
| C2 | 其余包只 import Cordis/Schemastery 与家族服务，平台耦合较低 | 这是一次可放大的优势：把 core 的适配层拆出后，多数 feature 包天然与平台无关 |
| C3 | 平台端口是可选 `undefined`，调用方手工判断；36 个 service probe 只服务 doctor | 缺失能力没有统一语义，容易静默降级；doctor 不是启动约束 |
| C4 | 16 个包直接 import `@deepseek-ai/cordis`、`schemastery` | 框架 seam 相对稳定，但必须在兼容包络中单独声明；不能假装它们与 DSH 版本无关 |

### 2.4 bundle/组合层

| 编号 | 事实 | 后果 |
|---|---|---|
| B1 | 三份 patch 都有平台 `tool-skill` 覆盖 | 平台 row 的 Config 键跨版本可能不存在；静态 patch 无法条件化 |
| B2 | `bundle-rows.json` 单源生成，但 row 集含平台覆盖 | 生成器同时生成“家族 row”和“平台声明”，两个兼容面耦合 |
| B3 | `all` 是完整 bundle，host/preset 是替代安装形态；三者共享 row 体 | 多版本时三份 patch 必须同时保持同一包络，不能各自漂移 |

### 2.5 验证/发布层

| 编号 | 事实 | 后果 |
|---|---|---|
| V1 | `verify-platform-matrix` 未进 gate，且会混入 family source alias 与宿主类型，产生 `TS2717` 假阳性 | 多版本没有可信编译证据；矩阵本身也不可信 |
| V2 | 没有“每个 cohort 安装 + 启动 + row 存活”的 smoke | 只编译不启动，会漏掉平台 preflight 静默 disable |
| V3 | `verify-platform-ranges` 只校验一个全局范围 | 不能证明每个包都使用同一 cohort；范围改了但 matrix 没跑就发布 |
| V4 | release evidence 与 tag/CI 绑定单平台线 | 不能带 cohort 发布，也不能回放旧线证据 |

### 2.6 分发/文档/用户环境层

| 编号 | 事实 | 后果 |
|---|---|---|
| U1 | 用户 profile 可能同时保留家族 bundle 与显式平台依赖（例如旧的 `dsh-tool-session-query`） | 家族删除依赖后，用户 profile 仍可能挂载旧工具；安装/升级文档必须明确“家族 bundle 是唯一 owner” |
| U2 | README/INSTALL 只描述当前平台线 | 多版本后需要兼容矩阵/cohort 表，不能只写一句“支持 rc.5” |
| U3 | 旧平台线用户只能安装旧 family 版本 | 需要 frozen legacy 线/dist-tag 的明确策略，不能靠“最新 all 自动兼容” |

## 3. 目标架构

```text
DSH host
  │
  ├─ evolution-adapter       ← 唯一允许 import @deepseek-ai/dsh-* 的包
  │    ├─ capability probes  (ctx.get / 方法形状 / 可选服务)
  │    ├─ contract generation (c1 / c2 …)
  │    └─ EvolutionPlatform 服务（现有 ports）
  │
  ├─ evolution-platform-contract      ← 纯类型/端口/能力名，零 host import
  │
  └─ feature packages        ← 只依赖 contract
       core / memory / skill / review / merge / ui …

platform-envelope.json       ← 唯一版本事实源
bundle patch                 ← 只含家族 row
```

### 3.1 不变量（实现期间冻结）

1. **一个 artifact 一个包络**；包络只列明确验证过的版本，不写开放式 `>=`。
2. **bundle 根、每个发布 manifest、每条 row 使用同一包络**，由生成器写入。
3. **业务代码禁止读取平台版本**；版本只出现在 adapter 诊断和 release evidence。
4. **只有 `evolution-adapter` import 平台包**；`evolution-platform-contract` 零 host import；feature 包只认 contract。
5. **bundle patch 只拥有家族 row**；平台 row 配置不进入默认 bundle。
6. **旧平台线用并行发行线**，不塞进同一个 all。
7. **没有测过的版本不写进包络**；peers 和 engines 由同一 cohort 生成。

### 3.2 包边界

```text
evolution-platform-contract/
  src/ports.ts        # EvolutionPlatform 端口接口
  src/capabilities.ts # PlatformCapability 枚举/能力集合
  src/types.ts        # 家族跨包数据类型
  src/tool-schemas.ts # 模型工具 schema（纯值）

evolution-adapter/
  src/index.ts        # 插件入口，提供 evolutionPlatform
  src/detect.ts       # 从 ctx 探测能力，不按版本分支
  src/c1/...          # 当前契约代际的端口实现
  src/c2/...          # 仅真实语义变化时新增
  src/platform-values.ts # 平台提供的运行时值（defineTool/createUserMessage/…）的家族出口
  src/diagnostics.ts  # 供 doctor 的版本/能力/缺失说明

evolution-core/       # 只留域逻辑；import contract，不 import 平台包
```

依赖规则：

- `evolution-platform-contract`：**零宿主 runtime import**；允许 type-only 平台类型，用于端口签名，但类型面必须由 cohort 矩阵编译覆盖。
- `evolution-adapter`：全仓唯一 import `@deepseek-ai/dsh-*` **运行时值** 的包；实现端口，并集中导出平台提供的运行时 helper（`defineTool`、`createUserMessage`、`escapeText`、`SessionId` 等）。
- feature 包：类型/端口从 contract 取；平台提供的运行时 helper 从 adapter 取；**不直接 import `@deepseek-ai/dsh-*`**。
- `Cordis`/`Schemastery` 继续作为框架 seam 直接 import；它们在兼容包络中单独声明，不混入 adapter 的宿主适配面。

迁移顺序：先拆 `contract`，再拆 `adapter`；`evolution-core/platform` 暂时作为 re-export 兼容桶，feature 包逐批切到 contract/adapter，最后删除兼容桶。包数增加不设硬上限；以机制边界为准。

**P0 子阶段（防止大爆炸）：**

- **P0a**：新建 contract/adapter；adapter 提供 `evolutionPlatform` 与 helper；`evolution-core/platform` 变成 re-export 兼容桶；core runtime 暂时仍 mount adapter 以保持行为；rc.5 全绿。
- **P0b**：把 adapter 中的端口接口/类型迁到 contract；feature 包逐批从 core/platform 切到 contract（类型/端口）与 adapter `./values`（宿主运行时 helper）；每次切换一个包组，测试绿后继续；最后删除兼容桶。
  **P0b 状态（2026-11-19）**：端口接口/类型已全部迁到 `evolution-platform-contract`（含 `llm`、`projections`、`presets`、`tools`、`platformView`、`profileContext`、`subagents`、`systemPrompt`、`HostPlatformPorts`）；adapter 实现文件只保留实现并从 contract re-export 类型。剩余工作是 feature 包逐批从 `evolution-core/platform` 切到 contract 类型 + adapter `./values`，并删除兼容桶。当前构建/类型 0 错、66 项定向测试、包映射/依赖闭包绿。
- **P0c**：把 adapter 作为独立 row 加入 host/all/preset/standalone，顺序在 core 之前；core runtime 不再 mount adapter；真实启动验证 row 顺序。
  **P0c 状态（2026-11-19）**：完成。`bundle-rows.json` 新增 `evolution-adapter` host 行，host/all/preset/standalone 四形态均生成；core runtime 不再 mount `EvolutionPlatform`；rc.5 干净安装后 `dump-config` 顺序为 `evolution-adapter` → `evolution-core-runtime`，真实 web 启动 200、doctor `platform-services: ok`、45 技能。`evolution-adapter` 仍是唯一平台 import 包。

### 3.3 契约与适配

`evolution-platform-contract` 定义语义能力，不定义版本：

```ts
export const CONTRACT = 1 as const

export type PlatformCapability =
  | 'agents' | 'tools' | 'subagents' | 'commands'
  | 'storage-domain' | 'session-projections' | 'approval'
  | 'plugin-manager' | 'profile-context' | 'hmr' | 'settings'
  // 其余按现有 36 个 probe 归并，名字必须表达能力而不是包名

export interface EvolutionPlatform {
  readonly contract: 1
  readonly capabilities: ReadonlySet<PlatformCapability>
  readonly agents?: AgentsPort
  readonly tools?: ToolsPort
  // ...现有 ports
}
```

- `evolution-adapter` 从 `ctx.get()` 与方法形状构造 `capabilities`；**不比较 semver**。
- 同一种语义但方法名/返回形状不同：adapter 内部归一化。
- 无法归一化的行为变化：提升 `contract` 代际，新增 adapter 文件；feature 代码仍只认 contract。
- 必选能力缺失：启动 fail loud，说明宿主缺什么、影响哪个功能；可选缺失：端口 `undefined`，功能显式降级。
- `platform-services.ts` 的 36 个探针迁入 adapter 的**能力清单**，标 `required`/`optional`；doctor 直接读它，输出“宿主版本 / contract / 缺失能力 / 受影响功能”。

### 3.4 包络与生成

新增 `platform-envelope.json`（替代 `platform-line.json` 的单线语义）：

```json
{
  "contract": 1,
  "current": "0.2.2-rc.5",
  "cohort": [
    "0.2.2-rc.3",
    "0.2.2-rc.4",
    "0.2.2-rc.5"
  ]
}
```

生成器负责：

- 每个发布 manifest 的 `@deepseek-ai/dsh-*` peers 与 `engines.dsh` 使用**同一精确并集**；例如 `^0.2.2-rc.3 || ^0.2.2-rc.4 || ^0.2.2-rc.5`。
- `all` bundle 只带 `engines.dsh`；row 包同时带 peers/engines，但仍由同一 cohort 生成。
- `platform-contract.generated.ts`：contract、cohort、能力名。
- CI 矩阵轴、release evidence、README 兼容表。
- 删除 `workspace:` 在发布物中的残留；源码仍可用 workspace。

策略：

- 同一 minor 内，cohort = **当前 + 前一档**（例如 rc.3–rc.5）；下一档加入前先跑矩阵。
- 跨 0.2.1/0.2.2：**frozen legacy 线**或 dist-tag，不放进同一个 artifact。
- 未列入 cohort 的版本不写进 peers/engines；不承诺未来版本。

### 3.5 bundle patch

- 三份 patch 只保留 `@lmzhen/*` 家族 row。
- 移除 `tool-skill` 平台覆盖；60 字符 cap 若仍是产品要求，放到家族自己的 skill catalog/tool 配置，或作为非默认的可选 profile override。
- `bundle-rows.json` 生成器只生成家族 row；不再把平台 row 覆盖当作默认组合的一部分。
- 不依赖 `postinstall` 动态改 patch，不依赖 `!!js` 猜宿主版本；静态包必须可复现。
- 如果未来必须按版本改平台 row，正确做法是推动上游支持 `dsh.bundle.patch` 的版本范围映射；平台不支持时，不把该能力做成默认路径。

### 3.6 验证/发布

- 修复 `verify-platform-matrix.mjs`：每个 cohort 使用干净宿主声明树，不混入 family overlay 别名；分别编译 contract/adapter/feature 全部包。当前 `TS2717` 假阳性必须先消除。
- 新增 `verify-platform-envelope.mjs`：所有 staged manifest 的 peers/engines 精确等于 envelope 生成值；不允许 `workspace:` 或自由范围。
- 新增 cohort smoke：每个成员干净 profile 安装 `all`，启动 `dsh web`，检查 bundle 根 + 每个家族 row active，doctor 无必选能力缺失。
- `verify-platform-matrix`、envelope 校验、smoke 进 pre-tag/CI；矩阵未绿不得 tag。
- release evidence 从 `platformLine` 改为 `platformEnvelope` + 每个 cohort 成员的读数；tag 只发当前 `current`。
- 文档自动生成 cohort 表；README/INSTALL 只写用户可感内容，兼容细节进本设计文档。

## 4. 平台侧事实与上游建议

平台当前行为是外部约束，不是我们可以直接重写的代码：

- `plugin-compatibility.ts`：单 manifest；`engines.dsh` 优先，peers 被忽略。
- `compatibility-preflight.ts`：逐 row 判定；拒绝的 row 变 `disabled` + stderr；Include 整体拒绝。
- `profile.ts`：bundle 根单独检查；patch 文件数组静态。
- `plugin-manager`：安装拒绝不兼容版本，不自动回退；exemption 是精确版本。
- 运行时没有 capability/version service。

因此本设计**不依赖平台变更**；以下上游改进列为可选、非阻塞：

1. 暴露 `ctx.platform`（version + capability）；
2. `dsh.bundle.patch` 支持版本范围映射；
3. bundle 兼容性聚合报告，指出具体 row 与原因；
4. 安装时选择最新兼容版本，而不是直接拒绝；
5. 统一 engines/peers 的判定语义。

平台不改时，我们用“精确包络 + 同一 row 范围 + 能力探测 + 纯家族 patch”工作。

## 5. 参考实现与取舍

- [dsh-web / @linxin666/dsh-web-all](https://github.com/zhu1090093659/dsh-web)：高 star 聚合 all，声明 `>=0.2.2-rc.3` 的**下限**，但未给出逐版本矩阵；它的 compat 是 UI 语义层，不是平台 API 适配。可作为“聚合包形态”参考，不作为兼容证据。
- [@hyzyn/dsh-plugin-kit](https://github.com/hyzyn/dsh-plugin-kit)：根 + 11 子包，每个包声明同一组 **16 个显式版本**，共享 `@hyzyn/dsh-kit` 兼容层；不按版本分支，逐版本比较宿主 lib/槽位/主题 token。它验证了“单一共享层 + 显式并集”的可行性；但它把 `engines.dsh` 写成开放式 `>=`，与精确 peers 有谓词分裂，我们**不采用**这一点。
- 官方发布规则：[engines.dsh 优先于 peerDependencies](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)。
- 平台源码：`packages/boot/app-boot/src/plugin-compatibility.ts`、`compatibility-preflight.ts`、`profile.ts`；`packages/boot/plugin-manager/src/index.ts`、`operations.ts`。

## 6. 迁移路线

### P0：边界，不改行为

**P0a 状态（2026-11-19）**：完成。`evolution-platform-contract`（能力/Result/全量端口接口，无宿主 runtime import）与 `evolution-adapter`（`ports` / `values` / `service` 三个入口）已落地；core 的 17 个平台 port 文件迁入 adapter，core 只保留 `src/platform/index.ts` 兼容 re-export；core 全包不再直接 import `@deepseek-ai/dsh-*`。`verify-family-types` 0 错，104 项定向测试绿，rc.5 真实 web 启动 200、45 技能、doctor `platform-services: ok`。安装器 `--from-dist` 增加 family namespace 链接（core → adapter → contract），否则 packed composer 无法解析跨包依赖。P0b 接口迁移已完成，P0b feature import 与 P0c 仍待做。

- 按 §3.2 的 P0a/P0b/P0c 分三次落地：先 contract/adapter + 兼容桶，再逐包切 import，最后独立 row；
- 把 `evolution-core/src/platform/*`、`runtime/platform.ts` 迁入 adapter；
- feature 包从 contract 取类型/端口、从 adapter 取平台运行时 helper；
- `evolution-adapter` 加入 host/all/preset/standalone 的 row 集，顺序在 core 之前；
- 在 rc.5 上编译/测试全绿；行为不变，可回退。

**验收**：当前单测/gate 绿；`grep @deepseek-ai/dsh` 只出现在 adapter（及 contract 的 type-only 说明）；rc.5 真机启动无新增 warning。

### P1：包络 + cohort spike

- `platform-envelope.json`；生成器写 peers/engines；
- cohort 先设 `rc.3 / rc.4 / rc.5`；
- 修矩阵假阳性，rc.3 编译 + 启动；
- adapter 只补真实差异，不加 feature 层版本分支；
- 移除 `tool-skill` 平台覆盖。

**验收**：矩阵每个 cohort 0 error；干净 profile 启动；所有家族 row active；doctor 报 cohort/能力；无平台 row 覆盖。

### P2：完整验收与最终发布

- 补齐 bundle/patch 清理与 doctor 的“宿主 contract / 能力 / row 存活”诊断；
- 全部优化完成后才做一次最终发布，过程中不发布中间版本；
- 通过 pre-tag/CI/独立复核后发当前线版本；
- README/INSTALL 写 cohort 表与旧线指引；
- 旧平台线冻结为 legacy 版本/ dist-tag，不再改 current。

**验收**：npm 20/20 latest；真实 npm web 升级；release evidence 带 cohort；旧线文档可照做。

### P3（可选）：上游能力

- 若平台愿意接受 `ctx.platform` / patch range map，再简化 adapter 和 bundle；
- 无上游变更也能完成 P0–P2；P3 不阻塞最终发布，但若启动则仍按本文不变量与 DCR 管理。

## 7. 不做清单

- 不在 feature 代码写 `if (version >= ...)`；
- 不在 20 个包重复手写兼容并集；
- 不做一个 artifact 横跨 0.2.1/0.2.2；
- 不用平台 row 覆盖解决家族配置；
- 不用开放式 `>=` 宣称未来兼容；
- 不用 `postinstall`/`!!js` 猜宿主版本生成 patch；
- 不在矩阵未绿时发版；
- 不把“多版本”变成“所有历史版本都支持”的口号。

## 8. 文档与变更控制

### 8.1 必读文档

**家族：**
- `README.md`、`README.zh.md`、`INSTALL.md`、`packages/INSTALL.md`、`packages/README.md`
- `docs/developer/architecture.md`
- `docs/developer/architecture-optimization/README.md`
- `docs/developer/architecture-optimization/platform-ports.md`
- `docs/developer/architecture-optimization/characterization.md`
- `docs/developer/development.md`
- `docs/UPGRADE-0.55.md`
- `packages/evolution-core/README.md`
- `packages/evolution-all/README.md`
- `packages/evolution-host/README.md`
- `packages/evolution-preset/README.md`
- `packages/evolution-agent/README.md`
- `platform-line.json`、`packages/scripts/lib-platform-line.mjs`
- `packages/scripts/verify-platform-matrix.mjs`、`verify-platform-ranges.mjs`、`prepare-release.mjs`
- `packages/scripts/release-evidence-rehearsal.json`

**平台：**
- `_upstream/dsh-upstream-0.2.2-rc.5/packages/boot/app-boot/README.md`
- `.../packages/boot/plugin-manager/README.md`
- `.../packages/boot/app-boot/src/plugin-compatibility.ts`
- `.../packages/boot/app-boot/src/compatibility-preflight.ts`
- `.../packages/boot/app-boot/src/profile.ts`
- 官方发布文档：https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish

**外部参考：**
- https://github.com/zhu1090093659/dsh-web
- https://github.com/hyzyn/dsh-plugin-kit

### 8.2 变更控制

- **DCR-1（2026-11-19，包名冲突）**：原计划的 `@lmzhen/dsh-evolution-contract` 在 npm 已存在 `0.44.0`，是历史上的**状态/事件跨包纯契约**包，已有公开版本；直接复用会让旧消费者升级到语义完全不同的新包。决定：新包改名为 `@lmzhen/dsh-evolution-platform-contract`；旧 `@lmzhen/dsh-evolution-contract@0.44.0` 不覆盖、不 deprecate（后续如需统一再单独处理）。影响：源码目录、imports、tsconfig 路径、包映射与发布占位名同步改名；设计目标不变（纯平台契约 + 单一 adapter）。
- 本文 §3 的不变量、包边界、envelope 语义是**冻结面**；变更必须写 DCR（日期、原因、影响、回退），并重新评审。
- 新发现先入 §2 台账或 §10 open questions；不擅自扩当前 Phase。
- 代码、测试、生成器、文档、release evidence 同 PR 更新；文档滞后视为未完成。
- 若实现暴露“设计假设错误”，先改本文再改代码；不允许代码先漂移、文档后补。
- 每个 Phase 结束时做一次“文档差集”：代码实际行为 vs 本文描述，差集必须清零或登记为 DCR。

## 9. 总验收

- 包络：所有发布 manifest 的 peers/engines 与 envelope 完全一致；无 `workspace:` 残留。
- 边界：`grep @deepseek-ai/dsh` 只出现在 `evolution-adapter`；feature 包无平台 import。
- 运行：每个 cohort 成员干净安装、启动、row 全 active、doctor 无必选能力缺失。
- 组件：bundle patch 无平台 row 覆盖；`bundle-rows.json` 只生成家族 row。
- 发布：pre-tag 全绿；独立复核 P0/P1=0；release evidence 按 cohort；npm 20/20；真实 npm web 升级验收。
- 文档：本文件、README/INSTALL、平台端口文档、release notes 同步。

## 10. Open Questions（未冻结）

1. `evolution-platform-contract` 是否独立 npm 包，还是 `evolution-core` 的纯子路径？当前已按独立包落地（22 个发布包），后续只在有明确收益时再评估合并。
2. 60 字符 catalog cap 的最终归属：家族 catalog 配置、可选 profile override，还是接受平台默认？需要产品/体验确认。
3. cohort 首版是否包含 rc.3，还是只做 rc.4–rc.5？由 P1 矩阵/真机结果决定。
4. 是否把 Cordis/Schemastery 也纳入 contract 包装？当前倾向保留直接 import（框架 seam，不随 DSH 版本面变化）。
5. 旧线采用 dist-tag 还是并行 major？按 npm 发布成本与用户升级路径定。
6. **P1 前置发现（2026-11-19，已收敛 detector 假阳性）**：rc.3 平台树里仍然带着旧 family 包副本；原矩阵把它们当成平台声明，与 mirror 的 family source 形成两套类型身份，才报 4 个 `TS2717`（`evolutionApproval` / `skillUsage` / `evolutionState` / `evolutionStateStorage`）。`verify-platform-matrix.mjs` 现在先按 `packages/*/package.json` 的名字剔除本地 family 包，再做单一声明树编译；rc.3 编译已 **0 error**。rc.5 的干净源码树没有构建后的 `lib/types`，暂用当前 `verify-family-types` 覆盖 rc.5，等 rc.5 树可构建后再补同一矩阵行。
