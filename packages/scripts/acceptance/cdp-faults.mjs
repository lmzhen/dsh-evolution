/**
 * G0 fault fixtures over CDP.
 *
 * usage:
 *   node cdp-faults.mjs --port 9289 --mode clipboard
 *   node cdp-faults.mjs --port 9289 --mode stale [--match settings/describe] [--timeout 120000]
 *
 * "clipboard" overrides navigator.clipboard.writeText in the live page.
 * "stale" arms a Fetch interception and answers the next matching request with
 * HTTP 500, so settings readback can be tested without touching production code.
 */
import { pathToFileURL } from 'node:url'

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index < 0 ? fallback : process.argv[index + 1]
}

export async function connect(port) {
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  const page = list.find(item => item.type === 'page')
  if (page === undefined) throw new Error('no page target on port ' + port)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const handlers = new Map()
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      const item = pending.get(message.id)
      pending.delete(message.id)
      if (message.error === undefined) item.resolve(message.result)
      else item.reject(new Error(message.error.message))
      return
    }
    const list = handlers.get(message.method)
    if (list === undefined) return
    for (const fn of list) fn(message.params)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const on = (method, fn) => {
    const list = handlers.get(method) ?? []
    list.push(fn)
    handlers.set(method, list)
  }
  return { send, on, close: () => ws.close() }
}

export async function denyClipboard(port) {
  const cdp = await connect(port)
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const deny = async () => { throw new Error('G0 clipboard denial') }
        try { navigator.clipboard.writeText = deny } catch {}
        try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: deny } }) } catch {}
        return typeof navigator.clipboard?.writeText === 'function'
      })()`,
      returnByValue: true,
    })
    return { armed: result.result.value === true }
  } finally { cdp.close() }
}

export async function failNextDescribe(port, match = 'settings/describe', timeoutMs = 120_000) {
  const cdp = await connect(port)
  let timer
  try {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' + match + '*', requestStage: 'Request' }] })
    const paused = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('no ' + match + ' request within ' + timeoutMs + 'ms')), timeoutMs)
      cdp.on('Fetch.requestPaused', resolve)
    })
    clearTimeout(timer)
    await cdp.send('Fetch.fulfillRequest', {
      requestId: paused.requestId,
      responseCode: 500,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ ok: false, error: { code: 'E-G0-STALE', message: 'G0 stale readback fixture' } })).toString('base64'),
    })
    await cdp.send('Fetch.disable')
    return { fired: true, url: paused.request?.url }
  } finally {
    clearTimeout(timer)
    cdp.close()
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(arg('port', '0'))
  const mode = arg('mode', '')
  if (!Number.isInteger(port) || port <= 0) { console.error('usage: --port <cdp-port> --mode clipboard|stale'); process.exit(2) }
  if (mode === 'clipboard') {
    console.log(JSON.stringify(await denyClipboard(port)))
  } else if (mode === 'stale') {
    console.log(JSON.stringify(await failNextDescribe(port, arg('match', 'settings/describe'), Number(arg('timeout', '120000')))))
  } else {
    console.error('mode must be clipboard or stale')
    process.exit(2)
  }
}
