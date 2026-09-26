/**
 * THE error-code table: E-301…E-318 with the exact text each one emits (E-317 and E-318 are the
 * write-admission gates' own refusals).
 *
 * The codes used to be spelled out at 33 call sites across two packages, so one
 * code's wording could drift between the branches that answer it and nothing could
 * see the drift. Keys name the SCENARIO rather than the code, because a code
 * legitimately carries more than one text (E-301 answers pending / approve / reject
 * with different guidance); the code still leads every string, so model- and
 * user-facing output is unchanged. Interpolations are written `%aN%` and filled by
 * `errorText` from the values the call site used to interpolate inline.
 * @module @deepseek-ai/dsh-evolution-core
 */
export const EVOLUTION_ERRORS = Object.freeze({
  'e-305-this-invocation-carries-no':
    'E-305: this invocation carries no agent — `%a1%` needs a session-backed call (run it from a session in the GUI or the CLI).',
  'e-306-this-deployment-stages-foreground':
    'E-306: this deployment stages foreground writes, but `/evolution %a1%` is not replayable through the skill runner — there is nothing to stage. Run it from a session whose approval policy is \'never\', or set `stageForeground: false` on the evolution-approval row, then repeat the command.',
  'e-301-approval-service-not-mounted':
    'E-301: approval service not mounted — pending writes cannot be listed or replayed. Next: the evolution-approval row ships with evolution-host/evolution-all — run /evolution doctor to see which services are mounted.',
  'e-301-approval-service-not-mounted-2':
    'E-301: approval service not mounted. Next: the evolution-approval row ships with evolution-host/evolution-all — run /evolution doctor to see which services are mounted.',
  'e-304-the-mounted-approval-service':
    'E-304: the mounted approval service predates the release capability — reject the record instead.',
  'e-302-curator-service-not-mounted':
    'E-302: curator service not mounted. Next: mount the evolution-curator row (evolution-host/evolution-all) and run /evolution doctor.',
  'e-305-the-invocation-agent-exposes':
    'E-305: the invocation agent exposes neither `followup` nor `inject` — this learn request has no delivery channel.',
  'e-306-this-deployment-stages-foreground-2':
    'E-306: this deployment stages foreground writes, but this invocation carries no agent session — `/evolution restructure` would stage a record with no session attribution. Run it from a session in the GUI or the CLI, or set `stageForeground: false` on the evolution-approval row, then repeat the command.',
  'e-303-replay-service-not-mounted':
    'E-303: replay service not mounted. Next: mount the evolution-replay row (evolution-host/evolution-all) and run /evolution doctor.',
  'e-307-the-settings-service-could':
    'E-307: the settings service could not report its sections (%a1%). /evolution params needs the user layer to tell an override from a deployment value; run /evolution doctor to see which services are mounted.',
  'e-308-unknown-parameter-group-group':
    'E-308: unknown parameter group "%a1%" — known groups: %a2%.',
  'e-311-no-settings-service-is':
    'E-311: no settings service is mounted, so there is no user layer to write. Mount the settings row (packages/settings/settings-file) and retry; this command never edits cordis.yml — a deployment value belongs to the deployment. /evolution doctor lists the mounted services.',
  'e-312-error-instanceof-Error-error':
    'E-312: %a1% — /evolution params lists the canonical ids.',
  'e-313-unknown-parameter-id-evolution':
    'E-313: unknown parameter "%a1%" — /evolution params lists every registered id with its tier and user layer.',
  'e-314-id-is-a-deployment':
    'E-314: "%a1%" is a deployment parameter (tier %a2%, owner %a3%) — it is written in cordis.yml on its plugin or policy row, not from a session. /evolution params shows who may write each row.',
  'e-315-id-has-no-user':
    'E-315: "%a1%" has no user layer — owner %a2% publishes no settings namespace, so the value stays with the deployment.',
  'e-307-the-settings-service-could-2':
    'E-307: the settings service could not report its sections (%a1%). /evolution policy set needs the current revision to write safely; run /evolution doctor to see which services are mounted.',
  'e-316-namespace-namespace-is-not':
    'E-316: namespace "%a1%" is not registered — owner %a2% is not mounted in this composition, so its parameters cannot be written from here. /evolution params marks those rows \'unregistered\'.',
  'e-309-revision-conflict-you-sent':
    'E-309: revision conflict — you sent %a1%, the document stands at %a2%. Re-read with /evolution params --json and retry.',
  'e-309-revision-conflict-message-Re':
    'E-309: revision conflict — %a1%. Re-read with /evolution params --json and retry.',
  'e-310-the-settings-service-refused':
    'E-310: the settings service refused the write: %a1% — the owning plugin\'s rule stands (a cross-field pair, or a cap that may only be tightened). /evolution params shows the current value.',
  'e-305-this-invocation-carries-no-2':
    'E-305: this invocation carries no agent — `%a1%` needs a session-backed call (run it from a session in the GUI or the CLI).',
  // 0.9.0: the write-admission sequence's own refusals (tool-skill-manage/src/write-gates.ts).
  'e-317-skill-write-not-confirmed':
    'E-317: skill "%a1%" was not %a2% — the confirmation prompt was declined, so nothing was written. The prompt appears on every create and bare delete; repeat the call only if the operator asks for it.',
  'e-318-skill-write-without-a-read':
    'E-318: skill "%a1%" was not read in this session, so this write is refused. Read it with the `skill` tool first (a read that failed does not count), then repeat the write.',
} as const)

/** One table key. */
export type EvolutionErrorId = keyof typeof EVOLUTION_ERRORS

/**
 * Render one table entry, substituting its interpolation slots.
 * @param id - the scenario key.
 * @param args - values for the entry's `%aN%` slots.
 * @returns the message text the call site used to spell out inline.
 */
export function errorText(id: EvolutionErrorId, args: Record<string, string | number> = {}): string {
  return EVOLUTION_ERRORS[id].replace(/%a(\d+)%/g, (_match, n: string) => String(args['a' + n] ?? ''))
}
