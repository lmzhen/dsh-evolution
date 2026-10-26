// @tier fast
import { expect, it } from 'vitest'
import { menuPrimitivesFrom } from '../src/client/platform-menu.ts'

it('accepts only a module row with both menu components', () => {
  const Surface = (): null => null
  const Item = (): null => null
  expect(menuPrimitivesFrom({ MenuSurface: Surface, MenuItemButton: Item })).toMatchObject({ MenuSurface: Surface, MenuItemButton: Item })
  expect(menuPrimitivesFrom({ MenuSurface: Surface })).toBeUndefined()
  expect(menuPrimitivesFrom({ MenuSurface: 'x', MenuItemButton: Item })).toBeUndefined()
  expect(menuPrimitivesFrom({})).toBeUndefined()
})
