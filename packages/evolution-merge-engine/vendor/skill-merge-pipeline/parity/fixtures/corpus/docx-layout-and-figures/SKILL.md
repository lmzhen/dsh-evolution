---
name: docx-layout-and-figures
description: Verify and fix Word layout, fonts, and figures in a .docx.
version: 0.1.0
author: Hermes
platforms: [windows]
metadata:
  hermes:
    tags: [Word, Docx, Figures, Layout, Verification]
    related_skills: [invention-point-mining]
---

# Word 交付物的排版、配图与验收

给 .docx 交付物（交底书、报告、论文）画流程图并用 **Word 自己的排版引擎**验收版式与字体。
本技能只做「配图 + 离线验收」，不覆盖 officecli 的文档编辑能力（那是 officecli-docx 的活）。
依赖：Windows + Word（COM）、python 带 pymupdf / python-docx / matplotlib。

## When to Use

- 用户说「检查一下排版有没有问题」「字体不对」「看着不如样例/参照件」
- 需要给 .docx 加流程图、状态图、泳道图
- 从模版重建过正文之后（段落重排会把字号、字体、图位全部重置）

## Prerequisites

- Word 已安装且可 COM 调用；目标 .docx **未被 Word 占用**（占用时报 io_error，改在副本上作业）
- `python -c "import fitz, docx, matplotlib"` 通得过
- 中文字体 TTF 实际路径（本机在 `%LOCALAPPDATA%\Microsoft\Windows\Fonts\`，如 chcfs.ttf=彩虹粗仿宋、
  chht.ttf=彩虹黑体、chkt.ttf=彩虹楷体）；**先确认字体文件存在再画图**，否则中文变方框

## How to Run

1. 对齐参照件风格（有参照件时必做，见 Procedure 第 1 步）
2. matplotlib 画图：`matplotlib.use('Agg')`，每处文字用 `FontProperties(fname=TTF, size=…)`，
   `figsize=(宽,高)` + `dpi=200`，白底 PNG
3. python-docx 插图：按图注文本定位 → `insert_paragraph_before()` → 居中 → `add_run().add_picture(png, width=Cm(14.5))`
4. Word COM 只读导 PDF → PyMuPDF 逐页几何验收（下方 Quick Reference 五道检查）

## Quick Reference

- 版心换算：A4 595×842pt；页边距 1440/1800 twips → 文本区约 x 72–523、y 90–752
- 五道检查：① 文本越界 ② 相邻行 bbox 垂直重叠 >45% ③ 图片下方 60pt 内是否有「图N.」图注
  ④ 页面末行是否标题字体 ⑤ 每页底部空白 >90pt
- 图宽取满版心 **14.5cm**；图内字号 8.5–9.5pt（折到页面约 7–8pt，参照件常为 9–11pt）
- **图随注走**：图片所在段落设 `keep_with_next = True`，否则整幅图占满当页下部时图注会被挤到次页（实测发生过）。
- **图注体例**：参照件多为「图N.短标题」——居中、小四（14pt）、不缩进；带括号的长说明会折成两行且不合体例，应把说明挪进正文。
- **两图同页**：两图都想落在同一页却总被拆开时，把两张都略收窄（14.5 → 13.5cm）通常就能同页，消掉半页空白；收窄幅度 ≤1cm 时与其他图并排看不出差异。
- 图内字号反推：`图内pt × (插入宽度 / 画布宽度) ≈ 页面pt`
- 图高超过当前页剩余空间 → 整幅跳页，前页留大空白；总流程图改双栏/泳道压高（实测 402pt→212pt，24→23 页）
- 字体验收基线（PDF 里 span 的 font 名）：正文 CHCFS、标题 CHHT、二级标题中文 CHKT、西文数字 TimesNewRomanPSMT
- **两份参照件的实测差异（判断「不一样」是参照件本来就不齐，还是我方写错）**：示例一（信贷助手）**全篇只用 CHCFS**，连标题都是彩虹粗仿宋；示例二（两阶段跨平台）一级标题 CHHT（184 字）、二级标题 CHKT（实测「2.1 基本背景」为 CHKT），正文同为 CHCFS 16pt。两者做法不同，取任一套都算与参照件一致——本会话取示例二那套（一级黑体＋二级楷体）。
- **两份参照件的共同点（真正的硬要求）**：A4 210×297mm；边距 L/R 31.8mm、T/B 25.4mm；正文首行缩进 2 字（406400 EMU）；图注居中、无缩进、14pt、样式 o；**都没有页脚页码**；都不放表格；第 2 节标题用**半角逗号**「2、详细介绍技术背景,并描述已有的与本发明最相近似的实现方案。」（用全角「，」是三家中唯一不一致的细节，改起来最容易被漏掉）。
- **排版密度基线**：交底书落在 384—458 字/页（示例一 384、示例二 458）属正常；偏离过多先查行距与字号，别急着改内容。
- **成品命名**：.docx 与正文源 .md 都按发明名称命名（与参照件同名惯例），不要留「合并稿 v1」这类工作稿名。

## Procedure

1. **先读参照件的图，再动手画。** 把参照 .docx 用同一个 COM 流程导 PDF，PyMuPDF 取 image block 的 bbox，
   按 200dpi 裁剪渲染成 PNG 逐张看：框型（直角/圆角）、分组方式（花括号/泳道容器）、有无菱形判断节点、
   着色习惯、图内字号、图宽占比。凭想象画出来的图，一定会被用户退回。
2. 画图：用一个脚本一次生成全部图，风格参数（框型、填充、字号）集中定义，便于整批调整。
3. 插图：按图注定位插入，保证「图在注上」；插图后不要再动文字批。
4. 验收：COM 导 PDF（`ExportAsFixedFormat(pdf, 17)`；`ComputeStatistics(2)` 取页数、`(3)` 取字符数），
   再跑五道检查；命中项逐条修，改完重导重验。
5. 报告：页数 + 五道检查结果 + 字体名清单 + 每张图与图注是否同页。

## Pitfalls

- 判「标题孤行」必须用 **字体名**，不能用字号：正文运行级本来就是 16pt，用字号会整篇误报。
- 二级标题的小节号数字容易落回主题字体（Cambria-Bold）。显式给该段运行级设 `font.latin=Times New Roman`，
  并核对与参照件一致（三份参照件用的字体可以各不相同，但别让主题字体混进来）。
- **每次重建正文后必须重跑运行级字体批**：段落样式不携带特定中文字体，只灌样式会掉回默认字体（用户一眼看出「字体不对」）。
- 用 Word 时不要抢前台：COM 只读导出不需要窗口可见；用户正在用机器时反复 AppActivate 会打断他。
  只有必须用真浏览器时才走桌面路径（`Start-Process chrome --proxy-server=…`，再读 DOM）。
- 描边与填充照参照件来，别自创配色；常见的轻着色是出口/终态框（绿=通过、红=拒绝/失败）。
- 图内文字过密会把框撑破：先压短文案，再谈缩小字号。
- **清悬空 media 要连关系一起删**：以模版为容器生成的 .docx 常在 `word/media/` 留下未被正文引用的历史图片；只删文件不删 `word/_rels/document.xml.rels` 里的 Relationship 与 `[Content_Types].xml` 里的 Override，python-docx 会以 `KeyError: There is no item named 'word/media/imageN.png'` 打不开（Word 自己倒是能开）。三步一起做，删完立刻用 python-docx 重开一次验证。
- **加图后必重跑三件事**：①「图与图注同页且图注在图下方 60pt 内」；②图注中心与版心中心对齐（实测：版心 90–505pt，中心 297.5pt，图注中心应落在此附近）；③逐页底部空白——整幅图放不进当页剩余高度时会把半页留空，先看图高与当页剩余高度的关系再决定收窄还是接受。
- **脚本目录别放与标准库同名的 .py**：python 把脚本所在目录放进 `sys.path[0]`，在作业目录里建一个 `struct.py` 会让之后所有脚本的 `import zipfile/docx/fitz` 崩成 `AttributeError: module 'struct' has no attribute 'calcsize'`（本次踩过）。摸底脚本一律起名如 `measure_struct.py`。
- **图件高度决定整页空白**：竖版或高图（例：2260×3008 的泳道图插 11.5cm 即 434pt）放不进当页剩余高度就整幅跳页，前一页留半页空白；正文精简后分页会整体平移、空白位置随之搬家，出稿后必须重跑五道检查。要消空白只能压图宽（例：434pt 的图压到 ≤9.8cm 才能塞进 396pt 的剩余高度），代价是图内字变小——先问用户要白页还是要可读性，别默认压。
- **协作稿先验来源版本**：对方（人或模型）说「已按你的意见改过 docx」时不要采信声明——`Get-Item` 看 mtime/size，
  并抽查被点名改动的那几段原文。实测遇到过：回复声称已统一触发表述、补齐编号，但文件 mtime 与内容均未变。
  若修订只存在于回复 md 中，就明确「以回复 md 为准、由我方在合并稿落实」，不要按旧 docx 合并。

## Verification

- `ComputeStatistics(2)` 页数 + PyMuPDF 五道检查 **零命中**
- 每张图与其图注同页且图注在下方 60pt 内
- PDF span 字体名与目标基线一致（示例：CHCFS 10129 字 / CHHT 193 字 / CHKT 10 字 / TimesNewRomanPSMT 433 字）

## References

- `references/patent-disclosure-figure-styles.md` —— 两份专利参照件的图风格清单、本机三张图的最终参数、
  留白事故与重建流水线顺序（会话级细节，2026-09）
