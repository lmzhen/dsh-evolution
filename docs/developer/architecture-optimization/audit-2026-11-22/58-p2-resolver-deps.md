# P2：删除 `dsh.resolverDependencies` 死字段

范围：05-platform-seam P2-8。
- `evolution-all` / `evolution-agent` / `evolution-host` / `evolution-preset` 的 `dsh.resolverDependencies` 仍声明；
- 平台 rc.5 没有读者；该字段只让 `verify-dependency-closure` 豁免未引用依赖；
- 真实依赖应由源码/组合补丁引用。

## 设计

- 从 `evolution-all` / `evolution-host` / `evolution-preset` 三份 manifest 删除 `dsh.resolverDependencies`；
- `evolution-agent` 保留该字段：它的 restrictor 行需要 core 可解析，`verify-composer-single-source` 也要求该依赖；这是活的组合边，不是死字段；
- `verify-dependency-closure` 的 resolver 豁免只服务这个活边；
- `prepare-release` 的 scope 改写保留。

## 验证

- `verify-dependency-closure packages`: 0；235 declarations all referenced；23 packages；
- `verify-composer-single-source`: 0；
- 只有 `evolution-agent` 保留 `resolverDependencies`；
- local gates 待跑。

## 回退

恢复字段与豁免；无运行时行为变更。
