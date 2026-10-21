---
name: dsh-plugin-discovery
description: Rank DSH plugins from the live market catalog and GitHub.
---

# DSH Plugin Discovery & Ranking

Use when the user wants to find, compare, or rank DSH community plugins by
topic, category, stars, downloads, or maintenance signals.

## Primary method: dsh-market's live registry

If `dshmarket` is installed in the profile, load the same live curated catalog
the market UI uses:

```bash
cd ~/.dsh/profiles/web
# A bare 'dshmarket/lib/registry.js' specifier FAILS: the package's "exports" map
# does not expose ./lib/* -> ERR_PACKAGE_PATH_NOT_EXPORTED. Import by file URL.
# Use FORWARD slashes in the embedded Windows path (backslashes get eaten as
# string escapes when the script is written to disk).
node --input-type=module - <<'REG'
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL('C:/Users/<you>/.dsh/profiles/web/node_modules/dshmarket/lib/registry.js').href)
const reg = await (m.loadRegistry ?? m.default.loadRegistry)()
console.log(reg.count, reg.updated, Object.keys(reg))
const items = reg.items ?? reg.plugins ?? []
REG
```

Registry record shape:

- `name`, `owner`, `url`, `category`
- `description.en`, `description.zh`
- `npm`, `tarball`, `install`, `added`
- `stars`, `downloads` (nullable; null means unknown, not zero)

## Fast path: the `category` field

Both catalogues carry a human-assigned `category`. `browser` (65 entries) is the
right starting pool for browser questions, but it MIXES real browser *control*
plugins with `web_search`/`web_fetch` *provider* plugins. Require a browser noun
AND a control verb; matching only 操控/控制 pulls in remote-control and
desktop-control plugins that never touch a browser.

## Filtering

- Search both `description.zh` and `description.en`, plus `name`, `url`, `npm`.
- Use word-boundary regexes for English words. `story` matches inside
  `history`, so prefer `\bstory\b`; simpler Chinese terms like `小说` are safe.
- After matching, manually drop false positives when the query is semantic
  (e.g., "history" plugins matching `story`, RPG themes mentioning "novels").

## Star data

The live registry can return `stars: null` for newer entries. Refresh via
GitHub API:

```js
const url = new URL(p.url)
const repo = [ ...url.pathname.split('/').filter(Boolean) ].slice(0, 2).join('/')
const res = await fetch(`https://api.github.com/repos/${repo}`, {
  headers: { accept: 'application/vnd.github+json' }
})
const stars = res.ok ? (await res.json()).stargazers_count : p.stars
```

For monorepo entries, use the first two path segments (owner/repo), not the
subdirectory path.

If the API is rate-limited (anonymous ~60 req/h), fall back to the repo's
`releases.atom` RSS feed (`https://github.com/<owner>/<repo>/releases.atom`)
or the release-tag HTML pages — both bypass the API limit.

## Sorting

Put null stars last:

```js
items.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
```

## Method 2: GitHub repository search (when the registry is thin or unavailable)

The local registry can come back empty in a script (`reg.items` undefined) and
only knows entries the market indexed. GitHub search finds the whole ecosystem, so
run it alongside — the user may also simply say "the plugins are on git".

```powershell
# pass the WHOLE url-encoded query as the path: -f q='... --profile ...' makes gh
# parse the value as flags, and --jq with \(...) is mangled by PowerShell.
gh api "search/repositories?q=dsh+plugin+deepseek-harness&sort=stars&order=desc&per_page=25"
gh api "search/repositories?q=%22dsh+plugin+--profile%22+in%3Areadme&sort=stars&order=desc&per_page=25"
```

Redirect the JSON to a file, re-encode it, then parse in node — an explicit `powershell.exe` (5.1)
writes UTF-16 and node's JSON.parse cannot read it. **The DSH `pwsh` tool is PowerShell 7.6.7 since
2026-10-15 and writes UTF-8, so the re-encode is only needed under 5.1:**

```powershell
$j = gh api "..." | Out-String
[IO.File]::WriteAllText('D:\tmp\gh.json', $j, [Text.UTF8Encoding]::new($false))
node -e "const j=JSON.parse(require('fs').readFileSync('D:/tmp/gh.json','utf8')); for (const r of j.items) console.log(r.stargazers_count, r.full_name)"
```

### Reading the results

- **GitHub 只覆盖"开源代码"这一层；同一问题往往同时有"论文层"，而论文层能给出实证结论**。一次自建系统的"是否重复开发"核查里，GitHub 四路搜索全部命中 ≤2★ 的长尾，而**真正同题的既有工作是在会议论文里找到的**（ICML 2026）。⇒ 搜索面必须扩到会议虚拟站（`icml.cc/virtual/<year>/...`）、arXiv，并用**问题域**（不是产品名）作查询词（如 "visual memory agent"、"image lifecycle LLM"）。**会议摘要页常带 project page / code / OpenReview 链接**，是拿到代码与作者的捷径。
- **引用论文前必须验存在性**：搜索结果的标题列表里**混着幻觉条目**（本次 `2606.14106` 的引用格式可疑，遂核）。一条命令即可判真伪：
  `https://export.arxiv.org/api/query?search_query=ti:%22<精确标题>%22&max_results=5` —— 看 `totalResults` 与 `<entry><title>` 是否逐字一致；对不上就整条丢弃，**不要因为它在搜索引擎结果里就采信**。
- **覆盖面 ≠ 新颖性**（本会话被用户纠正的判断错误）：生态内"没有同类"**只证明这个平台没人做**，不证明没人做过。判"是否重复开发"要换到**问题域**这个尺度：先写清自己解决的是哪一类问题，再在别的生态里找同类做法。反例教训——按平台内标准，887★ 的视觉插件是生态头部，看起来"最大重合"；换到"AI 图片生命周期管理"这个域，它**根本不在同一赛道**（它把图发给外部视觉 API，解决的是"模型看不见"）。⇒ **先定赛道，再看重合度**；赛道定错会得出完全相反的结论。
- **Stars belong to the monorepo, not the entry.** One 7.6k-star project shows up as
  10 entries with the same count — rank PROJECTS, then pick the entry you need.
- **Aggregate-package peers** (the shape this family ships) are repos whose install
  line is a single npm bundle, often named `<scope>/<project>-all`, or a suite that
  installs an injector plus presets. Filter candidates by `p.npm`/`p.install`, then
  confirm by reading the repo's README install section.
- **Benchmarking their docs**: fetch `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/README.md`
  and profile it before reading it — byte size, heading skeleton, badges, images,
  table rows, code fences, `<details>` count. Adopt the INFORMATION HIERARCHY
  (what it is → do I need it → fastest working path → daily use → control → failure
  → reference); reject the marketing devices (badge walls, star CTAs, centered HTML
  theater, cross-promo link farms). Copying those wholesale is the failure mode the
  user corrected once: extract what a reader gains, not what the peer displays.

## Capability questions ("does anything let DSH do X?")

Catalog blurbs lie about capability — every browser plugin "screenshots" without ever
touching the OS screen. Classify each candidate on TWO independent booleans read from
its README, never from the blurb:

- **performs the action** (capture / drive / write) vs merely consumes the artifact;
- **targets the requested platform** (Windows / macOS / Linux / a device).

The biggest false positives are high-star toolkits: a vision toolkit that *reads*
screenshots lists no capture tool. Open the README's tool inventory table and look for a
capture row; no capture row means no answer regardless of stars. Same trap: "browser page
screenshot" is not "OS screen capture", and Android / HarmonyOS / ROS / Godot captures are
different targets again.

### 能力不在 README 也不在工具表，在三处源码（2026-10-12 两次代码级核查的结论）

上一条说"打开 README 的工具清单表找 capture 行"——**那次核查证明这一层还是太高**。两个同域项目的代码级核查里，README/工具表给出的能力面**都被显著高估**：

| 看哪里 | 它决定什么 | 本次实例 |
|---|---|---|
| **数据模型里存了什么** | 什么**根本不可能**做到 | 一个项目只持久化 **64×64 WebP base64 缩略图**、另一个只存 **≤512px q85 有损 JPEG**，原图只记尺寸 ⇒ **像素级取用在其数据模型上不可能**，与它有多少工具无关 |
| **调用图（有没有人调到）** | 声明的能力里**多少是活的** | 一个项目 37 项能力中 **9 项零调用**（含全库唯一的"区域→像素"代码），`ttl` 未接线导致"持久行永不因龄过期"、`ocr_text` 列无写入点；另一个项目 **112 个工具**（README 声称 21）且语义轴依赖一个**缺失的模型文件**（仓库里是 15 字节文本 `Entry not found`，运行时找的又是另一个路径）⇒ 开箱即**静默零向量退化** |
| **工件形态（无损/有损、全量/缩略）** | 它的能力**服务于什么用途** | 两者都**从不落盘原始字节** ⇒ 它们是"分析结果缓存"，**不是归档**，谁也无法把一张图交回给消费者 |

⇒ 判据：**"能不能做 X"由数据模型判，"实际做不做 X"由调用图判，"做成什么样"由工件形态判**——三者都要读源码；README 与工具表只能用来**定位**这三处。凡只读到工具表就下的能力结论，一律标 `[推断]`。

### 子智能体的核查结论必须被主对话抽验（本次抓到一处反例）

派子智能体做代码级核查是有效手段，但**它的"证伪"也会错**：一次报告写"全仓无 sqlite/http 依赖"，抽验发现两个依赖都在（`rusqlite` 5 处引用、`reqwest` 15 处）——**结论方向对（那些声称的功能确实没实现），论据错（依赖存在，只是用在别处：域凭据保险库与资产下载）**。⇒ 主对话至少抽验**最要命的那一条**（决定进门/出门的那条），并把抽验命令与结果一并留痕；子智能体的 `文件:行` 是抽验的入口，不是可信度凭证。

Keep per-candidate evidence (win / capture / macOnly) plus raw hit counts, so an excluded
1200-star repo can be justified rather than silently dropped.

## Installed-plane questions ("what is installed here?" / "which plugin gives X?")

Catalog work answers what EXISTS; these questions are answered from the machine, and the
answer must split **platform-shipped** from **third-party installed** — the user checks
that split first. Authoritative sources, in order:

1. `$DSH_HOME/profiles/<name>/package.json` — `dependencies` AND `dsh.profile.bundles`
   (a dependency absent from `bundles` is installed but never mounted; the reverse also
   happens, so read both).
2. `$DSH_HOME/profiles/<name>/cordis.patch.yml` (+ `$DSH_HOME/cordis.patch.yml`) —
   `disabled:` flags, `insert:` rows, MCP rows. Each row `id` is what a boot log names.
3. `node_modules/<pkg>/package.json` — the REAL installed version (never the range in
   `dependencies`), and its `dsh.bundle.patch` names the rows it inserts.
4. Platform bundles (`@deepseek-ai/dsh-base`, `dsh-web-app`, `dsh-experimental-*`) are
   NOT in the profile's `node_modules`; they resolve from the dsh bundled inside the app's
   `resources/app.asar`. Report them as platform-provided, never as installs.
5. Live state: the host process command line names the profile dir it booted with, and
   every config mtime must be ≤ that boot time before calling the report "currently live".

**Capability attribution** ("is there a plugin that does X?") — grep the installed
packages for the capability's real identifiers, open the implementation at its trigger
site, then name the owning plane. A hit that only *parses another tool's logs about* the
capability is not an implementation of it. Grep list and worked example:
`references/local-installed-plane.md`.

**Mount-topology trap**: a GUI-plane (`web-app`) patch can `disabled: true` rows the base
bundle inserted, moving the real mount into **agent-preset** scope. Profile-root patches
cannot reach rows inside a preset — behaviour changes mean editing the preset file. The
`minimal` preset mounts no compaction at all, so "the platform supports X" ≠ "this
session has X". Check the preset before claiming a capability is live.

## Filtering on the FORM of a tool's return value

Catalog blurbs describe what a plugin *does*, never what it *returns* — so "capture the
screen" looks identical whether the tool hands back an image block or just a file path.
When the requirement is about payload form (raw image vs path vs text), the curated
catalog cannot answer it: read each candidate's README and look for a pipeline diagram
(saveImage() -> image content block -> model) or an explicit counter-claim ("passes a
path, not an image"). In one sweep of 2710 curated entries, ZERO declared an image
return — the only explicit statement was a path-only disclaimer. Expect this axis to
require per-repo reads.

## Every GitHub-API script needs the token prefix

A helper that calls api.github.com fails *silently* without a token: the anonymous budget
(60/h) exhausts easily, and a retry loop then reports every repo as unfetchable, which
reads exactly like "these repositories do not exist". Prefix such commands with
`$env:GH_TOKEN = (gh auth token);` and distinguish 403 (rate limit) from 404 (absent)
before drawing any conclusion.

### Topic search misses the biggest repos

A topic-scoped sweep (`topic:mcp screenshot`, `topic:dsh-plugin ...`) finds the long tail and
misses the head. CursorTouch/Windows-MCP — 7037 stars, the dominant Windows computer-use MCP
— appeared in NONE of five topic queries, yet surfaced immediately from a "closest peers"
comparison table inside another repo's README. Mine candidate READMEs for their comparison
sections and follow every peer link; cross-references reach the head of a category that
topic filters never will.

**2026-10-12 再次证实，且更强**：一个我自建的图片存档插件的领域里，`topic:dsh-plugin` 的头部项目 `Anionex/dsh-vision-toolkit`（**887★**）在**三路主题搜索（`dsh-plugin image` / `screenshot` / `视觉`）里一次都没出现**，全部命中都 ≤2★；它是**从目录仓（`0xsline/awesome-deepseek-harness` 的清单行）捞出来的**。同时 `topic:dsh-plugin` 已被**完全无关的高星项目**蹭满（PicGo 27k★、NocoBase 24k★、caffe 34k★）⇒ **该 topic 的"命中 N 条"不能当生态规模证据**，必须按 star 排序后再用仓名关键词硬过滤。

⇒ 结论固化为流程：**主题搜索＝补充（找长尾）；目录仓/peer 表＋会议论文＝找头部与同题工作**。三个来源缺一不可，且**都不能单独用来回答"有没有人做过"**。

### `gh api --jq` 的准确边界（比"\(...) 会被 mangled"更精确）

同一条命令里三种写法的实测结果不同，**别把整类 `--jq` 判死**：

| 写法 | 结果 |
|---|---|
| `--jq '.stargazers_count'`（纯点路径） | **可用** |
| `--jq '.["stargazers_count"]'` | 失败：`function not defined: stargazers_count/0` |
| `--jq '"[\(.x)] \(.y)"'`（字符串插值） | 失败：`failed to parse jq expression`——PS 把 `\(` 的反斜杠吃掉，jq 收到的是 `[\(.x)]` |

⇒ **规则（2026-10-15 修订）**：以上是 **PS 5.1** 的行为；DSH 的 `pwsh` 工具已是 **7.6.7**，实测带引号与管道的 `--jq '.name + " " + (.stargazers_count|tostring)'` 原样送达 jq ✓。5.1 下仍守旧规矩：`--jq` 只用纯点路径，要拼字段就 `gh api <path> | Out-String | ConvertFrom-Json` 再取值。

### When shell quoting keeps breaking, stop quoting

Nested quotes, regex, and backticks inside a PowerShell command string fail in ways that look
like syntax errors in the wrong layer ("Expected ',', got '<lexing error>'"). After a second
failed attempt, stop fighting it: write the payload to a file, then use the file tools.

    gh api -H "Accept: application/vnd.github.raw" repos/<owner>/<repo>/readme > $tmp
    # then: read $tmp  /  grep '^## ' $tmp

A 32 KB third-party README that kept breaking inline parsing became readable in one step this
way, and the same trick works for API JSON. Build multi-line commands as a JavaScript array of
SINGLE-quoted strings joined with newlines — backticks and double quotes inside them then cost
nothing.

One more trap: never name a local variable `tools` in a run_code program. It shadows the SDK
binding and the program dies with "Identifier 'tools' has already been declared" before any of
your logic runs. Rename it (toolRows, picks, ...).

## Static catalogue mirror (works without dshmarket — e.g. the desktop plane)

`https://awesome-dsh-plugin.com/plugins.json` is the machine-readable twin of the same market
(measured 2026-10-09: **4460 entries**; top-level `{name,url,source,updated,count,categories,plugins}`).
Each entry carries what a selection decision needs, without loading any profile:

| Field | Use |
|---|---|
| `install` | the exact command; `npm: null` ⇒ github-only spec |
| `npm`, `version` | published package + version (null ⇒ private/github-only) |
| `stars`, `downloads`, `downloadsStart/End` | demand evidence (downloads need a window to mean anything) |
| `capabilities` | declared surface: shell / fs-read / fs-write / network / env / host-runtime / llm |
| `capabilityRedLines` | **the risk filter** — e.g. "reads credentials/secrets AND has network access", "uses literal IP 169.254.169.254" |
| `category`, `added` | pool + freshness |

Fetch it with node/https (4.8 MB; do NOT pipe it through PowerShell inline quoting).

## Two traps that decide the answer

1. **The name is not the identity.** One plugin name can point at two sources: the npm package's
   `repository` versus the market entry's github `url`. Measured: `dsh-routing-suite` ⇒ npm 0.1.2
   (repo `dragonbaba/…`, a simple routing mode) **and** market `yjh051108/dsh-routing-suite`
   (`npm: null`, a three-part injector suite). Likewise `open-design` ⇒ `nexu-io/open-design`,
   which is **not a DSH plugin at all** (a desktop design app that consumes `dsh` as one of its
   runtimes via `od agent setup deepseek-harness`; code search for `"dsh plugin add"` in that
   repo = 0 hits — a ranking chart's "install" line is not the repo's own instruction).
   Pin the repo first (`npm view <pkg> repository` vs the market `install` spec), then read it.
2. **Peer ranges gate; they do not certify.** Open ranges (`>=0.1.2-rc.1`) install on any newer
   line, so a passing platform gate says nothing about author testing. Read the package's **own**
   declarations: `dsh.compatibility.dshReleases` (measured: `dsh-thoughtdag` certifies
   0.1.2-rc.1 / 0.1.5-rc.1..rc.3 and **no 0.2.x** ⇒ unverified on 0.2.0-rc.2);
   `dsh.desktop.presets` (present ⇒ the desktop installer materializes presets; absent ⇒ copy them
   into `$DSH_HOME/.agent-presets/<name>` by hand); `dsh.client.platform: "web"` (still mounts in
   the **desktop** app — its client IS the web client; it says the plugin injects client services,
   not that it is web-only). A plugin certified one platform line behind is the same risk class as
   any unverified port: install one at a time, cold-boot, read `did not activate` in the boot log.

## Fallback without dsh-market

The curated checkout is at `D:\\dsh\\awesome-dsh-plugin` — 2710 entries across 24 categories — and contains static data:

- `data/plugins/*.yml` — curated plugin metadata/descriptions
- `data/stars.json` — star snapshots keyed by URL

## Reference

- `references/novel-writing-search.md` — worked example: finding and ranking
  DSH novel-writing plugins from the live market catalog.
- `references/local-installed-plane.md` — enumerating what is actually installed in a
  profile (bundles, patches, real versions, app.asar platform packages, boot logs) and
  attributing a capability to plugin vs platform vs preset scope.
