# @lmzhen/dsh-memory

> 记忆 provider 注册表服务。

## 它做什么

ctx.memory：registerProvider/provider/pin；read/applyBatch/renderContext 委托；写成功发 memory-applied；provider 注册发 memory-provider-registered。

## 入口

ctx.memory。

## 依赖与默认

被 memory-files/tool-memory 使用。

## 边界

不存数据；无 provider 抛错；命名未命中不回退；第三方 provider 返回形状不校验。

## 代码位置

`src/index.ts`
