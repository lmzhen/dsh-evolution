/**
 * The subagents half of the family's platform contract.
 */
export interface SubagentActivationPort {
  readonly childId: string
  readonly result: Promise<unknown>
  dispose(): Promise<void>
}

export interface SubagentSendOptions {
  readonly signal?: AbortSignal
}

export interface SubagentsPort {
  getProvider(name: string): unknown
  start(spec: unknown): Promise<SubagentActivationPort>
  sendMessage?(sender: unknown, targetId: string, content: unknown, options: SubagentSendOptions): Promise<unknown>
}
