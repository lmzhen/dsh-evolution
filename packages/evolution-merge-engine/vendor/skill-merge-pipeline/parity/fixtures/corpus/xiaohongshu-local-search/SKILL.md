---
name: xiaohongshu-local-search
description: Search Xiaohongshu notes and comments through local MCP.
version: 0.2.0
author: Hermes
metadata:
  hermes:
    tags: [Xiaohongshu, MCP, Research, Windows]
    related_skills: [dsh-mcp-wiring]
---

# Xiaohongshu Local Search

Reads Xiaohongshu notes and their comments through a local Go MCP service that drives a real browser with a pinned fingerprint. **只走平台原生的 MCP 工具**（`mcp__xiaohongshu__*`）——不要绕过 MCP 客户端直连服务端口。只读：绝不发布、点赞、收藏、评论。

## When to Use

- 用户问「小红书 上怎么说 X」「从小红书看 X」，需要笔记正文或评论当证据。
- 旅游/购物/本地生活调研，要真实用户笔记而不是搜索引擎摘要。
- 症状：`mcp__xiaohongshu__search_feeds` 报 `fetch failed`（服务没起）或 `MCP error -32001: Request timed out`（客户端 60s 上限）。

## Prerequisites

- 服务端二进制：`%USERPROFILE%\.dsh\mcp\xiaohongshu\xiaohongshu-mcp-windows-amd64.exe`（xpzouying/xiaohongshu-mcp）。
- 配置在 `~/.dsh/profiles/web/cordis.patch.yml` 的 `mcp-xiaohongshu` 块：URL `http://127.0.0.1:18060/mcp`、`Authorization: Bearer` 令牌、`toolCallTimeoutMs`。令牌从配置里读，不要写死在别处。
- 登录态在 `%USERPROFILE%\.dsh\mcp\xiaohongshu\cookies.json`；未登录先跑同目录 `xiaohongshu-login-windows-amd64.exe` 扫码。

## How to Run

1. 探测端口：`Get-NetTCPConnection -LocalPort 18060 -State Listen`。
2. 没在听就先起计划任务（**首选**，进程脱离本会话，不占后台作业）：

```powershell
Start-ScheduledTask -TaskName xhs-mcp-service
```

   任务跑的就是同目录 `start-xhs-mcp.cmd`。**该任务没有任何触发器**（2026-10-10 实测 `Triggers.Count = 0`）：重启机器后不会自启，只能手动起。确实要走后台作业时（**必须 `run_in_background: true`**，见 Pitfalls）：

```powershell
& "$env:USERPROFILE\.dsh\mcp\xiaohongshu\xiaohongshu-mcp-windows-amd64.exe" -headless=false -port 127.0.0.1:18060 -token <从配置读>
```
3. 用 `mcp__xiaohongshu__check_login_status` 验登录态，再用 `mcp__xiaohongshu__search_feeds`。

## Quick Reference

| 项 | 值 |
|---|---|
| 只读工具 | `check_login_status`、`search_feeds`、`get_feed_detail`、`list_feeds`、`user_profile` |
| 禁调用 | `publish_*`、`*_comment_*`、`like_*`、`favorite_*`（写操作，风控风险高） |
| 客户端超时 | `toolCallTimeoutMs`，插件默认 60000；本项目已设为 180000 |
| 单次耗时 | 搜索 17–35s（冷启动最慢） |
| 仿真机制 | 服务端内置：`fingerprint seed pinned`、`fingerprint enabled`、`UA coherence` |

## Procedure

1. 端口 + 登录态两项先确认，再谈能不能搜。
2. 搜索阶段**只有标题和互动数，没有正文**。挑候选（标题命中 + 评论数高）后拉 `get_feed_detail`，带上返回值里的 `xsecToken`；`load_all_comments: true` 才拿得到评论区——本地人的实际答案通常在评论里。
3. 结论用笔记正文/评论原文当证据；互动数只用来挑候选，不算依据。
4. 面向结论先排软文：优先官方名录、基础设施硬数据、负面证据；点赞/评分不作数。

## Pitfalls

- **服务不常驻**。`Start-Process` 拉起的进程会在 pwsh 命令返回时被宿主回收；首选计划任务 `xhs-mcp-service`（无触发器，须手动 `Start-ScheduledTask`），其次后台作业。2026-10-10 实测：服务在 10-09 17:45 优雅关闭后一直没起来（`server.err.log` 末两行是「正在关闭服务器...／服务器已优雅关闭」），端口 18060 无人听 ⇒ 客户端的这一组工具在会话里根本不注册（表现是 `mcp-client(xiaohongshu): server is disconnected`）。服务没起时的症状是 `fetch failed`，不是超时。
- **不要直连 127.0.0.1:18060 绕开 MCP 客户端**。传输层不参与仿真——服务端日志证明直连调用同样打 `fingerprint seed`/`UA coherence`，与原生调用逐字一致；但那属于绕过平台通道，用户明确否决，且不带来任何收益。超时问题改 `toolCallTimeoutMs` 解决。
- 改 `cordis.patch.yml` 属宿主侧改动，**须用户重启 dsh 才生效**（会打断其它会话，先重启再刷新页面，反序报错）。
- 服务内部 `MustWait`（`search.go`）会零星报 `context deadline exceeded`，是服务端自己放弃，**重调一次即可**，不是参数错。
- 搜索结果 `displayTitle` 可能是空字符串，这类笔记要进详情才知道内容。
- 用户会自己动网络（关 Clash 等）；排障先报「服务在不在、登录态在不在」，别默认是代理问题。

## 挖"本地人真实去处"的四种搜法（实测有效）

1. **逐个子区域单独搜**。搜大类（"哈尔滨 美食"）只会得到攻略贴；把候选区域一个个单独搜才有本地讨论。注意关键词要带限定词——搜"哈尔滨 长春街"返回 0 条，搜"哈尔滨 道外 长春街 饭店"返回 20 条。
2. **否定帖 + 反驳法（最有效）**。先找避雷帖／唱衰帖（"XX 是美食荒漠""让我失望""巨难吃但会营销"），再读**评论区里本地人怎么反驳**。反驳是"被迫自证"，本地人一自证就会报出真地名。实测一条 281 评的低赞争议帖比同题材高赞攻略帖信息密度高得多。
3. **看反驳的类型**：归因型（"你时间没赶好/吃不惯"）不给替代；护店型（"这家开了几十年本地人常去"）证明老店；**报地名型**（直接甩一串区域+店）才是目标。
4. **交叉印证定权重**：同一条街被两条互不相关的帖子独立点到，才算硬证据。反面案例：某 1180 赞"本地人私藏小馆"帖，评论区把 5 家里 4 家拆了；同一位"20年接待土著"推荐的烧烤店，被另一帖本地人直接否掉——**单条自称本地人的推荐不成立**。

## 排除 AI 帖与推广帖（实测判据）

用户会明确要求"只看非 AI 的帖子"。**不要靠文风判断**（排比、emoji、小标题都不算证据），用三条可证伪的判据：

1. **可证伪细节**：真帖有只能实地获得的信息——门牌号、几点收摊、哪家挨着哪家、走过去几分钟；AI 帖是"地址＋交通＋亮点"的标准三件套。
2. **评论区纠错（最硬）**：真帖评论区会出现本地人纠正具体事实。实测正例：「餐厅是1968」（博主写的 1923）、「北山公园进门牌子写的是植物园」、「李杰熏酱这个不是老店，老店在钱塘街」。
3. **抓交通/地理错误**：某篇 144 赞的"本地人私藏 6 个小众秘境｜地铁直达"，评论区第一条是**「好几个地铁站都搞错了」**——6 个站全错，写的人没去过。地名/交通密集出错＝AI 或拼凑。

**推广矩阵识别（付费投放的硬证据）**：同一段模板评论出现在多个互不相关的帖子下，**只轮换开头那家店名**——

```
…欢迎尝尝【偏脸子烧烤】！老昌春饼！九转小磨！老鼎丰冰糕！…包好吃的！！
…欢迎尝尝【金刚山烧烤】！老昌春饼！老鼎丰冰糕！…包好吃的！！
```

模板一字不差、首店名轮换 = 投放。**这类评论的赞数是刷的，不能当依据。**

**赞数与可信度的实测反例**：一条 1180 赞的"本地人私藏小馆"帖，评论区拆掉 5 家里的 4 家；13 赞的避雷帖评论反而全是有效信息。

## Pitfalls（2026-09-30 实测补充）

- **服务必须在 dsh 启动之前就在跑**。启动时连不上，这一组工具在本会话里根本不会注册，症状是 `tools.mcp__xiaohongshu__* is not a function`（不是报错，是工具不存在），客户端也不会自己重连。
  补救：把 `cordis.patch.yml` 里该行的 `disabled: false` 临时改成 `true`，几秒后删掉那行（回到原状），插件会热重载并重新注册工具——**不必再重启 dsh**。
- `check_login_status` 这个工具本身常报 `context deadline exceeded`（服务端 bug），**不代表没登录**；直接用 `search_feeds` 验证更可靠。
- 单次 `search_feeds` / `get_feed_detail` 实测 17–92s，`load_all_comments: true` 更慢；偶发服务端 180s 超时，重调一次即可。
- **评论要显式抬 `limit`，默认只给 20 条**。源码 `xiaohongshu/feed_detail.go`：`defaultMaxCommentItems = 20`，且 `MaxCommentItems <= 0` 会被兜底回 20（注释说明"0 以前表示无上限"，现在不是了）。`limit` 的语义是**滚动到 N 条就停**，不是分页——实测 `limit: 80` 用 59s 取回 80 条（281 总评论），跑的是新内容。
- **没有游标翻页**：响应里带 `cursor`/`hasMore`，但工具入参不接受 cursor，想多看只能抬 `limit`。滚动侧护栏：`stagnantLimit = 20`（连续 20 次无位移即停）、滚动预算 `= limit * 3`。
- `get_feed_detail` 返回结构是 `{ feed_id, data: { note, comments } }`。**`data.comments` 是对象不是数组**：`{ list: [...], cursor, hasMore }`——只判 `Array.isArray` 会静默拿到 0 条评论，看起来像"这条笔记没评论"。`list` 每页 20 条，靠 `hasMore` 判断还有没有。
- **评论区比正文值钱，且必须看**：本地人的真实评价、纠错、劝退几乎只在评论里。实测一条 1180 赞的「本地人私藏小馆」帖，评论区把 5 家里 4 家拆了（"崔家服务太差""叶兴记算了吧真不好吃""小天烧烤不干了"），而同一批里一条 13 赞的避雷帖评论区反而全是有效信息。**选帖不要按赞数排，赞数和可信度无关甚至负相关。**
- 搜索结果的 `displayTitle` 只有标题，**正文和评论必须进 `get_feed_detail`**；品牌名、店名通常只出现在正文里。
- 判断软文：同题材多条笔记来自同一账号（官方号/商户号），或推荐里点名自家店名。例如「哈尔滨迷零皮草」既是商户号又出现在"本地私藏"类笔记里。

## 调用节奏（读源码得出，2026-09-30）

服务端 **v2.5.0 没有任何调用级限流**：`middleware.go` 全文无边限逻辑；`xiaohongshu/search.go` 只有页面级 `page.Timeout(60*time.Second)` 和 `waitFeedsChanged` 的 300ms 轮询。

所谓"仿真人机制"是 `humanize/delay.go` + `humanize/provider.go` 里的**动作级**对数正态延时，发生在**一次调用内部**，与调用间隔无关：

| 动作 | 分布 | 区间 |
|---|---|---|
| `AfterInteract` | μ0.88 σ0.30 | 2–3s |
| `AfterNavigate` | μ0.41 σ0.45 | 0.6–6s |
| `BeforeSubmit` | μ0.0 σ0.40 | 0.4–4s |
| `BetweenScroll` | μ-0.22 σ0.40 | 0.25–3s |
| `BeforeClick` | μ-1.61 σ0.45 | 80ms–1s |
| `Keystroke` | μ-2.12 σ0.50 | 30–400ms |

**因此间隔由我这边定**：单次调用的浏览器实际占用 16–107s（实测中位数约 33s），叠一个 **≥30s 静默**串行发，等于人"搜一次→看结果→再搜"的节奏。两条硬规矩：

1. **绝不并行**——服务背后是单浏览器实例，并行只会在服务端排队，反而产生非人的交错时序。
2. **`context deadline exceeded` 不要立刻重试**——那是服务端自己的 60s 页面 deadline（`search.go:101,115`）到期，不是限流信号；立即重试等于把一个已经超时的动作再压上去。等下一轮再发。

## 交付（本用户的硬要求）

产出的报告不是"交个 md 就算完"。三条同时满足：

1. **引一手原话，不转述**。引用网友内容时保留原句与赞数，别改写成我的概述。
2. **去 AI 味在结构，不在词汇**：删掉过程叙述（"本轮/实测/两次超时/已补取"）、自我评价（"这是最值钱的发现"）、编号总起小标题（"结论三条"）。这些是工作日志，读者不需要。
3. **必须带手机版 HTML**。用户是拿手机看文档的，只给 md 等于没交付。转换流程见技能 `mobile-readable-docs`（脚本 + 样式 + 无头渲染核对）。

## 用到高德时的定位坑

距离过滤、坐标比对这类活要接高德时：**`maps_geo` 对中小 POI 会返回城市中心兜底**——有坐标、有 level，看起来正常，实际是错的。实测 26 家店铺里 9 家返回同一个城市中心坐标；某民宿被定位偏了 13 公里。**凡是要拿坐标下判断，都必须走 `text_search`（citylimit）→ `search_detail` 取 POI 级坐标**，并且先用一个已知答案的点验一次。连锁店判"在不在范围内"要取**最近分店**，不是某家指定分店。

## Verification

`check_login_status` 返回 `✅ 已登录` 且 `search_feeds` 返回 `feeds` 数组（长度 20 左右）即通。
