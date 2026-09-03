import { describe, expect, it } from 'vitest'
import { redactSecrets } from '@deepseek-ai/dsh-evolution-core'

describe('review redaction', () => {
  it('masks well-known secret shapes', () => {
    const text = [
      'key sk-1234567890abcdef1234567890abcdef leaked',
      'aws AKIA1234567890ABCDEF here',
      'github ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 here',
      'gitlab glpat-abcdefghijklmnopqrst here',
      'slack xoxb-123456789012-abcdefgh here',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U here',
      'auth Bearer abcdefghijklmnopqrstuvwxyz here',
      'token=abcdefghijklmnop here',
      'api_key: "ABCDEFGHIJKLMNOP" here',
    ].join('\n')
    const out = redactSecrets(text)
    expect(out).not.toContain('1234567890abcdef1234567890abcdef')
    expect(out).not.toContain('AKIA1234567890ABCDEF')
    expect(out).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456')
    expect(out).not.toContain('glpat-abcdefghijklmnopqrst')
    expect(out).not.toContain('xoxb-123456789012-abcdefgh')
    expect(out).not.toContain('dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')
    expect(out).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz')
    expect(out).toContain('token=<redacted>')
    expect(out).toContain('api_key: "<redacted>"')
    expect(out).toContain('<redacted>')
  })

  it('leaves ordinary conversation text intact', () => {
    const text = 'Use vitest for tests. The password reset flow took 3 tries. Token budgets were fine.'
    expect(redactSecrets(text)).toBe(text)
  })
})
