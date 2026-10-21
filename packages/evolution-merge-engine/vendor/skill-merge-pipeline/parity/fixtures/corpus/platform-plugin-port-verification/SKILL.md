---
name: platform-plugin-port-verification
description: Prove a plugin port against a new platform release.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Plugins, Platform Compatibility, Verification, Release]
    related_skills: [capability-replication-audit, dsh-plugin-compatibility]
---

# Platform Plugin Port Verification

Adapt a plugin to a new release of the platform that hosts it, and prove the port
against the installed copy rather than against prose. The work ends as a landed
change set, refreshed docs, and one versioned release. It assumes the target
platform is installed locally so its bundled implementation, its docs, and its
CLI can all be read and run; it does not cover authoring a plugin from scratch.
Session-specific evidence lives in `references/openclaw-2026.9.4-seams.md` (seam map, live-proof commands, the four defects a live run exposed, and the claims left unverified).

## When to Use

- "This plugin was written for <older version>; make it work on <new version>."
- A port review asks which platform interfaces a plugin uses and whether each use is still correct.
- An audit document claims gaps; you must decide which are real, fix them, and record why.
- Seam symptoms: a hook never fires, an approval never appears, a prompt section moved, a declared capability is silently absent.

## Prerequisites

- Installed copy of the target platform. Its bundled JS **and** its `docs/` are both evidence; every quoted line number must come from the install, not from the upstream source tree.
- The port's upstream implementation, plus a sibling port when one exists (the sibling shows which divergences are intentional).
- An isolated instance for live proof: its own profile/state dir, its own port, a scratch workspace. Never prove behavior in the user's live instance.
- A gate pair that always runs together (typecheck + the repo's behavior suite) and one home document for evidence.

## How to Run

1. Inventory the plugin's platform call sites first (per-API counts, not prose).
2. Read each seam in the install: type declarations + implementation + docs page; record `path:line`.
3. Decide per seam: valid / renamed / removed / behavior-changed / better equivalent exists.
4. Design invariants and fallbacks before code; one owner per responsibility.
5. Implement in small batches; run the gate pair after every batch; commit each green batch.
6. Prove each batch on the isolated instance with a real turn and a real tool call.
7. Refresh all docs, bump every manifest, present the release checklist, publish on approval.

## Quick Reference

| Need | Method that worked |
|---|---|
| Seam contract | grep the installed bundle for the symbol; confirm against `docs/`; line numbers from the install |
| Prompt seam landed | one real turn + the run's prompt report (file list, section sizes) and a controlled model question with a negative-control string |
| Approval seam | a gateway-routed turn; read the platform's own routing verdict in the log |
| Command dispatch | the chat protocol the UI uses (`chat.send`-shaped), not a programmatic agent turn |
| State persisted | compare sidecar mtimes against the turn's end timestamp |
| Pure move equivalence | AST fingerprint + full string-literal multiset equality, then one end-to-end run |
| Declared-but-missing capability | list what the platform actually loads (its own inventory command) instead of reading the manifest |
| Context field truth | read the object-construction site in the installed bundle: the declaration may allow an optional field the dispatcher never passes, and may omit a payload field that exists at runtime |
| Recovery entry | register on both the interactive and the terminal surface, sharing one implementation |
| Signature drift | one compile against the installed `.d.ts` via a throwaway tsconfig inside the repo (shims hide it) |
| Registered surface, platform's own account | the run's prompt report (`tools.entries`, `skills.entries`) plus its tool-call summary — not the manifest |
| Declared surface vs install record | the platform hashes the manifest-declared surface; growing it invalidates the record stored at install time |
| Subsystem opt-in | one flag gates prompt text, timers, the persisted job, the write tool and its approval gate; every snapshot needs a runtime setter |
| Which port a CLI command talks to | read the config each subcommand loads — profile state dir vs the working directory's `state/*.json` can disagree; run the gateway on the port the command in hand uses, or pass `--port` where the subcommand accepts it |
| Platform-capped knob | read the clamp constants in the install before promising a value (a wait/timeout is clamped to `[default, max]`); the hook budget covers your handler only, not a wait the platform performs afterwards |
| Turn result with tool summary | the agent-style invocation with `--json` returns `meta.toolSummary` and the prompt report; the chat-protocol path returns only "started" — read the reply from the session transcript |

## Procedure

1. **Inventory before reading code.** Count call sites per API. A seam you never enumerated cannot be verified.
2. **Read the install, not the upstream repo.** Declarations tell you what may exist; the implementation tells you what happens. Both are needed before a verdict.
3. **Classify the seam** and write the verdict into the home doc with the exact `path:line` you read, dated.
4. **Design for absence.** Every optional seam gets an explicit fallback path, and exactly one of the two paths is active at runtime (guard the text so it can never appear twice). Fix audited functional gaps even when the fix changes behavior — "this keeps behavior unchanged" is never a reason to defer one; only a user product call or a genuinely absent platform interface justifies leaving it open, and then it is recorded as open.
5. **One implementation, two entry points.** When an interactive surface and a terminal surface need the same operation, extract the body into a named function and have both callers call it — including the tool body that the platform itself invokes.
6. **Gate pair, growing.** Typecheck plus the behavior suite. The assertion count may only grow; a refactor that adds no coverage is proven by equivalence evidence instead.
7. **Pure moves in three batches** (hooks → tools → commands), each committed green, each with per-region AST/string equivalence against the pre-move file.
8. **Live proof per batch.** One real turn (loads and registers everything) and one real tool call (proves the factories) on an isolated profile.
9. **Unavailable-but-callable seams.** Some platform bindings are stubs that throw on call; detect them by their stable error code, disable the feature for the process, and fall back in the same turn.
10. **Never lose a gated action.** If a decision cannot be delivered to the user (no route), stage the action with its exact parameters and expose a recovery entry on the same class of surface that produced it.
11. **Apply staged work directly.** Re-run the stored parameters through the same body, then verify the side effect before consuming the record.
12. **Close the release.** Docs refreshed, version bumped in every manifest, gates green, release checklist presented, publish only after explicit approval, remote verified.

### Real-types check (the shim gate cannot see this)

A repo that type-checks against local shims proves nothing about signatures: a shim such as
`registerTool(tool: any)` accepts what the real declaration rejects. Run one extra compile against
the platform's own `.d.ts`, from inside the plugin repo:

- Write a throwaway tsconfig **inside the repo** (so `types: ["node"]` resolves from the repo's
  `node_modules`; a config in a temp dir fails with TS2688) whose `paths` map each SDK specifier to
  the installed `dist/**/<entry>.d.ts`, and whose `include` lists the plugin sources in forward
  slashes — Windows backslashes make tsc report "No inputs were found".
- Run the repo-local compiler (`node node_modules/typescript/lib/tsc.js --noEmit -p <cfg>`); delete the
  config on success, keep it on failure.
- Expect real findings on the first run, and expect most of them to be type-only: object literals widen
  `type: "text"` to `string` unless the tool factory is annotated with the platform's tool type, and
  hand-written handler parameter types fail TS's weak-type rule when one member of the event union
  lacks the property. Let the platform registration method infer handler parameters; when a result type
  is not exported from the SDK barrel, derive it (`Awaited<ReturnType<Tool["execute"]>>`) instead of
  restating it. Fix the ones that hide a real defect (a narrower parameter type can mask dropped data).
- Ship the check as a repo script so the next platform upgrade re-runs it.

### Gating a subsystem behind one switch

Making a subsystem opt-in is an inventory job first: list every surface it touches, then hang each one
off the same flag. Missing one leaves the "off" state leaky or the "on" state dead.

- Prompt text often has two mount points (a platform section API and a static-prompt fallback): gate the
  *content*, not one mount, so a later runtime enable does not find the platform path empty.
- Timers and nudges read the flag when they fire; keep counting while off so state stays visible.
- A **persisted** scheduler job is not covered by skipping registration — find the owned job (declaration
  key, or name/id plus your owner tag) and remove it, or it keeps firing; its startup catch-up run may
  already be queued.
- The write path refuses with the exact command that turns the side back on, and the approval gate stops
  prompting for a write that will be refused anyway.
- Runtime flips must reach every construction-time snapshot: the resolved config, the config object you
  hand to submodules, and each per-workspace tracker (give them a setter). Otherwise `/… enable` writes
  the file, logs success, and changes nothing.

Surface inventory, the propagation list and the two-sided verification: `references/subsystem-opt-in-checklist.md`.

### Driving a live isolated instance

Live proof needs four things wired before the first run, or the first attempts fail for reasons that look
like defects:

- **Pin the port from the command you are about to use.** A profile flag isolates state, but subcommands
  do not all read the same config: the profile config and the working directory's state config can name
  different ports, and the ones without a `--port` flag silently use the wrong one. Start the gateway on
  the port your driving command expects (or pass `--port` explicitly on the ones that take it).
- **Turn text with non-ASCII or several lines** goes through a message *file* (`--message-file`), not an
  argument: shell quoting mangles it and the failure looks like a bad request.
- **Read the turn's own report** (`--json`): the tool summary (`calls/tools/failures`), the prompt report,
  and the final payload are all in it. The chat-protocol path returns "started" only — fetch the reply from
  the session transcript (session table → event table, newest seq) instead.
- **Capture load-time plugin lines from any command that loads the plugin**, not just the gateway log: a
  plugin CLI subcommand prints the same registration lines in-process, which is often the cheapest source
  for "which branch did the plugin take at load".
- **Drive gateway RPCs from Node, not from a Windows shell.** PowerShell 5.1 strips the quotes out of a
  JSON argument (the CLI then answers "must be valid JSON"). Write the params to a file and spawn the CLI
  with an argv array (`spawnSync(process.execPath, [cli.mjs, "gateway", "call", <method>, "--params", json,
  "--port", …, "--token", …, "--json"])`); no shell, no mangling. `chat.send` also requires
  `sessionKey` **and** `idempotencyKey`, returns only `{status:"started"}`, and the reply must be read
  back from `chat.history`.
- **A config hot reload is not a code reload.** Writing a plugin config value re-runs the plugin entry with
  the *module cache intact* (edited code keeps running its old body) and does **not** re-run
  `gateway_start` — anything a startup hook captured (a workspace path, a service handle) is empty on the
  new instance and every command that depends on it fails until a real restart. Resolve such values lazily
  from config with the hook value as fallback only, and restart the gateway to test code changes.

Concrete commands, JSON shapes and the observed strings: `references/live-isolated-instance-driving.md`.

### Config-form UX of a ported plugin

The platform renders the manifest `configSchema` as the settings page; the plugin controls only the hints.

- Row order is `hintForPath(...)?.order ?? 0`, then key name (`ui/src/components/config-form.node.collection.ts:91-99`) —
  un-hinted plugins read alphabetically by key. `order` is absent from the manifest-facing hint type but
  present in the runtime one and passes the normalizer, so emitting it from the manifest works (verified
  live). Emit it from the entry registry (row × 10) so re-ordering never touches numbers.
- `hint.group` is rendered by nothing (grouping exists only as adjacency) and `hint.advanced` is inert on the
  plugin detail page (`renderNode` directly). Grouping that *does* render: a nested object key becomes a heading
  above its rows and always starts collapsed — recipe in `references/plugin-config-ux.md` §5.
- The platform appends its own English category tags (`automation`/`performance`/…) to every hint. A plugin
  cannot remove them, but the rules match the path string, so the key names can dodge them (§6 there).
- The control follows the schema shape: `enum` ≤5 values → segmented buttons, >5 → dropdown, string/number
  → single-line (no multiline exists anywhere). **A dropdown is an enum, and an enum is a validation
  constraint** (config values are validated against the plugin schema), so only convert a key when the list
  can be exhaustive — build it from the runtime (`Intl.supportedValuesOf("timeZone")`) with the user's own
  region first — and keep open-ended values (cron, prompt overrides) as free text with examples in `help`.
- When the user rejects an ordering or the wording, settle it in a **discussion document first** (every
  entry with type/default/label/purpose/why-here, the principles, and a log of rejected variants), then bind
  that document to the code with an assertion on its table order — the doc is the review surface and cannot
  drift. Copy sweeps must cover every rendered surface (form rows, panel HTML, chat replies, CLI output, tool
  reports, approval dialog, scheduler and suggestion entries, manifest description); grep one literal form
  and you will miss the lines built as array elements.

Ordering recipe, copy surfaces and the live-driving quirks: `references/plugin-config-ux.md`.

### Auditing your own landed change

A feature that talks to the platform is worth one pass *after* it works, in this order:

1. Enumerate every platform interface the diff touches (hook result fields, ctx fields, SDK subpath,
   manifest/schema keys) and re-read each one in the **installed** declaration or bundle — the runtime
   proof shows the happy path, not the contract.
2. Look for **fail-open fallbacks**: a config value that falls back to a permissive default (allow / off /
   no-gate) turns a typo into a silently disabled safety feature. The resolver must stay pure, so log the
   mismatch where the resolved config is built, and assert it in the suite.
3. Look for **registration-time snapshots**: values captured when the handler was registered cannot react to
   a runtime command; read them per call.
4. Grep the docs for statements the change just falsified (fixed timeouts, "always asks", "only surface X"),
   including dated process records, and correct them in place instead of leaving both versions standing.

Contract facts worth keeping for the approval-style seams (clamp constants, decision vocabulary, staged
fallback, where the wait actually happens): `references/platform-approval-seam.md`.

### Answering "does the platform already provide X?"

Before designing a feature the platform may already reserve, look for its **source checkout** — bundles
answer contract questions slowly, and the source carries the tests and docs that say what is enforced.

- Confirm the checkout matches the runtime before citing it: `git rev-parse "<tag>^{commit}"` plus the
  `package.json` version. Two checkouts of different ages can sit side by side; reading the wrong one
  produces confident, wrong answers.
- Split the reading: **source** for contracts, enforcement and tests; **installed bundle** for what the
  running build actually does; one live RPC/CLI call to confirm the two agree.
- Grep for the *consumer*, not just the registration: the reservation only exists if something renders or
  dispatches it (a route with no renderer, or a descriptor nothing advertises, is not a usable surface).

Map of the config-UI reservation this produced (schema form, manifest hints, native UI plugin, tab limits)
with source paths: `references/platform-config-ui-surfaces.md`.

## Pitfalls

- **A single condition branch is not behavior.** A source-read gate looked decisive for command dispatch; a live run disproved it (the terminal RPC path dispatched, the programmatic turn path did not). Correct the document the moment the machine disagrees, and say plainly that the earlier claim was wrong.
- **Never make the model reproduce exact parameters.** It regenerates content; byte-identical replay never matches. Apply stored parameters through the same body, and keep byte-identity as a separate user-initiated channel.
- **"No exception" is not success.** Tool bodies commonly return validation failure as text. Check a post-condition (target artifact existence, size, mtime) before marking the staged action done.
- **Availability probes that only test `typeof fn === "function"`** pass against a stub that throws on invocation. Look for the platform's stable error code, or catch the first throw and remember it for the process.
- **Type declarations are neither complete nor tight.** A hook-context type listed `workspaceDir?` while the dispatcher built that context as a literal `{config, getCron}`; in the same bundle a cron-job type declared a `text` payload while the runtime passed the internal payload through verbatim (the real field was `message`). Read the construction call site before coding against a field; when the runtime is richer than the type, read shape-defensively.
- **Declared-but-absent artifacts load silently.** A directory the manifest does not list is simply not loaded; nothing errors. Verify with the platform's own inventory command, not by reading the manifest.
- **Growing the declared surface invalidates the install record.** Adding a tool, skill or CLI command
  changes the hash the platform compares against the surface it accepted at install time; existing
  installs then carry a "requires capability consent" warning until re-accepted (`plugins enable <id>
  --accept-capabilities`). The record also stores its own version at install time, so a version fix can
  look absent immediately after you make it.
- **A locked-down host needs no CLI: `plugins.load.paths` is a complete install.** Point it at the plugin
  root (the directory holding `openclaw.plugin.json`) and enable the id under `plugins.entries.<id>`; the
  platform then reports `origin: "config"`, `installSource: "path"`, `activationReason: "enabled in
  config"`, `status: "loaded"` — no install record, no npm, no network. Verified against a real npm
  install, including a TypeScript entry (`openclaw.extensions: ["./index.ts"]`). Three differences from a
  tracked install: capability acceptance cannot be persisted for config-discovered plugins; `plugins
  update` has nothing to update (an upgrade is copy-files + restart); and a non-bundled plugin still needs
  `hooks.allowConversationAccess: true` or the platform drops its conversation hooks at registration.
  Config-selected paths outrank bundled and global copies — that is the intended way to override one.
- **CLI probes against a running instance can block on the state lease.** Read-only queries returned in
  19–50 s on a live gateway; a mutating one ran past three minutes. Run them as background jobs with
  generous timeouts, and never read "the command failed" out of an unfinished process.
- **An exception is not automatically a failure.** A removal call surfaced "… was removed, but session
  cleanup failed: …" — the job was gone and only a follow-up step had complained. Judge by re-reading the
  end state (list again) and log a follow-up report as a warning, not as a failed operation.
- **A document that says "已修 / fixed" is a claim, not a fact.** A remediation note asserted a test had
  been rewritten to read the real table; the file still held the old literal copy, so the drift it claimed
  to close was still open. Re-read the code before building on any "fixed" annotation, then correct the
  note in place.
- **Attribute a refusal before calling it a regression.** "Approval unavailable (no approval route)" came
  from the *platform* (grep the install for the string), and the plugin's documented fallback — stage the
  action with its exact parameters, expose the recovery entry — had fired correctly. Blame the side whose
  text you actually found.
- **A missing report section is usually conditional.** The status surface omitted one section because its
  render guard required a scored record; the code line (`if (scored.length > 0)`) settled it in seconds.
  Find the guard before writing "regression".
- **A fallback to a permissive default has to be loud.** An approval-mode resolver fell back to "no gate" on
  any unrecognized string, so a typo silently switched the safety gate off. Log the mismatch next to the
  resolved config and pin it with an assertion; never let fail-open happen quietly.
- **A long wait is real only if it sits outside the hook budget.** The hook budget table (a `before_*` hook
  can be ~15s and fail-closed) looks like it caps everything, but a hook that only *returns a descriptor*
  hands the actual wait to the tool-call path — read both sites before promising "waits up to N minutes".
- **Display copy is a surface, not a comment.** Sentences that explain the UI to its own reader ("copy this
  command as-is", "… is the key, not the label"), spec-sheet inventories of internals, and em-dash rationale
  clauses read as machine-written. Ship what it is plus how to change it — and make each row carry the action
  that changes *its current* state — then pin it with a test that greps the rendered surface for the banned
  patterns, so the copy cannot regress.
- **A copy sweep that greps one literal form misses the rest.** Searching only `text:` values left the toggle
  listing, the suggestion listing, adopt/release output, the journey detail and the whole CLI help in the
  other language — they were built as array elements. Extract *every* quoted segment containing the target
  script from each file that speaks to the user, and run the retired-term blacklist over the config
  registry, the feature table, the rendered panel HTML and those extracted literals.
- **Editing a large file with a bounded read → full write deletes the tail.** Read the whole file, or splice by anchors. Prefer targeted edits over rewrite.
- **EOL-blind text transforms.** Split on the file's own line ending (`\r\n` vs `\n`) or `trim()`-based anchors never match and the script silently no-ops.
- **Process cleanup.** Stop background work through the job handle. A broad process-name filter can kill the harness's own runner, and killing a job's child directly can wedge it.
- **Two writers, one file.** Re-read short, unique anchors before each edit; never trust remembered line numbers.

## Verification

- Gate pair green with a non-decreasing assertion count; record the exact output.
- Every ported behavior has one live observation in the home doc (a log line, a file on disk, a state/ledger change, or a prompt report) and an explicit list of what is *not* verified.
- A pure move is proven by equivalence evidence **plus** one end-to-end run, never by the suite alone (the suite may not import the entry point at all).
- The release is verified remotely (branch and tag visible), not only locally.
- Docs are refreshed in the same pass as the code, one topic keeps one home document, and any claim a later run contradicts is corrected in place and marked as corrected — never left standing.
- The compile against the installed declarations is green (not only the shim gate), and it exists as a
  repo script rather than a one-off command.
- An opt-in switch is proved twice: **default-off** (no prompt text, no nudge, no scheduler job, the write
  tool refuses and writes nothing) and **runtime-on** (the same process resumes text and nudges with no
  reload) — plus one live line per claim (load log, toggle listing, the scheduler list).
- A change that gates one subsystem triggers a live pass over the **untouched** neighbours too (registration
  list, their tool calls, their scheduled jobs, an end-to-end write/delete cycle), with the raw lines kept in
  the same home document as the change itself — "the other side still works" is a claim that needs its own
  evidence.
- The self-audit pass (above) ends with the same gate pair plus a live check per mode/value: each configured
  value is observed doing its own thing (apply, stage, refuse), not merely parsed correctly.
- When the answer is "the platform already reserves an interface", the report names the entry point, the
  data source, the write path and the limits, each with a `path:line` — and separates what is free today from
  what needs new code with its cost.
