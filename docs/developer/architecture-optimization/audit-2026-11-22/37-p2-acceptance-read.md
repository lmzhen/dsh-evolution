# P2：验收夹具的读失败不再当空

范围：08-tests-debt P2 #11。
- `packages/scripts/acceptance/fixtures.mjs` 对 usage/merge state 的读取 `catch {}` 后按 `{}` 继续；
- 真实主机验收证据的读取失败会变成“没有数据”，而不是红。

## 设计

- 新增 `readOptional(path)`：只把 ENOENT 当 absent；其他读取错误抛出。
- 新增 `readJson(path, empty)`：absent 返回 empty；存在但 parse 失败抛出。
- 替换三处：
  - `writeManagedSkill` 的 usage；
  - `seedPendingMerge` 的 merge state；
  - `seedArchivedUsage` 的 usage。

## 验证

- `node --check packages/scripts/acceptance/fixtures.mjs` 0；
- arch/doc 0；
- 该文件不在 arch guard 扫描面内，但失败语义已与 N36 一致。

## 回退

恢复 try/catch 空值即可；无生产路径变更。
