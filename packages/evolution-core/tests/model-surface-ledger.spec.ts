// @tier fast
/** E4：家族前缀 section 的字节账（UTF-16 长度 ＋ UTF-8 SHA-256 双轨冻结）。
 * 红＝文本变了而摘要没跟着更新 —— 前缀在每一轮请求里，变动必须被看见。
 * 口径：UTF-8 sha256 取 Buffer.from(text, 'utf8')；UTF-16 长度取 String.length（与平台目录口径同源）。
 */
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { DSH_AUTHORING_STANDARDS, SKILLS_GUIDANCE } from '../src/prompts.ts'

export const measureSection = (text: string) => ({
  utf16: text.length,
  utf8Bytes: Buffer.byteLength(text, 'utf8'),
  sha256: createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
})

it('E4：两段家族前缀的双轨摘要逐值冻结（改一个字符必须同时改这里）', () => {
  // 冻结值＝2026-10-14 实测（mirror HEAD 0fa95c8）。改动任一前缀文本后，这两个三元组必须同时更新；
  // 只更新一个＝红（这正是 E4 要防的「前缀悄悄变宽而没人看见」）。
  const frozen = {
    SKILLS_GUIDANCE: { utf16: 407, utf8Bytes: 413, sha256: '6fd62626901053bf84c3a7bf964a400a76d47c01a2471ad734b35a259b439571' },
    DSH_AUTHORING_STANDARDS: { utf16: 2991, utf8Bytes: 3011, sha256: '8665c0f40df8803e2789fcf99984a0af623310e5d88bb9bc2be161ecc401279d' },
  }
  const ledger = { SKILLS_GUIDANCE: measureSection(SKILLS_GUIDANCE), DSH_AUTHORING_STANDARDS: measureSection(DSH_AUTHORING_STANDARDS) }
  expect(ledger).toEqual(frozen)
  // 双轨的一致性：UTF-8 字节数不得小于 UTF-16 长度（CJK 只会让它更大）。
  expect(ledger.SKILLS_GUIDANCE.utf8Bytes).toBeGreaterThanOrEqual(ledger.SKILLS_GUIDANCE.utf16)
  expect(ledger.DSH_AUTHORING_STANDARDS.utf8Bytes).toBeGreaterThanOrEqual(ledger.DSH_AUTHORING_STANDARDS.utf16)
})
