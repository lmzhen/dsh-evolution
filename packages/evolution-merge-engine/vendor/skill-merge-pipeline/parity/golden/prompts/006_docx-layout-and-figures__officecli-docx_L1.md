{
  "level": "L1",
  "skill_a": {
    "id": "docx-layout-and-figures",
    "description": "Verify and fix Word layout, fonts, and figures in a .docx.",
    "head": "Verify and fix Word layout, fonts, and figures in a .docx.\n\n# Word 交付物的排版、配图与验收\n\n给 .docx 交付物（交底书、报告、论文）画流程图并用 **Word 自己的排版引擎**验收版式与字体。\n本技能只做「配图 + 离线验收」，不覆盖 officecli 的文档编辑能力（那是 officecli-docx 的活）。\n依赖：Windows + Word（COM）、python 带 pymupdf / python-docx / matplotlib。\n\n- 用户说「检查一下排版有没有问题」「字体不对」「看着不如样例/参照件」\n- 需要给 .docx 加流程图、状态图、泳道图\n- 从模版重建过正文之后（段落重排会把字号、字体、图位全部重置）\n\n- Word 已安装且可 COM 调用；目标 .docx **未被 Word 占用**（占用时报 io_error，改在副本上作业）\n- `python -c \"import fitz, docx, matplotlib\"` 通得过\n- 中文字体 TTF 实际路径（本机在 `%LOCALAPPDATA%\\Microsoft\\Windows\\Fonts\\`，如 chcfs.ttf=彩虹粗仿宋、\n  chht.ttf=彩虹黑体、chkt.ttf=彩虹楷体）；**先确认字体文件存在再画图**，否则中文变方框\n\n1. 对齐参照件风格（有参照件时必做，见 Procedure 第 1 步）\n2. matplotlib 画图：`matplotlib.use('Agg')`，每处文字用 `FontProperties(fname=TTF, size=…)`，\n   `figsize=(宽,高)` + `dpi=200`，白底 PNG\n3. python-docx 插图：按图注文本定位 → `insert_paragraph_before()` → 居中 → `add_run().add_picture(png, width=Cm(14.5))`\n4. Word COM 只读导 PDF → PyMuPDF 逐页几何验收（下方 Quick Reference 五道检查）\n\n- 版心换算：A4 595×842pt；页边距 1440/1800 twips → 文本区约 x 72–523、y 90–752\n- 五道检查：① 文本越界 ② 相邻行 bbox 垂直重叠 >45% ③ 图片下方 60pt 内是否有「图N.」图注\n  ④ 页面末行是否标题字体 ⑤ 每页底部空白 >90pt\n- 图宽取满版心 **14.5cm**；图内字号 8.5–9.5pt（折到页面约 7–8pt，参照件常为 9–11pt）\n- **图随注走**：图片所在段落设 `keep_with_next = True`，否则整幅图占满当页下部时图注会被挤到次页（实测发生过）。\n- **图注体例**：参照件多为「图N.短标题」——居中、小四（14pt）、不缩进；带括号的长说明会折成两行且不合体例，应把说明挪进正文。\n- **两图同页**：两图都想落在同一页却总被拆开时，把两张都略收窄（14.5 → 13.5cm）通常就能同页，消掉半页空白；收窄幅度 ≤1cm 时与其他图并排看不出差异。\n- 图内字号反推：`图内pt × (插入宽度 / 画布宽度) ≈ 页面pt`\n- 图高超过当前页剩余空间 → 整幅跳页，前页留大空白；总流程图改双栏/泳道压高（实测 402pt→212pt，24→23 页）\n- 字体验收基线（PDF 里 span 的 font 名）：正文 CHCFS、标题 CHHT、二级标题中文 CHKT、西文数字 TimesNewRomanPSMT\n- **两份参照件的实测差异（判断「不一样」是参照件本来就不齐，还是我方写错）**：示例一（信贷助手）**全篇只用 CHCFS**，连标题都是彩虹粗仿宋；示例二（两阶段跨平台）一级标题 CHHT（184 字）、二级标题 CHKT（实测「2.1 基本背景」为 CHKT），正文同为 CHCFS 16pt。两者做法不同，取任一套都算与参照件一致——本会话取示例二那套（一级黑体＋二级楷体）。\n- **两份参照件的共同点（真正的硬要求）**：A4 210×297mm；边距 L/R 31.8mm、T/B 25.4mm；正文首行缩进 2 字（406400 EMU）；图注居中、无缩进、14pt、样式 o；**都没有页脚页码**；都不放表格；第 2 节标题用**半角逗号**「2、详细介绍技术背景,并描述已有的与本发明最相近似的实现方案。」（用全角「，」是三家中唯一不一致的细节，改起来最容易被漏掉）。\n- **排版密度基线**：交底书落在 384—458 字/页（示例一 384、示例二 458）属正常；偏离过多先查行距与字号，别急着改内容。\n- **成品命名**：.docx 与正文源 .md 都按发明名称命名（与参照件同名惯例），不要留「合并稿 v1」这类工作稿名。\n\n1. **先读参照件的图，再动手画。** 把参照 .docx 用同一个 COM 流程导 PDF，PyMuPDF 取 image block 的 bbox，\n   按 200dpi 裁剪渲染成 PNG 逐张看：框型（直角/圆角）、分组方式（花括号/泳道容器）、有无菱形判断节点、\n   着色习惯、图内字号、图宽占比。凭想象画出来的图，一定会被用户退回。\n2. 画图：用一个脚本一次生成全部图，风格参数（框型、填充、字号）集中定义，便于整批调整。\n3. 插图：按图注定位插入，保证「图在注上」；插图后不要再动文字批。\n4. 验收：COM 导 PDF（`ExportAsFixedFo"
  },
  "skill_b": {
    "id": "officecli-docx",
    "description": "Use this skill any time a .docx file is involved -- as input, output, or both. This includes: creating Word documents, reports, letters, memos, or proposals; reading, parsing, or extracting text from any .docx file; editing, modifying, or updating existing documents; working with templates, tracked changes, comments, headers/footers, or tables of contents. Trigger whenever the user mentions 'Word doc', 'document', 'report', 'letter', 'memo', or references a .docx filename.",
    "head": "Use this skill any time a .docx file is involved -- as input, output, or both. This includes: creating Word documents, reports, letters, memos, or proposals; reading, parsing, or extracting text from any .docx file; editing, modifying, or updating existing documents; working with templates, tracked changes, comments, headers/footers, or tables of contents. Trigger whenever the user mentions 'Word doc', 'document', 'report', 'letter', 'memo', or references a .docx filename.\n\n# OfficeCLI DOCX Skill"
  },
  "scores": {
    "jaccard_summary": 0.0476,
    "jaccard_body": 0.0248,
    "summary_cosine": 0.6404
  },
  "note": "这是两份技能的能力宣言段与触发条件；仍不足请回 0。",
  "schema": {
    "verdict": "1 | 0 | -1",
    "reason": "<one sentence, in Chinese>",
    "evidence": [
      {
        "path": "<file>",
        "line": "<n or -1>",
        "quote": "<short quote>"
      }
    ]
  }
}