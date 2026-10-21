---
name: windows-computer-use
description: Drive the Windows desktop with the platform Cua driver.
version: 0.3.0
author: Hermes
platforms: [windows]
metadata:
  hermes:
    tags: [Windows, Automation, UIA, ComputerUse]
    related_skills: [dsh-mcp-wiring, dsh-two-plane-maintenance]
---

# Driving the Windows Desktop with the Platform Cua Driver

See `references/session-and-capture.md` for the session/screenshot/input split verified on this machine: reviving the implicit session with `start_session({})`, the three screenshot tools and what each one actually captures, background delivery of click/type_text, and why `SendKeys` is unsafe.

Controls the live Windows desktop — click, type, scroll, hotkey, launch, menus, clipboard, drag —
through the **platform's own computer-use line**: the `@deepseek-ai/dsh-computer-use` seam plus a
provider (`…-cua-driver-native` or `…-cua-driver-mcp`). Tools appear as `cua_driver_native__<name>`.
Each action is verified by re-reading structured window/accessibility state, not by trusting a
tool's success return. Captures are true physical pixels as of 2026-10-15 (`get_screen_size` and `get_desktop_state` both report 2560x1600 @1.5; the older 1707x1067 DPI-virtualized reading no longer holds).
The workaround skill that existed for the old behaviour (`windows-screen-capture`) has been deleted.

**Measured baseline** (versions, permission/health values, the coordinate self-check, the UIA coverage
table across 12 apps, input-channel timings, and the three-way patch-form experiment) is kept in
`references/measured-baseline-2026-10.md` — evidence for the rules below, separated so the body stays
pattern-shaped. Re-check those numbers rather than trusting them; they are one machine, one day.

**This replaced the third-party `CursorTouch/Windows-MCP` route** (user directive, 2026-10-13:
"以后通通改用这个工具"). The old row is retained disabled for reference only. If you find yourself
reaching for `mcp__windows__*`, you are on the retired path.

## When to Use

- "click X" / "type this into Y" / "scroll the page" / "open that app" against a native Windows app
  or a browser on the desktop.
- You need proof an input action actually landed.
- You need to read a window's structure as TEXT (accessibility tree) rather than pixels.

## Prerequisites

- Both packages installed into the **profile** (not the host): the seam `@deepseek-ai/dsh-computer-use`
  **and** exactly one provider. Registration is *exclusive* ("Exclusive named computer-use provider
  registration") — never both providers at once.
- **Match the host version, not npm's `latest`.** Read
  `<install>\resources\runtime\primary-runtime\runtime.json` → `desktopVersion`, then install that
  dist-tag. Measured 2026-10-13: host `0.2.0-rc.2` while npm `latest` was `0.1.6-alpha.1` — i.e.
  `latest` would have been a downgrade.
- Install with the profile's own pnpm, run through the app binary:
  `"<install>\DeepSeek Harness.exe" --expose-internals "<install>\resources\runtime\pnpm\bin\pnpm.mjs" add "<pkg>@<version>"`, cwd = the profile dir.
- Add the entries to the profile's `cordis.patch.yml` (see **Pitfalls** for the form — the package
  README's snippet does NOT work there).
- **The patch file is WATCHED: adding entries hot-mounts into the running host — no restart needed.**
  Measured 2026-10-13: the host process had been up since 2026-10-11 20:41, the dependencies were
  installed at 08:46 and the entries written at 08:50, and `cua_driver_native__*` was live in the
  session afterwards. This holds for plugin rows as well as MCP rows. **Only *switching* a
  computer-use provider needs a host restart** (see Pitfalls).
- A model route that explicitly declares image input, or screenshots never reach the model.

## Before driving a UI: is the answer reachable without it?

The driver can operate a browser, but a browser is the **least reliable** target and a UI read proves
less than a structured one. Measured limits in one session (isolated Chromium, a local web app):

- **The typed `browser_*` layer needed a `tab_id`** that the bind step did not return (it reported
  "1 tab" without the id) ⇒ that layer was unusable there; the px/`element_*` paths still worked.
- **An omnibox silently drops characters.** `type_text` reported "Typed 72 char(s)"; the field gained
  **8**, then **50** at a slower retry. `Ctrl+L` also did **not** select the existing text, so the second
  attempt *appended* and produced a nonsense URL. `set_value` / `type_text(element_index=…)` are the
  right instrument for text fields (atomic UIA `ValuePattern`, no keystrokes) — but both demand an
  `element_token` or `snapshot_id`, which may not appear in the returned element list.

⇒ **Ask the application, not the picture.** If the app exposes a local HTTP/RPC surface, that answer is
repeatable, diffable, and impossible to misread. Reserve the driver for what genuinely needs eyes.
(A whole class of "is the service healthy / is the plugin loaded / what config is live" questions is
answered faster and more honestly that way — see `dsh-plugin-compatibility`.)

**Workarounds that hold when the UI really is the only way:** clear the field explicitly instead of
relying on select-all; type in short chunks and re-read the field between them; and verify from a
**fresh** `get_window_state`, never from the action's success return.

### Text and modifier keys are different channels — measure which one you actually have

Follow-up measurements sharpened the above into a usable decision table:

| channel | measured behaviour |
|---|---|
| **pixel click** | **reliable** — it established renderer focus correctly (confirmed: characters only began landing *after* the click hit the real field) |
| **plain typing** (`type_text`, no element) | reports success, **~96% loss** (200 chars sent → 7 visible) |
| **modifier combos** (`Ctrl+A`, `Ctrl+V`) | **did not reach the renderer at all** — the field was unchanged |

⇒ **"Input is broken" and "input is broken *for modifiers*" are different findings, and only testing them separately separates them.** In particular the clipboard route can fail at the **keystroke**, not at the clipboard: a host-side `clipboard_write` succeeds while `Ctrl+V` goes nowhere. Report which half failed; never collapse it to "paste doesn't work".

**★ The fix for the typing channel: send keys one at a time with `press_key`.** `type_text` writes via `WM_CHAR` and lost ~96% into this renderer; **`press_key` per character delivers via `WM_KEYDOWN` and landed reliably** — two characters in sequence arrived intact after the bulk-write path had failed twice at the same field. It costs one call per character, so reserve it for short strings (a word, a command, a path) and keep long content out of the UI entirely — put it in a file the target can read, or on the clipboard for the operator. Practical order that worked: **click to focus → verify the focus took (type one character and look) → then send the rest.**

**The field was a UIA `Edit` the whole time** (`actions=[set_value,text]`) — the atomic `ValuePattern` write that bypasses keystrokes entirely. It was unreachable only because `set_value` / `type_text(element_index=…)` demand an `element_token` or `snapshot_id`, and **neither appeared in the returned element list** (a sibling `Edit` further up *did* expose `id=view_N`, so this is per-element, not a blanket gap). ⇒ **When an element index exists but its token does not, that token is the thing worth going to get** — it converts an unreliable keystroke path into one atomic write.

### Validating a px click: derive the scale from the driver's own echo

`click` echoes the **screen** coordinate it actually used. Use that as a self-check rather than trusting the arithmetic:

    screen_x = window_local_x × (physical_width / returned_image_width)

Measured: window-local 700 with a 1400-wide returned image → screen **1280**, i.e. `700 × 2560/1400 = 1280` exactly. That confirms (a) the px space is the **returned image's** dimensions, not the window's, and (b) the physical screen width. **The same check is what exposed a target sitting 46 px too low** — a miss that had otherwise reported "typed 200 chars" with nothing on screen. The returned image size changes with `max_dimension`, so **re-derive whenever you change it**; mixing coordinates taken from two different calls is the trap.

### The clipboard has no undo — read it before you write it

`clipboard_read` exists and is the **only** rollback you will ever get; `clipboard_write` replaces whatever the operator had, permanently. Two rules:

- When putting something on the clipboard **for** the operator, **read first and say what you are displacing.** Disclosing afterwards is not the same as asking beforehand — the original is already gone.
- When *you* are the one who put the content there, overwriting it again is free — it is your own text. (The asymmetry is the whole point: know whose content you are deleting.)

### Make a pasted instruction self-sufficient

A prompt squeezed onto one line for *keystroke* safety can lose the details that made it unambiguous — a file list written as bare stems beside the word "png" leaves the extension to inference. **Once the clipboard is the transport, length is free.** Prefer full paths in the text itself: a paste that fails costs a whole round trip *plus* an operator interruption, which is far more expensive than the characters you saved. (Compress for the channel you are actually using — the constraints are different.)

## Session lifecycle — the thing that blocks everything else

The driver groups calls into a **session**, and a *named* session expires. The symptom never mentions
your action; it is:

    Error: this session has ended; call start_session explicitly to reuse its label

⇒ **Call `start_session` with no arguments after any gap.** That revives the **implicit** session, and
every tool that documents a `session` parameter also works when you simply omit it. Measured across one
long session: a *named* label threaded explicitly through every call died repeatedly and had to be
re-created; omitting the parameter rode the implicit session and kept working. Prefer implicit unless
you are deliberately running two independent runs.

## Cheap reads — pick the smallest call that answers the question

| need | call | why |
|---|---|---|
| **just the picture** | `get_window_state` with **`include_accessibility_tree: false`** | cheapest full-window screenshot; returns bounds + title, skips the tree walk |
| **just the structure** | `get_window_state` with **`include_screenshot: false`** | no image tokens |
| **read a small region legibly** | `zoom(pid, window_id, x1, y1, x2, y2)` | a tight crop (e.g. 500x54) costs far less than a full screenshot **and is legible where the downscaled window is not** |
| **prove a value changed** | `verify_state` with an explicit predicate | strongest evidence, zero pixels |

**`zoom` is usually the right first move for "what does that field actually contain".** One 500-px crop
of an input box settled what two full screenshots had left ambiguous. Two properties to know: its
coordinates are **the same space as the returned `get_window_state` image** (so they move when
`max_dimension` changes — re-read before zooming after changing it), and its response states the
mapping rule outright — *"use `click(pid, x, y, from_zoom=true)` where x,y are pixel coordinates in THIS
zoomed image"*. **`from_zoom=true` performs the back-translation**, so never redo that arithmetic by hand.

## Routes that are closed — do not spend turns on them

- **Legacy `page` mutations are gated.** Both `execute_javascript` and `insert_text` refuse with
  *"legacy page mutation is unbounded and requires unrestricted mode with trusted launch-time risk
  acceptance"*. Read-only `page` actions (`get_text`, `query_dom`) survive, though `get_text` can still
  fail with `element does not support TextPattern`. ⇒ Never plan a flow that depends on injecting script
  or text into a page; use the px/UIA routes, or the application's own API (see *Ask the application,
  not the picture*).
- **★ `query_dom` works and is often better than a screenshot** — it returns matched elements with the
  attributes you ask for, as **text**, at a fraction of the context cost of an image. Measured:
  `query_dom("input", attributes=["id","name","type","aria-label","value"])` enumerated the live inputs
  of a web app in one call. Use it to answer *"did the view I asked for actually have these controls?"*
  without pixels. (`get_text` on the same page failed, so the two read-only actions are not
  interchangeable — try `query_dom` first.)
- **★ A modal or panel can appear *after* your read, and a blind re-click dismisses it.** Measured twice
  in one session: a settings modal was **not** present in the screenshot taken immediately after the
  click, so the click looked like a miss — but the panel was open by the next read. **The re-clicks
  landed outside it and closed it again** (one of them also opened a context menu on whatever it hit).
  ⇒ When the first read shows no change, **do not re-click the same target blindly**: take one fresh
  capture, and only if the target is still inert try a different *element* — not a second shot at the
  same pixel. Corollary: when a click *does* open a panel, **re-read before clicking inside it**, because
  the panel's coordinates are not the page's.
- **The typed `browser_*` layer needs a `tab_id`.** The bind step reports "N tab(s)" **without** the id,
  and a snapshot refuses with `browser_tab_required` when given only the target id. Carry on with
  px/`element_*` — **do not keep re-binding hoping the id appears.**
- **`set_value` / `type_text(element_index=…)` reject a *bare* `element_index`** —
  *"pass element_token, or snapshot_id together with element_index"* — and `get_window_state`'s returned
  element list shows indices, `role`, `label`, `frame`, `actions` and sometimes `id=view_N`, **but not
  `element_token`/`snapshot_id`**. ⇒ **Budget for the pixel route by default.** If an element *does*
  expose `id=view_N` while a sibling does not, that is per-element, so it still may be worth one attempt
  — but treat the atomic-write path as a bonus, not the plan.

## How to Run

Discovery → act → verify. Never skip the verify step.

    list_windows                                      # find pid + window_id
    get_window_state  pid, window_id                  # elements[] with element_token + frame
    click             element_token=<from snapshot>   # preferred: no pixel math, works backgrounded
    get_window_state  pid, window_id, query="<expect>"# verify from FRESH state

    # pixel route, only when the tree came back degraded
    get_desktop_state                                 # PNG + screen_width/height
    click             x=<px>, y=<px>                  # same space as that screenshot

## Quick Reference

| Tool | Purpose |
| --- | --- |
| `list_apps` / `list_windows` | Enumerate apps and top-level windows (`pid`, `window_id`, `bounds`, `z_index`) |
| `get_window_state` | UIA tree as `elements[]` (preferred) **and** `tree_markdown` (sparse, back-compat) |
| `get_accessibility_tree` | Cheap desktop-wide process/window snapshot |
| `click` / `double_click` / `right_click` / `drag` | Pointer |
| `type_text` / `press_key` / `hotkey` / `set_value` | Keyboard and UIA `ValuePattern` writes |
| `scroll` / `invoke_menu` | Scroll; resolve an exact application-menu path |
| `launch_app` / `kill_app` / `bring_to_front` / `set_window_frame` | Window lifecycle |
| `verify_state` | Deterministic bounded predicates against one exact window — the strongest evidence |
| `get_screen_size` / `get_desktop_state` / `zoom` | Scale factor, full-screen PNG, native-res region zoom |
| `clipboard_read` / `clipboard_write` | Clipboard (text, image path, file URL) |
| `get_browser_state` / `browser_navigate` / `browser_click` / `browser_type` / … | CDP browser control, exact tab binding |
| `start_recording` / `replay_trajectory` | Trajectory capture and replay |
| `get_config` / `set_config` | Persistent driver config (`max_image_dimension`, cursor, PiP) |
| `health_report` / `check_permissions` | One-call diagnostics — start here when anything is off |

## Procedure

1. `list_windows`, pick the exact `pid` + `window_id` (titles are enough; `bounds`/`z_index`
   disambiguate duplicates).
2. `get_window_state` with `include_screenshot: false` for a cheap structural read. Keep
   `max_elements` / `max_depth` modest — large trees blow up context.
3. If `degraded` is true, **read `escalation.recommended` and do what it says** (normally `px`):
   take `get_desktop_state` and act by pixel off that same image.
4. Act — prefer `element_token` from the latest snapshot of that window. A new snapshot of the same
   window invalidates earlier tokens.
5. Verify from FRESH state: re-`get_window_state`, or better, `verify_state` with an explicit
   predicate (`exists` / `value_equals` / `selected` / `enabled` / `bounds`).
6. Undo what you changed, and re-read to confirm.

## Pitfalls

- **The coordinates are self-consistent, and that is the only property you need.** Screenshot
  pixels, reported coordinates and click coordinates are **one space** — **never apply a DPI
  multiplier on this line.** Measured 2026-10-15: `get_screen_size` and `get_desktop_state` report
  **2560x1600 @ scale_factor 1.5** (the true physical size of this desktop), and `get_window_state`
  returns a PNG exactly the size of the window bounds (540x1528 for a 540x1528 window). The
  2026-10-13 reading (`1707x1067` = the DPI-virtualized logical size) no longer holds, and neither
  does the old "GDI click ×1.5" rule that existed because of it.
- **Fine detail is readable from Cua captures now.** The former `windows-screen-capture` skill
  (DPI-aware GDI `CopyFromScreen`, which additionally broke under pwsh 7 with `CS1069`) was deleted
  2026-10-15: capture the full screen with `get_desktop_state` or a window with `get_window_state`,
  then crop. Crop tight — the harness downscales large images.
- **Element addressing does NOT cover every window.** Measured across 12 apps: 7 returned trees
  (DSH 49 elements, Chrome 39, clash-verge 32, cmd 11, explorer 5, WeChat 1) and 5 returned
  `element_count: 0` with `degraded: true`, reason `ax_tree_empty` — including **Settings,
  ApplicationFrameHost, NVIDIA Overlay, TextInputHost and Baidu Netdisk** (i.e. UWP/modern apps).
  The pixel path is mandatory, not a fallback of last resort. The tool tells you which to use:
  `escalation: { reason: "non-AX surface — act by pixel (x,y) off the screenshot in this response",
  recommended: "px" }`.
- **Read `elements`, not `tree_markdown`.** Same window: 49 structured elements vs a 3-line markdown
  tree. The markdown is explicitly back-compat. Each element carries
  `{element_index, element_token:"s0000000d:0", role, label, frame:{x,y,w,h}, actions:[]}` — and
  **`frame` is already screen coordinates**, so even the pixel route has a source of truth.
- **Prefer background delivery; a refusal is not permission to go foreground.** The driver decides
  when background is impossible and returns a structured `background_unavailable`; only then retry
  that same action with `delivery_mode: "foreground"`. `element_index`-based actions work on
  backgrounded, minimized, hidden and off-desktop windows — that is the main advantage over the
  retired MCP route, which needed the window visible.
- **★ 同一个拒绝有两种措辞 —— 认措辞会漏掉它。** 上面说"返回结构化的 `background_unavailable`"，
  但实测在 **Chromium** 上做**文本输入**时，拒绝长得**完全不一样**：
  `Background delivery is not available for target window class 'Chrome_WidgetWin_1' on this event kind (text_input). Retry this action with delivery_mode:"foreground"`
  —— **没有 `background_unavailable` 这个词**，而且它**直接把补救办法写在消息里**。
  ⇒ **判据：不要按\*关键词\*识别拒绝，要按\*"它是否指明了下一步"\*识别。**
  只要消息里出现了 `delivery_mode:"foreground"`（或同义的 retry 指引），**它就是那条阶梯的第一级**，
  照做即可 —— 本轮照做一次就成了。
- **★ Chromium 的文本框：用 `type_text` 的\*\*像素形式\*\*（带 x/y），不要用无坐标的形式。**
  带 x/y 时它**先像素点击建立真实渲染焦点、再输入**，这正是 WM_CHAR 路径够不到的场合的解法。
  `type_text` 也是 **`text_input` 这一类事件**，所以上面那条变体拒绝**同样适用于它** ——
  即：**往 Chromium 填表，第一次就预期它会要求 `foreground`**，别把那次拒绝当成"输入不可用"。
- **★ 全屏截图失败时，退到 `get_window_state(pid, window_id)`。** 实测全屏那条返回过
  `Maximum call stack size exceeded`（驱动内部错误，**不是"桌面截图不能用"**），
  而**按窗口取**当场就有图、还附 `bounds`。**⇒ 定位某个应用的控件时，按窗口取本来就更好** ——
  `list_windows` 按标题找到 `window_id`，比在全屏图里数像素稳。
- **★ 坐标空间\*\*不要靠文档假设，靠回读验证\*\*。** 带 x/y 的动作，其像素空间可能是
  **返回图的实际尺寸**、也可能是**显示层的预览尺寸**（两者在本机差 1.5 倍）。
  **⇒ 做法：先用一次 px 动作试探，紧接着取一张新截图确认它落在预期控件里；**
  落错了就按两个尺寸的比值换算再来。**"点完就宣布成功"在这条路上必错。**
- **★★★ 那个比值已经实测出来了，别再靠猜：工具收的是\*\*源图像素\*\*，不是预览像素。**
  同一台机器上三次独立反推（给点 → 实际落点）：
  `(350,390)→预览 y≈265`、`(245,331)→预览 y≈199`、`(148,470)→落在控件间的空档` ——
  **三次都恰好是 `给我值 × 0.66`**；而 `0.66 = 1035/1567` **正是预览尺寸 ÷ 源图尺寸**。
  ⇒ **所以：读图时按\*\*预览\*\*估算，传参前乘以 `源图宽/预览宽`**（本例 ≈ **1.514**）。
  按这条换算后 `(371,501)` **一次命中**「工作流文件名」输入框。
  ⇒ **判据**：`get_window_state` 会同时报 **preview 尺寸**与 **source 尺寸** ——
  **传参前先看这两个数，比值就是你要乘的系数。** 没有这个数就别动像素，改走元素句柄。
- **★ 像素打偏的代价不只是"没点到"**：有一次 `(148,470)` 落在控件之间的**空档**，
  那次点击**落到了任务栏上，把浏览器窗口最小化了** —— 随后所有截图变成全黑，
  驱动报 `cannot capture minimized window … Call bring_to_front`。
  **⇒ 打偏会\*改变现场\*，让下一次诊断基于一个已经变了的界面。**
  ⇒ **补救**：`bring_to_front(pid, window_id)` 拉回前台，**重新取图重新定位**（页面可能已滚动）。
  ⇒ **另**：`get_window_state` 返回的 UIA 树里有 `[id=...]` 与 `actions=[...]` ——
  **`actions` 里出现 `set_value` 就是可以用 ValuePattern 原子写入的信号**（比打字可靠）。
  但要注意本驱动的 `set_value` **不接受裸 `element_index`**，要么给 `element_token`、要么 `snapshot_id` + `element_index`。
- **Putting a plugin row in `cordis.patch.yml`: the package README's snippet is a trap.** The Cua
  README's "minimal config" is a top-level pair of `- name: '<pkg>'` lines. Measured three ways with
  `--dump-config` on a dumpable profile:
  | form | result |
  | --- | --- |
  | `- name: '<pkg>'` | **silently ignored** — exit 0, stderr only says `patch: id is required for non-insert patches`, nothing enters the tree |
  | `- insert:` + children | **works** — clean stderr, both entries compose into the tree |
  | `- id:` + `name:` | treated as a patch **targeting an existing entry** → `entry "…" not found`, nothing inserted |
  So: patch-layer additions must be wrapped in `- insert:`. That snippet shape is the *bundle*
  entry-list form, not the patch form.
- **`--dump-config-schema` disagrees with the real loader.** It reports
  `error: unrecognized Loader tree carrier; use cordis:group or cordis:include` for `insert:` — and
  keeps reporting it even for patches that add nothing, plus the same for the four shipped agent
  presets. Judge a patch by `--dump-config` (exit code + stderr + whether the entry appears), not by
  the schema pass, which also exits 1 on these.
- **`--dump-config` emits YAML, not JSON**, despite the `.json` you may be tempted to write it to.
- **The desktop profile refuses the CLI.** `dsh --profile desktop --dump-config` answers
  `error: profile "desktop" is managed exclusively by the Electron application` — that is a
  permission design, not a fault. To validate a patch, point `--patch <file>` at a *dumpable*
  profile (e.g. `web`, with `DSH_HOME` set to that plane's home) and inspect the composed tree.
- **Windows needs no elevation.** Measured: `elevated: false`, `integrity_level: Medium`, `uia: true`
  ("no special permission needed"), `post_message: true`. `health_report` reported `overall: "ok"`
  with `ax_capability` and `screen_capture_capability` both passing (D3D11 / Windows Graphics
  Capture reachable).
- **In-process native runtime: a native crash can kill the host.** The `-native` provider shares the
  host process (the platform README says so plainly); the `-mcp` provider runs out of process but
  needs a separately installed `cua-driver` executable. Choose deliberately.
- **A failed shutdown keeps the registration slot occupied**, so mounting a different computer-use
  provider then requires a **host restart**. Expect a reload to be needed; do not assume a hot swap.
- **Do NOT escalate the moment a human-gated step appears — wait, then re-check (user rule,
  2026-09-27).** A WebAuthn prompt, an approval, or a paused bridge often resolves on its own. Sit
  ~2 minutes, re-read the state, and only then hand over — with what you tried, the current state,
  and the one exact action you need. Escalating on first sighting burns a turn and reads as nagging.
- **WebAuthn / security keys are a designed boundary.** A 使用安全密钥 button focuses and clicks
  fine, but no Windows Hello dialog appears: WebAuthn requires *transient user activation*, which
  synthesized input does not grant. Drive the flow up to that button, leave it focused, hand over,
  then continue from fresh state. Not a tool defect.
- **If an action produced NO visible change, LOOK at the screen before retrying or re-filtering
  (user rule, 2026-09-27).** A confirmation modal can be sitting there waiting for one click, while
  your own coordinate/keyword filters silently exclude it. Capture, find the dialog, act, capture
  again to prove it closed.
- **A web app can keep a STALE count after your action** — verify with a real reload (focus the
  window first) before concluding. Measured: after a delete the table still read "共 1 行" with an
  empty body; `ctrl+r` then read "共 0 行".
- **Chrome's tab strip is not in the accessibility tree**, and the window title names only the ACTIVE
  tab — "the page did not change" can just mean you are looking at another tab. Switch with
  `ctrl+<N>` (1-based, left to right), then re-read the title.
- **The tree is localised.** On a Chinese Chrome the names come back in Chinese; match on
  coordinates and on the *role* token, not on English names.
- **Pick reversible targets.** While testing, use the app's own toggles and its own text field —
  a live desktop has other people's work on it, and other sessions may be driving the same desktop.
- **After cancellation, inspect before retrying** — completed input is never rolled back.
- **A window launched from a `pwsh` call dies with that call** (the harness kills the process tree),
  so `Start-Process chrome …` yields a page that is gone before the next turn. Either launch it via
  the driver's `launch_app` (which uses `SW_SHOWNOACTIVATE`, so it does not steal focus), or detach
  it to WmiPrvSE:
  `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }`.
- **For a URL, prefer the driver's browser tools** (`browser_navigate` on an exactly-bound tab), or
  the Run dialog (`hotkey ["win","r"]`). Measured 2026-09-27 on Chrome: typing into the omnibox via
  synthetic input reported success, closed the popup, and the page never changed.

## Fallback when the driver is not mounted

If no `cua_driver_native__*` tool is present (the row is not in the active profile, or the host has
not been restarted since it was added), the same two operations are available from plain PowerShell:

- **Read the screen**: with the driver unavailable, a `CopyFromScreen` capture plus a rectangle
  crop still works from plain PowerShell — but set the thread DPI-awareness context first
  (`SetThreadDpiAwarenessContext(-4)`), or you get the virtualized 1707x1067 rather than the real
  2560x1600. Then `read_image` the crop. Crop tight; the harness downscales large images.
- **Click**: `SetProcessDPIAware()` → `SetCursorPos(x, y)` → `mouse_event(0x0002)` then
  `mouse_event(0x0004)`. These coordinates are **PHYSICAL** pixels, so this is the one path where the
  ×1.5 compensation applies. Verify by capturing again — an unchanged crop means the click never
  landed.

## Verification

Two independent checks, neither of which requires a screenshot:

1. **The line is alive**: the driver's own `health_report` must return `overall: "ok"` with
   `ax_capability` and `screen_capture_capability` both `pass`, and `check_permissions` must show
   `uia: true`.
2. **An action landed**: `type_text` a distinctive string into a text field, then re-read that
   window and confirm the element reports that value; clear it and confirm it is empty again. For a
   stronger, self-describing check use `verify_state` with an explicit predicate and
   `stable_samples` ≥ 2 — a delivered action alone never proves the outcome.
