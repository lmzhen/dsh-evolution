import { describe, expect, it } from 'vitest'
import { claimInstance, instanceClaimKey, instanceHolder, releaseInstance } from '@deepseek-ai/dsh-evolution-core'

describe('per-home instance claims (B3 / G4)', () => {
  it('grants the first claimant, refuses the second, and names the holder', () => {
    const home = '/home/one'
    const first = claimInstance(home, 'evolution-test', 'instance-a')
    expect(first).toEqual({ granted: true, key: instanceClaimKey(home, 'evolution-test'), holder: 'instance-a' })
    const second = claimInstance(home, 'evolution-test', 'instance-b')
    expect(second.granted).toBe(false)
    expect(second.holder).toBe('instance-a')
    // The loser never displaces the holder.
    expect(instanceHolder(home, 'evolution-test')).toBe('instance-a')
  })

  it('is re-entrant for the SAME owner (a remount is not a second instance)', () => {
    const home = '/home/remount'
    expect(claimInstance(home, 'k', 'same').granted).toBe(true)
    expect(claimInstance(home, 'k', 'same').granted).toBe(true)
    expect(instanceHolder(home, 'k')).toBe('same')
  })

  it('keys on the HOME: two homes do not contend', () => {
    expect(claimInstance('/home/a', 'k', 'a').granted).toBe(true)
    expect(claimInstance('/home/b', 'k', 'b').granted).toBe(true)
    expect(instanceHolder('/home/a', 'k')).toBe('a')
    expect(instanceHolder('/home/b', 'k')).toBe('b')
  })

  it('releases only the owner own claim and frees the key after it', () => {
    const home = '/home/release'
    claimInstance(home, 'k', 'owner')
    releaseInstance(home, 'k', 'intruder')
    expect(instanceHolder(home, 'k')).toBe('owner')
    releaseInstance(home, 'k', 'owner')
    expect(instanceHolder(home, 'k')).toBeUndefined()
    expect(claimInstance(home, 'k', 'next').granted).toBe(true)
  })

  it('separates keys on one home (a second SERVICE is not a second instance)', () => {
    const home = '/home/keys'
    expect(claimInstance(home, 'service-a', 'a').granted).toBe(true)
    expect(claimInstance(home, 'service-b', 'b').granted).toBe(true)
  })
})
