import { describe, expect, it } from 'vitest'
import { configurationOf, entryAt, heldEntries, lastLogIndex } from '@/lib/raft/log'
import { members } from '@/lib/raft/configuration'
import { SCENARIOS, ablated, scenarioForFlag } from '@/data/scenarios'
import { LOCALES } from '@/lib/i18n'
import {
  ABLATION_FLAG_NAMES,
  RULE_DESCRIPTORS,
  UNMODIFIED_RAFT,
  descriptorFor,
  disabledRules,
  isModifiedRaft,
} from '@/lib/raft/rules'
import { logOfNode } from '../helpers/nodes'
import { run } from '@/lib/sim/simulation'
import { traceDigest } from '@/lib/sim/trace'

/**
 * Every toggle must actually break something.
 *
 * A toggle that never produces a violation is a bug in the toggle, not a
 * well-behaved option — it means the rule is still being enforced somewhere else, or
 * that the toggle is a UI label with nothing behind it. Both directions are asserted:
 * the named property fails when the rule is off, and does not fail when it is on.
 */

describe('every ablation toggle breaks its named property', () => {
  for (const flag of ABLATION_FLAG_NAMES) {
    const descriptor = descriptorFor(flag)
    const definition = scenarioForFlag(flag)

    it(`${flag}: ${definition.id} violates ${descriptor.protects} with the rule off`, () => {
      const trace = run(ablated(definition, flag))
      const named = trace.violations.filter((v) => v.property === descriptor.protects)
      expect(named.length).toBeGreaterThan(0)
      // The report must name the servers involved, or it is not a report.
      expect(named[0]?.nodes.length).toBeGreaterThan(0)
      expect(named[0]?.summary.length).toBeGreaterThan(10)
    })

    it(`${flag}: ${definition.id} violates nothing at all with the rule on`, () => {
      const trace = run({ ...definition.spec, flags: UNMODIFIED_RAFT })
      expect(trace.violations).toEqual([])
    })
  }
})

describe('rule descriptors', () => {
  it('covers every flag exactly once', () => {
    expect(RULE_DESCRIPTORS.map((rule) => rule.flag).sort()).toEqual([...ABLATION_FLAG_NAMES].sort())
  })

  it('cites a paper section and a Figure 2 location for every rule', () => {
    for (const rule of RULE_DESCRIPTORS) {
      // §6 is not in Figure 2 at all — membership changes are their own section, and
      // the descriptor says so rather than pretending otherwise.
      expect(rule.paperSection).toMatch(/^§[56]/)
      expect(rule.figure2.length).toBeGreaterThan(5)
      expect(rule.callSite).toMatch(/^lib\/raft\//)
    }
  })

  it('names a scenario that exists for every rule', () => {
    for (const rule of RULE_DESCRIPTORS) {
      const definition = SCENARIOS.find((entry) => entry.id === rule.scenarioId)
      expect(definition, `no scenario ${rule.scenarioId}`).toBeDefined()
      expect(definition?.ablation?.flag).toBe(rule.flag)
      expect(definition?.ablation?.breaks).toBe(rule.protects)
    }
  })

  it('records the single call site of each guard, and it is a real one', () => {
    // The guards are consulted in exactly one place each. If a second call site ever
    // appears, the toggle stops being honest — see lib/raft/rules.ts.
    const sites = RULE_DESCRIPTORS.map((rule) => rule.callSite)
    expect(new Set(sites).size).toBe(sites.length)
  })
})

describe('modified Raft is marked as modified', () => {
  it('reports unmodified Raft as unmodified', () => {
    expect(isModifiedRaft(UNMODIFIED_RAFT)).toBe(false)
    expect(disabledRules(UNMODIFIED_RAFT)).toEqual([])
  })

  it('reports any disabled rule, in a stable order', () => {
    const flags = { ...UNMODIFIED_RAFT, persistVotedFor: false, electionRestriction: false }
    expect(isModifiedRaft(flags)).toBe(true)
    expect(disabledRules(flags)).toEqual(['electionRestriction', 'persistVotedFor'])
  })
})

describe('the scenario library', () => {
  it('gives every scenario a stable id, a title and a documented phenomenon', () => {
    const ids = SCENARIOS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of SCENARIOS) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/)
      // Every reader-facing string exists in both interface languages. `title` and
      // `summary` were once bare Indonesian strings, so the English scenario library
      // rendered Indonesian titles above English phenomena. Asserting both halves of
      // every localised field is what keeps a half-translated scenario from shipping.
      for (const locale of LOCALES) {
        expect(entry.title[locale].length, `${entry.id} title ${locale}`).toBeGreaterThan(3)
        expect(entry.summary[locale].length, `${entry.id} summary ${locale}`).toBeGreaterThan(20)
        // The phenomenon is the one thing the scenario exists to show. It is not
        // decoration: a scenario without one has not been curated.
        expect(
          entry.phenomenon[locale].length,
          `${entry.id} phenomenon ${locale}`,
        ).toBeGreaterThan(60)
      }
      // The two languages must actually differ, or a field has been left untranslated
      // by pasting one language into both halves. `Figure 8` and `Split vote` are
      // genuinely the same in both, being algorithm terms, so titles are exempt.
      expect(entry.summary.id, `${entry.id} summary untranslated`).not.toBe(entry.summary.en)
      expect(
        entry.phenomenon.id,
        `${entry.id} phenomenon untranslated`,
      ).not.toBe(entry.phenomenon.en)
    }
  })

  it('replays every scenario identically', () => {
    for (const entry of SCENARIOS) {
      expect(traceDigest(run(entry.spec)), entry.id).toEqual(traceDigest(run(entry.spec)))
    }
  })

  it('holds all five properties in every scenario under unmodified Raft', () => {
    for (const entry of SCENARIOS) {
      const trace = run({ ...entry.spec, flags: UNMODIFIED_RAFT })
      expect(trace.violations, entry.id).toEqual([])
    }
  })

  it('elects a leader in every scenario, so none is vacuous', () => {
    for (const entry of SCENARIOS) {
      const trace = run(entry.spec)
      const elected = trace.steps.some((step) => step.nodes.some((node) => node.role === 'leader'))
      expect(elected, entry.id).toBe(true)
    }
  })
})

describe('scenario phenomena actually occur', () => {
  it('clean-election: entries commit on every server', () => {
    const trace = run(scenarioById('clean-election'))
    const last = trace.steps[trace.steps.length - 1]
    expect(last?.nodes.every((node) => node.commitIndex >= 3)).toBe(true)
  })

  it('split-vote: at least one election ends with no leader and a term bump', () => {
    const trace = run(scenarioById('split-vote'))
    const contested = trace.steps.some(
      (step) =>
        step.nodes.filter((node) => node.role === 'candidate').length >= 2 &&
        step.nodes.every((node) => node.role !== 'leader'),
    )
    expect(contested).toBe(true)
    // And it resolves: jitter, not a tiebreak rule, is what ends it.
    const last = trace.steps[trace.steps.length - 1]
    expect(last?.nodes.some((node) => node.role === 'leader')).toBe(true)
  })

  it('partition-stranded-leader: the stranded leader accepts entries it can never commit', () => {
    const trace = run(scenarioById('partition-stranded-leader'))
    const stranded = trace.steps.some(
      (step) =>
        step.time > 2000 &&
        step.time < 5000 &&
        step.nodes.filter((node) => node.role === 'leader').length === 2,
    )
    // Two servers believe they lead — in *different* terms, which is not a violation.
    expect(stranded).toBe(true)
    const last = trace.steps[trace.steps.length - 1]
    expect(last?.nodes.filter((node) => node.role === 'leader').length).toBe(1)
  })

  it('log-divergence-repair: logs diverge at an index and are then repaired', () => {
    const trace = run(scenarioById('log-divergence-repair'))
    const diverged = trace.steps.some((step) => {
      const first = heldEntries(logOfNode(step.nodes[0]))
      const third = heldEntries(logOfNode(step.nodes[2]))
      if (first === undefined || third === undefined) return false
      return first.some((entry, i) => {
        const other = third[i]
        return other !== undefined && other.command !== entry.command
      })
    })
    expect(diverged).toBe(true)

    // And afterwards every server agrees, entry for entry.
    const last = trace.steps[trace.steps.length - 1]
    const reference = heldEntries(logOfNode(last?.nodes[2])).map((entry) => `${entry.term}:${entry.command}`)
    for (const node of last?.nodes ?? []) {
      expect(heldEntries(node.log).map((entry) => `${entry.term}:${entry.command}`)).toEqual(reference)
    }
  })

  it('election-restriction-overwrite: the isolated node ends far ahead in term, far behind in log', () => {
    const trace = run(scenarioById('election-restriction-overwrite'))
    const beforeHeal = trace.steps.filter((step) => step.time < 4500).at(-1)
    const isolated = beforeHeal?.nodes[4]
    const connected = beforeHeal?.nodes[0]
    expect(isolated?.currentTerm ?? 0).toBeGreaterThan((connected?.currentTerm ?? 0) + 3)
    expect(lastLogIndex(logOfNode(isolated)) ?? 99).toBeLessThan(lastLogIndex(logOfNode(connected)) ?? 0)
    // The restriction is the only thing stopping it winning, so with it on nothing
    // committed is ever lost.
    expect(trace.violations).toEqual([])
  })

  it('figure-8: index 2 reaches a majority, is not committed, and is then overwritten', () => {
    const trace = run(scenarioById('figure-8'))

    // Panel (c): a majority holds index 2 with term 2 — and the leader of term 4 has
    // not committed it.
    const panelC = trace.steps.filter((step) => step.time < 3000).at(-1)
    const holders = panelC?.nodes.filter((node) => entryAt(node.log, 2)?.term === 2).length ?? 0
    expect(holders).toBeGreaterThanOrEqual(3)
    const leaderC = panelC?.nodes.find((node) => node.role === 'leader')
    expect(leaderC?.currentTerm).toBe(4)
    expect(leaderC?.commitIndex).toBeLessThan(2)

    // Panel (d): index 2 now holds the term-3 entry everywhere that is running.
    const last = trace.steps[trace.steps.length - 1]
    const live = last?.nodes.filter((node, id) => last.crashed[id] !== true) ?? []
    expect(live.length).toBeGreaterThan(2)
    for (const node of live) expect(entryAt(node.log, 2)?.term).toBe(3)

    // And under unmodified Raft, losing it costs nothing, because it was never
    // committed. That is the entire argument of the figure.
    expect(trace.violations).toEqual([])
  })

  it('membership-change: the transition passes through a joint configuration', () => {
    const spec = scenarioById('membership-change')
    const trace = run(spec)
    expect(trace.violations).toEqual([])

    // C-old,new was genuinely in force, and on more than just the leader.
    const jointStep = trace.steps.find((step) =>
      step.nodes.filter((node) => configurationOf(node.log).type === 'joint').length >= 2,
    )
    expect(jointStep).toBeDefined()

    // While partitioned, neither disjoint majority can elect — the cluster correctly
    // stalls rather than splitting. That stall is the demonstration.
    const partitioned = trace.steps.filter((step) => step.time > 1700 && step.time < 3000)
    for (const step of partitioned) {
      const leaders = step.nodes.filter((node) => node.role === 'leader')
      const terms = new Set(leaders.map((node) => node.currentTerm))
      expect(terms.size).toBe(leaders.length)
    }

    // And once healed the change completes: the cluster is {2,3,4}.
    const last = trace.steps[trace.steps.length - 1]
    const settled = last?.nodes[2]
    expect(members(configurationOf(settled?.log ?? last!.nodes[0]!.log))).toEqual([2, 3, 4])
  })

  it('log-compaction: the lagging follower is caught up by a snapshot, not by entries', () => {
    const trace = run(scenarioById('log-compaction'))
    expect(trace.violations).toEqual([])

    // Servers actually discarded entries.
    const last = trace.steps[trace.steps.length - 1]
    expect(last?.nodes.every((node) => node.log.lastIncludedIndex > 0)).toBe(true)

    // And the lagging follower was caught up by InstallSnapshot, which is the whole
    // point: at that moment AppendEntries could not have worked.
    const installs = trace.steps.filter(
      (step) => step.event.kind === 'deliver' && step.event.message.type === 'InstallSnapshot',
    )
    expect(installs.length).toBeGreaterThan(0)
    const toLagger = installs.filter(
      (step) => step.event.kind === 'deliver' && step.event.message.to === 4,
    )
    expect(toLagger.length).toBeGreaterThan(0)

    // Everyone converges, and no server ever discarded past what it had applied.
    for (const step of trace.steps) {
      for (const node of step.nodes) {
        expect(node.log.lastIncludedIndex).toBeLessThanOrEqual(node.lastApplied)
      }
    }
    const reference = last?.nodes[0]?.stateMachine.slice(0, last.nodes[0]?.lastApplied)
    for (const node of last?.nodes ?? []) {
      expect(node.stateMachine.slice(0, node.lastApplied)).toEqual(reference)
    }
  })

  it('log-matching-break: the divergent index is repaired, not papered over', () => {
    const spec = scenarioById('log-matching-break')
    // The opening position must itself be legal — a hand-built start that already
    // violates something would prove nothing about the rule under test.
    const start = run({ ...spec, maxTime: 1, maxSteps: 2 })
    expect(start.violations).toEqual([])

    const trace = run(spec)
    expect(trace.violations).toEqual([])
    const last = trace.steps[trace.steps.length - 1]
    // Node 4 began with a term-3 entry at index 3 and ends agreeing with everyone.
    expect(entryAt(logOfNode(trace.steps[0]?.nodes[4]), 3)?.term).toBe(3)
    const reference = heldEntries(logOfNode(last?.nodes[0])).map((entry) => `${entry.term}:${entry.command}`)
    for (const node of last?.nodes ?? []) {
      expect(heldEntries(node.log).map((entry) => `${entry.term}:${entry.command}`)).toEqual(reference)
    }

    // With the check off, node 4 keeps its divergent index 3 while agreeing at index 4.
    const broken = run({ ...spec, flags: { ...UNMODIFIED_RAFT, appendEntriesConsistencyCheck: false } })
    const brokenLast = broken.steps[broken.steps.length - 1]
    expect(entryAt(logOfNode(brokenLast?.nodes[4]), 3)?.term).toBe(3)
    expect(entryAt(logOfNode(brokenLast?.nodes[0]), 3)?.term).toBe(2)
    expect(entryAt(logOfNode(brokenLast?.nodes[4]), 4)?.term).toBe(entryAt(logOfNode(brokenLast?.nodes[0]), 4)?.term)
    expect(broken.violations.some((v) => v.property === 'log-matching')).toBe(true)
  })

  it('double-candidacy: the same campaign is a new ballot only if the term rises', () => {
    const spec = scenarioById('double-candidacy')
    const start = run({ ...spec, maxTime: 1, maxSteps: 2 })
    expect(start.violations).toEqual([])
    // Node 2 has not voted in term 1. That is the hinge of the whole scenario.
    expect(start.steps[0]?.nodes[2]?.votedFor).toBeNull()

    // With the rule on, node 1's campaign moves to a new term, so the two leaders sit
    // in different terms — which is not a violation.
    const trace = run(spec)
    expect(trace.violations).toEqual([])
    const contested = trace.steps.find(
      (step) => step.nodes.filter((node) => node.role === 'leader').length === 2,
    )
    expect(contested).toBeDefined()
    const terms = contested?.nodes.filter((n) => n.role === 'leader').map((n) => n.currentTerm) ?? []
    expect(new Set(terms).size).toBe(2)

    const broken = run({ ...spec, flags: { ...UNMODIFIED_RAFT, termIncrementOnCandidacy: false } })
    const violation = broken.violations.find((v) => v.property === 'election-safety')
    expect(violation?.summary).toMatch(/Two leaders in term 1/)
  })

  it('double-vote-restart: the restarted follower still refuses to vote twice', () => {
    const trace = run(scenarioById('double-vote-restart'))
    expect(trace.violations).toEqual([])
    const leadersPerTerm = new Map<number, Set<number>>()
    for (const step of trace.steps) {
      step.nodes.forEach((node, id) => {
        if (node.role !== 'leader' || step.crashed[id] === true) return
        const holders = leadersPerTerm.get(node.currentTerm) ?? new Set<number>()
        holders.add(id)
        leadersPerTerm.set(node.currentTerm, holders)
      })
    }
    for (const [, holders] of leadersPerTerm) expect(holders.size).toBe(1)
  })
})

function scenarioById(id: string) {
  const found = SCENARIOS.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`No scenario ${id}`)
  return found.spec
}
