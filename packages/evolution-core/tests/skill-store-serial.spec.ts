/**
 * S2-1: the in-process serial queue (makeSerialQueue) is NOT reentrant — a
 * task that awaits `this.serial` again from inside its own section never
 * settles, because that section only ends when the inner task resolves.
 * `consolidate` holds the chain and calls `archive()`; archive() therefore
 * must not take it. Until this spec the invariant lived only in comments, so
 * adding the (apparently symmetrical) lock to archive() would have turned
 * every consolidate into a silent hang. Both cases bound the call with a
 * timer, so a self-deadlock fails the assertion instead of hanging the suite.
 */
import { expect, it } from 'vitest'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const skillOf = (name: string) =>
  '---' + String.fromCharCode(10)
  + 'name: ' + name + String.fromCharCode(10)
  + 'description: Run and debug Python test suites with pytest and coverage.' + String.fromCharCode(10)
  + '---' + String.fromCharCode(10) + String.fromCharCode(10)
  + '# ' + name + String.fromCharCode(10) + String.fromCharCode(10)
  + 'Body of ' + name + '.' + String.fromCharCode(10)

async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => { resolve({ ok: false }) }, ms)
  })
  const outcome = await Promise.race([promise.then(value => ({ ok: true as const, value })), timeout])
  if (timer !== undefined) clearTimeout(timer)
  return outcome
}

const DEADLOCK_HINT = 'never settled: the serial queue is not reentrant — archive() must not take this.serial while consolidate holds it'

it('consolidate archives its source from inside the serial section — no self-deadlock (S2-1)', async () => {
  const root = await tempRoot('dsh-evo-serial-consolidate-')
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', skillOf('target-skill'), 'foreground')
  await lib.create('src-a', skillOf('src-a'), 'foreground')
  const outcome = await settledWithin(lib.consolidate('target-skill', ['src-a']), 10_000)
  expect(outcome.ok, DEADLOCK_HINT).toBe(true)
  if (!outcome.ok) return
  expect(outcome.value.ok).toBe(true)
  expect(await lib.read('target-skill')).toMatch(/consolidated from src-a/)
  expect((await lib.list()).some(skill => skill.name === 'src-a')).toBe(false)
})

it('the serial chain orders concurrent patches on one file — every marker lands (S2-1)', async () => {
  const root = await tempRoot('dsh-evo-serial-queue-')
  const lib = new SkillLibrary(root)
  await lib.create('queue-skill', skillOf('queue-skill'), 'foreground')
  // Three read-modify-write cycles start together. Without the chain each one
  // reads the same body and the last commit drops the other two markers.
  const marker = (index: number) => 'MARKER-' + String(index)
  const results = await Promise.all([0, 1, 2].map(index =>
    lib.patch('queue-skill', 'Body of queue-skill.', 'Body of queue-skill.' + String.fromCharCode(10) + marker(index), '')))
  expect(results.map(result => result.ok)).toEqual([true, true, true])
  const body = await lib.read('queue-skill') ?? ''
  for (const index of [0, 1, 2]) expect(body).toContain(marker(index))
})
