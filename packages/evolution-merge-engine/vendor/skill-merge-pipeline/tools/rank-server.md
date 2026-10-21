# 本地精排服务（llama-server + StartLux GGUF）

④.5 的本地精排走 OpenAI 兼容端点；未启动时自动降级 `vec`（`rank_mode=auto`）。

## 1) 下载 GGUF（可选 artifact）

```bash
node tools/fetch-models.js --include ranker --dry-run   # 先看 URL/sha/size
node tools/fetch-models.js --include ranker             # 下载约 774 MiB 到 <models>/startlux/
```

## 2) 启动服务

一键脚本（自动定位 GGUF 与 llama-server，健康检查后前台运行）：

```bash
node tools/rank-server.js --models-dir <models> [--port 8093] [--slots 4] [--download]
# 或 npm run rank-server -- --models-dir <models>   # 默认 ctx=16384；可 --ctx-size 覆盖
# 仅查看将执行的命令：--dry-run
```

手动启动（等价）：

```bash
llama-server -m <models>/startlux/StartLux-Decision-0.8B-Q8_0.gguf --host 127.0.0.1 --port 8093
```

## 3) 配置与验证

- 流水线：`--rank local`（默认 `auto`：探活成功用本地，否则 vec）；`rank_server` 默认 `http://127.0.0.1:8093`。
- 体检：`npm run doctor` 的「本地精排服务」项应显示 `[OK] … /health OK`。
- 探活超时：`rank_probe_timeout`（默认 2 s）。
> CPU 实跑提示：0.8B Q8 在长 prompt（~7k token）下单请求可达 60–120 s；建议 `--slots` 由服务端自动（本构建不支持 --slots 参数），并用 `--rank-request-timeout`（默认 300 s）与 `--rank-concurrency`（≤服务端 slots）配合。
