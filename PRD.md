# PRD — Mufakat

**A Raft consensus simulator where you can break the algorithm on purpose. Deterministic discrete-event simulation, continuous safety-invariant checking, and an ablation mode that turns individual Raft rules off so you can watch the guarantee they protect actually fail.**

> *mufakat* (Indonesian) — consensus, agreement reached through deliberation. From *musyawarah mufakat*, the deliberative decision-making principle in the fourth *sila* of Pancasila.
> An unusually exact name: the project simulates a consensus algorithm, and *mufakat* is the Indonesian word for the thing being simulated. Slug used throughout as `mufakat`.

| | |
|---|---|
| **Status** | Draft — pre-implementation |
| **Owner** | Andi Fathul Mukminin Salahuddin |
| **Type** | Personal portfolio project, open source, educational |
| **Deployment** | GitHub Pages (static export, no server) |
| **Language** | Indonesian-first UI; English secondary. Algorithm terms stay in English. |
| **Normative source** | Ongaro & Ousterhout, *In Search of an Understandable Consensus Algorithm* (USENIX ATC 2014), extended version — Figure 2 in particular. Plus Ongaro's 2014 Stanford thesis, *Consensus: Bridging Theory and Practice*. |

---

## 1. Prior art — read this first

**RaftScope exists, it is good, and it was written by the author of the Raft paper.** It runs on raft.github.io, it is interactive, and it lets you pause, drop messages, stop servers, and step through time. There is also *The Secret Lives of Data*, a well-known scroll-driven Raft explainer.

Any pitch that claims this space is empty is wrong. **The project is only worth building if it does something RaftScope does not.**

## 2. What existing visualisations don't do

**They show the mechanism, not the reasoning.** You watch an election happen. You do not learn why the election restriction exists, or what would go wrong without it. The rules appear as given.

**They don't check invariants.** Raft's value is five stated safety properties. No visualiser continuously evaluates them across all nodes and tells you which one is currently holding and why.

**Nobody lets you turn a rule off.** This is the gap. Every non-obvious rule in Raft exists to defend a specific property, and the fastest route to understanding is to remove the rule and watch the property break. Figure 8 of the paper is precisely this argument, presented as a static diagram that most readers do not fully absorb. It should be a button.

## 3. Product thesis

**Ablation is the product.** Toggle off the election restriction and watch a committed entry get overwritten. Toggle off the current-term commit rule and reproduce Figure 8 live. Each toggle names the safety property it protects, and the scenario library ships a scenario that breaks it.

**Invariants are continuously evaluated and always on screen.** Five properties, five indicators. When one goes red, the app names the entry, the index, the term, and the nodes involved.

Supporting commitments, same as the sibling projects: deterministic simulation, a scrubbable event trace, and every explanation derived from the trace rather than written prose.

## 4. Non-goals

- **Not a Raft implementation for production.** A simulator. No networking, no persistence layer, no storage engine.
- **Not a general distributed-systems sandbox.** No Paxos, no Zab, no Viewstamped Replication, no CRDTs. One algorithm, understood deeply.
- **No membership changes or log compaction in v1.** Joint consensus and snapshotting are real Raft and are genuinely interesting, but they double the state space and the UI surface. Deferred, and documented as deferred.
- **No real network, no real time.** Virtual clock only. See §6.
- **No accounts, no server, no shared scenario hosting.** Scenarios share by URL hash.
- **No ML.** Every explanation is templated over the event trace.
- **Not a replacement for reading the paper.** The app should make someone want to read Figure 2, and should cite it everywhere.

## 5. Raft in brief

Nodes are Follower, Candidate, or Leader. Time is divided into numbered **terms**, each beginning with an election.

A follower that hears nothing from a leader before its randomized election timeout becomes a candidate, increments the term, votes for itself, and requests votes. A majority makes it leader. Split votes are resolved by the randomized timeouts, not by a tiebreak rule.

The leader accepts client entries, appends them to its log, and replicates via AppendEntries. Once a majority holds an entry it is **committed** and can be applied. AppendEntries carries a consistency check on the preceding index and term; on mismatch the follower rejects and the leader walks its `nextIndex` back until the logs agree, then overwrites the follower's divergent tail.

**The five safety properties** — the things the simulator continuously checks:

| Property | Statement |
|---|---|
| **Election Safety** | At most one leader per term |
| **Leader Append-Only** | A leader never overwrites or deletes entries in its own log |
| **Log Matching** | If two logs hold an entry with the same index and term, the logs are identical through that index |
| **Leader Completeness** | An entry committed in a term is present in the log of every leader of every later term |
| **State Machine Safety** | If a node applies an entry at an index, no node ever applies a different entry at that index |

Two rules do the non-obvious work, and both are ablation targets:

- **The election restriction** — a voter refuses a candidate whose log is less up-to-date than its own, comparing last term first, then last index. This is what makes Leader Completeness hold.
- **The current-term commit rule** — a leader may only mark an entry committed by counting replicas if that entry is from its own term. Older entries commit indirectly, once a current-term entry above them commits. Removing this reproduces the Figure 8 scenario, in which an entry replicated on a majority is later overwritten.

## 6. Simulation model — the technical core

**A virtual clock, never wall time.** The simulation is a priority queue of scheduled events: message deliveries, timer expirations, and user-injected actions. Advancing means popping the next event, not waiting. This buys everything at once — determinism, instant fast-forward, free time travel, and reproducibility from a seed.

**Each node is a pure state machine.** `step(nodeState, input, config) → { nodeState, outbox, timers }`. No clock reads, no I/O, no randomness except from a seeded PRNG threaded through the state.

**The network is a first-class, configurable component.** Per-link latency ranges, drop probability, duplication, reordering, and partitions the user can draw and heal. Message loss is normal, not exceptional — Raft is designed for it, and the simulator should default to a lossy network so that behaviour is what people see.

**The whole simulation is a pure function.** `(config, seed, userActions) → EventTrace`. Same inputs, byte-identical trace, on any machine. Everything downstream — the timeline, the log ledger, the invariant panel, sharing — is a rendering of that trace.

**Randomized election timeouts come from the seeded PRNG.** They are the mechanism that breaks split votes, so they must be real randomness in behaviour and fully reproducible in practice.

**The trace is materialised, so stepping backwards is free.** Typed arrays for hot fields, side tables for message payloads and log snapshots, lazy hydration for the step under inspection.

## 7. Features

### 7.1 The cluster view
Nodes arranged in a ring, coloured by state, each showing current term, `votedFor`, `commitIndex`, and role. Messages travel between them as slips carrying their type and term. Partitions render as a visible break in the ring.

### 7.2 The log ledger — signature view
Every node's log as a ruled column, entries as rows, **aligned across nodes on index**. Divergence appears as rows that fail to line up, and repair appears as the leader walking back and overwriting. The central abstraction of Raft becomes a thing you can literally see going wrong and getting fixed.

Entry cells show term, commit status, and applied status. Committed entries are visually settled; uncommitted ones are provisional.

### 7.3 The invariant panel — always visible
Five indicators, evaluated after every event across all nodes. On violation: name the property, the index, the terms, the nodes, and the event that caused it. Freeze the simulation and offer to step back to the moment it became inevitable.

In normal operation all five stay green, which is itself informative — it shows the algorithm working under adversarial conditions.

### 7.4 Ablation mode — the flagship
A panel of Raft rules, each toggleable, each labelled with the property it protects:

- Election restriction (up-to-date log check) → Leader Completeness
- Current-term commit rule → State Machine Safety, via Figure 8
- AppendEntries consistency check → Log Matching
- Term-increment-on-candidacy
- Step down on seeing a higher term
- Persistence of `votedFor` across a restart → Election Safety

Turning one off marks the run as **modified Raft**, permanently and visibly, so nobody screenshots a broken run and mistakes it for real Raft. Each toggle links to the paper section that justifies the rule, and to the scenario that breaks without it.

### 7.5 Scenario library
Curated, each demonstrating one named phenomenon: a clean election, a split vote resolved by timeout jitter, a partition with a stranded leader, log divergence and repair, a leader crash mid-replication, and **Figure 8 reproduced exactly**.

Scenarios are `(config, seed, scripted actions)` — so they replay identically, and the user can take control at any point and diverge.

**Scenario curation is real content work and is on the critical path.** Random fuzzing produces runs that are either boring or incomprehensible. Hand-build them.

### 7.6 Timeline and stepping
Scrub, step forward, step back, jump to next term change, next election, next commit, next violation. Speed control. Step-back is free because the trace is materialised.

### 7.7 Direct manipulation
Click a node to crash, restart, or isolate it. Drag to partition. Submit a client request to any node — including a follower, so the user discovers redirection. Drop or delay an in-flight message by clicking it.

### 7.8 Sharing
`(config, seed, actions, ablation flags)` encodes into the URL hash. A shared link reproduces the run exactly, including any violation. This is how someone sends a colleague a live Figure 8.

## 8. Architecture

Static Next.js 14 App Router export. No backend, no runtime fetches.

```
config + seed + actions + ablation flags
  → scheduler (virtual clock, event queue)
  → node.step (pure)  →  outbox, timers
  → network model     →  scheduled deliveries
  → EventTrace
        → cluster view | log ledger | invariant panel | timeline
```

**`lib/raft` is pure and isolated.** No React, no DOM, no clock, no network, no module-level mutable state. It is the only place that knows the algorithm.

**Ablation flags are parameters to the node state machine, not code branches scattered through it.** Each rule is a named guard consulted in exactly one place. This is what makes the toggles honest rather than cosmetic.

**The invariant checker is independent of the node implementation.** It reads the global state across nodes and evaluates the five properties from their definitions, sharing no code with the algorithm. A checker that reused the implementation's assumptions would validate its own bugs.

**Simulation runs in a worker.** Fuzzing and long runs must never block the UI.

**The trace is the only interface between simulation and rendering.** No component computes algorithm state.

## 9. Testing

Correctness matters more here than in the game projects, because this teaches. **A subtly wrong Raft teaches wrong Raft**, confidently and with nice animations.

**Invariant fuzzing — the backbone.** Thousands of randomized scenarios: random partitions, drops, reorderings, crashes and restarts at random moments, random client load. Assert all five safety properties hold at every event of every run, with unmodified Raft. This is effectively a small model checker, and it is the strongest correctness signal available.

**Ablation must actually break things.** For each toggle, a designated scenario must produce a violation of the named property when the rule is off, and no violation when it is on. This proves the toggles are real. A toggle that never breaks anything is a bug in the toggle.

**Figure 8 reproduction.** The exact scenario from the paper, asserted step by step against the published figure.

**Liveness.** Given a network that eventually stops dropping, a leader is eventually elected and submitted entries eventually commit. Asserted with a generous event bound.

**Determinism.** Same config, seed, and actions produce a byte-identical trace. Asserted across the scenario library and generated runs.

**Figure 2 conformance fixtures.** Each RPC's stated rules — the receiver implementation steps in the paper — get a fixture asserting exact behaviour, cited by figure and rule number.

## 10. Design direction

The material world is the **ledger book**: ruled columns, entries in numbered rows, corrections struck and rewritten, a clerk's hand. Raft's central object is literally a log, and the log ledger is the central view — so the metaphor is structural rather than decorative.

**Palette.** Ledger stock `#E9EDE4`, a pale blue-green account paper. Ink `#1E2321` for rules, text, and column ruling. Node states carry the three colours that must be instantly distinguishable: follower slate `#6B7770`, candidate amber `#B8862F`, leader deep blue `#2C5578`. Committed entries in ledger green `#3E6B4A`. **Vermilion `#B03A2E` is reserved exclusively for safety violations** — the strongest colour on the page means "the algorithm is broken", which in ablation mode is the entire point. Nothing else is ever red.

**Type.** The content is numeric — terms, indices, node ids — so **JetBrains Mono** for log entries, terms, and indices, with tabular figures, set in genuine ruled columns. **Source Serif 4** for prose and headings, in the register of a bound ledger. **IBM Plex Sans** for controls and labels.

**Structure.** Ruled columns with visible horizontal rules on the index grid, so alignment across nodes is unmissable — divergence should read as a broken line, the way a mismatched ledger does. Generous gutters between node columns.

**Motion.** One orchestrated moment: a message slip travelling between nodes, landing, and the receiving node's row updating. Election timeouts show as a thin depleting rule under each follower — the only ambient motion, and it encodes real information about what is about to happen. `prefers-reduced-motion` disables autoplay and keeps stepping instantaneous.

**Copy.** Indonesian first for interface and explanation; algorithm terms stay in English — *term*, *leader*, *commit index*, *AppendEntries* — because a reader should recognise them in the paper afterwards. Every rule in the ablation panel cites its paper section. Violations are stated flatly, with the mechanism named, never with alarm language.

## 11. Milestones

| | | |
|---|---|---|
| **M0** | Scaffold | Static export deploying, virtual-clock scheduler, event queue, seeded PRNG. Determinism proven before anything is built on it. |
| **M1** | Network model | Message transport, latency, drop, reorder, partitions. Console only. |
| **M2** | Elections | Node state machine, terms, RequestVote, randomized timeouts, split votes, heartbeats. Cluster view. First thing worth looking at. |
| **M3** | Replication | Log, AppendEntries, consistency check, `nextIndex` backtracking, commit rules. Log ledger view. |
| **M4** | Invariants | Independent checker, five-property panel, violation reporting, fuzz suite green. **Ship publicly here** — correct and checked before public. |
| **M5** | Ablation | Rule toggles, ablation tests proving each breaks its property, Figure 8 scenario. The flagship. |
| **M6** | Scenarios + polish | Curated library, direct manipulation, timeline scrubbing, sharing, a11y. |
| **M7** | Stretch | Membership changes, log compaction. Only if M0–M6 is genuinely finished. |

M4 is a longer path to first ship than the game projects. That is deliberate — shipping an unverified Raft would be worse than shipping nothing.

## 12. Success criteria

- All five safety properties hold across 10,000 randomized fuzz runs with unmodified Raft. No exceptions.
- Every ablation toggle produces a violation of its named property in its designated scenario, and none when enabled.
- Figure 8 reproduces exactly as published.
- Same config, seed, and actions produce a byte-identical trace across machines.
- Liveness holds under an eventually-reliable network across the scenario library.
- Every rule in the ablation panel cites its paper section.
- A user can go from opening the app to watching a real safety violation in under four interactions.
- Fully offline after first load. JS ≤ 250 KB gzipped.

## 13. Deployment

`output: 'export'`, `basePath` matching the repository name, `images.unoptimized`, `trailingSlash: true`, `.nojekyll` in the output root. Fuzz suite runs in CI and gates the deploy. Verify under the production `basePath` with `pnpm preview` before pushing.

## 14. Risks

| Risk | Mitigation |
|---|---|
| **RaftScope exists and is by the paper's author.** | The differentiator is ablation plus invariant checking, and it is real. Link to RaftScope and the paper prominently and warmly — that framing is honest and costs nothing. |
| **A subtly wrong Raft teaches wrong Raft.** | Fuzzing against the five properties, an invariant checker independent of the implementation, and Figure 2 conformance fixtures. Three independent signals, all landing at M4, before public launch. |
| **Ablation toggles that don't actually break anything.** | Every toggle has a test asserting the violation occurs. A cosmetic toggle is a bug. |
| **Raft's subtleties are easy to get almost right.** | Implement Figure 2 literally, rule by rule, with the rule number in the comment. Do not paraphrase the spec from memory. |
| **Fuzzing state space is unbounded.** | Bounded event counts, bounded cluster sizes, seeded and reproducible. A failing seed is a permanent regression test. |
| **Trace memory on long runs.** | Typed arrays, lazy hydration, event budget with head/tail retention. |
| **Scenario curation stalls the project.** | It is content work on the critical path. Build the Figure 8 scenario during M3 so the tests have a real target early. |
| **Scope creep into a general consensus sandbox.** | §4 is binding. Paxos is a different project and a worse one. |
