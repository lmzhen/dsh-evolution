/**
 * G3 screen adapter: cards -> corpus snapshot -> EnginePort.screen.
 *
 * The vendor engine reads a corpus from disk; host cards are content. This module
 * writes only SKILL.md support-free snapshots under the run directory. It does not
 * decide candidates: the Q02 selector is injected so engine/report-map stays the
 * single source of that policy.
 */
import { dirname, join, resolve } from 'node:path'
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCandidate } from '../contracts.ts'
import type { SkillCard } from '../skill-card.ts'
import type { RetrievalCredentials } from '../domain/retrieval-credentials.ts'

export type EngineScreenResult =
  | { readonly ok: true; readonly report: Record<string, unknown> }
  | { readonly ok: false; readonly error: { readonly code: string; readonly stage?: string; readonly detail?: string } }

export interface EngineScreenPort {
  screen(input: {
    readonly corpusDir: string
    readonly outDir: string
    readonly cfg?: Record<string, unknown>
    readonly credentials?: RetrievalCredentials
    readonly signal?: AbortSignal
    readonly onProgress?: (p: { stage: string; done?: number; total?: number }) => void
    readonly runner?: (prompt: string, cfg?: Record<string, unknown>, signal?: AbortSignal | undefined) => Promise<string>
  }): Promise<EngineScreenResult>
}

export interface CandidateSelection {
  readonly candidates: readonly MergeCandidate[]
  readonly skipped: readonly { readonly pairKey: string; readonly a: string; readonly b: string; readonly reason?: string }[]
  readonly reportOnly: readonly unknown[]
  readonly candidatePairs?: number
}


export interface EngineScreeningDeps {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly engine: EngineScreenPort
  readonly select: (report: Record<string, unknown>) => CandidateSelection
  readonly cfg?: Record<string, unknown>
  readonly credentials?: () => Promise<RetrievalCredentials>
  readonly runner?: (prompt: string, cfg?: Record<string, unknown>, signal?: AbortSignal | undefined) => Promise<string>
  readonly onSelection?: (selection: CandidateSelection, runId: string, cards: readonly SkillCard[]) => Promise<void>
}

function safeName(name: string, index: number): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned === '' ? 'skill-' + String(index) : cleaned) + '__' + String(index)
}

/** Write the exact card bodies as a support-free corpus snapshot and return its root. */
export async function snapshotCards(io: EvolutionIoLike, home: string, runId: string, cards: readonly SkillCard[]): Promise<string> {
  const root = join(home, 'merge', 'runs', runId, 'corpus')
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (card === undefined) continue
    await io.writeText(join(root, safeName(card.name, index), 'SKILL.md'), card.body)
  }
  return root
}

/**
 * Run the local engine in a child process. The engine's local screening is
 * CPU-bound and would otherwise occupy the host event loop for the whole scan;
 * the model-backed path keeps the in-process runner because a function cannot
 * cross the process boundary.
 * @param direct - the in-process engine port used when a runner is present.
 * @returns an engine port that isolates the local screening process.
 */
export function createProcessEngineScreen(direct: EngineScreenPort['screen']): EngineScreenPort['screen'] {
  const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'engine-screen-worker.mjs')
  return async input => {
    if (!existsSync(workerPath)) return await direct(input)
    const child = fork(workerPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    const result = await new Promise<EngineScreenResult>((resolveResult, reject) => {
      let settled = false
      const finish = (value: EngineScreenResult): void => {
        if (settled) return
        settled = true
        input.signal?.removeEventListener('abort', abort)
        resolveResult(value)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        input.signal?.removeEventListener('abort', abort)
        reject(error)
      }
      const abort = (): void => {
        child.kill()
        fail(new Error('engine screen aborted'))
      }
      child.once('error', fail)
      child.once('exit', code => {
        if (!settled) fail(new Error('engine screen worker exited with code ' + String(code)))
      })
      child.on('message', (message: { type?: string; id?: string; prompt?: string; cfg?: Record<string, unknown>; ok?: boolean; value?: string; error?: string; result?: EngineScreenResult }) => {
        if (message.type === 'runner-request') {
          if (input.runner === undefined) {
            child.send({ type: 'runner-response', id: message.id, ok: false, error: 'no runner in this host' })
            return
          }
          void input.runner(message.prompt ?? '', message.cfg, input.signal)
            .then(value => { if (!settled) child.send({ type: 'runner-response', id: message.id, ok: true, value }) })
            .catch(error => { if (!settled) child.send({ type: 'runner-response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }) })
          return
        }
        if (message.type !== 'result' || message.result === undefined) return
        finish(message.result)
      })
      if (input.signal?.aborted === true) {
        abort()
        return
      }
      input.signal?.addEventListener('abort', abort, { once: true })
      child.send({
        type: 'screen',
        corpusDir: input.corpusDir,
        outDir: input.outDir,
        ...(input.cfg === undefined ? {} : { cfg: input.cfg }),
        ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
        ...(input.runner === undefined ? {} : { hasRunner: true }),
      })
    })
    return result
  }
}

export function createEngineScreening(deps: EngineScreeningDeps) {
  return async (cards: readonly SkillCard[], runId: string, signal: AbortSignal): Promise<readonly MergeCandidate[]> => {
    const corpusDir = await snapshotCards(deps.io, deps.home, runId, cards)
    const outDir = join(deps.home, 'merge', 'runs', runId, 'engine')
    const runner = deps.runner === undefined ? undefined : (prompt: string, cfg?: Record<string, unknown>) => deps.runner!(prompt, cfg, signal)
    const credentials = deps.credentials === undefined ? undefined : await deps.credentials()
    const result = await deps.engine.screen({
      corpusDir,
      outDir,
      ...(deps.cfg === undefined ? {} : { cfg: deps.cfg }),
      ...(credentials === undefined ? {} : { credentials }),
      ...(runner === undefined ? {} : { runner }),
      signal,
    })
    if (!result.ok) {
      throw new Error('engine screen failed: ' + result.error.code + (result.error.stage === undefined ? '' : ' @' + result.error.stage) + (result.error.detail === undefined ? '' : ': ' + result.error.detail))
    }
    const selection = deps.select(result.report)
    if (deps.onSelection !== undefined) await deps.onSelection(selection, runId, cards)
    const degraded = selection.reportOnly
      .filter(row => (row as { error?: unknown }).error === true)
      .map(row => { const value = row as { a?: unknown; b?: unknown }; return 'gate error: ' + String(value.a ?? '?') + ' + ' + String(value.b ?? '?') })
    return Object.assign(
      selection.candidates.slice(),
      selection.candidatePairs === undefined ? {} : { candidatePairs: selection.candidatePairs },
      degraded.length === 0 ? {} : { degraded },
      selection.reportOnly.length === 0 ? {} : { reportOnly: selection.reportOnly },
    )
  }
}
