---
name: deck-page-imitation
description: Produce new deck pages that match a reference page exactly.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [PowerPoint, SlideDesign, Cloning, VisualQA]
    related_skills: [office-pptx, docx-layout-and-figures]
---

# 参照页仿写（Deck page imitation）

给一份既有 PPT，用户要求「严格仿照第 N 页」再生成一页或几页（常见形态：一版一页的多版本，放同一个文件）。做法是把参照页**自己的形状元素整份深拷贝**进新页，只改文字与位置，不重画——配色、字体、芯片、箭头、成果框天然与参照页一致。本技能只管仿写与视觉验收；原生图表/动画/SmartArt 的语义编辑走 `office-pptx`。

## When to Use

- 「严格仿照 PPT 里第 X 页生成一页」「多出几个版本，每个版本一页，存在同一个 PPT 文档中」
- 要在既有行内模板（汇报/年终总结母版）下新增页，样式不能跑偏
- 把某个业务场景的页面改写成另一个场景：内容换、版式不换

## Prerequisites

- `load_workspace_dependencies` 取 bundled python（含 python-pptx 1.0.x）；脚本与产物放任务目录
- 源文件只读：先复制到工作区再改，绝不在用户原文件上写
- 开工前先跑一次渲染，确认预览链路可信（见 Pitfalls「预览可信度」）

## How to Run

1. `officecli view <ref.pptx> outline` 与 `view <ref.pptx> text`：弄清参照页有哪些文字
2. `officecli view <ref.pptx> screenshot --page N`：看清版式，别只靠 XML 猜
3. 写 build 脚本（骨架见下；本族模板的具体坐标见 `references/ccb-workplan-deck.md`）
4. `<bundled python> build.py` → 每页 screenshot 审 → `officecli validate` → `present`

## Quick Reference

| 动作 | 做法 |
|---|---|
| 建新页 | `add_slide(src.slide_layout)`，清掉自动带的占位符，再逐个 deepcopy 参照页 spTree 子元素 |
| 保格式改文字 | 改首个 run 的 `<a:t>`，删多余 run/段落，rPr/pPr 全保留 |
| 加粗前导段 | 「技术路线：……」这类拆 run0/run1 分写，别整段覆盖 |
| 克隆后必做 | 剔 `p:custDataLst`（tag 关系在新页不存在）；重编 `p:cNvPr/@id`（否则 id 撞车） |
| 位置/尺寸 | `a:off`+`a:ext` 双改；`grpSp` 的 xfrm 在 `p:grpSpPr`，sp 的在 `p:spPr` |
| 删原页 | 先 `prs.part.drop_rel(rId)`，再删 `p:sldIdLst` 条目 |
| 多版本 | 一版一页同一文件；每页 speaker notes 写该版本取向与适用场景 |
| 交付 | 复制到用户源文件同目录 + `present`；工作区留副本与 build 脚本便于改文案 |

```python
import copy
from pptx import Presentation
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'

tpl = {el.find('.//' + P + 'cNvPr').get('name'): copy.deepcopy(el)
       for el in src.shapes._spTree if el.find('.//' + P + 'cNvPr') is not None}
_seq = [800]

def instantiate(tree, name, newname=None):
    el = copy.deepcopy(tpl[name])
    for c in el.iter(P + 'cNvPr'):                 # 防 id 撞车
        _seq[0] += 1; c.set('id', str(_seq[0]))
    for t in list(el.iter(P + 'custDataLst')):     # 防悬空 tag 关系
        t.getparent().remove(t)
    if newname:
        el.find('.//' + P + 'cNvPr').set('name', newname)
    tree.append(el); return el

def set_text(el, lines):
    """整块改写，但沿用首个段落/首个 run 的格式。"""
    tx = el.find(P + 'txBody'); ps = tx.findall(A + 'p')
    tmpl_p = copy.deepcopy(ps[0])
    for tag in ('r', 'fld', 'br'):
        for c in tmpl_p.findall(A + tag): tmpl_p.remove(c)
    runs = ps[0].findall(A + 'r'); rtmpl = copy.deepcopy(runs[0]) if runs else None
    for p in ps: tx.remove(p)
    for line in lines:
        p = copy.deepcopy(tmpl_p)
        if line and rtmpl is not None:
            r = copy.deepcopy(rtmpl); r.find(A + 't').text = line
            epr = p.find(A + 'endParaRPr')
            epr.addprevious(r) if epr is not None else p.append(r)
        tx.append(p)
```

## Procedure

1. **列全参照页的文字元素**，不是只列主体图。清单必须包含：页眉标题/副标题、说明条、行名/分组名/芯片、成果框、**责任部门或分工列**、页脚结论条、图例、页码域。漏一项就会出现「另一个场景的文案被整段带过来」。
2. **建页**：`add_slide(参照页的 layout)` → 清占位符 → 按 z 序 deepcopy 参照页元素（外壳在前、行结构在后）→ 建名字索引。
3. **改写**：只动文字与几何；需要新增芯片/分组时，从同页既有芯片 deepcopy 再改文字，样式自动一致。
4. **几何**：行高变化时按比例重算 y/高度，别让芯片压线；框高不满足最小行高就升框高（文本框透明，视觉不动）。
5. **渲染审**：每页 screenshot，逐项目视：芯片阅读顺序、分组标题是否对准芯片、留白是否偏心、文字是否折行/裁切。
6. **收尾**：删原页（drop_rel + sldIdLst）→ validate → 复制到用户源文件同目录 → `present`。

## Pitfalls

- **场景串味（用户会当场抓）**：只改主体图、外壳文字沿用参照页，等于把另一场景的话术搬过来。验证手段：读 slide XML 里全部 `<a:t>` 做全量 dump，拿源场景关键词当黑名单 grep，期望 0 命中。`python-pptx` 的 `slide.shapes` **不下钻 `p:grpSp`**，组内文字会漏检，必须读 XML（用 `scripts/scan_slide_text.py`）。
- **文本度量**：可用宽度 ≈ 框宽 − 左右内边距；每行字数 ≈ 可用宽度 ÷ 字号（CJK 记 1 em）。窄框典型：0.80 in @14 pt ⇒ 3 字/行；1.06 in @10 pt ⇒ 6 字；1.56 in @10 pt ⇒ 11 字。芯片一行 10 pt 需框高 ≥0.30 in，两行 ≥0.44 in。
- **2×2 芯片按列摆会把链路读反**（左列放 1、2，右列放 3、4 → 渲染成 1、3 / 2、4）。链条类内容一律先横后排。
- **自动 issues 检查器对 CJK 过度悲观**：参照页自己可能带几十条 `text overflow`。把新页告警集与参照页基线对比，只修**新增类别**，并以渲染图为准，别被它牵着改版式。
- **预览可信度**：用能出整页的截图（`officecli view <f> screenshot --page N`）。某些 raster CLI 对特定母版会放大裁剪（实测 1.5×：XML 里 6.45 in 的箭头渲染在 9.7 in 处）——换预览工具前先用一个已知形状的像素位置验标度，别拿裁剪图当审美依据。
- **近义词重复**：分组标题与其芯片用同一批词（标题「语义归因回流」下再放「语义归因」芯片）算缺陷，换词到互不重叠。
- 删页后不可达 part 不会进包：`drop_rel` + 删 `sldIdLst` 即够，无需手清 `[Content_Types].xml`。
- 产出的文件名与页序要让用户一眼分清是哪一版；版本取向写进 speaker notes，别写在页面上（会破坏仿写一致性）。

## 文案层（汇报口径，用户判据）

- **总纲条讲实质，不讲通用流程**。判套话的检验：把这句话换成别的主题看是否仍成立——仍成立就是套话。AI 主题页的总纲句必须以 AI 机制名词/动作作主语；通用流程词（事前/事中/事后、近期/中期/长期、先旁路后主流程）不得占总纲篇幅。
- **骨架**：「在…既有能力基础上，〈主题名词〉做①②③④；〈边界：什么情况不交给它〉」。边界句（如「置信度不足一律转人工」）是领导拍板要听的那句，不能省。
- **三区职责分离，同一论点不说三遍**：顶部总纲=主题做什么 + 边界；页脚=推进方式与风控口径；行名=阶段或分层。改总纲必回看页脚，否则同一句话在顶部/行名/页脚各出现一次。
- **多版本取舍排序**：领导先读总纲句 → 行名即结论 → 风险姿态可见；按此推主讲页，密度最高的并列版留附件/答疑页。行名用时间刻度（近期/中期/中长期）时，必须给出时间口径或明写「以效果验证为准」，否则现场必被追问。

## Verification

1. `officecli validate <out.pptx> --json` → 0 errors；`view <out.pptx> issues` 的告警集不超参照页基线类别。
2. 每页 `screenshot` 目视一遍（芯片顺序 / 标题居中 / 留白 / 不裁切），已改页面重渲，未改不重复渲。
3. `python scripts/scan_slide_text.py <out.pptx> --require 必含串 --stale 源场景词` → 命中 0、缺失 0。
4. 页数、文件名、桌面/工作区两份都在；`present` 指向用户会打开的那份。

支持文件：`references/ccb-workplan-deck.md`（建行年终总结母版 + 工作方案页的具体坐标与四版组织逻辑）、`scripts/scan_slide_text.py`（XML 级文字 dump 与串味扫描）。
