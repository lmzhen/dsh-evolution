/**
 * The settings half of the family's platform contract.
 */
export interface SettingsPort {
  configure?(options: { auto: boolean }, owner: unknown): () => void
  describe?(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; user?: Record<string, unknown> }>
}
