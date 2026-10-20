/**
 * G6/W8: the command-face fallback for every Host data-plane surface.
 *
 * The browser panels depend on the platform's `connection` carrier (exact Fetch routes). When that
 * carrier is absent (headless host, E-325) or a panel answer is missing, the operator is owed the
 * equivalent command — the SAME use case, not a different implementation. This table is the ONE
 * home of those pairs; the INSTALL runbook and the client `fallbacks.generated.ts` are generated
 * from it (W7), and a spec pins its key set to HOST_ROUTES' four surfaces.
 *
 * Not exported from the package: this is a command-side contract, not a plugin API (W8 §2).
 * @module @deepseek-ai/dsh-evolution-commands/command-fallback
 */

/** One surface's command-face path(s): the family command, plus the platform CLI when one exists. */
export interface CommandFallbackHint {
  readonly command: string
  readonly platformCli?: string
}

/** The four Host surfaces (keyed exactly like the frozen `COMMAND_FALLBACK_SURFACES`). */
export type CommandFallbackSurface = 'approval' | 'skill-history' | 'skill-health' | 'merge' | 'diagnostics'

/**
 * One entry per Host surface. The command column names the same service methods the routes call,
 * so the answers (and refusal sentences) match the panel.
 */
export const COMMAND_FALLBACKS: Readonly<Record<CommandFallbackSurface, CommandFallbackHint>> = {
  approval: {
    command: '/evolution pending … /evolution approve <id> … /evolution reject <id> … /evolution release <id>',
  },
  'skill-history': {
    command: '/evolution restore <name> [v]（查看：/evolution skills history <name>）',
  },
  'skill-health': {
    command: '/evolution skills refresh（健康行：/evolution doctor）',
  },
  merge: {
    command: '/evolution merge status / pending / approve <id> / report',
  },
  diagnostics: {
    command: '/evolution doctor',
    platformCli: 'dsh --json /evolution doctor',
  },
}

/** The ordered surface ids (the frozen W1 set). */
export const COMMAND_FALLBACK_SURFACES: readonly CommandFallbackSurface[] = ['approval', 'skill-history', 'skill-health', 'merge', 'diagnostics']
