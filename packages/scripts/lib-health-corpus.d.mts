/** Type declarations for lib-health-corpus.mjs (the engine-side corpus collector). */

export interface CorpusSkills {
  roots: string[]
  skills: Array<{
    path?: string
    name?: string
    language?: string | null
    facts?: { dims?: { bodyChars?: number | null; bodyWithSupportChars?: number | null; referenceCount?: number } }
    [key: string]: unknown
  }>
}

export declare function collectCorpusSkills(...args: unknown[]): CorpusSkills
