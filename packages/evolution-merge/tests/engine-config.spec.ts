// @tier pre-tag
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { engineConfigFromRoot } from '../src/index.ts'

it('derives only the allowed embedder paths from the configured root', () => {
  const cfg = engineConfigFromRoot('C:/models')
  expect(cfg).toBeDefined()
  if (cfg === undefined) return
  expect(Object.keys(cfg).sort()).toEqual(['embedder_model', 'embedder_model_last'])
  expect(cfg).toEqual({
    embedder_model: join('C:/models', 'potion-multilingual-128M-int8'),
    embedder_model_last: join('C:/models', 'potion-multilingual-128M-pca64-int8'),
  })
  for (const forbidden of ['models_dir', 'offline', 'auto_provision', 'embed_backend', 'rank_mode', 'judge_model']) {
    expect(cfg).not.toHaveProperty(forbidden)
  }
})

it('does not fall back to the environment or a blank root', () => {
  vi.stubEnv('SKILL_MERGE_MODELS_ROOT', 'C:/env-models')
  try {
    expect(engineConfigFromRoot()).toBeUndefined()
    expect(engineConfigFromRoot('   ')).toBeUndefined()
  } finally { vi.unstubAllEnvs() }
})