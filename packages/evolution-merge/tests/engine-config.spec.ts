// @tier pre-tag
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { engineConfigFromEnv } from '../src/index.ts'

it('derives model paths from the configured root and never overrides rank_mode', () => {
  const cfg = engineConfigFromEnv('C:/models')
  expect(cfg).toBeDefined()
  if (cfg === undefined) return
  expect(cfg).toMatchObject({
    models_dir: '',
    offline: true,
    auto_provision: false,
    embed_backend: 'local',
    embedder_model: join('C:/models', 'potion-multilingual-128M-int8'),
    embedder_model_last: join('C:/models', 'potion-multilingual-128M-pca64-int8'),
  })
  expect(cfg).not.toHaveProperty('rank_mode')
})
