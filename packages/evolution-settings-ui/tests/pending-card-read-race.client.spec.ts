// @tier pre-tag
// @vitest-environment jsdom
// G4/4.1 (second half): a stale read must not overwrite a newer one.
//
// PendingCard.load applies its answer unconditionally (the state lives in a ref holder), so a SLOW
// first read that lands after a FAST second read wins. skill-history/Panel.ts already guards exactly
// this with a read ticket; this card does not.
import { describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { formatText } from '../src/client/messages.ts'
import { PendingCard, type PendingCardFace } from '../src/client/PendingCard.ts'

const row = (summary: string) => ({ id: summary, kind: 'skill', summary, createdAt: 'x', age: { unit: 'minute', n: 1 }, status: 'pending' })
const ok = (data: unknown) => ({ ok: true, data })

function racingApi() {
  let calls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  // ONE load asks twice (waiting + executing), so two calls per load: calls 1-2 are the slow read,
  // calls 3-4 the fast one.
  const pending = async () => {
    calls += 1
    if (calls <= 2) { await gate; return ok([row('SLOW-STALE')]) }
    return ok([row('FAST-FRESH')])
  }
  const api = { pending, approve: async () => ok({}), reject: async () => ok({}), preview: async () => ({ ok: false, message: 'n/a' }) }
  return { api, release: () => { release() }, calls: () => calls }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('G4/4.1: the pending window read is race-guarded', () => {
  it('a stale read that lands late does not replace the newer window', async () => {
    const { api, release } = racingApi()
    const props = { t: formatText, api, confirmMode: () => 'auto' } as unknown as PendingCardFace
    const view = render(createElement(PendingCard, props))
    await tick()
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(view.container.textContent).toContain('FAST-FRESH')
    expect(view.container.textContent).not.toContain('SLOW-STALE')
    release()
    await tick()
    // THE ASSERTION: once the slow read lands it must be DISCARDED, not merged in.
    expect(view.container.textContent).not.toContain('SLOW-STALE')
    expect(view.container.textContent).toContain('FAST-FRESH')
    cleanup()
  })
})
