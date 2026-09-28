/**
 * The ambient surface this package needs to reach ONE platform module at RUNTIME.
 *
 * Why not a static import: the workspace tsconfig maps `@deepseek-ai/*` into the platform tree, so
 * statically importing `@deepseek-ai/dsh-client-ui-primitives` pulls platform SOURCES into this
 * package's program (TS6059/TS6307) and then trips over this package's own `react.d.ts` (TS2305).
 * Measured on 2026-09-27; an ambient `declare module` for that specifier does NOT win over the paths
 * mapping (and a docblock that SPELLS an import statement would be read by
 * `verify-dependency-closure`'s line scan, which is why this one is described in prose).
 *
 * What works instead: the bundle is CJS and the loader hands it a `require` bound to the client
 * module table (`PLATFORM_MODULES`, which seeds `@deepseek-ai/dsh-client-ui-primitives`), so the
 * module is reached the same way `react` is — at runtime, by a bare `require` the bundler leaves
 * alone because `@deepseek-ai/*` is external.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

/** The CJS require the client bundle runs with (injected by the platform's module loader). */
declare function require(id: string): unknown
