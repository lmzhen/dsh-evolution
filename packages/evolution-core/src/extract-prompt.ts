/**
 * The frozen semantic prompt for skill extraction. One constant, consumed by
 * explicit extract agents and tests; it is deliberately not part of the review
 * prompt bundle, and no review path injects it.
 */
export const EXTRACT_PROMPT_VERSION = 'v1'

export const EXTRACT_PROMPT_V1 = `Inspect the source skill, its linked support files, and the candidate owners
in the library. A part of the skill (one or more sections) is a separate
capability when it has its own trigger and outcome, can be used without the
parent context, and leaves the parent coherent. If it is separate and a
class-level owner covers it, extract that part. If no owner covers it, report
the owner gap and name the class-level owner that would be needed. If it mixes
a reusable capability with parent-specific facts, return mixed and name only
the reusable part. Otherwise keep it. Keep, extract, mixed, and owner-gap are
all valid outcomes; no split is required.`
