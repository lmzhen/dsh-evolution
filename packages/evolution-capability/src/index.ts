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
import { clampedNumber } from '@deepseek-ai/dsh-evolution-core'
import type { PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import type {} from '@deepseek-ai/dsh-evolution-approval'
import type {} from '@deepseek-ai/dsh-evolution-state'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolutionCapability: EvolutionCapability
  }
}

// 0.3.17 (E-35): a trailing (or double) hyphen never matches — `foo-` used to
// pass and would be unreachable/ambiguous once on disk.
const CAPABILITY_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

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
    maxNameLength: z.number().min(1).default(64),
    maxPurposeLength: z.number().min(1).default(200),
    maxCodeChars: z.number().min(1).default(65_536),
  })

  private readonly limits: Required<Config>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'evolutionCapability')
    // G3.1 (0.3.23): every numeric limit is clamped to at least 1. 0/negative
    // fall back to the package default (a 0 is never a "disabled" meaning — a 0
    // limit would reject every package). NaN/±Infinity (which schemastery lets
    // a bare number schema through) and an out-of-range value also fall back.
    // Warn once when a user-supplied value had to be corrected.
    const clamped: string[] = []
    const field = (name: string, value: number | undefined, fallback: number): number => {
      const result = clampedNumber(value, fallback, { min: 1 })
      if (value !== undefined && result !== value) clamped.push(name)
      return result
    }
    this.limits = {
      maxNameLength: field('maxNameLength', config.maxNameLength, 64),
      maxPurposeLength: field('maxPurposeLength', config.maxPurposeLength, 200),
      maxCodeChars: field('maxCodeChars', config.maxCodeChars, 65_536),
    }
    if (clamped.length > 0) {
      ctx.logger.warn(`evolution-capability: ${clamped.join(', ')} provided an invalid value; falling back to the default`)
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
      // P3 (v3 audit): a capability submission must ALWAYS stage — the
      // allow-direct path would dead-end capability evolution silently.
      return { ok: false, message: 'Capability submission requires staged approval: set approval.stageForeground=true (it keeps capability submissions paused for review; allow would bypass the audit).' }
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
    if (!record) return null
    // 0.3.17 (E-35): re-validate on read-back — the approved record is
    // persistent data that has crossed the approval chain; a malformed one
    // (or one edited out-of-band) must not reach Creator-mode activation.
    const validation = this.validate(record.args)
    return validation.ok ? record.args as CapabilityPackage : null
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
