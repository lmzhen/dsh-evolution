import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { boot } from '../../../boot/app-boot/src/index.ts'

it('boots discovery from a real Loader cordis.yml', async () => {
  const ctx = await boot('discovery-test', fileURLToPath(new URL('./fixtures/loader.cordis.yml', import.meta.url)), [], undefined, new URL('../', import.meta.url).href)
  expect(ctx.get('tools')?.get('skill_search')).toBeDefined()
})
