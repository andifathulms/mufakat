/**
 * Share links.
 *
 * `(config, seed, actions, flags)` encodes into the URL hash, and a shared link
 * reproduces the run exactly — including any violation, and including the fact that
 * a rule was switched off. This is how someone sends a colleague a live Figure 8.
 *
 * There is no server, so the hash is the whole state. It is kept short and readable
 * rather than opaque: someone who reads a shared link should be able to see that
 * `!er` means the election restriction was disabled.
 */

import { ABLATION_FLAG_NAMES, UNMODIFIED_RAFT, type AblationFlagName, type AblationFlags } from '@/lib/raft/rules'
import type { Action, Scenario } from '@/lib/sim/simulation'
import { scenario } from '@/lib/sim/simulation'
import { SCENARIOS, scenarioById } from '@/data/scenarios'

/** Short codes for the hash. Stable: they appear in links people have sent. */
const FLAG_CODES: Readonly<Record<AblationFlagName, string>> = {
  electionRestriction: 'er',
  currentTermCommitRule: 'ct',
  appendEntriesConsistencyCheck: 'ae',
  termIncrementOnCandidacy: 'ti',
  stepDownOnHigherTerm: 'sd',
  persistVotedFor: 'pv',
  jointConsensus: 'jc',
}

function flagFor(code: string): AblationFlagName | null {
  const found = ABLATION_FLAG_NAMES.find((name) => FLAG_CODES[name] === code)
  return found ?? null
}

const ACTION_CODES = {
  'client-request': 'c',
  crash: 'x',
  restart: 'r',
  partition: 'p',
  heal: 'h',
  'change-configuration': 'm',
} as const

export interface ShareState {
  readonly scenarioId: string
  readonly seed: number
  readonly flags: AblationFlags
  /** Actions added on top of the scenario's own, by direct manipulation. */
  readonly extraActions: readonly Action[]
  readonly step: number | null
}

function encodeAction(action: Action): string {
  switch (action.kind) {
    case 'client-request':
      return `${ACTION_CODES['client-request']}${action.at}.${action.node}.${encodeURIComponent(action.command)}`
    case 'crash':
      return `${ACTION_CODES.crash}${action.at}.${action.node}`
    case 'restart':
      return `${ACTION_CODES.restart}${action.at}.${action.node}`
    case 'partition':
      return `${ACTION_CODES.partition}${action.at}.${action.partitionOf.join('')}`
    case 'heal':
      return `${ACTION_CODES.heal}${action.at}`
    case 'change-configuration':
      return `${ACTION_CODES['change-configuration']}${action.at}.${action.node}.${action.servers.join('')}`
    default: {
      const unreachable: never = action
      throw new Error(`Unhandled action: ${JSON.stringify(unreachable)}`)
    }
  }
}

function decodeAction(token: string): Action | null {
  const kind = token[0]
  const rest = token.slice(1).split('.')
  const at = Number(rest[0])
  if (!Number.isInteger(at) || at < 0) return null
  switch (kind) {
    case ACTION_CODES['client-request']: {
      const node = Number(rest[1])
      const command = rest.slice(2).join('.')
      if (!Number.isInteger(node)) return null
      return { at, kind: 'client-request', node, command: decodeURIComponent(command) }
    }
    case ACTION_CODES.crash:
    case ACTION_CODES.restart: {
      const node = Number(rest[1])
      if (!Number.isInteger(node)) return null
      return { at, kind: kind === ACTION_CODES.crash ? 'crash' : 'restart', node }
    }
    case ACTION_CODES.partition: {
      const digits = rest[1] ?? ''
      if (!/^[0-9]+$/.test(digits)) return null
      return { at, kind: 'partition', partitionOf: [...digits].map(Number) }
    }
    case ACTION_CODES.heal:
      return { at, kind: 'heal' }
    case ACTION_CODES['change-configuration']: {
      const node = Number(rest[1])
      const digits = rest[2] ?? ''
      if (!Number.isInteger(node) || !/^[0-9]+$/.test(digits)) return null
      return { at, kind: 'change-configuration', node, servers: [...digits].map(Number) }
    }
    default:
      return null
  }
}

/** Encode to a URL hash, without the leading `#`. */
export function encodeShare(state: ShareState): string {
  const parts: string[] = [`s=${state.scenarioId}`, `seed=${state.seed}`]
  const disabled = ABLATION_FLAG_NAMES.filter((name) => !state.flags[name]).map(
    (name) => FLAG_CODES[name],
  )
  if (disabled.length > 0) parts.push(`off=${disabled.join('-')}`)
  if (state.extraActions.length > 0) {
    parts.push(`a=${state.extraActions.map(encodeAction).join('-')}`)
  }
  if (state.step !== null) parts.push(`i=${state.step}`)
  return parts.join('&')
}

/** Decode a URL hash. Unknown or malformed fields fall back to the default. */
export function decodeShare(hash: string): ShareState {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash
  const fields = new Map<string, string>()
  for (const pair of clean.split('&')) {
    const index = pair.indexOf('=')
    if (index <= 0) continue
    fields.set(pair.slice(0, index), pair.slice(index + 1))
  }

  const scenarioId = fields.get('s') ?? SCENARIOS[0]?.id ?? 'clean-election'
  const known = SCENARIOS.some((entry) => entry.id === scenarioId)
  const resolvedId = known ? scenarioId : (SCENARIOS[0]?.id ?? 'clean-election')

  const seedField = Number(fields.get('seed'))
  const seed = Number.isInteger(seedField) ? seedField : scenarioById(resolvedId).spec.seed

  const flags: Record<string, boolean> = { ...UNMODIFIED_RAFT }
  for (const code of (fields.get('off') ?? '').split('-')) {
    const name = flagFor(code)
    if (name !== null) flags[name] = false
  }

  const extraActions: Action[] = []
  const actionField = fields.get('a')
  if (actionField !== undefined && actionField.length > 0) {
    for (const token of actionField.split('-')) {
      const action = decodeAction(token)
      if (action !== null) extraActions.push(action)
    }
  }

  const stepField = Number(fields.get('i'))
  const step = Number.isInteger(stepField) && stepField >= 0 ? stepField : null

  return { scenarioId: resolvedId, seed, flags: flags as unknown as AblationFlags, extraActions, step }
}

/** Build the runnable scenario a share state describes. */
export function specFromShare(state: ShareState): Scenario {
  const definition = scenarioById(state.scenarioId)
  return scenario({
    ...definition.spec,
    seed: state.seed,
    flags: state.flags,
    actions: [...definition.spec.actions, ...state.extraActions],
  })
}

export function shareStateFor(scenarioId: string): ShareState {
  const definition = scenarioById(scenarioId)
  return {
    scenarioId,
    seed: definition.spec.seed,
    flags: definition.spec.flags,
    extraActions: [],
    step: null,
  }
}
