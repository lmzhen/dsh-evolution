import { cpSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const lib = join(root, 'lib')
rmSync(lib, { recursive: true, force: true })
mkdirSync(join(lib, 'vendor', 'skill-merge-pipeline', 'models'), { recursive: true })
cpSync(join(root, 'src', 'index.js'), join(lib, 'index.js'))
cpSync(join(root, 'src', 'index.d.ts'), join(lib, 'index.d.ts'))
cpSync(join(root, 'vendor', 'skill-merge-pipeline', 'src'), join(lib, 'vendor', 'skill-merge-pipeline', 'src'), { recursive: true })
cpSync(join(root, 'vendor', 'skill-merge-pipeline', 'models', 'registry.json'), join(lib, 'vendor', 'skill-merge-pipeline', 'models', 'registry.json'))
cpSync(join(root, 'vendor', 'skill-merge-pipeline', 'models', 'pca64'), join(lib, 'vendor', 'skill-merge-pipeline', 'models', 'pca64'), { recursive: true })
console.log('engine build copied to lib (src + registry/pca64 only)')
