# @lmzhen/dsh-tool-memory

> 模型面 memory 工具 + 两段提示。

## 它做什么

memory 工具（add/replace/remove/operations）；guidance section；snapshot context；审批 runner；memory-applied 刷新；memoryEnabled/entryPreviewChars。

## 入口

memory 工具；系统提示段。

## 依赖与默认

需要 tools + memory；systemPrompt 可选；approval 可选。

## 边界

memoryEnabled:false 不注册工具/提示但保留拒绝式 runner；snapshot 为空时不注入；审批关闭时直接执行。

## 代码位置

`src/index.ts`
