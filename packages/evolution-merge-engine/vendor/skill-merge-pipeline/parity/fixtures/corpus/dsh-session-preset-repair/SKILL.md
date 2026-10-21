---
name: dsh-session-preset-repair
description: Repair sessions that fail to resume after a preset rename.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [DSH, Sessions, Presets, Repair]
    related_skills: [dsh-plugin-compatibility, dsh-evolution-maintenance]
---

# DSH Session Preset Repair

A DSH conversation records the agent preset it started with, and the host refuses
to resume it when that preset id no longer resolves — which is what happens after
a plugin that shipped the preset is renamed, upgraded, or removed. This skill
finds those sessions and rewrites the recorded id to one that still exists. It
does NOT install plugins, does NOT recreate the missing preset, and does NOT
change any conversation content.

## When to Use

- `resume failed for session "session-…": RemoteError: agent-presets: preset "x" not found (available: …) (gateway/internal)`
- A sidebar entry in the DSH Web GUI throws instead of opening, right after a DSH or plugin upgrade.
- The GUI preset picker shows a mode that no longer exists.
- Several conversations broke at once after the same upgrade.

## Prerequisites

- The built-in DSH CLI on PATH. On Windows call `dsh.cmd`, never `dsh` or a
  bare `npx` — the `.ps1` shims are blocked by the execution policy.
- Node with `node:zlib` Zstandard support (the logs are zstd).
- `scripts/session-preset.mjs` from this skill.
- Read access to `~/.dsh/sessions` (`$DSH_HOME/sessions` when DSH_HOME is set).

## How to Run

```bash
node scripts/session-preset.mjs list ~/.dsh/sessions
node scripts/session-preset.mjs inspect ~/.dsh/sessions/<workspace>/<session-id>/session.jsonl.zstd
node scripts/session-preset.mjs set <log> <preset-id> --backup ~/.dsh/session-preset-fix-backup --apply
```

`set` is a dry run without `--apply`, and it verifies the rebuilt container
in memory before it writes anything.

## Quick Reference

| Fact | Value |
|---|---|
| Log path | `$DSH_HOME/sessions/<cwd-slug>/<session-id>/session.**vN**.jsonl.zstd` — **文件名带版本号**（2026-10-12 实测本机为 `session.v3.jsonl.zstd` / `session.v4.jsonl.zstd`）。技能脚本里写死的 `session.jsonl.zstd`（无 `vN`）**在本版 DSH 上匹配不到任何文件** ⇒ `list` 会（错误地）报 `total: 0`。**先 `ls` 确认实际文件名再用**；`-Filter` 也不要用无通配符的完整名（实测静默返回 0）。 |
| 目录形态 | `sessions/<cwd-slug>/<session-id>/`。`<cwd-slug>` 由工作目录派生（如 `D:\dsh` → `--D-dsh--`）。同一 slug 下**几十上百个**会话目录是正常的。 |
| 确认"哪个日志是当前会话" | 解**尾帧**看它是不是你刚才那次调用（见 `Verification`）。**别靠 mtime 猜**——并行多会话时会有多个日志在同一分钟内被写。 |
| Preset source | `agentPreset` in the first JSONL record (the header) |
| Override | an `agent-preset/selected` event later in the log wins over the header |
| Container | concatenated Zstandard frames, header frame first, one frame per batch |
| Frame flags | checksummed; boundaries are structural, never magic-scan |
| Error text | `agent-presets: preset "x" not found (available: …)`, surfaced as `gateway/internal` |
| Why the GUI cannot fix it | `agent-presets.select` → `swap()` refuses any started session with `agent-preset/locked` |

## Procedure

1. Enumerate affected sessions and group them by recorded preset:
   `node scripts/session-preset.mjs list ~/.dsh/sessions`.
2. Confirm the preset id is genuinely gone from the error's `available:` list, and
   pick a replacement id from that same list — use the ids the host actually
   reports, never a guess.
3. Decide the remedy (see Pitfalls):
   - **Rewrite the id** per session — the conversation resumes in the new mode.
   - **Restore the old id** by copying the replacement preset directory in
     `$DSH_HOME/.agent-presets/` to a directory named for the old id — fixes every
     affected session at once and touches no session data.
4. Back up and rewrite: run the `set` command above. One backup per session.
5. Verify with `inspect`: the recorded and effective preset must both show the new
   id, and the frame count must be unchanged from before the edit.
6. Reload the Web GUI before retrying — the sidebar caches the old tag.

## Pitfalls

- **The projection is not the header alone.** A session that changed preset while
  blank carries an `agent-preset/selected` event that outranks the header; fix the
  header there and the session still resolves the stale id. `inspect` prints the
  effective value so this is caught up front.
- **Never re-compress the whole log.** Rebuild frame 0 only and keep the remaining
  frames byte-identical, or a single bad block silently truncates a long
  conversation. `set` asserts this before writing.
- **Never scan for the Zstandard magic.** The bytes appear inside compressed
  blocks; walk the frame and block headers instead.
- **A plain `node` streaming decompressor stops at the first frame** with
  `ZSTD_error_prefix_unknown` — a multi-frame log is not a corrupt log.
- **Do not leave backups inside a session directory** — the loader enumerates that
  directory. Keep them in a directory outside `$DSH_HOME/sessions`.
- **The recorded toolset does not follow the preset.** History keeps the tool
  calls it ran with; only the next request composes from the new preset. Switching
  a long session to a single-tool mode such as `ptc` is supported but changes how
  that conversation continues.
- **A directory alias is a snapshot.** A copied preset directory goes stale when
  the plugin updates its own; a Windows junction may not be enumerated by preset
  discovery. Re-copy after plugin upgrades instead of assuming it tracks.
- **Do not edit a log whose process still holds it.** Check for an exclusive-open
  failure first; a live session rewrites the file and discards the edit.
  **★ 推论（2026-10-12 实测）**：**正在进行的那个会话，无法从它自己内部改成别的模式**——宿主持有日志并持续写入
  （实测：目标日志的 mtime 在几十秒内持续推进），写进去会被覆盖/丢弃。
  要改**当前**会话的模式，只能等它**结束并释放**之后，由另一个会话（或人）动手。
  判据：先问"目标是**正在跑的那个**还是**已结束的历史会话**"——这个技能只适用于后者。
- **`ptc` 是「单工具」模式，不是「能并发调工具」。** 切换一个长会话到它是**支持**的，但
  **只影响之后的请求**（历史保留原样），且会**改变这个会话此后怎么继续**。
  ⇒ 别把"PTC 能否省往返"与"能不能并行调工具"混为一谈——**并行调用标准模式本来就支持**（一次可发多个独立调用）。
  PTC 改变的是**工具由谁驱动**（代码调用、结果进代码），代价是**你看到的原始输出变少**；
  而诊断型任务恰恰靠读原始 diff／计数／帧内容找 bug ⇒ 切换前先判断当前阶段是**机械批处理**还是**诊断**。

## Verification

```bash
node scripts/session-preset.mjs inspect <log>
```

Expected: the same frame count as before the edit, and `effective agentPreset`
equal to the new id. Then open the conversation in the GUI after a page reload —
the tag shows the new mode and the session resumes instead of throwing.
