/**
 * Cluster configuration and quorum arithmetic. §6 — membership changes.
 *
 * Until now a majority was `floor(n / 2) + 1` over a fixed `nodeCount`, and that was
 * true everywhere in the algorithm. Membership changes make the cluster a *variable*,
 * so every place that counted servers has to ask the configuration instead — and the
 * configuration is not always a single set.
 *
 * **The whole difficulty of §6 is in one sentence of the paper**: a cluster cannot
 * switch directly from C-old to C-new, because there is no instant at which the switch
 * happens on every server at once, so for a while some servers believe C-old and
 * others believe C-new — and those two can contain *disjoint majorities*, which elect
 * two leaders in the same term. Figure 10 is that picture.
 *
 * Joint consensus is the fix. The cluster passes through a transitional configuration
 * C-old,new in which agreement requires **separate majorities of both**, so no decision
 * can be taken by C-old alone or C-new alone, and the overlap that Election Safety
 * depends on is restored.
 */

import type { NodeId } from './types'

export type Configuration =
  | { readonly type: 'simple'; readonly servers: readonly NodeId[] }
  /** C-old,new. Agreement needs a majority of `oldServers` *and* of `newServers`. */
  | {
      readonly type: 'joint'
      readonly oldServers: readonly NodeId[]
      readonly newServers: readonly NodeId[]
    }

/** Ascending, de-duplicated. Server sets are compared and hashed, so order is fixed. */
function normalise(servers: readonly NodeId[]): readonly NodeId[] {
  return [...new Set(servers)].sort((a, b) => a - b)
}

export function simpleConfiguration(servers: readonly NodeId[]): Configuration {
  return { type: 'simple', servers: normalise(servers) }
}

export function jointConfiguration(
  oldServers: readonly NodeId[],
  newServers: readonly NodeId[],
): Configuration {
  return { type: 'joint', oldServers: normalise(oldServers), newServers: normalise(newServers) }
}

/** The configuration a cluster of `nodeCount` slots starts in: everyone is a member. */
export function allServers(nodeCount: number): Configuration {
  return simpleConfiguration(Array.from({ length: nodeCount }, (_, id) => id))
}

/**
 * Every server the configuration concerns — the union in a joint configuration.
 *
 * These are the servers that vote, that count toward agreement, and that the leader
 * replicates to. In a joint configuration that deliberately includes servers on their
 * way *out*: until C-new is committed they are still full members, and treating them
 * as gone early is exactly the disjoint-majority mistake §6 exists to prevent.
 */
export function members(configuration: Configuration): readonly NodeId[] {
  if (configuration.type === 'simple') return configuration.servers
  return normalise([...configuration.oldServers, ...configuration.newServers])
}

export function isMember(configuration: Configuration, id: NodeId): boolean {
  return members(configuration).includes(id)
}

/** Servers this one replicates to: every member but itself, ascending. */
export function replicationTargets(configuration: Configuration, self: NodeId): readonly NodeId[] {
  return members(configuration).filter((id) => id !== self)
}

/** A strict majority of one server set. Integer arithmetic: 3 -> 2, 4 -> 3, 5 -> 3. */
function majorityOf(servers: readonly NodeId[]): number {
  return Math.floor(servers.length / 2) + 1
}

function countIn(servers: readonly NodeId[], predicate: (id: NodeId) => boolean): number {
  let total = 0
  for (const id of servers) if (predicate(id)) total += 1
  return total
}

/**
 * Does `predicate` hold on enough servers to constitute agreement?
 *
 * The single definition of agreement in the algorithm: elections ask it about votes,
 * commitment asks it about `matchIndex`. A joint configuration requires a majority of
 * **both** halves — that conjunction is the whole of joint consensus, and it is why
 * this returns one boolean rather than a count.
 */
export function hasQuorum(
  configuration: Configuration,
  predicate: (id: NodeId) => boolean,
): boolean {
  if (configuration.type === 'simple') {
    return countIn(configuration.servers, predicate) >= majorityOf(configuration.servers)
  }
  return (
    countIn(configuration.oldServers, predicate) >= majorityOf(configuration.oldServers) &&
    countIn(configuration.newServers, predicate) >= majorityOf(configuration.newServers)
  )
}

/** The configuration that results once a joint configuration is committed. */
export function targetOf(configuration: Configuration): Configuration {
  if (configuration.type === 'simple') return configuration
  return simpleConfiguration(configuration.newServers)
}

export function sameServers(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  const left = normalise(a)
  const right = normalise(b)
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function sameConfiguration(a: Configuration, b: Configuration): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'simple' && b.type === 'simple') return sameServers(a.servers, b.servers)
  if (a.type === 'joint' && b.type === 'joint') {
    return sameServers(a.oldServers, b.oldServers) && sameServers(a.newServers, b.newServers)
  }
  return false
}

/** Readable, and stable enough to appear in a log entry's command text. */
export function describeConfiguration(configuration: Configuration): string {
  if (configuration.type === 'simple') return `C{${configuration.servers.join(',')}}`
  return `C{${configuration.oldServers.join(',')}}+{${configuration.newServers.join(',')}}`
}
