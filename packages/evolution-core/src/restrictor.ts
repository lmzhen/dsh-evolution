// The one extra preset row a restricted preset appends; G2-S3 implements the restriction.
import type { Context } from '@deepseek-ai/cordis'

export const name = 'evolution-restrictor'
export const inject = ['tools'] as const

export interface Config {
  readonly allow: readonly string[]
  readonly deny?: readonly string[]
}

export function apply(_ctx: Context, _config: Config): void {
  throw new Error('restrictor apply is not implemented until G2-S3')
}
