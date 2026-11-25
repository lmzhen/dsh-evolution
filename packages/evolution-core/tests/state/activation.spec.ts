// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isStoreV2Active, readStoreActivation, StoreActivationCorruptError, storeV2ActivationPath } from '../../src/state/activation.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('store activation oracle', () => {
  it('treats an absent marker as legacy and reads mode/generation from the record', async () => {
    const root = await tempRoot('dsh-activation-record-')
    await mkdir(join(root, 'state'), { recursive: true })
    expect(readStoreActivation(root)).toBeNull()
    expect(isStoreV2Active(root)).toBe(false)
    await writeFile(storeV2ActivationPath(root), JSON.stringify({ mode: 'store-v2', generation: 7, lastActiveCommitId: 'abc' }) + '\n')
    expect(readStoreActivation(root)).toMatchObject({ mode: 'store-v2', generation: 7, lastActiveCommitId: 'abc' })
    expect(isStoreV2Active(root)).toBe(true)
    await writeFile(storeV2ActivationPath(root), JSON.stringify({ mode: 'legacy', generation: 8, lastActiveCommitId: 'abc' }) + '\n')
    expect(isStoreV2Active(root)).toBe(false)
  })

  it('fails loud on a corrupt activation record instead of falling back to legacy', async () => {
    const root = await tempRoot('dsh-activation-corrupt-')
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(storeV2ActivationPath(root), '{not json\n')
    expect(() => isStoreV2Active(root)).toThrow(StoreActivationCorruptError)
    await writeFile(storeV2ActivationPath(root), JSON.stringify({ mode: 'bogus' }) + '\n')
    expect(() => readStoreActivation(root)).toThrow(/unknown mode/)
  })
})
