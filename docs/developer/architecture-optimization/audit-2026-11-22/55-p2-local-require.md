# P2：去掉页面全局 require，改成 bundle 局部绑定

范围：07-ui-client P2-7（全局 require 部分）。
- `build-client.mjs` 的 factory 写 `globalThis.__dshClientRequire = require;`；
- `platform-ui.ts` 读这个页面全局。

问题：
- 页面全局是家族发明的名字；
- HMR 下后物化 bundle 会覆盖该全局；
- 同一个页面上的多个 bundle 共享一个可覆盖的入口。

## 设计

- factory 在 bundle 体内先声明：

```js
var __dshClientRequire = require;
```

- `platform-ui.ts` 改为读这个 **module-local** 绑定：

```ts
declare const __dshClientRequire: ClientRequire | undefined
```

- 不再写/读 `globalThis`；
- `typeof` 保护使测试直接 import 源码时安全。

## 验证

- `node packages/scripts/build-client.mjs` 0；
- 生成物 `evolution-ui/lib/client.js`、`evolution-merge-ui/lib/client.js` 均为：
  - `var __dshClientRequire = require;`
  - `return typeof __dshClientRequire === "function" ...`
- 无 `globalThis.__dshClientRequire` 写入。

## 回退

恢复页面全局；无数据/schema 变更。
