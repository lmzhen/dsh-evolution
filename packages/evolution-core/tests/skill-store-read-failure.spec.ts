/**
 * S2-14 (FLOW2-1/flow-3): a target that cannot be READ at all gets the same
 * explicit classification on every write path.
 *
 * `io.readText` returns null only for a genuinely missing path and throws for
 * everything else (EACCES/EIO/EISDIR/EMFILE). The staged write paths used to let
 * that error escape — the model saw a raw errno — while the remove path has
 * classified the same condition since A-5 (v15). Each row below is one call site
 * of `runSingleWrite`: the fixture parks a DIRECTORY on the target path (EISDIR,
 * the shape a nested support dir makes reachable) and asserts a structured
 * refusal that names the cause, never a thrown errno.
 */
import { expect, it } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const SKILL = [
  '---',
  'name: readable-target',
  'description: Run and debug Python test suites with pytest.',
  '---',
  '',
  '# Body',
  '',
  'Body text.',
  '',
].join(String.fromCharCode(10))

/** Park a DIRECTORY on `path` so the next readText throws EISDIR. */
async function parkDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
  await mkdir(path, { recursive: true })
}

async function fixture(): Promise<{ lib: SkillLibrary; root: string }> {
  const root = await tempRoot('dsh-evo-unreadable-target-')
  const lib = new SkillLibrary(root)
  await lib.create('readable-target', SKILL, 'foreground')
  return { lib, root }
}

interface Row {
  label: string
  /** The call under test, against a target turned into a directory. */
  invoke: (lib: SkillLibrary, root: string) => Promise<{ ok: boolean; message: string }>
  /** What the refusal must name. */
  expect: RegExp
  park: (root: string) => Promise<void>
}

const ROWS: Row[] = [
  {
    label: 'update',
    park: root => parkDirectory(join(root, 'readable-target', 'SKILL.md')),
    invoke: lib => lib.update('readable-target', SKILL.replace('Body text.', 'Body v2.'), 'foreground'),
    expect: /Could not read "readable-target".*DIRECTORY/,
  },
  {
    label: 'patch',
    park: root => parkDirectory(join(root, 'readable-target', 'SKILL.md')),
    invoke: lib => lib.patch('readable-target', 'Body text.', 'Body v2.', ''),
    expect: /Could not read "readable-target\/SKILL\.md".*DIRECTORY/,
  },
  {
    label: 'write_file',
    park: root => parkDirectory(join(root, 'readable-target', 'references', 'notes.md')),
    invoke: lib => lib.writeSupportFile('readable-target', 'references/notes.md', 'notes', 'foreground'),
    expect: /Could not read "readable-target\/references\/notes\.md".*DIRECTORY/,
  },
  {
    label: 'remove_file (the A-5 control)',
    park: root => parkDirectory(join(root, 'readable-target', 'references', 'notes.md')),
    invoke: lib => lib.removeSupportFile('readable-target', 'references/notes.md', 'foreground'),
    expect: /not a readable regular file/,
  },
]

it('S2-14: every staged write path refuses an unreadable target with a named cause, never a raw errno', async () => {
  for (const row of ROWS) {
    const { lib, root } = await fixture()
    try {
      await row.park(root)
      const result = await row.invoke(lib, root)
      expect(result.ok, row.label).toBe(false)
      expect(result.message, row.label).toMatch(row.expect)
      // The old behavior leaked the bare errno to the model; the refusal must
      // carry the classification instead of (or in addition to) the code.
      expect(result.message, row.label).not.toMatch(/^EISDIR/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})
