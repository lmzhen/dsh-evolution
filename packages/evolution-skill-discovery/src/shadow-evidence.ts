import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { canPromoteShadow } from './domain-projection.ts'
import type { ProjectionResult } from './projection.ts'

interface ShadowEvidenceFile { readonly schemaVersion: 1; readonly samples: number; readonly recovered: number; readonly hidden: number; readonly silentMisses: number }

/** Durable shadow-run evidence; every complete shadow projection is one sample. */
export class ShadowEvidenceStore {
  private readonly io: EvolutionIoLike
  private readonly path: string
  private samples = 0
  private recovered = 0
  private hidden = 0
  private silentMisses = 0
  private loaded = false
  constructor(io: EvolutionIoLike, path: string) { this.io = io; this.path = path }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const content = await this.io.readText(this.path)
    if (content === null) return
    try {
      const parsed = JSON.parse(content) as ShadowEvidenceFile
      if (parsed.schemaVersion === 1 && Number.isSafeInteger(parsed.samples) && parsed.samples >= 0) {
        this.samples = parsed.samples
        this.recovered = Number.isSafeInteger(parsed.recovered) && parsed.recovered >= 0 ? parsed.recovered : 0
        this.hidden = Number.isSafeInteger(parsed.hidden) && parsed.hidden >= 0 ? parsed.hidden : 0
        this.silentMisses = Number.isSafeInteger(parsed.silentMisses) && parsed.silentMisses >= 0 ? parsed.silentMisses : 0
      }
    } catch { /* corrupt evidence starts over */ }
  }

  async record(result: ProjectionResult): Promise<void> {
    if (result.shadowHiddenNames === undefined || result.shadowHiddenNames.length === 0) return
    await this.load()
    this.samples += 1
    this.hidden += result.shadowHiddenNames.length
    this.recovered += result.shadowRecoveredNames?.length ?? 0
    await this.io.writeText(this.path, JSON.stringify({ schemaVersion: 1, samples: this.samples, recovered: this.recovered, hidden: this.hidden, silentMisses: this.silentMisses }))
  }

  evidence(): { samples: number; hiddenRecoverableRate: number; silentMisses: number } {
    return { samples: this.samples, hiddenRecoverableRate: this.hidden > 0 ? this.recovered / this.hidden : 0, silentMisses: this.silentMisses }
  }

  canPromote(): boolean { return canPromoteShadow(this.evidence()) }
}
