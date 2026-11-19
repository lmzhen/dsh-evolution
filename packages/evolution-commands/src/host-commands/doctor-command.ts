/** The read-only doctor surface: the CLI view and its --json form. */
import type { HostLocale } from '@deepseek-ai/dsh-evolution-core'
import { evolutionRoot } from '@deepseek-ai/dsh-evolution-core'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-platform-contract'
import { diagnose, renderDoctorText } from '../doctor.ts'
import { presetProfileTarget } from '../preset-source.ts'

/** What the doctor handler needs. */
export interface DoctorCommandContext {
  readonly input: string
  readonly ctx: Parameters<typeof diagnose>[0]
  readonly runs: () => { running: number; orphaned: number }
  readonly locale: HostLocale
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })

/**
 * Render the doctor report for the bare and --json forms.
 * @param context - raw input, plugin context, run counts and locale.
 * @returns the report, or undefined for a different command.
 */
export async function runDoctorCommand(context: DoctorCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, runs, locale } = context
  if (input !== 'doctor' && input !== 'doctor --json') return undefined
  const mountedForDoctor = presetProfileTarget(ctx)
  const mounted = mountedForDoctor === undefined
    ? {}
    : { mounted: { profile: mountedForDoctor.profile, dir: mountedForDoctor.profileDir, bundles: mountedForDoctor.bundles } }
  const report = await diagnose(ctx, { home: evolutionRoot(), ...mounted, runs: runs() })
  if (input === 'doctor --json') return ok(JSON.stringify(report, null, 2))
  return ok(renderDoctorText(report, locale))
}
