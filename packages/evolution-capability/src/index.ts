/**
 * Explicit, non-automatic capability evolution adapter.
 *
 * The DSH Creator mode already owns the trusted dynamic-package lifecycle.
 * This adapter adds the missing governance seam WITHOUT executing model code:
 * a capability package is validated, then submitted through the same staged
 * approval audit used by memory/skills. Human approval records the pending
 * package; the actual `cordis_define`/`cordis_run` work stays in Creator mode.
 * @module @deepseek-ai/dsh-evolution-capability
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import type {} from '@deepseek-ai/dsh-evolution-approval'
import type {} from '@deepseek-ai/dsh-evolution-state'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionCapability: EvolutionCapability
  }
}

export const CAPABILITY_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export interface CapabilityPackage {
  name: string
  purpose: string
  code: {
    host?: string
    client?: string
  }
}

export interface CapabilityValidation {
  ok: boolean
  errors: string[]
}

export interface CapabilitySubmitResult {
  ok: boolean
  pendingId?: string | undefined
  message: string
}

export interface Config {
  maxNameLength?: number
  maxPurposeLength?: number
  maxCodeChars?: number
}

export class EvolutionCapability extends Service {
  static inject = ['evolutionApproval', 'evolutionState']

  static Config: Schema<Config> = z.object({
    maxNameLength: z.number().default(64),
    maxPurposeLength: z.number().default(200),
    maxCodeChars: z.number().default(65_536),
  })

  private readonly limits: Required<Config>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCapability')
    this.limits = {
      maxNameLength: config.maxNameLength ?? 64,
      maxPurposeLength: config.maxPurposeLength ?? 200,
      maxCodeChars: config.maxCodeChars ?? 65_536,
    }
  }

  validate(pkg: unknown): CapabilityValidation {
    return validateCapabilityPackage(pkg, this.limits)
  }

  /** Stage one capability package. Execution is deliberately out of scope. */
  async submit(pkg: CapabilityPackage, origin: 'foreground' | 'background_review' = 'foreground'): Promise<CapabilitySubmitResult> {
    const validation = this.validate(pkg)
    if (!validation.ok) {
      return { ok: false, message: validation.errors.join('; ') }
    }
    const approval = this.ctx.evolutionApproval
    if (!approval.isEnabled) {
      return { ok: false, message: 'Capability evolution requires staged approval to be enabled.' }
    }
    const decision = await approval.request({
      kind: 'capability',
      summary: `capability ${pkg.name}`,
      args: pkg,
      origin,
    })
    if (decision.action !== 'staged') {
      return { ok: false, message: 'Capability submission was not staged.' }
    }
    return { ok: true, pendingId: decision.pendingId, message: decision.message }
  }

  async listPending(status: PendingStatus = 'pending'): Promise<PendingRecord[]> {
    const records = await this.ctx.evolutionState.listPending(status)
    return records.filter(record => record.kind === 'capability')
  }

  /** Retrieve an approved package for manual Creator-mode activation. */
  async approvedPackage(id: string): Promise<CapabilityPackage | null> {
    const records = await this.ctx.evolutionState.listPending('approved')
    const record = records.find(item => item.id === id && item.kind === 'capability')
    return record ? record.args as CapabilityPackage : null
  }
}

export interface CapabilityLimits {
  maxNameLength: number
  maxPurposeLength: number
  maxCodeChars: number
}

export function validateCapabilityPackage(
  pkg: unknown,
  limits: CapabilityLimits = { maxNameLength: 64, maxPurposeLength: 200, maxCodeChars: 65_536 },
): CapabilityValidation {
  const errors: string[] = []
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { ok: false, errors: ['capability package must be an object'] }
  }
  const record = pkg as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const purpose = typeof record.purpose === 'string' ? record.purpose.trim() : ''
  const code = record.code
  if (!CAPABILITY_NAME_RE.test(name) || name.length > limits.maxNameLength) {
    errors.push(`name must be lowercase-hyphenated and <= ${limits.maxNameLength} chars`)
  }
  if (purpose.length === 0 || purpose.length > limits.maxPurposeLength) {
    errors.push(`purpose must be 1-${limits.maxPurposeLength} chars`)
  }
  if (!code || typeof code !== 'object' || Array.isArray(code)) {
    errors.push('code object is required')
  } else {
    const halves = code as Record<string, unknown>
    const host = typeof halves.host === 'string' ? halves.host : ''
    const client = typeof halves.client === 'string' ? halves.client : ''
    if (host.length === 0 && client.length === 0) errors.push('at least one of code.host or code.client is required')
    if (host.length > limits.maxCodeChars || client.length > limits.maxCodeChars) {
      errors.push(`each code half must be <= ${limits.maxCodeChars} chars`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export default EvolutionCapability
