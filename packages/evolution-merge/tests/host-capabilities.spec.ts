// @tier pre-tag
import { expect, it } from 'vitest'
import { createHostCapabilities } from '../src/host-capabilities.ts'

it('passes through available and unavailable states and normalizes a rejection', async () => {
  expect(await createHostCapabilities(async () => undefined).hostOnly()).toBeUndefined()
  expect(await createHostCapabilities(async () => ({ code: 'E-323', detail: 'no presets' })).hostOnly()).toEqual({ code: 'E-323', detail: 'no presets' })
  expect(await createHostCapabilities(async () => { throw new Error('boom') }).hostOnly()).toEqual({ code: 'E-323', detail: 'boom' })
})
