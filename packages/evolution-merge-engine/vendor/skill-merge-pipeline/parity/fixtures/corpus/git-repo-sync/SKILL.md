---
name: git-repo-sync
description: Establish, back up, and sync a git repo with its remote.
---

# Git Repository: Backup, Sync & Update

## When to use

- User asks to "update from Git" / "pull latest" / sync a local clone.
- A remote branch was force-pushed and a normal `pull --ff-only` fails with "diverging branches".
- GitHub/HTTPS fetches fail with OpenSSL/TLS errors.
- **User asks whether work is backed up ("备份到 git 了吗"). Run the audit below before answering — never answer from memory or from the presence of a `.gitignore`.**

## Is it even a repo? (audit before answering "backed up")

Do not infer a repo from a `.gitignore`, a `files` whitelist, or commits elsewhere in the tree. **A well-commented `.gitignore` with no `.git` is a real observed state** — someone intended to init and never did. Walk up from the project dir to the drive root:

```powershell
$p='D:\path\to\proj'
while ($p) { if (Test-Path (Join-Path $p '.git')) { "repo at $p"; break }
             $n=Split-Path $p -Parent; if ($n -eq $p -or -not $n) { 'NO repo up to drive root'; break }; $p=$n }
```

Check all three backup forms, not just the first:

| form | check |
|---|---|
| local repo | walk-up above |
| remote, actually synced | `git remote -v`; `rev-list --count origin/main..HEAD` **and** `HEAD..origin/main` both 0 |
| published artifact | `npm view <name> version` — empty means never published |

Also search the disk for a second copy before concluding; the directory can be the only one.

**Quantify what is NOT covered — "it ships" and "it is backed up" are different sets.** A published tarball is a whitelist subset; measure it:

```bash
npm pack --dry-run                              # text mode: "total files" + the file list
node -e "console.log(require('./package.json').files)"
```

Real case: whitelist `["index.js","client.js","lib/","cordis.patch.yml","README.md","USAGE.md"]` = 19 files / 239 kB shipped, while `design/` (24 docs), `test/`, `tools/`, `SMOKE.md` — **84% of the project by volume, and the least reproducible part** — sat on one disk with zero copies.

## Establishing the repo (when the audit finds none)

1. **Read the committer identity from an existing repo's LOCAL config — do not invent one, and do not assume a global one exists.**
   ```bash
   git -C <an-existing-repo> config --local user.name
   git -C <an-existing-repo> config --local user.email
   ```
   On this machine global `user.name`/`user.email` were **empty** while several repos had commits, because each set it locally. Copy that value; set it `--local` on the new repo.
2. `git init -b main`, then `git add -A` and **inspect the staged set before committing**: assert 0 hits for `node_modules`, scratch dirs, and anything the `.gitignore` exists to catch.
3. Work-in-progress defaults to private: `gh repo create <name> --private --source <dir> --remote origin --push`.
4. **Verify by fetching the content back, not by the push exit code.**

## Verifying a backup is real

A successful `push`, and `ls-remote` matching the local SHA, only prove a **ref** moved. **A fresh clone into an independent directory is the proof**, because it re-downloads the objects:

```bash
git clone --quiet <url> /tmp/verify-clone
git -C /tmp/verify-clone ls-files | wc -l     # == local tracked count
git -C /tmp/verify-clone rev-parse HEAD       # == local HEAD sha
```
Spot-check that known-large files exist with plausible byte sizes, confirm no `node_modules`/scratch leakage, then delete the clone.

**SUSPECT THE EXTRACTOR when a verification count comes back 0.** Two false zeros in one session, both from the *measurement*, not the repo:

- `gh api <url> --jq '...'` printed nothing ⇒ looked like an empty repo. Bare `gh api <url>` exited 0 with full JSON; the `--jq` invocation was at fault.
- `npm pack --dry-run --json | ConvertFrom-Json` yielded 0 files ⇒ looked like an empty tarball. Plain `npm pack --dry-run` listed 19.

Rule: on a 0 or empty result, re-run the same check with the **dumbest possible output** (no `--jq`, no `--json`, no filtering) before believing it. A zero that would be alarming is far more often a broken extractor than a broken world.

> Real case with numbers, commands and transcripts: `references/backup-gap-audit.md`.

## Safe update workflow

1. Inspect before changing anything:
   ```bash
   git status --short --branch
   git remote -v
   git log --oneline --decorate -5
   ```
2. Prefer a fast-forward pull:
   ```bash
   git pull --ff-only
   ```
   - If it fails only due to SSL, see below and retry with the same command plus the workaround.
   - If it says "Not possible to fast-forward", do **not** assume it is safe to force-reset immediately. Check whether local work is uncommitted and whether local `main` was merely the previous remote tip.
3. For a clean worktree where the remote was force-pushed:
   - Create a backup ref so the operation is reversible:
     ```bash
     git branch backup/main-pre-update
     ```
   - Fetch the real remote state:
     ```bash
     git fetch origin
     ```
   - Point the branch at the remote:
     ```bash
     git reset --hard origin/main
     ```
   - Verify:
     ```bash
     git status --short --branch
     git log -1 --oneline --decorate
     ```
   - Tell the user how to restore if needed:
     ```bash
     git reset --hard backup/main-pre-update
     ```
4. If there are local uncommitted changes or local-only commits that matter, do **not** hard reset automatically. Merge or rebase carefully, or ask the user.

## GitHub/HTTPS connectivity workarounds

On some Windows/proxied environments, `git pull` may fail with:

```text
OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443
```

Retry with both of these Git options (they work together for this failure mode):

```bash
git -c http.sslVerify=false -c http.version=HTTP/1.1 pull --ff-only
```

For read-only checks first:

```bash
git -c http.sslVerify=false -c http.version=HTTP/1.1 ls-remote --heads origin
```

Notes:
- Do not treat this as permanent "GitHub is broken". The same command often succeeds after tweaking HTTP version/TLS verification.

**First settle WHICH ROUTE is live — never reason from a belief about it.** The same
machine can present the mirror image: the configured proxy works while the direct route
is dead. Measured in one session, both aimed at `127.0.0.1:7897`:

- `git ls-remote --heads origin` (**through** the configured proxy) → **exit 0**, returned
  the ref
- `git -c http.proxy= -c https.proxy= ls-remote --heads origin` (**bypass**) → **exit 128**,
  `Failed to connect to github.com port 443 after 21089 ms: Couldn't connect to server`

So run both — one cheap line each — and use whichever exits 0:

```bash
git ls-remote --heads origin
git -c http.proxy= -c https.proxy= ls-remote --heads origin
```

**The bypass is a mode you may be carrying, not a cure.** Putting `-c http.proxy=` on
every command is what turned eight consecutive pushes into 21-second timeouts: the flag
had been inherited from an earlier round in which the proxy *was* the broken hop. Re-test
the direction each time instead of reusing last time's answer, and leave the owner's git
config alone either way.

**A transport error with a ~21 s timeout means the route is dead, not the repo.** Two
signatures, same meaning: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL`, and
`Failed to connect to github.com port 443 ... Couldn't connect to server`.

**Read the output, not only the exit code.** A failed push printed
`Everything up-to-date` while returning non-zero; reading that line as "nothing to do"
hid a whole round of failed pushes. Output that contradicts the exit status is a fact to
chase immediately.

**Check whether the proxy is even running before retrying.** On this machine
the proxy is Clash on `127.0.0.1:7897`, and it is only listening while the
Clash app is up. With Clash off, `git clone/ls-remote/fetch` over HTTPS fails
as `OpenSSL SSL_connect: SSL_ERROR_SYSCALL`, and **no git-side flag fixes it** —
verbatim failures observed in one session:

- `-c http.sslVerify=false -c http.version=HTTP/1.1` → `SSL_ERROR_SYSCALL`
- `-c http.sslBackend=schannel` → `schannel: failed to receive handshake`
- `-c http.proxy=http://127.0.0.1:7897` (explicit instead of env var) → `SSL_ERROR_SYSCALL`

Five retries with backoff all failed; the same command succeeded on the first
try after the user started Clash. So: if two attempts fail this way, stop
retrying and ask the user to start Clash, then run it once.

Triage asymmetry worth knowing: while git was failing, `gh api` and
`npm view` still succeeded over the same proxy. A working `gh` therefore does
NOT mean git will work — the transport differs, not the network.
- If the issue is a mid-transfer drop, retry after a short wait; an external proxy can be selective per host.
- You may set these flags only for the command, or persist them with `git config --global` if this environment routinely needs them.

## Diagnostics when a pull aborts

- `git branch -a -vv` shows ahead/behind counts.
- `git merge-base main origin/main` shows whether histories truly diverged.
- A forced update appears in fetch output as:
  ```text
  + <old>...<new> main -> origin/main (forced update)
  ```
- If local `main` exactly equals the old remote `main` and the worktree is clean, resetting to `origin/main` is normally the correct "update" action.

## Verification

After update, confirm:
- `git status --short --branch` shows no ahead/behind (or intended state).
- `git log -1 --oneline --decorate` shows `HEAD -> main, origin/main`.
- If a backup branch was created, list it: `git branch --list 'backup/*'`.

## Mirroring a very large repository (thousands of refs)

Real case (2026), `openclaw/openclaw`: 7110 branch heads, 747 tags, 99,267 commits on `main`, 5,007,620 objects.

- Prefer ONE `git clone --mirror`. Sliced fetching (`--depth=1000` then repeated `--deepen=2000`) cost ~3x the space of a single pack: 11k commits already occupied 2.2 GB while `main` alone has ~99k commits.
- Expect roughly 75-100 s of TOTAL SILENCE before the first byte: GitHub builds the pack server-side. Silence is not a stall.
- Do NOT judge progress by the pack file or `objects/pack` size:
  - a running clone writes the pack as `objects/pack/tmp_pack_*`, which `git count-objects -vH` reports under `garbage`;
  - that file can be invisible to `Get-ChildItem` while git holds it open, so a size probe reads 0 forever.
  Use git's own `--progress` output, or watch free disk space.
- Never kill a transfer on a "no size change" heuristic; a broken detector killed a healthy clone at 11%.
- Killing the parent `git` does NOT stop the transfer. `git-remote-https` / `index-pack` children keep running, keep the tmp pack and the redirected log locked, and become zombies that block a re-clone. Kill the whole tree: `taskkill /PID <pid> /T /F`.
- Do not run two GitHub transfers at once through the same proxy. Contention appears as `RPC failed; curl 56 ... SSL_ERROR_SYSCALL` during ref listing — a proxy symptom that looks like a repo problem.
- Settings that worked on Windows through a local proxy: `HTTPS_PROXY=http://127.0.0.1:7897`, `-c http.sslVerify=false -c http.version=HTTP/1.1`, plus `-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=600` as a genuine-stall guard.
- Wipe a failed target properly: kill git first, `Remove-Item -Recurse -Force`, fall back to `cmd /c rmdir /s /q`, then ASSERT the path is gone. `git clone` refuses a non-empty destination ("destination path already exists") and fails in seconds.

Progress tail that survives the `\r`-only progress stream and locked files:

```powershell
$fs=[System.IO.File]::Open($err,'Open','Read','ReadWrite')
$sr=New-Object System.IO.StreamReader($fs); $raw=$sr.ReadToEnd(); $sr.Close(); $fs.Close()
($raw -split [char]13) | Where-Object { $_.Trim() } | Select-Object -Last 1
```

Verifying a finished mirror (mirror the remote's own numbers, not assumptions):

```bash
git -C repo.git for-each-ref --format='%(refname)' refs/heads | wc -l    # == remote head count
git -C repo.git for-each-ref --format='%(refname)' refs/tags  | wc -l    # == remote tag count
git -C repo.git rev-parse 'refs/tags/vX.Y.Z^{commit}'                    # == remote tag commit
git -C repo.git rev-parse --is-bare-repository --is-shallow-repository   # true false
git -C repo.git count-objects -vH                                        # size-pack sane, garbage 0
```

## Related reference

- `references/backup-gap-audit.md` — the "is it backed up?" audit end to end: walk-up check, the four commands and their exact output, the 84%-unbacked set difference, identity-from-local-config, private-remote creation, fresh-clone verification, and the two false zeros.
- `references/github-ssl-and-force-push-case.md` — a real-case walkthrough (2026) with SSL workaround, forced-update diagnosis, backup branch, and reset.
