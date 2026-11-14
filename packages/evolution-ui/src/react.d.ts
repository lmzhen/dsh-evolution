/**
 * Minimal ambient surface for the React the loader injects.
 *
 * The bundle keeps `react` EXTERNAL (the client module table supplies it through the factory), and this
 * package is typechecked in a tree where no react package is installed: the declarations below cover
 * exactly what these panels use, so the family build stays self-contained.
 */
declare module 'react' {
  /** A renderable value. */
  export type ReactNode = unknown
  /** Inline style object (design tokens arrive as `var(--dsw-… )` strings). */
  export type CSSProperties = Record<string, string | number | undefined>
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): any
  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]
  export function useRef<T>(initial: T): { current: T }
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  export function useSyncExternalStore<T>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T
}
