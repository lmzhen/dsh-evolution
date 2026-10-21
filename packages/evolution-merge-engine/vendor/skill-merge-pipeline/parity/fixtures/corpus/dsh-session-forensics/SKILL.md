---
name: dsh-session-forensics
description: Locate where a DSH message or turn got stuck.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Dsh, Session, Debugging, Message-Flow]
    related_skills: [dsh-plugin-compatibility, dsh-session-preset-repair, dsh-evolution-maintenance]
---

# DSH Session Forensics

Trace one prompt or turn across the whole DSH chain — browser client, host session, agent loop —
and name the exact hop that dropped it, using on-disk session artifacts plus the client source.
It answers "which link is blocked" with evidence instead of UI impressions. It does NOT cover
release/version work (see `dsh-evolution-maintenance`) or plugin protocol breakage
(see `dsh-plugin-compatibility`), and it is strictly read-only against the running host.

## When to Use

- 「结果如何」/「怎么样了」/「跑完了吗」arrives after a host restart or context compaction, with no
  antecedent in this session — treat it as "the most recent open thread in THIS workspace", not as a
  question needing clarification (see the continuation subsection below).
- "网页端发了消息，模型没反应" / a message is visible in the GUI but never gets a reply.
- One client surface works while another does not (page composer vs Chrome side panel vs side chat).
- A turn looks stuck, a session looks wedged, or an app restart is suspected as the trigger.
- You need to prove whether the host ever received a given text.
- A session ZIP appears (`dsh-session-<id>.zip`) and the question is "can this be imported into the
  other client / another machine?" — the platform is export-only; see the transfer section below.

## Prerequisites

- DSH install root (Windows): `%APPDATA%\npm\node_modules\@deepseek-ai\dsh`; nested deps live in
  its `node_modules\@deepseek-ai` folder — that is where client/server packages and their sources are.
- **Know which host you are on, and WHERE ITS HOME IS.** Port 19387 belongs to the DESKTOP app's host process
  (`DeepSeek Harness.exe`, and your own tool calls run as its child processes); the npm-global
  `dsh web` instance listens on 3080.
  **★ The two hosts no longer necessarily share `~/.dsh`** (measured 2026-10-13): the web plane's launcher
  `%USERPROFILE%\.dsh\start-dsh-web.cmd` sets `DSH_HOME=D:\dsh-homes\web` (+ `DSH_AGENTS_HOME`), so
  **sessions / storages / skills / memories are separate per plane and invisible to each other** —
  look for a session or a storage file under `~/.dsh` and you will find nothing, with no error.
  ⇒ **Read `DSH_HOME` from the launcher before searching**, and when a store file is reported missing,
  check the OTHER home's `sessions/` and `storages/` before concluding it does not exist. The desktop
  plane's launcher is the same `~/.dsh` unless its own script overrides it — verify, do not assume.
- The active profile: `~/.dsh/profiles/<name>` — `package.json` → `dsh.profile.bundles` is the real
  plugin roster; `cordis.patch.yml` holds per-row user overrides (last layer wins).
- **The same-version source tree outranks any shipped bundle.** Each release has a full checkout in the
  workspace (`D:\dsh\dsh-upstream-<version>` — `packages/`, `docs/`, `.git`). Resolve which version is
  actually RUNNING first (web: `<global npm root>/@deepseek-ai/dsh/package.json`; desktop: the
  `app: @deepseek-ai/dsh-desktop <ver>` line in
  `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log`), then answer platform-capability
  questions from that tree and cite `file:line`. The user asks for exactly this before accepting an
  answer; it is where "does this feature even exist" gets settled.
- Node >= 22 — **never decode the log with `zlib.zstdDecompressSync` / `createZstdDecompress`**: the file is a CONCATENATION of one zstd frame per flush (measured 2026-09-29: 572,545 frames across 338 logs), the sync API silently returns only the FIRST frame (170–257 B out of a 129 MB file, and it looks like it succeeded), and the stream form returned 0 B. Split at the frame magic `28 b5 2f fd` and decode each slice, or just run `scripts/dsh-session-probe.cjs` (it already frame-splits: `frames=35440 events=80972` on a live log). Reading CJK through the PowerShell console mangles it (U+00B7 printed as 「路」) — compare code points in node. — run `node --version` first.
- Optional: the browser bridge for UI-side classification (`browser_snapshot`, `browser_get_text`).

## How to Run

Locate the session directory, read the plaintext projection for cheap authoritative state,
decompress the event log for the timeline, then read the client source for whichever surface
submitted. Decide every verdict on host artifacts; use the UI only to classify an artifact.

## Quick Reference

Windows artifact map (`~` = `%USERPROFILE%`):

- `<DSH_HOME>\sessions\<escaped-cwd>\session-<uuid>\session.vN.jsonl.zstd` — the event log.
  **`vN` is versioned and moves with the release** (`session.v3.*` = 0.1.5-rc.2, `session.v4.*` =
  0.2.0-rc.2 — measured 2026-10-13 on the web plane). **Glob `session.v*.jsonl.zstd`, never the
  literal v3 name**: a `-Filter 'session.jsonl.zstd'` (or any exact-version guess) returns 0 files
  while 217 sit there, which reads as "no sessions". `DSH_HOME` may not be `~/.dsh` — see Prerequisites.
  The cwd is escaped into the folder name: `C:\Users\x\.dsh\browser-sessions` becomes
  `--C-Users-x-.dsh-browser-sessions--`.
- `~\.dsh\storages\session_projcache\sessions\session-<uuid>.json` — plaintext projection of the
  same session, rewritten on every change; `rows.*.seq` gives ordering. Cheapest source of truth.
- `~\.dsh\settings.yaml` — host settings (model, presets, permission default, per-plugin blocks).
- `scripts/dsh-session-probe.cjs` — frame-splits the zstd log and prints a turn/inbox timeline;
  also summarises a projection file (`inbox` + `turnOutline`).
- `scripts/dsh-renderer-probe.mjs` — reads the DESKTOP renderer over CDP (port 9222, target
  `dsh-app://app/`): `rows` / `expand` dump the sidebar with workspace groups, row keys and indent,
  `eval <file.js>` runs JS in the page, `reload` re-pulls the client list. This is the authority for
  what the user actually sees.

Event types that matter: `user/message`, `agent/inbox/spliced`, `turn/start`, `turn/end`,
`assistant/message`, `system/message`. For "why did this turn fail", two more carry the payload:
**`turn/end`** → `data.reason.{kind,error:{message,code}}`, the ONLY durable record of a failed turn
(the 「本轮运行失败」 banner is that `message` verbatim, per `client/ui-chat/src/client/locale.ts:168`),
and **`tool/call`** → `data.{turn,step,callId,name,arguments}` — committed calls only, because a turn
that dies mid-stream commits neither an assistant message nor a tool call and its arguments are then
lost forever. There is no top-level `chunk` record type. Census plus committed-argument validation:
`scripts/dsh-turn-failure-census.mjs <DSH_HOME> …` (point it at both homes); measured readings, the
`llm-deepseek` provider-error taxonomy and the two counting traps: `references/turn-failure-census.md`.

The single most decisive field is the projection's inbox row:

```json
"inbox": { "ver": 1, "seq": 321, "val": { "next-turn": [], "next-step": [] } }
```

A prompt that reached the host appears as `agent/inbox/spliced` with
`{"target":"next-turn","inserted":[<the message>]}` immediately followed by `turn/start`, then a
second splice with `{"removedCount":1,"inserted":[]}` as it is consumed. Inbox empty + no splice at
that timestamp ⇒ the message never left the client.

Client source for the composer surface:
`<dsh root>\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js`

- `resolveSubmitMode(preferred, running, gesture, steeringAvailable)` — `if (!running || !steeringAvailable) return "queue"`;
  plain Enter and the Send button share the `enter` gesture, Cmd/Ctrl+Enter uses the opposite behavior.
- `BUSY_ENTER_FIELD = "busyEnter"`, `DEFAULT_BUSY_ENTER_BEHAVIOR = "queue"` — user-visible as
  「繁忙时的发送行为」/ "Send behavior while busy".
- `sink()` — documented as "optimistic clear + prompt": the composer is cleared BEFORE the send
  settles, and on failure the draft is restored only while untouched. This is why a dropped submit
  looks like "input empty, no reply, no error".
- `steerQueue()` / QueueDock — per-row Steer, and Ctrl+Enter steers all still-queued rows.

<!-- keep: references/web-composer-wedge.md — dated case archive (2026 web-composer drop: evidence chain,
     four controlled reproduction runs, the restart resolution). The reusable pattern is the composer
     section above; this file records one session's readings, not current-version behaviour. -->

## Procedure

1. Enumerate the client surfaces before touching anything: the page composer, the Chrome side panel
   (a SECOND DSH client with its own connection — it bundles `@deepseek-ai/dsh-client-connection`),
   and any in-page side-chat plugin. Read `dsh.profile.bundles` for the roster. A side chat that
   "does not enter the main session" can never be the surface whose text shows up in the transcript.
2. Read the projection first (`read` tool): `rows.inbox.val`, `rows.turnOutline.val.turns`,
   `rows.titleInput.val.count`. Two turns recorded while the user believes he sent three messages is
   already a verdict.
3. Decompress the log with `scripts/dsh-session-probe.cjs` — never a single-shot zstd call.
4. Read the timeline as turns: `turn/start` → `user/message` → `assistant/message` → `turn/end`, with
   `agent/inbox/spliced` bracketing the enqueue and the consume.
5. Cross-check FIFO: if the user says message A preceded B, B's splice `inserted` array must contain
   A first. A one-item array is proof A never entered the host queue.
6. Only now look at the page, and only to classify: the composer is a `contenteditable` /
   `role="textbox"` element (not a `textarea`). If it is EMPTY while a message row renders just above
   it, that row is a client-local queued/optimistic artifact, not an unsent draft.
7. Read `sink()` / `resolveSubmitMode()` for the submitting surface to explain why the failure was
   silent, then state the broken hop. Do not prescribe a page reload as the fix — this class has
   survived a full reload in practice, so verify before recommending one.
8. Run the two-client control test: send the same prompt from a SECOND client surface (extension side
   panel, another window) and watch the host. A prompt that lands from client B while client A yields
   zero host effects (no `agent/inbox/spliced`, no inbox row, no new entity) localises the break to
   client A's command path and proves host, session, agent loop and model healthy.
9. Answer "restart or reload?" with this rule. A reload rebuilds the client and its connections, so a
   defect that survives it rules out client memory AND one-shot per-connection host state. What is left
   splits cleanly: a host-global wedged singleton (restart helps) vs a composition defect or
   browser-persisted state (restart does not). Discriminate with a client identity the host has never
   seen — incognito window, second browser, or cleared site data: works there => do not restart the
   host; fails there too => restart, and if it returns at once, bisect the profile's plugin rows in
   `cordis.patch.yml`, which the watcher hot-mounts so no further restart is needed.

## Session export, import, and store transfer

Export exists; **import does not**. `@deepseek-ai/dsh-session-log-export` produces
`dsh-session-<id>.zip` (`session.vN.jsonl` + `media/<attachmentId>.<ext>` + `files/…`) through `/export`
or the header's 「下载 Session 日志」, and no route, command, or package takes one back. Answer this
class in order:

1. **Same DSH_HOME ⇒ same store ⇒ nothing to import.** Every profile's base bundle sets
   `root: !!js dshHomePath('sessions')`, so on one machine web and desktop list the same
   `~/.dsh/sessions/--<projectKey(cwd)>--/<encodeSegment(id)>/`. Compare the archive entry against the
   store log byte-for-byte before proposing a transfer — the 2026-10-10 case was a ZIP of a session
   already in the desktop's store, so the honest answer was "no-op, it is already listed".
2. **Direction matters across versions.** Read `SESSION_FORMAT_VERSION` in both source trees. A newer
   reader migrates an older generation (read-only open: in memory, publishes nothing; write-open:
   publishes the successor generation, source byte-identical); the reverse direction is not guaranteed.
3. **One writer at a time.** Write ownership is a cross-process kernel lock beside the log
   (`session.lock`: `flock` on POSIX, a named semaphore on Windows), the loser gets
   `SessionAlreadyOwnedError`, and there is no expiry — the client holding the session must release it
   before another resumes it.
4. **A store root accepts exactly ONE physical encoding.** Appending the ZIP's raw `session.vN.jsonl`
   to a `.jsonl.zstd` root fails loud on list/create/open: `session artifact "…" uses .jsonl, but this
   backend is configured for compression "zstd"`; a log sitting directly in the project dir is the
   rejected legacy flat layout. Re-encode to the root's encoding instead of copying.
5. **Attachments are content-addressed outside the session dir** (images `attachments/v1/objects/<2>/<sha>`,
   files `files/…` + `file-objects/…`), and their `sha256:`-named archive entries break Windows' own
   extractor (`不支持给定路径的格式`) — extract programmatically or with 7z.

Exact rules, error strings, the writer-version matrix and the verification recipe:
`references/session-export-and-store-transfer.md`; re-runnable tooling:
`scripts/dsh-session-zip.mjs` (`list` / `extract` / `compare` / `plan` / `restore` — `restore` refuses
an existing target and a root-encoding mismatch, and the derived path was verified against the live
store's own bucket name).

## Out-of-band sessions and the desktop sidebar

A session written by another process — the other host, an import, a hand-placed file — can be
perfectly readable and still absent from the sidebar, both in its workspace group and in 未分组.
The sidebar shows, per workspace, the **durable member list** in
`~/.dsh/storages/workspace.json` → `tables.workspaces[<id>].sessionIds`, filtered to ids whose cwd
resolves to that workspace path (`packages/workspace/workspace/src/entity.ts:101-103`); everything else
trails in 未分组, and a group renders only a slice plus 「展开其余 N 个会话」. Membership changes only by
`attachSession` (`entity.ts:109+`, called when a host creates or forks a session) or by `bootstrap`,
which merges store sessions by cwd **exclusively while the storage is uninitialized**
(`packages/workspace/workspace/src/index.ts:206-212`; every real store carries `global.initialized:
true`) — so **a restart never re-groups anything**. Lineage renders a fork *indented under its parent*.
Two refreshes fix two different halves:

- **renderer reload** (Ctrl+R, or `scripts/dsh-renderer-probe.mjs reload`) → the client re-pulls the
  list and the row appears (ungrouped, titled 未命名); host, runs and sessions untouched.
- **host restart** → the member list is re-read from `workspace.json` and title projections are
  recomputed (that is what turns an ungrouped 未命名 row into its real title), but membership itself is
  *not* recalculated. Your own tool calls are children of the host process, so a restart issued from
  inside a turn kills that turn — hand it to the user, then verify with the probe.

`session_event_read` proves the host can read such a session (and resolves its real title) but never
attaches it, and a read-only SQLite probe of the live index can report a stale snapshot — never read
absence out of it. Mechanism, code citations and measured before/after sidebar rows:
`references/host-registration-and-ui-visibility.md`.

**The mirror symptom is not damage.** The member list is durable and *shared by both hosts*: whichever
host attaches a session (its own create/fork, or the other client's) writes the id, so a group can show
the other client's conversations (`session.v3.*` = 0.1.5-rc.2 / npm global vs `session.v4.*` =
0.2.0-rc.2 / desktop tells them apart) while rows that were in the group only because the previous host
run held them live fall down to 未分组. The user reads that as "我导入一条对话，结果 npm 侧的对话把我的
全顶掉了". Answer from the store, never from the list: neither a reload nor a restart writes session
files, so `--<projectKey(cwd)>--` still holds every id that was listed before — verify id by id, say
plainly that nothing was overwritten, and name the durable-membership cause. Repair, in order:
(1) opening the row in the client does NOT attach it — measured 2026-10-10: member table mtime and
member count unchanged after the click, and `attachSession` is only called on create/fork — so go
straight to (2); (2) with no desktop host listening, run
`node scripts/dsh-workspace-membership.mjs restore --workspace <cwd> --only <id,id> --apply` and
restart — `--only` is what keeps old test sessions and subagent children in 未分组, and a running host
re-persists its own membership over the edit. `report` mode prints each workspace's members plus
the store ids missing from it, which is also how to prove "which conversations the group lost".

## Answering "结果如何" after a restart (state forensics, not path forensics)

A restarted host keeps the files but loses your in-session memory; the user does not know that and asks
the bare question anyway. Rebuild the answer from disk, then finish from live state — never from memory
of the previous turn, and never by re-asking which task he means (he expects the last open thread in
this workspace, which his question presupposes).

1. **Open the handoff card, not the transcript.** `<workspace>\*situation-*.md`, then the newest
   `*续接卡*.md` / `*continuation*.md` under the active audit directory. They carry status, the exact
   remaining steps, and the deciding numbers; read the newest first because they supersede each other.
2. **Shared state beats recollection for run-style work.** `~/.dsh/evolution/runs.json` (state, pid,
   startedAt/endedAt, resultRef) plus `reports/<kind>-<id>.{md,json}` — a `succeeded` row with a
   `resultRef` IS the result. Cross-session probe rows (`cancelled`, "probe" wording) in the same file
   are normal noise from other writers, not failures of the current thread.
3. **Measure three live facts before saying "done".** (a) which process owns the relevant port and when
   it started — one command answers "is the host up, and on which bytes?"; (b) the installed version
   (`profiles/<name>/package.json`, the lockfile, and `node_modules/@lmzhen/*` package.json versions)
   against the published tag; (c) `git log/tag` of the release repo, so "published" is a tag, not a claim.
4. **Answer with the reading next to each claim**, name what is still open (cleanups, undecided items),
   and close by offering the plausible alternative reading if the instruction could have meant another
   recently touched thread — one clause, not a question that stalls the answer.
5. A card is a save file: when a long run is interrupted mid-flight, write the card BEFORE doing anything
   else, and keep every number in it reproducible by a command printed in the same file.

## Pitfalls

- `Get-Process node` is not a liveness test: it returns nothing (or `Get-CimInstance` returns 拒绝访问)
  under the sandbox while the host is up. Use `netstat -ano | Select-String ':19387\s'` for the listener
  and its owning pid. Reading the version off disk and the pid off the port is what turns "seems done"
  into a verified state.
- An MSYS/Win32 UNC-style `glob` outside the session workspace may time out or come back `os error 3`;
  enumerate with `pwsh` when the tree is large, or glob inside the workspace only.

- `zstdDecompressSync` and `createZstdDecompress` stop at the FIRST frame; the log is multi-frame and
  a naive call yields ~200 chars of header. Frame-split on the magic bytes `28 B5 2F FD`.
- A plain HTTP fetch of the GUI (`http://127.0.0.1:3080/`) returns 401 — the host requires auth. Read
  the page through the browser bridge instead of `Invoke-WebRequest`.
- The Windows console mangles UTF-8 Chinese (`Get-Content -Raw` prints mojibake) — **that was Windows PowerShell 5.1; the DSH `pwsh` tool is 7.6.7 since 2026-10-15 and prints CJK intact (measured)**. It still bites an explicit `powershell.exe`. Use the `read` tool,
  or `Select-String` for matching, when a file contains non-ASCII.
- Never infer authorship from UI text. Grep the installed plugins with `grep` for the literal string
  first: if no plugin ships it, it is user-originated (a pet/remark plugin can otherwise masquerade as
  a stuck message). Coincidental substring hits inside minified bundles (`emmet`, domain tables) are
  noise — always read the surrounding context, and remember the bundles are minified and nested.
- `browser_snapshot`'s quoted label for a textbox may be the placeholder, present even when the field
  has content. Confirm emptiness separately with `browser_get_text({selector: '[contenteditable]'})`.
- Do not generalise one wedge into "surface X is broken". A hung submit can be transient; ask the user
  to re-send from the suspect surface and re-check the inbox before prescribing a fix.
- Confirmed signature of the HOST-MEMORY variant (observed live): every command from ONE client yields
  zero host effects while a second client's prompts land normally, and a full page reload reproduces the
  failure exactly. A reload creates a new client connection but does not clean the host's stale
  registration; only restarting the host process cleared it. So skip the reload, capture evidence with
  `scripts/dsh-web-wedge-snapshot.cjs`, then restart the host and confirm with a fresh splice event.
- Verify a suspected host restart from the PROCESS, never from file or directory mtimes: a session
  directory's mtime does not change when the log inside it is rewritten. Compare the `dsh web` PID,
  its start time, and the owner of the listening port — one command answers "did it restart?".
- Never count occurrences of a UI string across the whole page text: the transcript quotes the very
  strings you are hunting, so the counts are contaminated. Read the owning container instead (the DSH
  composer card carries `data-composer-card`) or use the numbered element inventory. **The session log
  has the same disease, worse** — it holds every message and tool result of the very session you are
  reading, so a substring scan for an error string mostly matches your own prose (measured 2026-10-13:
  50 raw "hits" for one string, 6 real). Split lines, `JSON.parse`, branch on `rec.type`/`rec.data`.
- **Two more census traps in that family.** A session is stored once per format version
  (`session.v3` for 0.1.5-rc.2 beside `session.v4` for 0.2.0-rc.2), so every `turn/end` is counted
  2-3x — dedupe on session+turn+time+code (measured: 123 raw → 50 real). And `{"type":"chunk", time, chunk}` lines **are** a real
  record shape — that is `AssistantStreamRecord` inside `assistant/attempt.data.stream`
  (`packages/core/session/src/types.ts:355`), the durable per-attempt stream. Correction to an earlier
  reading of this skill: they are not echoes. But the stream is **compacted** — block boundaries plus the
  terminal `finish`, no token deltas (measured 2026-10-13 across 223 logs: 388 attempts, histogram
  `finish:369 block-start:32 block-end:20`) — so it will not hold the fragments you may be hunting.
  `dsh-llm-stream-failure-triage` owns that path.
- The QueueDock stages rows locally as 「N 条排队消息」 + 「发送中…」 with edit/remove/steer disabled
  "until their Host queue rows arrive"; such a row is a client-side artifact whose buttons cannot be
  clicked to flush it. Plain Enter resolves to the queue even when the agent is idle, so the host owns
  the wake — a submission that never wakes looks exactly like a dropped message.
- **Reading the sidebar needs CDP, and CDP needs the launch flag.** `scripts/dsh-renderer-probe.mjs`
  works only while the app was started with `--remote-debugging-port=9222`;
  `%APPDATA%\@deepseek-ai\dsh-desktop\DevToolsActivePort` keeps the PREVIOUS run's value, so compare
  its mtime with the app's start time before trusting it (a relaunch from the Start Menu drops the
  flag). The pixel fallback has three traps: `PrintWindow` with `PW_RENDERFULLCONTENT=2` returns a
  fully blank frame once the window stops rendering (occluded/backgrounded), a background process'
  `SetForegroundWindow` is refused, and `ShowWindow(h, SW_RESTORE)` un-maximizes the user's window
  (put it back with `SW_MAXIMIZE=3`). When all of that fails, ask the user to scroll and report.

## Abort attribution (a turn that ends by itself)

A user-visible `This operation was aborted` is an `AbortError` from a **plain `abort()`**; a timeout
signal reads `The operation was aborted due to timeout` instead. Read the pair, not the prose:

- Child session's last event `turn/end {reason:{kind:'aborted',reason:{kind:'parent'}}}` ⇒ the PARENT
  cancelled it. If that child log then shows no model error and no tool timeout, stop blaming the
  child — and do not blame the LLM stream-idle watchdog unless `MESSAGES_IDLE` / `stream idle timeout`
  is actually present (it only counts one outstanding read, and SSE events/heartbeat comments pulse it).
- The parent's `command/run` → `command/done {kind:'error'}` timestamps give the wall clock. A round
  number (300 s, 600 s) with 1–2 s of spread across attempts is a FIXED DEADLINE, not a stall; a stall
  scatters.
- `CommandInvocation.signal` is documented as "owned by the dispatching UI request"
  (`packages/interaction/commands/src/index.ts:56`), so an abort at a round wall-clock number points at
  the REQUEST's lifetime (client/transport) rather than at any model or tool timer.

When a constant grep comes up empty, trace the CALL PATH instead of widening the search: start from the platform
interfaces the plugin actually uses and read each hop's implementation to the end — for a slash command that is
`commands.execute(...)` (`@Remote`, `interaction/commands/src/index.ts:360`, signal "owned by the dispatching UI
request") → the client caller (`client/ui-commands/src/client/service.ts` → `client/connection/src/client/rpc.ts`
HTTP POST, signal only when the caller supplies one) → the host carrier (`client/connection/src/http-bridge.ts:47-49`,
where a premature socket close becomes a PLAIN `abort()` — the exact source of the user-visible text) → the HTTP server
(`host/webserver/src/index.ts:243`, no timeout overrides). Say where the trace bottoms out when the owner sits below the
repository (Electron/Chromium socket behaviour) instead of inventing a mechanism — and disprove a promising suspect with a
scaled-down experiment rather than argument (see the reference: Node's `requestTimeout` looked exact, then survived).
Enumerate before blaming: non-test constants of the same-version source tree in the observed band, the
running profile's row configs (`cordis.patch.yml`, the bundle patches), and the running build's own
bundles — a mechanism that merely sounds plausible must also match the log's signature. Worked example
with the exact log lines and what it ruled out: `references/abort-attribution.md`.

## Verification

After the user re-sends from the suspect surface, the projection's `inbox.next-turn` returns to `[]`
AND a fresh `agent/inbox/spliced` whose `inserted` carries that exact text appears immediately before a
new `turn/start`. Seeing that proves the client→host hop end to end; its absence, with the composer
already cleared, proves the drop happened inside the client.
