// Runs the merge engine's CPU-bound screening in a child process so a scan cannot
// monopolize the host event loop. Model judging is proxied back to the parent,
// because a runner function cannot cross the process boundary.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pending = new Map()
let nextRunnerId = 0
let started = false

function selectWithErrors(engine, report) {
  const base = engine.selectCandidates(report)
  const doc = report.reportDoc ?? report
  const rows = Array.isArray(doc.pairs_final) ? doc.pairs_final : []
  const errors = new Set()
  for (const row of rows) {
    if (row.error !== true) continue
    const a = typeof row.a === 'string' ? row.a : ''
    const b = typeof row.b === 'string' ? row.b : ''
    if (a !== '' && b !== '') errors.add(engine.pairKeyOf(a, b))
  }
  const candidates = base.candidates
    .filter(candidate => !errors.has(engine.pairKeyOf(candidate.a, candidate.b)))
    .filter(candidate => {
      const gate = candidate.gate
      return gate?.level === 'L2' || gate?.verdict === 1
    })
  const reportOnly = base.reportOnly.filter(row => {
    if (typeof row.a !== 'string' || typeof row.b !== 'string') return true
    return !errors.has(engine.pairKeyOf(row.a, row.b))
  })
  for (const candidate of base.candidates) {
    if (candidate.gate?.level !== 'L2') reportOnly.push(candidate)
  }
  const skipped = base.skipped.filter(item => !errors.has(item.pairKey))
  for (const row of rows) {
    if (row.error !== true) continue
    reportOnly.push(row)
  }
  return { ...base, candidates, skipped, reportOnly }
}

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
    const selection = result.ok && result.report !== undefined ? selectWithErrors(engine, result.report) : undefined
    process.send?.({ type: 'result', result: { ...result, ...(selection === undefined ? {} : { selection }) } })
  } catch (error) {
    process.send?.({ type: 'result', result: { ok: false, error: { code: 'WORKER_FAILED', detail: error instanceof Error ? error.stack ?? error.message : String(error) } } })
  } finally {
    process.disconnect?.()
  }
})
