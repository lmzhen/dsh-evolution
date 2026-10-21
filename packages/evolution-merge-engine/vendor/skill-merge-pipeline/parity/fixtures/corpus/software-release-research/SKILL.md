---
name: software-release-research
description: Look up latest releases and verify local installs.
---

# Software Release & Version Research

Use when the user asks for a software's latest version, which version is
"newer" or "more advanced", what a release changed, or whether a feature/model
is supported by an installed version. Typical targets: DSH (`@deepseek-ai/dsh`),
its plugins, and any npm/GitHub project.

## Before any publish: identify the channel ("push and release" ≠ publish)

A user asking to "推送并发行" wants the artifacts *and* the release; the publish mechanism is not the
same question as the push. Establish which channel this project actually has **before** touching a
version number, because a wrong publish is unrecoverable and a version bump without a publish is a
dead release number (the family rule: never reuse a published version).

Five cheap checks, run in this order:

1. Is the package public at all? `npm.cmd view <name> version` — E404 means either not published or not
   visible; both mean "no npm release path you can use".
2. Do you own the scope? `npm.cmd whoami` gives the account; an `@scope` owned by someone else cannot
   be published to from this account, whatever the local name says.
3. What does the manifest say about distribution? A `workspace:*` devDependency means the package is built
   inside its host's workspace and usually ships with that repo, not as a standalone npm package.
4. Is there any automation to follow? `.npmrc`, `.github/workflows`, an obvious release script — their
   absence means "no institutional channel exists", which is itself the finding.
5. Does the project's own user doc mention publishing? If the README documents only `plugins install` /
   `git pull`, that is the documented channel; do not invent a registry one.

Then separate the two halves and say which you did: **push + annotated tag + release notes are always
safe and reversible; a registry publish is neither.** When no channel is identifiable, do the first half,
write a release note that records *why* the second half did not happen, and ask for the channel — never
guess a registry, and never report "released" in a way that implies bytes were published.

## Tag proof: the release must be self-contained at the tag

Whatever the channel, readers land on the **tag**, so everything the release claims has to be *inside
the tagged commit* — not in a separate repo, not only in a chat message.

- Write the release note in-repo (e.g. `docs/release-<version>.md`), commit it, and register it where the
  project's index lists documents; a note that exists only outside the repo cannot be re-derived at the tag.
- **Tag after** the note is committed. If you already tagged, move the tag: delete it locally and remotely
  (`git push origin :refs/tags/<tag>` then re-tag and push) — safe while nothing downstream has consumed it,
  and the alternative (a tag without its own release note) is permanent.
- Verify the end state from the remote, not from your memory of the commands: `git ls-remote origin refs/heads/master refs/tags/<tag>`,
  then compare `git rev-parse <tag>^{}` with `git rev-parse HEAD` — the two must be the same commit.
- The release range is `last-tag..new-tag`, which may include commits you did not write in this session.
  Enumerate it (`git log --oneline <old>..<new>`) before describing the release, or the notes will undercount.

## npm packages: version, channels, timeline

On Windows, `npm` resolves to `npm.ps1` which is often blocked by the
PowerShell execution policy — **always call `& npm.cmd`** in pwsh:

```powershell
& npm.cmd view @deepseek-ai/dsh dist-tags    # latest / next / alpha channels
& npm.cmd view @deepseek-ai/dsh time --json   # full release timeline
& npm.cmd ls -g @deepseek-ai/dsh              # locally installed version
```

Two Windows command-construction traps:

- A **saved `.ps1` file will not execute** under the default execution policy — a script
  written to disk and invoked with `& file.ps1` is rejected. `.cmd` shims cover
  npm/pnpm/dsh; for your own multi-step loops, inline them in `-Command`.
- `npm view "pkg@<range>" version` is the cheapest ruler for prerelease-range questions:
  it prints exactly the published versions the range admits, using npm's own semver.
  Prefer it over reasoning about prerelease rules by hand — a range like `>=0.1.2-rc.1`
  admits far fewer versions than it looks like it should.

Reading the channels:

- `latest` = default install target; `next`/`alpha` = preview lines.
- **Dist-tags move independently of publishes.** Between two checks four days
  apart with *no* new version in between, `latest` jumped from the old rc line to
  the then-newest one. So "is the latest still X?" needs two answers, not one:
  the newest **published version** (from `versions` / `time`) and **where each
  channel points right now** (`dist-tags`) — plus which one `npm i -g` would
  actually install today. A semver-higher alpha is *published* newer while a
  lower rc can be the *install* target; say both.
- **Answer on the npm axis.** This user tracks DSH currency on npm and treats it
  as the reference; the desktop/CDN channel is a *separate* question they raise
  deliberately, not part of a routine "is it still the latest?" answer. Reporting
  both unasked reads as scope creep — mention the desktop only when asked, or
  when the npm answer alone would be misleading.
- A semver-higher preview line (e.g. `0.1.2-alpha.4` vs `0.1.1-rc.2`) is
  **functionally newer** — it carries the later milestone's changes — but
  `alpha` is a preview/test channel while `rc` is a release candidate. State
  both: "feature-newer, stability-older".
- Always cite the `time` timeline for release dates; channel names alone do
  not prove which came first.

## GitHub release notes

- **List releases without the API**: `https://github.com/<owner>/<repo>/releases.atom`
  (RSS feed; immune to GitHub's anonymous API rate limit ~60 req/h).
  Entry `title`/`published` are reliable; some entries have **empty content**.
- **Get full notes**: fetch `https://github.com/<owner>/<repo>/releases/tag/<tag>`
  HTML and extract the `markdown-body` div:

```powershell
$html = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
$m = [regex]::Match($html, '<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>(.*?)</div>\s*<div', 'Singleline')
$txt = $m.Groups[1].Value -replace '<[^>]+>',' ' -replace '&amp;','&' -replace '&#39;',"'" -replace '\s+',' '
```

- Preferred repos: the project's own GitHub; release tag pages are the
  authoritative source. Do **not** burn time on
  `raw.githubusercontent.com/.../CHANGELOG.md` — branch/path guesses 404
  often; fall back to release pages.

## Local install verification (does my version support X?)

1. Confirm installed version: `& npm.cmd ls -g <pkg>`.
2. Feature/model-support claims live in the installed package's sub-packages,
   not the top level. For DSH: `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/`
   holds the DeepSeek adapter (model catalog, Files API); grep it for model ids
   (`deepseek-v4-flash-vision-exp` etc.).
3. **Narrow the grep path first** — recursively grepping a whole 1000+-entry
   node_modules tree times out (~30 s). List the dir structure, pick the
   sub-package, then grep.

## Which version was a released binary/desktop build packaged from?

GitHub releases are the wrong lens for vendor desktop apps: DSH's releases carry
**zero assets**. Read the upload contract from the source instead of guessing
URLs (`apps/desktop/README.md` documents the `upload:latest:*` targets and
`DSH_DESKTOP_AUTO_UPDATE_ENV`), then:

1. **Probe versioned object names.** The CDN is `https://download.deepseek.com`;
   versioned installers live at
   `dsh-desk/bin/<target>/deepseek-harness-<version>-<target>.<ext>`
   (`target` ∈ `mac-arm64`, `mac-x64`, `win-x64`) and the floating pointer is
   `desktop/dsh-latest-<target>.<ext>`. `HEAD` gives `Content-Length` and
   `Last-Modified`, which dates the build without downloading 300 MB.
2. **Pin the version by byte identity** across all targets: the floating
   pointer's size equalling one versioned object's size is cheap and strong.
3. **Confirm inside the binary.** A range GET of the first ~3 MB of the Windows
   installer, searched as UTF-16, reads the PE `VS_VERSION_INFO` resource
   (`FileVersion` / `ProductVersion` / `ProductName`). Skip the DMG — its version
   sits inside the packed app bundle.
4. A `.../feeds/<target>/latest.yml` 404 is often correct, not a failure: the
   fixed-installer upload path replaces one object **without** publishing feeds.
5. The app may have no version of its own — DSH's `apps/desktop/package.json`
   tracks the root version, so "desktop version" == release version. It also
   bundles its runtime rather than installing one from npm
   (`@deepseek-ai/dsh-desktop-host` is not published).
6. **A preview line can have no desktop build at all.** The fixed installer sat
   unchanged while npm and GitHub moved on to the next alpha. Probe the versioned
   object for the candidate version directly and read a 404 as "the desktop has
   not shipped that line yet", not as a wrong URL; use the fixed pointer's
   `Last-Modified` to date what is actually published.

Windows pitfalls that each cost a wasted attempt:

- `Invoke-WebRequest -Headers @{ Range = 'bytes=0-2999999' }` throws
  *"The 'Range' header must be modified using the appropriate property or method"*.
  Use `curl.exe -s -L --proxy <p> --range 0-2999999 -o part.bin -w "%{http_code}" <url>`.
- Redirection's encoding follows the shell: an explicit `powershell.exe` (**5.1**) writes **UTF-16LE**
  for `>` and bare `Out-File`, so a Node `JSON.parse(readFileSync(f, 'utf8'))` fails on every field
  and a path allow-list matches nothing. **The DSH `pwsh` tool is PowerShell 7.6.7 since 2026-10-15 and
  writes UTF-8 without BOM.** Write with `Out-File -Encoding utf8` and strip the BOM, or - safest
  across both - decode defensively:
  `raw[0] === 0xFF && raw[1] === 0xFE ? raw.toString('utf16le') : raw.toString('utf8')`.

## References

- [references/publish-channel-verification.md](references/publish-channel-verification.md) — the five checks that settle whether a publish channel exists at all, the half-safe release procedure when only the push half is available, tag hygiene, and what a release note must contain.

## Reference

- `references/dsh-version-lookup-notes.md` — DSH release timeline, per-release
  highlights (rc.2 → 0.1.2-alpha.4), and how to verify model support in an
  installed DSH.
