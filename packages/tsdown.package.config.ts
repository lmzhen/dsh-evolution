import { defineConfig } from 'tsdown'

export default defineConfig(() => ({
  workspace: false,
  cwd: process.cwd(),
  entry: ['lib/types/{index,invariant,startup}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
