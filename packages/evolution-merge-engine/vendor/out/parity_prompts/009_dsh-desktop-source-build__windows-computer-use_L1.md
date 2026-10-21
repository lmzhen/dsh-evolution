{
  "level": "L1",
  "skill_a": {
    "id": "dsh-desktop-source-build",
    "description": "Build and run the DSH desktop from a source tarball.",
    "head": "Build and run the DSH desktop from a source tarball.\n\n# DSH Desktop Source Build\n\nBuilds the `@deepseek-ai/dsh-desktop` Electron shell from a DSH source tarball and runs it in\ndevelopment mode against an isolated `DSH_HOME`. It does NOT produce a distributable installer:\nWindows packaging requires a GlobalSign EV certificate plus a physical SafeNet token, and macOS\nrequires a Developer ID identity, so the official `package:desktop:*` pipeline cannot run without\nthe release environment.\n\n- \"Run the DSH desktop app\", \"install the desktop version\" on a machine with no prebuilt installer.\n- The published update channel is empty (e.g. `https://download.deepseek.com/_/harness/desktop/stable/win-x64/rc.yml` returns 404).\n- Verifying desktop plugin eligibility (`dsh.bundle.patch`, registry, `strictDepBuilds`).\n\n- Windows x64, Node `^22.19 || >=24`, pnpm available as `.cmd`, ~5 GB free on the target drive.\n- The PowerShell execution policy blocks `pnpm.ps1` under **Windows PowerShell 5.1**; the DSH `pwsh` tool is **7.6.7 / RemoteSigned since 2026-10-15** and runs bare `pnpm` (measured: `pnpm --version` -> 11.17.0). Under 5.1, invoke `pnpm.cmd`.\n- Behind a slow network to GitHub, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`.\n\n```powershell\ntar -xzf <tarball> -C <src> --strip-components=1\ncd <src>\n& \"$env:APPDATA\\npm\\pnpm.cmd\" install --frozen-lockfile --reporter=append-only\n$env:DSH_CLIENT_COMMIT_HASH='0d15c200'      # tarball has no .git; see Pitfalls\n& \"$env:APPDATA\\npm\\pnpm.cmd\" run build\nnode apps\\desktop\\node_modules\\electron\\install.js   # skipped by pnpm allowBuilds\n& \"$env:APPDATA\\npm\\pnpm.cmd\" run build:desktop\n$env:DSH_HOME='<src>\\apps\\desktop\\.desktop-build\\development\\home'\n$env:DSH_DESKTOP_OPEN_DEVTOOLS='0'\n& \"$env:APPDATA\\npm\\pnpm.cmd\" run start:desktop\n```\n\n| Item | Value |\n|---|---|\n| Root build | `build:native-system` -> `build:lib:host` (`tsc -b tsconfig.host.json` + tsdown) -> `build:lib:client` -> `build:web` |\n| Dev launcher | `apps/desktop/scripts/dev.ts`, `--skip-build` = `start:desktop` |\n| Isolated state | `apps/desktop/.desktop-build/development/{home,project,electron-user-data}` |\n| Debug ports | main 9229, renderer 9222, host 9230 |\n| Renderer page | `dsh-app://app/index.html` |\n\n1. Extract the tarball to a scratch tree; never build inside a mirrored family checkout.\n2. `pnpm install --frozen-lockfile`. pnpm self-selects th"
  },
  "skill_b": {
    "id": "windows-computer-use",
    "description": "Drive the Windows desktop with the platform Cua driver.",
    "head": "Drive the Windows desktop with the platform Cua driver.\n\n# Driving the Windows Desktop with the Platform Cua Driver\n\nSee `references/session-and-capture.md` for the session/screenshot/input split verified on this machine: reviving the implicit session with `start_session({})`, the three screenshot tools and what each one actually captures, background delivery of click/type_text, and why `SendKeys` is unsafe.\n\nControls the live Windows desktop — click, type, scroll, hotkey, launch, menus, clipboard, drag —\nthrough the **platform's own computer-use line**: the `@deepseek-ai/dsh-computer-use` seam plus a\nprovider (`…-cua-driver-native` or `…-cua-driver-mcp`). Tools appear as `cua_driver_native__<name>`.\nEach action is verified by re-reading structured window/accessibility state, not by trusting a\ntool's success return. Captures are true physical pixels as of 2026-10-15 (`get_screen_size` and `get_desktop_state` both report 2560x1600 @1.5; the older 1707x1067 DPI-virtualized reading no longer holds).\nThe workaround skill that existed for the old behaviour (`windows-screen-capture`) has been deleted.\n\n**Measured baseline** (versions, permission/health values, the coordinate self-check, the UIA coverage\ntable across 12 apps, input-channel timings, and the three-way patch-form experiment) is kept in\n`references/measured-baseline-2026-10.md` — evidence for the rules below, separated so the body stays\npattern-shaped. Re-check those numbers rather than trusting them; they are one machine, one day.\n\n**This replaced the third-party `CursorTouch/Windows-MCP` route** (user directive, 2026-10-13:\n\"以后通通改用这个工具\"). The old row is retained disabled for reference only. If you find yourself\nreaching for `mcp__windows__*`, you are on the retired path.\n\n- \"click X\" / \"type this into Y\" / \"scroll the page\" / \"open that app\" against a native Windows app\n  or a browser on the desktop.\n- You need proof an input action actually landed.\n- You need to read a window's structure as TEXT (accessibility tree) rather than pixels.\n\n- Both packages installed into the **profile** (not the host): the seam `@deepseek-ai/dsh-computer-use`\n  **and** exactly one provider. Registration is *exclusive* (\"Exclusive named computer-use provider\n  registration\") — never both providers at once.\n- **Match the host version, not npm's `latest`.** Read\n  `<install>\\resources\\runtime\\primary-runtime\\runtime.json` "
  },
  "scores": {
    "jaccard_summary": 0.1111,
    "jaccard_body": 0.1375,
    "summary_cosine": 0.5369
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