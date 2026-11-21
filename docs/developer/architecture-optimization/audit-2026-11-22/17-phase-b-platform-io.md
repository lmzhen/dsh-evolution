# Phase B 设计：平台文件后端替换 `EvolutionIo` 的生产实现

范围：Phase B 的第一步，把生产 `EvolutionIo` 后端从自研 `node:fs` 实现切到平台 `ctx.fs`（`fs-local` 语义），保留现有领域代码不变。UnitKernel/锁合并随后进行；本轮不删 `WriteKernel`，不改变技能语义。

## 1. 已读依据

- `11-target-architecture.md` §2.1/§4.1：平台拥有 target identity、per-target 锁、`FsWriteIntent`、原子写、hardlink createIfAbsent；插件 `EvolutionIo` 只能是平台适配器。
- `10-system-framework.md`：I2 单一写权威、I5 可恢复、M2/M3。
- `01-core-write.md`：`WriteKernel`/`transact` 依赖 `EvolutionIoLike.transact`/`createTextIfAbsent`。
- 当前实现：
  - `packages/evolution-core/src/io.ts`：`EvolutionIoLike` 契约 + `nodeEvolutionIo()` 自研实现（sync/async fs、tmp+rename、锁、hardlink）。
  - `packages/evolution-core/src/io-node.ts`：生产 provider，注册 `evolutionIo` 默认后端。
  - `packages/evolution-core/src/io-registry.ts`：provider 注册/默认。
  - `packages/evolution-core/src/write-kernel.ts`：`transact`/`createTextIfAbsent` 的消费者。
  - `packages/evolution-all/cordis.patch.yml`、`packages/evolution-host/cordis.patch.yml`、`packages/evolution-preset/cordis.patch.yml`：`evolution-io-node` 行。
- 平台实现：
  - `harness-rc3/packages/fs/fs/src/index.ts:104,275-330`：`FileSystem` 的 `writeText/editText/deleteFile` 签名与 `FsWriteIntent`。
  - `harness-rc3/packages/fs/fs/src/types.ts:26-130`：`FsTarget/FsVersion/FsObservation/FsWriteIntent/FsEditRequest`。
  - `harness-rc3/packages/fs/fs-local/src/index.ts:112,216-...`：per-target `withLock`、`writeTarget`、原子发布。
  - `harness-rc3/packages/fs/fs-local/src/fsio.ts:604-710`：tmp+fsync+rename、createIfAbsent hardlink。
- 测试：`packages/evolution-core/tests/*io*`、`skill-store` 持久化/并发测试；本轮新增 adapter 单测。

## 2. 定性

| 目标 | 结论 |
|---|---|
| 平台拥有文件原子性/身份/lock | `ctx.fs` 已具备；插件不应再实现 |
| `EvolutionIoLike` 的 CAS/事务语义 | `transact` 必须用平台 read→edit/write CAS 表达；平台没有跨 read+write 的显式锁，但 `editText` 的版本 guard 覆盖“读后写”临界区 |
| 跨进程 | 平台 fs-local 的 per-target 锁是进程内；`processScope` 诚实声明 `single-process`，跨进程仍由现有文件锁/WriteKernel 负责 |
| 删除旧实现 | 本轮不删；先让生产 provider 可切换并有对照测试；Phase B 完成后再删 `io-node` |

不改变 `EvolutionIoLike` 公共 API；因此不触碰 `SkillLibrary`/`WriteKernel`/状态文件语义，避免“换后端+改语义”同时发生。

## 3. 设计

### 3.1 结构型 `PlatformFs` 端口

避免 `evolution-core` 新增平台包依赖，同时不手写平台类型：

```ts
interface PlatformFs {
  resolve(path: string): Promise<{ targetKey: string; displayPath: string }>
  stat(target): Promise<{ version: string; type: string; size?: number } | undefined>
  readText(target): Promise<string>
  writeText(target, content, intent?): Promise<{ version: string; before: string|null; after: string; operation: 'create'|'update' }>
  editText(target, edit, expected?): Promise<{ version: string; before: string; after: string }>
  deleteFile(target, expected?): Promise<{ before: string|null }>
  listDir(target): Promise<Array<{ name: string }>>
  moveFile(source, destination, options?): Promise<{ sourceDeleted: boolean }>
  lstat(path): Promise<{ type: string } | undefined>
}
```

`ctx.fs` 结构上满足该端口；`inject=['fs']`。

### 3.2 `platformEvolutionIo(fs)`

逐方法映射：

| `EvolutionIoLike` | 平台操作 |
|---|---|
| `readText` | resolve + `readText`；`FS_NOT_FOUND/FS_NOT_DIRECTORY` → `null` |
| `writeText` | resolve + `writeText`（无 guard） |
| `remove` | resolve + `deleteFile`；missing → no-op |
| `list` | resolve + `listDir` names |
| `exists` | `stat !== undefined` |
| `rename` | resolve both + `moveFile`；source removal 失败抛 |
| `copy` | readText + writeText |
| `size` | `stat.size ?? null` |
| `isSymlink` | `lstat.type === 'symlink'` |
| `createTextIfAbsent` | `writeText({kind:'createIfAbsent'})`；`FS_ALREADY_EXISTS` → `EEXIST`（`WriteKernel` 的冲突码） |
| `transact` | read current + version；task；same→no-op；null→guarded delete；absent→createIfAbsent；present non-empty→`editText`（oldString=current, newString=next, expected=version）；present empty→`writeText(replaceIfVersion)` |
| `processScope` | `single-process`（平台 fs-local 锁是进程内） |
| `mtime` | 不实现（平台 `FsInfo` 无 mtime；消费者必须已有 null 回退） |

关键：`transact` 的版本 guard 使“读后写”不会覆盖并发变更；`editText` 的整文件 oldString 只匹配唯一一次。空文件不能用 `editText`，走 guarded write。

### 3.3 provider 与切换

新增 `@deepseek-ai/dsh-evolution-core/io-platform`：

```ts
export const name = 'evolution-io-platform'
export const inject = ['evolutionIo', 'fs']
export function apply(ctx) { ctx.effect(() => ctx.evolutionIo.registerProvider(platformEvolutionIo(ctx.fs), { default: true })) }
```

- 先保持 `io-node` 为默认（不切生产）；新增 provider 作为可选，测试/组合可显式改默认。
- 下一步把 `evolution-all/host/preset` 的 `evolution-io-node` 行替换为 `evolution-io-platform`，再删旧实现。

### 3.4 测试

- `packages/evolution-core/tests/io-platform.spec.ts`：内存 `PlatformFs`。
  - read/write/list/exists/size/remove；
  - createIfAbsent 成功 + 已存在映射 EEXIST；
  - transact 成功、same no-op、absent create、present edit、null delete；
  - stale version → 抛 `FS_STALE_VERSION`；
  - resolve identity 不同 alias 共用 targetKey。
- 现有 `WriteKernel`/`SkillLibrary` 测试保持不变（未切默认）。

## 4. 回退与边界

- 未改生产 provider 默认，回退只需删除新文件/export。
- 平台 `ctx.fs` 不可用时不注入（组合不挂）；旧 `io-node` 仍可用。
- 不声明跨进程；不把平台 fs 的进程内锁当跨进程锁。
- `mtime` 缺失是明确降级：依赖它的 curator/commands 在平台后端需接受 null 回退（现有契约已允许）。

## 5. 实现结果（2026-11-22，未发布）

- 新增 `packages/evolution-core/src/io-platform.ts`：`platformEvolutionIo(fs)` + `apply()`；
  新增 `@deepseek-ai/dsh-evolution-core/io-platform` export。
- 新增 `packages/evolution-core/tests/io-platform.spec.ts`：4 tests（读写/list/exists/size、
  createIfAbsent→EEXIST、transact edit、transact create/delete）通过。
- 本轮 `io-node` 仍是生产默认；新 provider 已可挂载但未替换组合行。
- 未发布。

## 6. 后续实现（2026-11-22，未发布）

- 用真实平台 `LocalFileSystem` + 临时 DSH_HOME 做集成测试：write/read/size/transact/
  createIfAbsent 冲突全部通过；平台 createIfAbsent 的冲突码是 `FS_NOT_OBSERVED`，adapter 已映射到
  `EEXIST`（供 WriteKernel 识别为 cas-conflict）。
- `evolution-all` / `evolution-host` / `evolution-preset` 的 IO 行已从 `evolution-io-node` 切到
  `evolution-io-platform`；`HOST_ROW_IDS`/`HOST_ROW_NAMES` 同步。
- host composition / bundle mutual-exclusion / dependency closure / contract：24 tests passed。
- `io-node` 保留为测试/standalone legacy backend；下一步 UnitKernel 完成后再删除生产依赖。
