/** Type declarations for lib-param-registry.mjs (the parser the generators and the spec share). */

export interface RegistryEntry {
  id?: string
  group?: string
  tier?: string
  authority?: string
  applies?: string
  owner?: string
  docAnchor?: string
  summary?: string
  [key: string]: unknown
}

export interface RegistryParse {
  entries: RegistryEntry[]
  violations: { notes: string[]; [key: string]: unknown }
}

export declare function readRegistry(path: string): RegistryParse
