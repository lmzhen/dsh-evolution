---
name: npm-package-publishing
description: Publish packages to npm and debug CI trusted-publishing.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Npm, Release, Ci, Oidc, Packaging]
    related_skills: [git-repo-sync, software-release-research]
---

# npm Package Publishing

Publish a JavaScript package to the npm registry either interactively from a local
machine or unattended from CI with OIDC trusted publishing, and diagnose a CI
publish that fails *after* the identity step already succeeded. It does not cover
registry signup, scope/org administration, or non-npm registries.

## When to Use

- "publish this package", "cut a release", "bump and publish"
- A GitHub Actions publish job fails with `E404 Not Found - PUT https://registry.npmjs.org/<pkg>`
- `npm publish` throws `EOTP` and only shows a URL with the challenge masked as `***`
- Setting up or auditing trusted publishing (`npm trust ...`)
- Deciding whether a read taken right after publishing is trustworthy yet

## Prerequisites

- npm ≥ 11.5.1 for trusted publishing (CI images often ship older; see step 2).
- `id-token: write` permission on the publishing job.
- A bound trusted publisher: repo + workflow filename (+ environment if used).
- For interactive publishing: a real console window (see Pitfalls) and the
  publisher's 2FA device. A security key / fingerprint has no 6-digit code to type.

## How to Run

Trusted publishing from CI is a one-time bind plus a tag push:

```bash
npm trust github <pkg> --file .github/workflows/publish.yml \
  --repo <owner>/<repo> [--env <environment>] --allow-publish -y
git tag v1.2.3 && git push origin v1.2.3     # triggers the workflow
```

**When the tag push itself is what fails, the API is the other door.** If `git push`
dies with `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` or `Failed to connect to github.com
port 443` after ~21 s, test the API before blaming the network: `gh auth status` and
`gh run list` speak to `api.github.com` and routinely keep working while
`github.com:443` is blocked. Any workflow declaring `workflow_dispatch:` can then be
started with no tag at all:

```bash
gh workflow run publish.yml --ref main      # publishes the version on that ref
```

This path publishes whatever `package.json` says on that ref, so the tag becomes a
marker you push afterwards — which is exactly the situation that exposes the duplicate
guard in Pitfalls. Both doors are equivalent to the workflow; pick the one that works.

Interactive, from a console npm can actually open a browser out of (Windows):

```powershell
Start-Process cmd.exe -ArgumentList '/k', 'npm publish --access public'
```

## Quick Reference

| Action | Command |
| --- | --- |
| Bind a GitHub trusted publisher | `npm trust github <pkg> --file <wf> --repo <o/r> -y` |
| Inspect the binding | `npm trust list <pkg>` |
| Revoke by id | `npm trust revoke <pkg> --id=<uuid>` |
| What will be packed | `npm pack --dry-run` |
| Live versions | `npm view <pkg> versions dist-tags` |
| Watch the run | `gh run list --limit 5` / `gh run view <id> --log` |
| Manage explicit staging | `npm stage list / approve / reject` |

## Procedure

1. **Confirm the name and version are still free.** A published version is
   immutable — you bump it, you never overwrite it. Create a brand-new package
   name before pushing the tag that triggers its first publish. Publish bytes
   from the run's own artifacts, never a hand-assembled copy.
2. **Make the runner's npm new enough.** `npm install -g npm@latest` in the job
   and echo `npm --version`; setup-node's bundled npm can sit below 11.5.1, where
   trusted publishing silently cannot engage.
3. **Blank the static token on the publish step.** `actions/setup-node` with
   `registry-url:` writes an `.npmrc` and populates `NODE_AUTH_TOKEN` from
   `github.token`. npm then takes the static-token path instead of exchanging the
   OIDC token, and the registry rejects the write:

   ```yaml
   - name: Publish
     env:
       NODE_AUTH_TOKEN: ''
     run: npm publish --access public --provenance
   ```

4. **Read the failing log for what SUCCEEDED too.** In the same run,
   `Signed provenance statement ... from GitHub Actions` and `Provenance
   statement published to transparency log` prove the OIDC identity was
   accepted. That rules out "trusted publishing is not configured" and narrows
   the fault to the registry write itself.
5. **Change one suspected cause, then diff the error text.** Compare the new
   failure against the previous one verbatim. A byte-identical error falsifies
   the hypothesis — revert that guess instead of layering another patch on it.
6. **Read the registry twice.** npm 12 publishes in stages: `npm publish` first
   creates a transient `0.0.0-stage` stub (`"stub": true`, description
   "Temporary package placeholder for staged publishing") and the real version
   lands about a minute later, so a single immediate read reports an intermediate
   state. `npm stage list/approve/reject` govern *explicit* staging only;
   auto-staged publishes need no approval. Don't just wait it out — read the
   registry **directly** (`https://registry.npmjs.org/<pkg>`) instead of through
   `npm view`, which can still hand back the pre-publish list seconds after the
   version lands (measured: version stamped `05:58:19Z`, `npm view` at `05:58:31Z`
   still reported the old `dist-tags`).
7. **Verify what actually shipped.** `npm pack --dry-run` against the `files`
   whitelist, then compare the registry `shasum`/`integrity` with the local build.
8. **Pull the published tarball back and diff it against the tree.** A local pack is
   not the released artifact:

   ```bash
   npm pack <pkg>@<version> --pack-destination "$TMP"   # downloads the published one
   # its sha1 must equal the registry's dist.shasum - that proves you are comparing it
   ```

   Then compare per file. **A worktree that keeps CRLF for some files while CI packs a
   fresh LF checkout yields a different tarball for identical content**, so a shasum
   mismatch against a *local* pack is expected, not alarming — normalise line endings
   and compare content. Measured: exactly two files differed, by their CR counts
   (338 + 871 bytes); every other file was byte-identical, and the CR delta matched
   `git ls-files --eol`'s `w/crlf` list exactly. State which files are `w/crlf` when you
   report this, and note that local packs are therefore not byte-reproducible.
9. **A review verdict covers only the commit it read.** If a shipped file moves after
   the review, either run another round or show the delta is inert:

   ```bash
   git diff -U0 <reviewed>..<released> -- <shipped paths>
   # strip lines starting with //, * or /* ; what remains must be the version line only
   ```

   Otherwise "it passed review" is an empty claim about the artifact. This is the
   release-side twin of "publish bytes from the run's own artifacts".

## Pitfalls

- **Predict that wall before spending a publish cycle on it: ask the channel whether it has a TTY.** In PowerShell, `[System.Console]::IsOutputRedirected` / `IsInputRedirected` answer it in one call (measured: both `True` on an agent-routed command channel). When both are true, `npm publish` on a package whose publisher requires 2FA **cannot** succeed — `otplease` throws `EOTP` and never reaches its browser branch — so the honest move is to stop after one attempt, report the capability finding as the blocker, hand over the exact two-command sequence (`npm publish` then `git tag v<ver> && git push origin v<ver>`), and let the human press it in a real console. Do not loop the same attempt; the channel cannot change mid-session, so retries are pure cost.
- **Bump, publish, and tag in that order — the tag records a published artifact, not an intention.** Measured near-miss: with `package.json` already at `0.1.8` and the registry still at `0.1.7`, tagging `v0.1.8` would have created a marker for a release that does not exist, and the local tree would claim "released" while the registry disagreed. Keeping the tag until the registry confirms keeps one source of truth (the registry) and makes an interrupted release resumable with no cleanup.
- **`EOTP` with no code prompt.** npm's `otplease` (`npm/lib/utils/auth.js`)
  runs `if (!process.stdin.isTTY || !process.stdout.isTTY) { throw err }`.
  Without a TTY it never reaches the "open a browser" branch: it prints the auth
  URL with the challenge masked as `***` and rethrows. Launch the publish from a
  real console — `Start-Process cmd.exe -ArgumentList '/k', '<cmd>'` — so npm can
  open the browser for a security-key / fingerprint tap. `npm trust list` needs
  the same treatment, and the masked URL is worthless for recovering by hand.
- **Confirm the next version from the registry, and the payload from a dry run — before you bump anything.** Measured on a package whose local tags stopped one release behind: `npm view <pkg> versions --json` listed `0.1.0 … 0.1.7` while the last local tag was `v0.1.7`, so the only legal next number was `0.1.8` (republishing an existing version is refused, and a lower one is worse). Pair it with `npm pack --dry-run`, which is the only cheap way to see what will actually ship: `files` globs are easy to trust and easy to get wrong — a new directory under a globbed path (`lib/ops/`) ships silently, while a file outside them (`cordis.patch.yml`) only ships if it is listed. Read the printed file list and byte count as the release artifact, not the git tree.
- **`E404` on PUT while provenance succeeded** almost always means the token path
  was taken instead of OIDC (step 3). It is not a scope, name, or
  metadata-field problem: adding `repository` / `homepage` / `bugs` does not
  change the error.
- **`E422` — provenance needs a PUBLIC source repo.** A private origin gets the
  write rejected with `Error verifying sigstore provenance bundle: Unsupported
  GitHub Actions source repository visibility: "private"`. Fix: drop
  `--provenance`. Do **not** also add `provenance=false` — npm only auto-enables
  provenance when the OIDC payload says `repository_visibility === 'public'`
  (`npm/lib/utils/oidc.js`), so a private repo is never auto-enabled. State the
  tradeoff plainly to the owner: private origin ⇒ no provenance on the tarball,
  and those two are mutually exclusive. Making the repo public is an
  outward-facing change — get explicit consent, never flip it to "fix" this.
- **A `repository` field is still read and validated** under trusted publishing,
  so keep it accurate even though no token is involved.
- **`files` is a whitelist, not a filter.** Directories such as `design/`,
  `test/`, `tools/` do not ship unless listed; and a file that must ship but is
  not listed fails silently at install time, not at publish time.
- **A pattern-based count is a claim about the pattern, not the world.** Before
  "correcting" a count from a grep, widen the pattern and re-count.
- **Re-publishing a shipped version is a no-op, not a failure — and that is a trap
  unless you pair it.** Push a tag *after* a manual dispatch and the tag-triggered run
  fails with `npm error You cannot publish over the previously published versions:
  <v>.` The wrong fix is "remember the order"; the right one is two guards that only
  work together:

  ```yaml
  - name: Assert tag matches package version
    if: github.ref_type == 'tag'
    run: |
      expected="v$(node -p "require('./package.json').version")"
      if [ "$GITHUB_REF_NAME" != "$expected" ]; then
        echo "::error::tag $GITHUB_REF_NAME != package.json $expected"; exit 1
      fi

  - name: Publish
    env: { NODE_AUTH_TOKEN: '' }
    run: |
      version="$(node -p "require('./package.json').version")"
      if npm view "<pkg>@$version" version >/dev/null 2>&1; then
        echo "<pkg>@$version already published - nothing to do (not a failure)"; exit 0
      fi
      npm publish --access public
  ```

  The skip alone would turn "pushed `v1.2.4` but forgot to bump `package.json`" into a
  **green run that published nothing**; the tag assertion is what keeps the skip
  honest. `npm view <pkg>@<version> version` exits non-zero for an unpublished
  version, which is what makes it a usable probe. Nested quotes inside `$( )` are
  legal POSIX — `version="$(node -p "…")"` is verified working on a Linux runner —
  and `node -p "require('./package.json').version"` works even under
  `"type": "module"`, because `-p`/`-e` evaluate as CommonJS.
- **A local proxy is a hop whose state can flip — test the direction, never inherit it.**
  A `git push` transport error is not proof the network is down, and "bypass the proxy"
  is **not** a standing cure: on one machine the configured proxy was the working route
  while direct `:443` was dead, and carrying a previous round's bypass flag forward made
  eight pushes fail with `Failed to connect to github.com port 443 ... Couldn't connect to
  server` (~21 s each). Settle the direction with one cheap comparison before choosing:

  ```bash
  git ls-remote --heads origin                                     # via configured proxy
  git -c http.proxy= -c https.proxy= ls-remote --heads origin      # direct
  ```

  Whichever exits 0 is *this session's* route; use it for the push. The empty `-c key=`
  form disables that setting for the run only — neither route requires editing the
  owner's git config. Expect either to be intermittent, so retry rather than concluding.
- **Read the output, not only the exit code.** A failed push printed
  `Everything up-to-date` while returning non-zero; reading that line as "nothing to do"
  hid the outage for a whole round. An output that contradicts the exit status is a fact
  to chase on the spot, not a formatting quirk.
- **Verify a shell construct locally with Git's bash, not WSL.** On Windows a bare
- **`git add -A` after writing a helper file into the repo root is a self-inflicted commit.** Measured: a commit-message file written to `<repo>/_commit-msg.txt` (so `git commit -F` could read it) was swept into the same commit by `git add -A`, landing a temp artifact in the published tree. Two habits: write such files **outside** the repo (or into an ignored path), and after committing a big sweep, read the `create mode` list the commit prints — that is where an unintended file shows up. Removing it afterwards costs an extra commit, and a pushed one costs history.
  `bash` usually resolves to `C:\Windows\system32\bash.exe` (WSL), which has no `node`
  on `PATH` and mangles a PowerShell-built command line. Use
  `C:\Program Files\Git\bin\bash.exe` and pass the script as a **file**, not via
  `-c` — that is the same shell family as an ubuntu runner, so a construct proven
  there is proven for CI. State the boundary when you do: proving the construct and
  its branching is not the same as having exercised the CI wiring around it.

## Verification

After the workflow goes green, confirm the registry agrees with what you built:

```bash
npm view <pkg> dist-tags --json           # latest points at the new version
npm view <pkg>@<version> dist.shasum      # matches the local tarball
npm view <pkg>@<version> dist.integrity
```

Re-read once more after ~1 minute to get past the staged placeholder.

Session-specific evidence — the failing runs' exact output, the final workflow
YAML, and the trust-binding id — is in `references/dsh-pixel-loupe-oidc.md`.
The blocked-git fallback, the duplicate-publish incident and both guards'
verification readings are in `references/publish-path-fallbacks.md`.
