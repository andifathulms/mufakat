'use client'

/**
 * The cluster view: nodes on a ring, messages travelling between them as slips.
 *
 * Node state is never colour alone. Follower, candidate and leader each carry a
 * distinct shape and a distinct badge as well as a distinct colour, so the view
 * survives both colour blindness and a greyscale screenshot.
 */

import type { Dictionary } from '@/lib/i18n'
import { describeConfiguration, isMember, type Configuration } from '@/lib/raft/configuration'
import { configurationOf } from '@/lib/raft/log'
import type { NodeState, Role } from '@/lib/raft/types'
import type { InFlight, TraceStep } from '@/lib/sim/trace'

const ROLE_FILL: Record<Role, string> = {
  follower: 'fill-follower',
  candidate: 'fill-candidate',
  leader: 'fill-leader',
}

const ROLE_BADGE: Record<Role, string> = {
  follower: 'F',
  candidate: 'C',
  leader: 'L',
}

interface Props {
  readonly step: TraceStep
  readonly dict: Dictionary
  readonly onNodeAction?: (node: number, action: 'crash' | 'restart' | 'isolate') => void
  readonly selected: number | null
  readonly onSelect: (node: number | null) => void
}

const SIZE = 420
const CENTRE = SIZE / 2
const RADIUS = 150

function position(index: number, count: number): { x: number; y: number } {
  // Node 0 at the top, then clockwise. Deterministic layout: the same cluster is
  // always drawn the same way, so screenshots between runs are comparable.
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return { x: CENTRE + Math.cos(angle) * RADIUS, y: CENTRE + Math.sin(angle) * RADIUS }
}

/** Follower is a circle, candidate a diamond, leader a square. Shape, not just hue. */
function NodeGlyph({ role, crashed }: { role: Role; crashed: boolean }) {
  const className = `${crashed ? 'fill-stock-deep' : ROLE_FILL[role]} stroke-ink`
  if (crashed) {
    return <circle r="22" className={className} strokeWidth="1.5" strokeDasharray="3 3" />
  }
  switch (role) {
    case 'leader':
      return <rect x="-21" y="-21" width="42" height="42" className={className} strokeWidth="1.5" />
    case 'candidate':
      return <rect x="-20" y="-20" width="40" height="40" transform="rotate(45)" className={className} strokeWidth="1.5" />
    case 'follower':
    default:
      return <circle r="22" className={className} strokeWidth="1.5" />
  }
}

function slipLabel(flight: InFlight): string {
  switch (flight.message.type) {
    case 'RequestVote':
      return 'RV'
    case 'RequestVoteResponse':
      return flight.message.voteGranted ? 'RV✓' : 'RV✗'
    case 'AppendEntries':
      return flight.message.entries.length === 0 ? 'HB' : `AE·${flight.message.entries.length}`
    case 'AppendEntriesResponse':
      return flight.message.success ? 'AE✓' : 'AE✗'
    case 'InstallSnapshot':
      return `IS@${flight.message.lastIncludedIndex}`
    case 'InstallSnapshotResponse':
      return 'IS✓'
    default: {
      const unreachable: never = flight.message
      throw new Error(`Unhandled message: ${JSON.stringify(unreachable)}`)
    }
  }
}

export function NodeRing({ step, dict, onNodeAction, selected, onSelect }: Props) {
  const count = step.nodes.length
  const partitions = new Set(step.network.partitionOf)
  const split = partitions.size > 1
  // §6 — a server's configuration is whatever its own log says, so the cluster shown
  // is the one the leader believes in, falling back to node 0's view when there is no
  // leader. Servers can genuinely disagree about membership mid-change, and the node
  // badges show that rather than hiding it behind one authoritative answer.
  const authority = step.nodes.find((node) => node.role === 'leader') ?? step.nodes[0]
  const configuration: Configuration =
    authority === undefined ? { type: 'simple', servers: [] } : configurationOf(authority.log)

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[420px] mx-auto"
        role="img"
        aria-label={`${dict.sim.cluster}: ${step.nodes
          .map((node) => `node ${node.id} ${node.role} term ${node.currentTerm}`)
          .join(', ')}`}
      >
        {/* The ring itself. A partition renders as a visible break rather than a
            colour change, because colour is reserved. */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          fill="none"
          className="stroke-ink-rule"
          strokeWidth="1"
          strokeDasharray={split ? '6 10' : undefined}
        />

        {/* Messages in flight, positioned along their link by how far they have got. */}
        {step.inFlight.slice(0, 24).map((flight) => {
          const from = position(flight.message.from, count)
          const to = position(flight.message.to, count)
          const span = Math.max(1, flight.arrivesAt - flight.sentAt)
          const progress = Math.min(1, Math.max(0, (step.time - flight.sentAt) / span))
          const x = from.x + (to.x - from.x) * progress
          const y = from.y + (to.y - from.y) * progress
          return (
            <g key={`${flight.seq}`} className="slip-in">
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-ink-rule"
                strokeWidth="0.5"
              />
              <rect
                x={x - 17}
                y={y - 8}
                width="34"
                height="16"
                rx="2"
                className="fill-stock-pale stroke-ink-soft"
                strokeWidth="0.75"
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                className="fill-ink text-[9px] font-mono tabular"
              >
                {slipLabel(flight)}
              </text>
            </g>
          )
        })}

        {step.nodes.map((node) => {
          const { x, y } = position(node.id, count)
          const crashed = step.crashed[node.id] === true
          const isSelected = selected === node.id
          return (
            <g
              key={node.id}
              transform={`translate(${x} ${y})`}
              onClick={() => onSelect(isSelected ? null : node.id)}
              className="cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={`Node ${node.id}, ${node.role}, term ${node.currentTerm}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(isSelected ? null : node.id)
              }}
            >
              {isSelected && (
                <circle r="30" fill="none" className="stroke-ink" strokeWidth="1" strokeDasharray="2 3" />
              )}
              {/* §6 — a server outside the configuration is not part of the cluster.
                  Drawn with a dashed outer ring rather than a colour, because colour
                  is spoken for and membership is not a state of the server. */}
              {!isMember(configurationOf(node.log), node.id) && (
                <circle
                  r="27"
                  fill="none"
                  className="stroke-ink-faint"
                  strokeWidth="1"
                  strokeDasharray="1 4"
                />
              )}
              <NodeGlyph role={node.role} crashed={crashed} />
              {/* The digit sits on the role fill, so its colour has to follow the
                  fill's lightness: pale ink on the deep blue leader, dark ink on the
                  mid-toned follower and the amber candidate. Set at 19px bold, which
                  is large text by WCAG, so the 3:1 threshold applies — dark ink on
                  the follower reaches 3.41:1 and cannot do better, the follower slate
                  being fixed by the palette. The id is also in the group's
                  aria-label, so nothing depends on reading the digit. */}
              <text
                y="6"
                textAnchor="middle"
                className={[
                  'text-[19px] font-mono font-bold tabular pointer-events-none',
                  crashed ? 'fill-ink' : node.role === 'leader' ? 'fill-stock-pale' : 'fill-ink',
                ].join(' ')}
              >
                {node.id}
              </text>
              {/* Badge: the role in one letter, so the shape is doubly redundant. */}
              <circle cx="18" cy="-18" r="8" className="fill-stock-pale stroke-ink" strokeWidth="1" />
              <text
                x="18"
                y="-15"
                textAnchor="middle"
                className="fill-ink text-[9px] font-mono font-bold pointer-events-none"
              >
                {crashed ? '×' : ROLE_BADGE[node.role]}
              </text>
              <text
                y="40"
                textAnchor="middle"
                className="fill-ink-soft text-[10px] font-mono tabular pointer-events-none"
              >
                t{node.currentTerm} c{node.commitIndex}
              </text>
              {/* Partition group, only when there is more than one. */}
              {split && (
                <text
                  y="52"
                  textAnchor="middle"
                  className="fill-ink-faint text-[9px] font-mono pointer-events-none"
                >
                  grup {step.network.partitionOf[node.id]}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <p className="text-center font-mono text-[11px] tabular text-ink-soft">
        {dict.sim.configuration}: {describeConfiguration(configuration)}
      </p>

      <NodeDetail
        step={step}
        node={selected === null ? null : (step.nodes[selected] ?? null)}
        dict={dict}
        onNodeAction={onNodeAction}
      />
    </div>
  )
}

function NodeDetail({
  step,
  node,
  dict,
  onNodeAction,
}: {
  step: TraceStep
  node: NodeState | null
  dict: Dictionary
  onNodeAction?: (node: number, action: 'crash' | 'restart' | 'isolate') => void
}) {
  if (node === null) {
    return (
      <p className="text-xs text-ink-faint font-sans text-center">
        {dict.sim.submitHint}
      </p>
    )
  }
  const crashed = step.crashed[node.id] === true
  return (
    <div className="border border-ink-rule bg-stock-pale p-3 text-xs font-mono tabular">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-sans font-semibold text-sm">
          node {node.id} — {crashed ? dict.roles.crashed : dict.roles[node.role]}
        </span>
        {onNodeAction !== undefined && (
          <span className="flex gap-1">
            <button
              type="button"
              className="border border-ink-edge px-2 py-0.5 font-sans hover:bg-stock-deep"
              onClick={() => onNodeAction(node.id, crashed ? 'restart' : 'crash')}
            >
              {crashed ? dict.sim.restart : dict.sim.crash}
            </button>
            <button
              type="button"
              className="border border-ink-edge px-2 py-0.5 font-sans hover:bg-stock-deep"
              onClick={() => onNodeAction(node.id, 'isolate')}
            >
              {dict.sim.isolate}
            </button>
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Field label="currentTerm" value={node.currentTerm} />
        <Field label="votedFor" value={node.votedFor ?? '—'} />
        <Field label="commitIndex" value={node.commitIndex} />
        <Field label="lastApplied" value={node.lastApplied} />
        <Field label="configuration" value={describeConfiguration(configurationOf(node.log))} />
        {node.role === 'leader' && (
          <>
            <Field label="nextIndex" value={node.nextIndex.join(' ')} />
            <Field label="matchIndex" value={node.matchIndex.join(' ')} />
          </>
        )}
      </dl>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
