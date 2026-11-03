# @lmzhen/dsh-evolution-preset

> 兼容一键 bundle + 独立组合文件。

## 它做什么

patch 形态：26 条 insert + 2 覆盖，与 all 接近但少 UI/健康两行；另导出 standalone cordis.yml（25 条顶层条目，无 UI/merge/maintenance tools，state 用 domain）。

## 入口

dsh plugin add @lmzhen/dsh-evolution-preset；standalone 仅供手工 compose。

## 依赖与默认

与 all/host/分层互斥。

## 边界

兼容形态，不是新装默认；standalone 在仓库内没有运行时消费者；缺 UI/健康两行。

## 代码位置

`cordis.patch.yml, cordis.yml, package.json`
