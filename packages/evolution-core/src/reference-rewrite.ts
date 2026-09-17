/**
 * Reference re-homing plans (0.5.0 V1, design §16.7).
 *
 * A consolidation moves one skill's body under ANOTHER skill root, where every
 * support-dir reference resolves against that other root (design §2.1). This
 * module plans what has to happen to the support files and to the body's
 * references for the move to leave no dangling link. Pure: the caller owns IO,
 * decides the destination names, and decides whether the plan is applied (V2)
 * or only reported (V1). Cross-skill rewriting is out of scope by design (§14) —
 * a plan covers ONE body.
 */

import { resolveCitations } from './citations.ts'

/** One re-homed support file: source-relative path -> target-relative path. */
export interface ReferenceMove {
  /** Path inside the skill the body comes FROM. */
  from: string
  /** Path inside the skill the body moves TO. */
  to: string
}

/** One reference the plan rewrites, in body line order. */
export interface ReferenceRewriteEdit {
  /** 1-based line in the body being moved. */
  line: number
  from: string
  to: string
}

/** What one consolidation plan does to one body's references. */
export interface ReferenceRewritePlan {
  /** References whose target changes (a re-homed file). */
  edits: readonly ReferenceRewriteEdit[]
  /** Cited files the moves give no destination: applying this plan would dangle. */
  unresolved: readonly string[]
  /** Targets still absent from the target file list after the moves. */
  residualDangling: readonly string[]
  /** Moves the plan actually relies on (paths the body cites or that must travel). */
  moves: readonly ReferenceMove[]
}

/**
 * Provisional re-homing rule. The naming style for re-homed files is still an
 * open decision (design §16.3 B5); this rule only fires on a COLLISION, where
 * something has to give: a path that the target already occupies gets the source
 * name as a prefix (`references/a.md` -> `references/<source>-a.md`). Nested
 * destinations are deliberately avoided: the support listing is one level deep,
 * so a file moved into a subdirectory would drop out of the listing entirely.
 * @param sourceFiles - the moving skill's support files.
 * @param targetFiles - the destination skill's support files.
 * @param sourceName - the moving skill's name, used as the collision prefix.
 * @returns the moves plus the paths that collided (for the report).
 */
export function planRehoming(
  sourceFiles: readonly string[],
  targetFiles: readonly string[],
  sourceName: string,
): { moves: ReferenceMove[]; collisions: string[] } {
  const taken = new Set(targetFiles)
  const collisions: string[] = []
  const moves: ReferenceMove[] = []
  for (const path of sourceFiles) {
    if (!taken.has(path)) {
      moves.push({ from: path, to: path })
      continue
    }
    collisions.push(path)
    const cut = path.lastIndexOf('/')
    const dir = cut < 0 ? '' : path.slice(0, cut + 1)
    const name = path.slice(cut + 1)
    let candidate = `${dir}${sourceName}-${name}`
    let counter = 2
    while (taken.has(candidate)) {
      candidate = `${dir}${sourceName}-${counter}-${name}`
      counter += 1
    }
    taken.add(candidate)
    moves.push({ from: path, to: candidate })
  }
  return { moves, collisions }
}

/**
 * Plan the reference rewrites for one body that is moving into another root.
 * @param input - the body, the MOVING skill's file list, the re-homing moves and
 *   the destination's file list (with the moved paths already included).
 * @returns the edits, the cited files without a destination, and any target that
 *   the destination file list cannot prove (applying such a plan would dangle).
 */
export function planReferenceRewrite(input: {
  content: string
  files: readonly string[]
  moves: readonly ReferenceMove[]
  targetFiles: readonly string[]
}): ReferenceRewritePlan {
  const report = resolveCitations({ content: input.content, file: 'SKILL.md', files: input.files })
  const byFrom = new Map(input.moves.map(move => [move.from, move.to]))
  const available = new Set(input.targetFiles)
  const edits: ReferenceRewriteEdit[] = []
  const unresolved: string[] = []
  const residual = new Set<string>()
  const used = new Set<string>()
  for (const ref of report.refs) {
    if (ref.kind !== 'citation' || ref.target === null) continue
    const move = byFrom.get(ref.target)
    const to = move ?? ref.target
    if (move !== undefined) {
      used.add(ref.target)
      if (move !== ref.target) edits.push({ line: ref.line, from: ref.target, to: move })
    } else if (!report.dangling.some(entry => entry.target === ref.target)) {
      // Already resolvable in the MOVING skill: it only stays valid if the
      // destination happens to carry the same path, which the caller proves by
      // listing it under `targetFiles`.
      unresolved.push(ref.target)
    }
    if (!available.has(to)) residual.add(to)
  }
  return {
    edits,
    unresolved: [...new Set(unresolved)],
    residualDangling: [...residual],
    moves: input.moves.filter(move => used.has(move.from) || move.from !== move.to),
  }
}

/**
 * One-line, model-facing summary of a plan, for the consolidation refusal and
 * for the V2 apply path's audit text.
 * @param plan - the plan to describe.
 * @returns a compact sentence naming counts, the moves and any residual risk.
 */
export function describeReferenceRewrite(plan: ReferenceRewritePlan): string {
  const renames = plan.moves.filter(move => move.from !== move.to)
  const parts = [
    `re-home ${plan.moves.length} file(s)`,
    renames.length === 0 ? '' : `renamed: ${renames.map(move => `${move.from}->${move.to}`).join(', ')}`,
    `rewrite ${plan.edits.length} reference(s)`,
    `residual dangling ${plan.residualDangling.length}`,
    plan.unresolved.length === 0 ? '' : `no destination: ${plan.unresolved.slice(0, 5).join(', ')}`,
  ].filter(part => part.length > 0)
  return `plan: ${parts.join('; ')}`
}
