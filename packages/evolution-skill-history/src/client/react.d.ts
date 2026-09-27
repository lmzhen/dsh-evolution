/**
 * Minimal ambient surface for the React the loader injects.
 *
 * The bundle keeps `react` EXTERNAL (the client module table supplies it through the factory), and this
 * package is typechecked in a tree where no react package is declared for it: the declarations below
 * cover exactly what this panel uses, so the family build stays self-contained.
 */
declare module 'react' {
  /** A renderable value. */
  export type ReactNode = unknown
  /** Inline style object (design tokens arrive as `var(--dsw-… )` strings). */
  export type CSSProperties = Record<string, string | number | undefined>
  /**
   * Create one element.
   * @param type - element type (a tag name or a function component).
   * @param props - element props, or null.
   * @param children - child nodes.
   * @returns the element the renderer consumes.
   */
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  /**
   * Component-local state.
   * @param initial - the initial value.
   * @returns the current value and its setter.
   */
  export function useState<S>(initial: S): [S, (next: S | ((current: S) => S)) => void]
  /**
   * One mutable box that survives re-renders without causing one.
   * @param initial - the initial value.
   * @returns the box; assign to `current` to change it.
   */
  export function useRef<T>(initial: T): { current: T }
  /**
   * Run one effect after the render that produced it, and again when a dependency changes.
   * @param effect - the effect; a returned function cleans it up.
   * @param deps - the dependency list.
   */
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  /**
   * A value derived from the render's inputs, recomputed only when a dependency changes.
   * @param factory - computes the value.
   * @param deps - the dependency list.
   * @returns the memoized value.
   */
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
}
