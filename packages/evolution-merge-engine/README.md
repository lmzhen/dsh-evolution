# @lmzhen/dsh-evolution-merge-engine

> 纯库：合并筛选引擎与报告映射。

## 它做什么

提供 screen()、judge 包装、selectCandidates/report-map、vendored pipeline 和模型资产；无 apply/命令/路由/服务。

## 入口

无插件面；只被 evolution-merge import。

## 依赖与默认

本地 potion 模型目录；deepseek judge 需要 runner。

## 边界

不是插件；probe/ensureModels 生产未接线；引擎版本串是 0.29.0，不是包版本。

## 代码位置

`src/engine.js, src/report-map.js, src/index.js`
