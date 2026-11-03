# @lmzhen/dsh-evolution-threat

> 写入期威胁扫描 guard。

## 它做什么

扫描 memory 的 facts/content 和 skill_manage 的 content/file_content/new_string；覆盖注入、角色劫持、外泄、C2、持久化、密钥、隐形字符。

## 入口

tools.guard。

## 依赖与默认

需要 tools 服务；enabled:false 时直接 return。

## 边界

只覆盖两个写工具；规则集手工维护，不证明穷尽；窗口下限 4097。

## 代码位置

`src/index.ts`
