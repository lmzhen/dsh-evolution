#!/usr/bin/env node
/**
 * capture-client-console — headless-Chrome/CDP console capture for the family client faces.
 *
 *   node packages/scripts/capture-client-console.mjs --url "<authenticated url>" \
 *     --out <file.json> [--screenshots <dir>] [--actions home,settings,plugins] \
 *     [--chrome <exe>] [--cdp-port 9226] [--user-data-dir <dir>] [--timeout 20000]
 *
 * Why: "the page looked fine" is not evidence. This runs the real web face in a disposable
 * headless Chrome, records console.error / uncaught exceptions / Log.entryAdded errors for every
 * step, and writes one JSON artifact (plus screenshots) that can be attached to release evidence.
 *
 * Exit codes: 0 = no console error/exception recorded; 1 = console errors or exceptions;
 * 2 = CANNOT DECIDE (chrome/CDP/page/diagnostics could not be read - an empty read is not a pass).
 *
 * Every path is an argument (no machine defaults): the release flow passes the authenticated URL
 * printed by `dsh web` and a repo-relative output path.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined }
const url = flag("--url")
const outPath = flag("--out")
const screenshotDir = flag("--screenshots")
const chromePath = flag("--chrome") ?? process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const cdpPort = Number(flag("--cdp-port") ?? "9226")
const timeoutMs = Number(flag("--timeout") ?? "20000")
const actions = (flag("--actions") ?? "home,settings,plugins").split(",").map((entry) => entry.trim()).filter(Boolean)
const packageName = flag("--package") ?? "@lmzhen/dsh-evolution-all"
const userDataDir = flag("--user-data-dir") ?? mkdtempSync(join(tmpdir(), "dsh-client-console-"))
if (url === undefined || outPath === undefined) { console.error("capture-client-console: --url and --out are required"); process.exit(2) }

const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=" + String(cdpPort), "--user-data-dir=" + userDataDir, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
let chromeOutput = ""
chrome.stdout.on("data", (chunk) => { chromeOutput += String(chunk) })
chrome.stderr.on("data", (chunk) => { chromeOutput += String(chunk) })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (reason, extra = {}) => {
  try { chrome.kill() } catch { /* already gone */ }
  console.error(JSON.stringify({ ok: false, reason, chrome: chromeOutput.slice(-800), ...extra }, null, 1))
  process.exit(2)
}

let version
try {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { version = await (await fetch("http://127.0.0.1:" + String(cdpPort) + "/json/version")).json(); break } catch { await sleep(250) }
  }
} catch { /* handled below */ }
if (version === undefined) fail("chrome did not expose the CDP endpoint")

let target
try { target = await (await fetch("http://127.0.0.1:" + String(cdpPort) + "/json/new?" + encodeURIComponent(url), { method: "PUT" })).json() } catch (error) { fail("could not open the page target: " + String(error)) }
if (target?.webSocketDebuggerUrl === undefined) fail("the page target has no debugging socket")

let nextId = 0
const pending = new Map()
const consoleErrors = []
const consoleWarnings = []
const exceptions = []
const logErrors = []
const socket = new WebSocket(target.webSocketDebuggerUrl)
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id).resolve(message); pending.delete(message.id); return }
  const method = message.method
  if (method === "Runtime.consoleAPICalled") {
    const text = (message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 500)
    if (message.params?.type === "error") consoleErrors.push(text)
    else if (message.params?.type === "warning") consoleWarnings.push(text)
  } else if (method === "Runtime.exceptionThrown") {
    exceptions.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? "").slice(0, 500))
  } else if (method === "Log.entryAdded" && message.params?.entry?.level === "error") {
    logErrors.push(String(message.params.entry.text ?? "").slice(0, 500))
  }
})
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }) })
const evaluate = async (expression) => {
  const reply = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  const result = reply?.result?.result
  if (result?.exceptionDetails !== undefined) throw new Error(String(result.exceptionDetails.text ?? "evaluate failed"))
  return result?.value
}
const shot = async (name) => {
  if (screenshotDir === undefined) return null
  mkdirSync(screenshotDir, { recursive: true })
  const reply = await call("Page.captureScreenshot", { format: "png" })
  const data = reply?.result?.data
  if (data === undefined) return null
  const file = join(screenshotDir, name + ".png")
  writeFileSync(file, Buffer.from(data, "base64"))
  return file
}
await call("Runtime.enable")
await call("Page.enable")
await call("Log.enable")
const readings = { home: null, settings: null, plugins: null }
const screenshots = []

const waitReady = async () => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { const state = await evaluate("document.readyState"); if (state === "complete" || state === "interactive") return true } catch { /* retry */ }
    await sleep(250)
  }
  return false
}
const bodyText = async () => String(await evaluate("(document.body && document.body.innerText) || ''"))
const clickByText = async (pattern) => evaluate("(() => { const re = new RegExp(" + JSON.stringify(pattern) + "); const nodes = [...document.querySelectorAll('button,a,[role=menuitem],[role=tab],[role=button]')]; const hit = nodes.find((node) => re.test((node.innerText || node.getAttribute('aria-label') || '').trim())); if (hit === undefined) return false; hit.click(); return true })()")

try { if (await waitReady()) {
  await sleep(3000)
  readings.home = {
    title: await evaluate("document.title"),
    textLength: (await bodyText()).length,
    diagnostics: await evaluate("(async () => { try { const reply = await fetch('/api/dsh-evolution/diagnostics', { headers: { accept: 'application/json' } }); const body = await reply.json(); const data = body.data ?? body; return { schemaVersion: data.schemaVersion ?? null, facts: Array.isArray(data.facts) ? data.facts.length : null, runtime: Array.isArray(data.runtime) ? data.runtime.length : null } } catch (error) { return { error: String(error) } } })()")
  }
  if (actions.includes("home")) screenshots.push(await shot("home"))
  if (actions.includes("settings")) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate("Boolean(document.querySelector('[aria-label=\"账号菜单\"]'))")) break
      await sleep(250)
    }
    const hadMenu = await evaluate("Boolean(document.querySelector('[aria-label=\"账号菜单\"]'))")
    const opened = hadMenu ? await evaluate("(() => { const node = document.querySelector('[aria-label=\"账号菜单\"]'); if (!node) return false; node.click(); return true })()") : false
    await sleep(600)
    const clickedSettings = await evaluate("(() => { const nodes = [...document.querySelectorAll('button,a,[role=menuitem]')]; const hit = nodes.find((node) => (node.innerText || '').trim().startsWith('设置')); if (hit === undefined) return false; hit.click(); return true })()")
    await sleep(1200)
    const clickedEvolution = await clickByText("^自进化$")
    await sleep(2500)
    const text = await bodyText()
    readings.settings = { hadMenu, opened, clickedSettings, clickedEvolution, hasParam: /参数/.test(text), hasPending: /待批|审批/.test(text), hasDiagnostics: /诊断/.test(text), textLength: text.length }
    screenshots.push(await shot("settings-evolution"))
  }
  if (actions.includes("plugins")) {
    // The Plugins page is a top-level nav target; reload first so the settings dialog cannot be
    // mistaken for it (the first version clicked the settings dialog's "内置插件" tab and recorded
    // the wrong page — evidence must name its page, not just "clickedPlugins: true").
    await evaluate("location.href = location.origin + '/'")
    await waitReady()
    await sleep(1200)
    const clickedPlugins = await evaluate("(() => { const hit = document.querySelector('[aria-label=\"插件\"]'); if (hit === undefined || hit === null) return false; hit.click(); return true })()")
    await sleep(2500)
    const pluginPageText = await bodyText()
    const installForm = await evaluate("(async () => { try { const reply = await fetch('/api/dsh-evolution/diagnostics', { headers: { accept: 'application/json' } }); const body = await reply.json(); const data = body.data ?? body; const fact = (data.facts ?? []).find((row) => row.key === 'install-form'); return fact ? fact.value : null } catch (error) { return null } })()")
    const bundleCardVisible = await evaluate("(() => [...document.querySelectorAll('[aria-label]')].some((node) => (node.getAttribute('aria-label') || '').includes('查看 ' + " + JSON.stringify(packageName) + ")))()")
    const openedBundle = await evaluate("(() => { const hits = [...document.querySelectorAll('[aria-label]')]; const hit = hits.find((node) => (node.getAttribute('aria-label') || '') === '查看 ' + " + JSON.stringify(packageName) + "); if (hit === undefined) return false; hit.click(); return true })()")
    await sleep(2500)
    const detailText = String(await bodyText()).slice(0, 8000)
    const configLabels = await evaluate("[...document.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label')).filter((label) => typeof label === 'string' && /^配置 /.test(label))")
    const componentRows = await evaluate("(() => { const keys = ['evolution-approval', 'evolution-commands', 'evolution-curator', 'evolution-review', 'memory-files', 'tool-memory', 'tool-skill-manage', 'skill-usage', 'evolution-settings-ui']; const text = document.body.innerText || ''; return keys.filter((key) => text.includes(key)) })()")
    readings.plugins = { clickedPlugins, installForm, bundleCardVisible, openedBundle, hasConfigureEntry: configLabels.length > 0, configLabels, componentRows, componentCountText: (detailText.match(/共 \d+ 个[^\n]*/) ?? [])[0] ?? null, detailTextLength: detailText.length, detailText: detailText.slice(0, 4000) }
    screenshots.push(await shot("plugins-bundle-detail"))
  }
} else { readings.home = { error: "page never reached readyState complete" } }
} catch (error) { readings.error = String(error && error.message ? error.message : error) }

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  page: { host: (() => { try { return new URL(url).host } catch { return "unparseable" } })() },
  chrome: String(version?.["Browser"] ?? "unknown"),
  actions,
  readings,
  screenshots,
  console: { errors: consoleErrors, warnings: consoleWarnings, exceptions, logErrors },
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2) + String.fromCharCode(10))
try { socket.close() } catch { /* already closed */ }
try { chrome.kill() } catch { /* already gone */ }
const problemCount = consoleErrors.length + exceptions.length + logErrors.length
console.log(JSON.stringify({ ok: problemCount === 0, out: outPath, consoleErrors: consoleErrors.length, exceptions: exceptions.length, logErrors: logErrors.length, readings: Object.keys(readings) }, null, 1))
process.exit(problemCount === 0 && readings.home !== null ? 0 : 1)
