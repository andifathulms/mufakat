import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '@/data/scenarios'
import { UNMODIFIED_RAFT } from '@/lib/raft/rules'
import { decodeShare, encodeShare, shareStateFor, specFromShare } from '@/lib/share'
import { run } from '@/lib/sim/simulation'
import { traceDigest } from '@/lib/sim/trace'

/**
 * A shared link must reproduce the run exactly — including any violation, and
 * including the fact that a rule was switched off. There is no server, so the hash is
 * the whole state.
 */

describe('share links', () => {
  it('round-trips every scenario', () => {
    for (const entry of SCENARIOS) {
      const state = shareStateFor(entry.id)
      expect(decodeShare(encodeShare(state))).toEqual({ ...state, step: null })
    }
  })

  it('round-trips disabled rules', () => {
    const state = {
      ...shareStateFor('figure-8'),
      flags: { ...UNMODIFIED_RAFT, currentTermCommitRule: false, persistVotedFor: false },
    }
    const decoded = decodeShare(encodeShare(state))
    expect(decoded.flags.currentTermCommitRule).toBe(false)
    expect(decoded.flags.persistVotedFor).toBe(false)
    expect(decoded.flags.electionRestriction).toBe(true)
  })

  it('round-trips direct manipulation', () => {
    const state = {
      ...shareStateFor('clean-election'),
      extraActions: [
        { at: 1200, kind: 'client-request' as const, node: 2, command: 'set x=1' },
        { at: 1400, kind: 'crash' as const, node: 3 },
        { at: 1600, kind: 'restart' as const, node: 3 },
        { at: 1800, kind: 'partition' as const, partitionOf: [0, 0, 1, 1, 1] },
        { at: 2000, kind: 'heal' as const },
      ],
      step: 42,
    }
    expect(decodeShare(encodeShare(state))).toEqual(state)
  })

  it('reproduces the identical trace from a link', () => {
    const state = {
      ...shareStateFor('figure-8'),
      flags: { ...UNMODIFIED_RAFT, currentTermCommitRule: false },
    }
    const link = encodeShare(state)
    const fromLink = run(specFromShare(decodeShare(link)))
    const direct = run(specFromShare(state))
    expect(traceDigest(fromLink)).toEqual(traceDigest(direct))
    // And the violation the link was shared for is still there.
    expect(fromLink.violations.length).toBeGreaterThan(0)
  })

  it('survives a malformed hash rather than throwing', () => {
    for (const hash of ['', '#', 'garbage', '#s=does-not-exist&seed=abc&off=zz&a=!!&i=-4']) {
      const decoded = decodeShare(hash)
      expect(SCENARIOS.some((entry) => entry.id === decoded.scenarioId)).toBe(true)
      expect(Number.isInteger(decoded.seed)).toBe(true)
      expect(decoded.flags).toEqual(UNMODIFIED_RAFT)
      expect(() => run(specFromShare(decoded))).not.toThrow()
    }
  })

  it('keeps a link short enough to paste', () => {
    const state = {
      ...shareStateFor('figure-8'),
      flags: { ...UNMODIFIED_RAFT, currentTermCommitRule: false },
    }
    expect(encodeShare(state).length).toBeLessThan(120)
  })
})
