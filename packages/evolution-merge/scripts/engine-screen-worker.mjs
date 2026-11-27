// Runs the merge engine's CPU-bound screening in a child process so a scan cannot
// monopolize the host event loop. Model judging is proxied back to the parent,
// because a runner function cannot cross the process boundary.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pending = new Map()
let nextRunnerId = 0
let started = false

function runner(prompt, cfg) {
  const id = String(++nextRunnerId)
  process.send?.({ type: 'runner-request', id, prompt, ...(cfg === undefined ? {} : { cfg }) })
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

process.on('message', async message => {
  if (message?.type === 'runner-response') {
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.ok === true) entry.resolve(message.value)
    else entry.reject(new Error(String(message.error ?? 'runner failed')))
    return
  }
  if (started) return
  started = true
  const input = message
  try {
    const engine = await import(require.resolve('@deepseek-ai/dsh-evolution-merge-engine'))
    const result = await engine.screen({ ...input, ...(input.hasRunner === true ? { runner } : {}) })
    process.send?.({ type: 'result', result })
  } catch (error) {
    process.send?.({ type: 'result', result: { ok: false, error: { code: 'WORKER_FAILED', detail: error instanceof Error ? error.stack ?? error.message : String(error) } } })
  } finally {
    process.disconnect?.()
  }
})
