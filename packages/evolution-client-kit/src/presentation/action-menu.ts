/**
 * The one seam onto the platform's menu material, plus a small fallback for deployments
 * without the primitive row. No page owns a second menu implementation.
 */
import { createElement, type ReactNode } from 'react'

declare function require(id: string): unknown

/** The platform's menu surface: a styled container that accepts div props. */
export type MenuSurfaceComponent = (props: Record<string, unknown> & { children?: ReactNode }) => ReactNode
/** The platform's menu row: role=menuitem plus selected/disabled/danger semantics. */
export type MenuItemButtonComponent = (props: {
  children: ReactNode
  current?: boolean
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}) => ReactNode

/** The two components this family consumes from one platform module row. */
export interface MenuPrimitives {
  MenuSurface: MenuSurfaceComponent
  MenuItemButton: MenuItemButtonComponent
}

const PLATFORM_UI_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

/** One row of the coordinate/action menu, independent of the renderer. */
export interface RowMenuAction {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly separatorBefore?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly danger?: boolean | undefined
}

/**
 * Render the platform menu directly. Kept exported for callers that already own the primitive row.
 * @param primitives - platform MenuSurface/MenuItemButton pair.
 * @param actions - rows in display order.
 * @param label - accessible menu name.
 * @param style - fixed position computed from the pointer.
 * @param className - optional surface class.
 * @returns the menu element.
 */
export function renderPlatformMenu(primitives: MenuPrimitives, actions: readonly RowMenuAction[], label: string, style: Record<string, string | number>, className?: string | undefined): ReactNode {
  return createElement(primitives.MenuSurface, {
    'data-role': 'action-menu', 'data-platform': 'true', role: 'menu', 'aria-label': label,
    ...(className === undefined ? {} : { className }),
    style,
  }, actions.map(action => createElement(primitives.MenuItemButton, {
    key: action.id,
    children: action.label,
    ...(action.separatorBefore === true ? { separatorBefore: true } : {}),
    ...(action.disabled === true ? { disabled: true } : {}),
    ...(action.danger === true ? { danger: true } : {}),
    onSelect: action.onSelect,
  })))
}

/**
 * Accept only the two component functions; a namespace row without them is not a menu.
 * @param row - the module row's exports.
 * @returns the two components, or undefined.
 */
export function menuPrimitivesFrom(row: Record<string, unknown>): MenuPrimitives | undefined {
  const surface = row.MenuSurface
  const item = row.MenuItemButton
  if (typeof surface !== 'function' || typeof item !== 'function') return undefined
  return { MenuSurface: surface as MenuSurfaceComponent, MenuItemButton: item as MenuItemButtonComponent }
}

/** The module-table row, when this deployment carries it. */
export const PLATFORM_MENU: MenuPrimitives | undefined = (() => {
  try {
    // oxlint-disable-next-line typescript/no-require-imports -- the client module table is reachable only through the loader's require
    return menuPrimitivesFrom(require(PLATFORM_UI_MODULE) as Record<string, unknown>)
  } catch {
    return undefined
  }
})()
