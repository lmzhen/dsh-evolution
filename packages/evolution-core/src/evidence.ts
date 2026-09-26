/**
 * Which session frames are EVIDENCE, and which are bookkeeping.
 *
 * A plan op must cite `evidence` seqs, and the validator's range rule
 * (`evolution-plan-validator`, rule `EVIDENCE_RANGE`) answers only "is this an integer inside
 * the window the plan was authored against". A boundary frame satisfies that while carrying
 * nothing a claim can rest on: the `turn/start` seq is the frame a claim about that turn was
 * most likely read out of, and citing it is indistinguishable from citing a real exchange. This
 * module owns the ONE classification of a session frame by what it CARRIES, so the plan path can
 * report an op whose whole citation list is bookkeeping (design
 * `dsh-evolution-skill-history-design.md` §3D, phase 1: report only — no op is refused here).
 *
 * The classification is a DENY list of the pure bookends, not an allow list of content frames.
 * The platform's own vocabulary (`KNOWN_SESSION_EVENT_TYPES`, 57 members at 0.1.5-rc.2) mixes
 * content frames with state-change frames, and out-of-repo plugins append types the family cannot
 * enumerate; an unknown frame is therefore treated as carrying content, because a report that
 * fires on an unclassifiable frame is a false positive and phase 1 exists to measure how many TRUE
 * ones there are. Tightening — a narrower definition, or an allow list built from the platform's
 * vocabulary — changes this table and nothing else (`evidenceKindIndex` is the only reader).
 * @module @deepseek-ai/dsh-evolution-core
 */

/** The frame types that record a boundary and carry no content: the turn and step bookends. */
const BOOKKEEPING_FRAME_TYPES: ReadonlySet<string> = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
])

/** One session frame, as far as the classification reads it. A platform `SessionEvent` is
 * assignable: both fields are optional here so a stub log can be classified without pretending
 * to be a full event. */
export interface EvidenceFrame {
  /** The platform event type. An unknown value counts as content (see the module docblock). */
  type?: unknown
  /** The durable sequence number a plan op cites. */
  seq?: unknown
}

/**
 * The seqs of the frames that carry content.
 *
 * @param events - the session's frames, oldest first (any iterable; nothing is retained).
 * @returns the substantive seqs, or `undefined` when NO frame carried a usable seq. The two
 *   answers are different facts: an empty SET says "every sequenced frame is a boundary", while
 *   `undefined` says "this log cannot tell a boundary from a message" (a stub session in a test,
 *   a composition whose events carry no seq). A caller that cannot classify must stay silent
 *   rather than report every op — the same three-state posture as `sessionReadSkillNames`.
 */
export function evidenceKindIndex(events: Iterable<EvidenceFrame>): ReadonlySet<number> | undefined {
  const substantive = new Set<number>()
  let sequenced = 0
  for (const event of events) {
    const seq = event.seq
    // Only an integer seq is citable, so only an integer seq is classifiable.
    if (typeof seq !== 'number' || !Number.isInteger(seq)) continue
    sequenced += 1
    if (typeof event.type === 'string' && BOOKKEEPING_FRAME_TYPES.has(event.type)) continue
    substantive.add(seq)
  }
  return sequenced === 0 ? undefined : substantive
}
