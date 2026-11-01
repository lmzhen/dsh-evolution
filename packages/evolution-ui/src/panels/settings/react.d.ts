/**
 * Minimal ambient surface for the React the loader injects.
 *
 * The bundle keeps `react` EXTERNAL (the client module table supplies it through
 * the factory's `require`), and this package is typechecked in a tree where no
 * react package is installed: the declarations below cover exactly what the card
 * uses, so the family build stays self-contained instead of depending on a
 * client-only toolchain.
 */
declare module 'react' {
  /** A renderable value. */
  export type ReactNode = unknown
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
  export function useState<S>(initial: S): [S, (next: S) => void]
  /**
   * A value that survives re-renders without causing one.
   * @param initial - the value the first render stores.
   * @returns the holder whose `current` the component reads and writes.
   */
  export function useRef<T>(initial: T): { current: T }
  /**
   * Run one effect after the render that produced it, and again when a dependency
   * changes.
   * @param effect - the effect; a returned function cleans it up.
   * @param deps - dependency list the renderer compares between renders.
   */
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}
