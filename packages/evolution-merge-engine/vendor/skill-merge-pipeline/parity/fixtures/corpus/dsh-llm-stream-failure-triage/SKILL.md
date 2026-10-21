---
name: dsh-llm-stream-failure-triage
description: Triage a failed DSH turn to its provider-stream guard.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: ["DSH", "LLM", "Diagnostics", "Providers"]
    related_skills: [dsh-session-forensics, dsh-plugin-compatibility]
---

# DSH LLM Stream Failure Triage

Map the exact text behind a 「本轮运行失败 <message>」 banner to the guard that raised it, decide which
layer owns it, and say what evidence survives. Every trigger below was read out of the same-version
source tree; the discarded-hypothesis rules come from the code, not from plausibility. It does NOT
cover client→host message drops (use `dsh-session-forensics`) or plugin load failures
(use `dsh-plugin-compatibility`), and it never asks you to patch a consumer plugin.

## When to Use

- 「本轮运行失败」 + `DeepSeek Messages stream: …` / `DeepSeek Messages expected …` / `DeepSeek Messages SSE …`.
- `tool input is invalid JSON` specifically — the one that surfaces to the user and has no obvious cause.
- `SSE stream ended without [DONE]`, `stream idle timeout after 300000ms`, `returned no content`.
- Any question shaped like "is this DSH's bug, the provider's, or a plugin's?" — answer it with the
  ownership table, never by guessing from the symptom.

## Prerequisites

- The **same-version source tree** (`D:\dsh\dsh-upstream-<version>`) — line numbers below are 0.2.0-rc.2.
  Resolve the running version first: web `<global npm root>/@deepseek-ai/dsh/package.json`, desktop the
  `app: @deepseek-ai/dsh-desktop <ver>` line in `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log`.
- The session log (`<DSH_HOME>/sessions/**/session.v*.jsonl.zstd`) — multi-frame zstd; frame-split on
  `28 B5 2F FD` (`dsh-session-forensics` owns the decoding rules and its census script).
- Node >= 22. Two homes on this machine: `%USERPROFILE%/.dsh` (desktop 19387) and `D:/dsh-homes/web` (3080).

## How to Run

1. `scripts/dsh-attempt-failure-list.mjs <DSH_HOME> [session-substring]` — one line per durable attempt,
   with the failure's `code`, `status` and `request_id`, then a summary.
2. `read` / `grep` the named site in the source tree to confirm the precondition.

## Quick Reference

**Every `MALFORMED_RESPONSE` the DeepSeek adapter can raise** (`packages/llm/llm-deepseek/src/`):

| exact text after 「本轮运行失败」 | site | trigger |
|---|---|---|
| `DeepSeek Messages expected a string field` | `translate.ts:21` | a field the wire protocol defines as a string is not one |
| `DeepSeek Messages expected a JSON object` | `replay.ts:17-22`, called from `translate.ts:46,66,112,144,156` | that field is not a JSON object — includes valid JSON that is not an object (`[]`, `42`, `"x"`) |
| `DeepSeek Messages stream: invalid block index` | `translate.ts:30` | `index` missing, negative, or not a safe integer |
| `DeepSeek Messages stream: invalid <wire>` | `translate.ts:40` | `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` not a non-negative safe integer |
| `DeepSeek Messages stream: empty tool identity` | `translate.ts:57` | `tool_use` block with empty `id` or `name` |
| `DeepSeek Messages stream: unsupported delta <t> for <block>` | `translate.ts:87` | delta type does not match the open block (e.g. `text_delta` into a tool-call) or is unknown |
| `DeepSeek Messages stream: unsupported stop reason <v>` | `translate.ts:95` | `stop_reason` outside `end_turn` / `stop_sequence` / `tool_use` / `max_tokens` |
| `DeepSeek Messages stream: duplicate message_start` | `translate.ts:111` | a second `message_start` |
| `DeepSeek Messages stream: event precedes message_start` | `translate.ts:120` | a content event before `message_start` |
| `DeepSeek Messages stream: block starts after settlement or repeats an index` | `translate.ts:123` | `content_block_start` reusing a wire index, or arriving after `stop_reason` |
| `DeepSeek Messages stream: delta/stop without an open block` | `translate.ts:134` | delta or stop for an index never started or already closed |
| `DeepSeek Messages stream: message_stop without settled blocks and stop reason` | `translate.ts:148` | a block never closed, or no `stop_reason` arrived |
| **`DeepSeek Messages stream: tool input is invalid JSON`** | **`translate.ts:155`** | the concatenated `input_json_delta.partial_json` is not parseable JSON **and** `stop_reason !== 'max_tokens'` |
| `DeepSeek Messages SSE contains invalid JSON` | `sse.ts:19` | a frame's `data:` is not JSON |
| `DeepSeek Messages SSE event type mismatch` | `sse.ts:22-24` | the `event:` field disagrees with `data.type` |

Same file, **different codes** — do not count them as this class:

| text | site | code |
|---|---|---|
| `DeepSeek Messages does not support response block <t>` | `translate.ts:60` | `UNSUPPORTED_CONTENT` |
| `DeepSeek Messages returned no content` | `translate.ts:149` | `EMPTY_RESPONSE` — **in the default retry set**, so it is retried away invisibly |
| `DeepSeek Messages stream ended before message_stop` | `translate.ts:165` | `STREAM_CLOSED` |
| `DeepSeek Messages stream idle timeout` | `adapter.ts:63` (`MESSAGES_IDLE` watchdog, 300000 ms from `defaults.ts:4`) | `TIMEOUT` |
| the provider's own error text | `transport.ts:22-43`, reached from `sse.ts:25` | `AUTH` / `QUOTA` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED` / `INVALID_REQUEST` / `SERVER` / `HTTP_<status>` |

Idle-timeout wording differs per adapter (`llm-pi-ai/src/adapter.ts:415` writes
`pi-ai stream idle timeout after <ms>ms`) — read the string from the log rather than assuming an adapter.

## `tool input is invalid JSON`: the complete trigger set

`translate.ts:82-85` accumulates, `:140` copies the accumulation into `content.arguments`, `:151-158`
checks. All four conditions are required:

1. the block is a `tool_use` block, and
2. **at least one `input_json_delta` arrived** — without any, `:56` builds the arguments with
   `JSON.stringify(object(native.input))`, which is valid by construction, and
3. the concatenation is not parseable (string concatenation cannot corrupt the text, so the model's
   emitted text was itself invalid), and
4. `stop_reason !== 'max-tokens'`.

What makes model-emitted argument JSON unparseable — the sub-cases worth naming:

- **Illegal escape**: `\d`, `\l`, `\R`, `\s`, `\'`, `\p` … — the classic, and exactly what a Windows
  path (`D:\dsh\...`) or a regex literal becomes when the model forgets to double the backslash.
- **Raw control character inside a string**: a literal LF / TAB / CR, from multi-line content pasted
  into a JSON string.
- **Structural imbalance**: extra or missing brace, trailing comma, two concatenated objects.
- **Unterminated arguments while the provider still reported a normal stop** — the only way a cut
  stream lands here, and it means `stop_reason` is wrong, because a real `max_tokens` cut is exempt.

Two source-derived exclusions that kill whole hypotheses:

- **Truncation by token limit can never produce this message.** `:151` skips the check for
  `max-tokens`, and `packages/llm/llm/src/assembler.ts:137-140` drops tool-call blocks outright on a
  `max-tokens` finish, pruning the matching replay entries in step (`:144-149`). "The answer got too
  long" is never the answer.
- **A provider that sends the whole `input` object and no deltas can never produce it** (`:56`).

Its neighbour, same code but a different message: valid JSON that is not an object (`[]`, `42`, `"x"`)
throws from `object()` at `:156` as `DeepSeek Messages expected a JSON object`.
`llm-deepseek/tests/stream.spec.ts:81` — `it.each(['{', '[]'])('refuses completed non-object tool JSON %s without repairing it')`
— pins both, so neither is repaired, by design.

## Who owns which part

| step | owner |
|---|---|
| detect + raise | `@deepseek-ai/dsh-llm-deepseek` — first-party, part of DSH itself |
| turn the throw into a terminal `finish {kind:'error'}` chunk | the `@deepseek-ai/dsh-llm` runtime (every stream ends in exactly one terminal finish) |
| commit `assistant/attempt`, then fail the **whole step** | `packages/core/agent-loop/src/agent.ts:489-508` (throw at `:507`) |
| whether it is retried | `packages/llm/llm/src/retry-policy.ts:18-24`, executed by `@deepseek-ai/dsh-llm-retry`, mounted by default at `dsh-base/cordis.patch.yml:91-92` |
| the invalid JSON text itself | the model / provider side — the only place that can emit it |

No third-party plugin can be at fault for this class: it is raised before any tool executes, and a
plugin can influence what the model *sees* (prompt, schemas) but not the bytes that come back.

## What evidence survives (measured)

`assistant/attempt` is a durable, **log-only** event (`packages/core/session/src/types.ts:355`:
`{ turn, step, stream }`), appended both on the mid-stream throw path (`agent.ts:445-486`) and on the
finish-error path (`:489-493`) — so failed attempts *are* recorded, and its `finish` record carries the
failure's `code`, `message` and `status` verbatim.

But `stream` is `accumulator.snapshot()` (`packages/core/agent-loop/src/assistant-stream.ts:112-114`), a
**compacted** stream: block boundaries plus the terminal finish, not token deltas. Measured 2026-10-13
across 223 logs: 388 attempts, and the chunk histogram was `finish:369, block-start:32, block-end:20` —
**zero deltas**. So on a failed attempt the streamed text and the offending `partial_json` are gone;
`~/.dsh/storages/` holds only `session_projcache`, with no delivery/delta store to recover them from.

Two practical consequences: counting per **attempt** beats counting per `turn/end` (it separates retries
— one turn showed five attempts — and it carries `request_id`), and any fix aimed at diagnosability has
to capture the fragments at `translate.ts:155`, because nothing downstream retains them.

## Procedure

1. Take the banner text verbatim and locate it in the Quick Reference. The string names the guard;
   never infer the mechanism from how the failure feels.
2. Run `scripts/dsh-attempt-failure-list.mjs <DSH_HOME> [session-substring]` for every attempt's failure
   with code/status/request_id, plus the chunk-type histogram.
3. `read` the named site in the same-version tree and confirm its precondition. For `:155` that means
   the failing attempt had at least one `tool-call-delta`; if it had none, the message would have been
   `expected a JSON object` instead, so re-derive rather than force the conclusion.
4. Place the failure with the ownership table before proposing anything.
5. If it recurs, count the burst per attempt and correlate with what was being generated at that moment
   — for this class that is escape-heavy argument text, not the profile's plugin count.

## Pitfalls

- The `max-tokens` exemption means a length story can never explain `tool input is invalid JSON`.
- `stop_reason` must exist before the check runs at all (`:148`), so a stream missing it fails earlier
  with a different message — do not attribute that failure to `:155`.
- Non-object-but-valid JSON is a *different* message string; merging the two inflates any census.
- `turn/end` alone is not enough: one turn can hold several attempts, and v3/v4 generations double-count.
- `{type:'chunk', time, chunk}` **is** the real record shape inside `assistant/attempt.data.stream`.
  Those lines are not echoes, but they also will not contain deltas — see above.
- Do not "fix" this in a consumer plugin. The decision to fail the step is in the loop, and the invalid
  text originates outside the harness.

## Verification

`node scripts/dsh-attempt-failure-list.mjs <DSH_HOME>` ends with
`attempts=N  unparseableToolArgs=0`, and the histogram lists only `finish` / `block-start` / `block-end`.
A `BAD` row appearing means the durable stream started retaining token deltas — then this section is out
of date and the fragments become recoverable.

Full verbatim catalogue, the test citations that pin each rule, and the corrections to earlier readings:
`references/provider-error-catalogue.md`.
