# CLAUDE.md — Mufakat

Raft consensus simulator with deterministic discrete-event simulation, continuous safety-invariant checking, and an ablation mode that disables individual Raft rules so the guarantee they protect visibly fails. Static site, GitHub Pages, no backend.

Read `PRD.md` before starting any task. It fixes scope; this file describes how to work in the repo.

**Three things shape everything:**

1. **This teaches, so wrongness is expensive.** A subtly incorrect Raft teaches incorrect Raft, confidently, with good animations. Correctness gates public launch, not the other way round.
2. **Implement Figure 2 literally.** The Raft paper's Figure 2 is a complete, condensed specification — RPC arguments, receiver rules, server rules. Implement it rule by rule with the rule cited in the comment. **Do not paraphrase the spec from memory.** Raft is easy to get almost right, and almost right is wrong.
3. **Determinism is load-bearing.** Virtual clock, seeded PRNG, pure state machines. Time travel, sharing, fuzzing, and reproducible bug reports all rest on it.

---

## Stack

- Next.js 14, App Router, `output: 'export'` — static only
- TypeScript, `strict: true`
- Tailwind CSS
- Vitest
- pnpm
- No distributed-systems library, no simulation framework, no state library. The scheduler and the state machine are the project.

## Commands

```bash
pnpm dev
pnpm build                  # static export to ./out
pnpm preview                # serve ./out under the production basePath
pnpm test                   # vitest watch
pnpm test:run               # vitest once — before every commit
pnpm test:fuzz              # randomized scenarios vs the five safety properties (slow)
pnpm test:ablation          # each toggle must break its named property
pnpm test:figure8           # exact reproduction of the paper's Figure 8
pnpm test:figure13          # InstallSnapshot and log compaction, §7
pnpm test:section6          # joint consensus and membership changes, §6
pnpm test:determinism       # byte-identical trace replay
pnpm typecheck
pnpm lint
```

`pnpm test:fuzz` runs in CI and gates the deploy. Do not weaken it.

## Layout

```
app/
  [locale]/                 # id (default), en
    simulasi/               # cluster + ledger + timeline
    skenario/               # scenario library
    ablasi/                 # ablation panel and explanations
components/
  cluster/                  # node ring, message slips, partitions
  ledger/                   # log columns aligned on index — signature view
  invariants/               # five-property panel
  timeline/                 # scrubber, stepping controls
  ablation/                 # rule toggles
lib/
  sim/                      # scheduler. Pure.
    clock.ts                # virtual clock, priority queue
    network.ts              # latency, drop, duplicate, reorder, partitions
    prng.ts                 # seeded PRNG
    trace.ts                # EventTrace storage, typed arrays, lazy hydration
  raft/                     # THE ALGORITHM. Pure. Figure 2, literally.
    node.ts                 # step(state, input, config) → { state, outbox, timers }
    election.ts             # RequestVote, terms, timeouts
    replication.ts          # AppendEntries, consistency check, nextIndex
    commit.ts               # commitIndex advancement, current-term rule
    rules.ts                # named ablation guards — one place each
    types.ts
  invariants/               # INDEPENDENT checker. Shares no code with lib/raft.
data/
  scenarios/                # curated (config, seed, actions, flags) + phenomenon
workers/
  sim.worker.ts
tests/
  figure2/                  # per-rule conformance fixtures
  figure13/                 # InstallSnapshot and compaction, §7
  section6/                 # joint consensus, membership changes
  figure8/
  fuzz/
  ablation/
  determinism/
```

## Invariants

1. **`lib/raft` is pure.** `step(state, input, config) → { state, outbox, timers }`. No clock reads, no `Date`, no `Math.random`, no I/O, no DOM, no React, no module-level mutable state. Randomness comes only from the seeded PRNG threaded through state.

2. **No wall-clock time anywhere in simulation.** The virtual clock in `lib/sim/clock.ts` is the only notion of time. No `setTimeout` driving logic, no `performance.now()`, no real delays. Animation timing in the UI is separate and never feeds back into the simulation.

3. **Never iterate an unordered collection in `lib/sim` or `lib/raft`.** No `Set` iteration, no `Object.keys`, no `Map` order dependence. Event queue ordering must be a total order with an explicit tiebreak — equal timestamps resolve by a deterministic sequence number, never by insertion luck.

4. **The invariant checker is independent of the implementation.** `lib/invariants` evaluates the five properties from their definitions over global state and imports nothing from `lib/raft` except types. A checker sharing the implementation's assumptions validates its own bugs. This isolation is not negotiable.

5. **Ablation rules are named guards in exactly one place each.** `rules.ts` holds them; each is consulted at a single call site. Never scatter `if (config.electionRestriction)` through the algorithm, and never implement a toggle as a UI-only label.

6. **Every ablation toggle has a test proving it breaks its property.** A toggle that never produces a violation is a bug in the toggle, not a well-behaved option.

7. **Modified Raft is marked as modified, everywhere.** Any run with an ablation flag off is visibly and permanently labelled, in the UI and in shared links. Nobody should screenshot a broken run and take it for real Raft.

8. **Implement Figure 2 literally, and cite it.** Every rule gets a comment naming its figure and rule — `// Figure 2, AppendEntries RPC, receiver rule 2`. This is the highest-value comment style in the repo.

9. **Message loss is the default, not an option.** Raft is designed for a lossy network; a simulator defaulting to a perfect one teaches the wrong intuition.

10. **The simulation is a pure function of `(config, seed, actions, flags)`.** Byte-identical trace on any machine. Never introduce a source of divergence for convenience.

11. **The trace is the only interface between simulation and rendering.** No component computes algorithm state, evaluates an invariant, or decides what happened.

12. **Simulation runs in a worker.** Fuzz runs and long simulations never touch the main thread.

13. **Node state is never colour alone.** Follower, candidate, and leader carry distinct shape or badge as well as colour.

14. **`vermilion` is reserved for safety violations only.** Nothing else in the app is ever red — not errors, not partitions, not crashed nodes. See PRD §10.

15. **A failing fuzz seed becomes a permanent regression test.** Never fix a fuzz failure without first committing the seed as a fixture.

## Working style

- **Read Figure 2 before writing any algorithm code.** Then implement it rule by rule. If a rule seems redundant, it is not — write the comment explaining what it defends and move on.
- **Determinism before algorithm.** M0 exists so the scheduler is proven reproducible before anything depends on it. Do not start M2 until `pnpm test:determinism` passes on the scheduler alone.
- **Invariant checker before ablation.** You cannot demonstrate a violation until you can detect one.
- **When a fuzz run fails, the algorithm is wrong.** Not the checker, not the fuzzer, not the seed. Investigate in that order and only in that order.
- **Never relax an invariant to make a fuzz run pass.** The five properties are the definition of Raft being correct. If one fails under unmodified Raft, something real is broken.
- **Ask before adding to the algorithm surface.** Membership changes and log compaction touched the state machine, the checker, the ledger view, the scenario schema, and every fixture at once — both are now in, and anything of comparable reach deserves the same question first.
- **Don't touch `next.config.js`, the Actions workflow, or the fuzz configuration without saying so explicitly.**
- **Don't add dependencies** for simulation, scheduling, randomness, or graph layout.

## Conventions

- Named exports; defaults only where Next requires them.
- Discriminated unions for messages, events, and node states, keyed on `type`. Exhaustive `switch` with a `never` default — this is how a new message type surfaces every handler that must deal with it.
- No `any`. No non-null `!` in `lib/sim` or `lib/raft`.
- Integers only. Terms, indices, node ids, and virtual timestamps are all integers. No floats anywhere in simulation, including in network latency — use integer ticks.
- Log indices are **1-based**, matching the paper. Do not silently switch to 0-based for array convenience; keep the paper's numbering and handle the offset in one documented place.
- Field names match the paper exactly: `currentTerm`, `votedFor`, `commitIndex`, `lastApplied`, `nextIndex`, `matchIndex`, `prevLogIndex`, `prevLogTerm`. A reader should be able to hold the paper beside the code.
- Algorithm terms stay in English in code and UI. Interface copy is Indonesian.
- Scenario ids stable and readable: `split-vote`, `partition-stranded-leader`, `figure-8`, `log-divergence-repair`. They appear in shared URLs.
- Tailwind utilities inline; semantic tokens in `tailwind.config.ts` — `stock`, `ink`, `follower`, `candidate`, `leader`, `committed`, `vermilion`. Never raw hex in components.

## Testing rules

- `pnpm test:run` before every commit; `pnpm test:fuzz` before any commit touching `lib/raft`, `lib/sim`, or `lib/invariants`.
- New algorithm behaviour → a Figure 2 conformance fixture citing the rule it implements.
- New ablation toggle → a test asserting the violation occurs when off and does not occur when on. Both directions.
- New scenario → determinism assertion plus a documented `phenomenon` field.
- Fuzz failure → commit the seed as a fixture before fixing anything.
- Bug fix → failing test first.
- Never update a fixture without reading the diff and confirming the change was intended.

## Deployment

Live at **https://andifathulms.github.io/mufakat/**, from `main` via Actions; the fuzz
suite gates it. `basePath` must match the repository name; `.nojekyll` must exist in
`out/`. Verify with `pnpm preview` before pushing.

`pnpm build` runs `scripts/generate-sw.mjs` after `next build`, generating the service
worker *from* the export — the precache manifest is the actual file list, and the cache
name is a hash of their contents, so a rebuild that changes nothing does not evict a
working cache. CI fails the build if any emitted file or route is missing from the
manifest, because "works offline" is a claim worth checking rather than asserting.

Do not pass `version:` to `pnpm/action-setup`: `packageManager` in package.json is the
pin, and setting both makes the action refuse to start.

## Framing

RaftScope and the Raft paper are linked prominently and warmly — RaftScope was written by the paper's author and is the canonical visualiser. This project's contribution is ablation and invariant checking, not replacement. State that plainly rather than competing.

## Current state

M0–M7 built. `pnpm test:run` is green: 179 tests — 49 Figure 2 conformance fixtures,
23 Figure 13 fixtures, 16 §6 fixtures, the panel-by-panel Figure 8 reproduction in both
directions, both directions of all seven ablation toggles, and the fuzz suite.

All five safety properties hold across **10,000 randomized runs** under unmodified
Raft, with log compaction and membership changes both active. Live and verified under
the production `basePath`.

Every scenario is now hand-built. `initialNodes` is what made the last two possible:
`log-matching-break` and `double-candidacy` both hinge on a starting position that is
legal but improbable, and both document the history Raft would have taken to reach it.
Neither position may violate anything at step 0, and the tests assert that.

**Accessibility.** Contrast was measured, not eyeballed. `ink-faint` was 2.63:1 —
below AA, and the most-used secondary text colour in the app — and is now 5.08:1.
Interactive borders moved to a separate `ink-edge` token at 3.60:1, leaving `ink-rule`
light for the ledger grid, which is decorative. The node-id digit follows its role
fill and is set at large-text size, because dark ink on the follower slate tops out at
3.41:1 and the palette is fixed by PRD §10. Skip link, per-locale `<html lang>`,
`sr-only` cell descriptions in the ledger, a polite live region for violations, and an
`aria-valuetext` on the scrubber that says what happened rather than a step number.

**Log compaction (§7, Figure 13) is in.** Half of M7. `NodeState.log` is now a bundle
of the held entries and the snapshot point beneath them, because the offset between the
paper's indices and the array is no longer the constant 1 — nothing outside `log.ts`
may index it. Compaction is **off by default** (`snapshotThreshold: 0`), so every
scenario and fixture written before §7 produces exactly the trace it produced then.

Chunking (`offset`, `data[]`, `done`) is deliberately not modelled: there are no bytes
here, and always sending `offset: 0, done: true` would be a fiction dressed as
conformance. That omission is stated on the type rather than hidden.

The fuzz suite draws a compaction threshold, and asserts §7 is genuinely exercised —
snapshots transferred, and both Figure 13 receiver rules taken — so a compaction bug
cannot hide behind a suite where servers never discard anything.

**Offline works.** A service worker generated from the export precaches all 62 files
and every route; the app loads and simulates with the network off, including pages not
visited before going offline. Verified against the deployed site, not only locally.

**Every success criterion in PRD §12 is met**, measured rather than assumed:

| Criterion | Measured |
|---|---|
| Five properties across 10,000 fuzz runs | green, with compaction on |
| Every toggle breaks its property, none when on | 6/6, both directions |
| Figure 8 reproduces exactly | panel by panel, terms 2/3/4/5 |
| Byte-identical trace for the same inputs | digest equality across the library |
| Liveness under an eventually-reliable network | 120 seeds |
| Every ablation rule cites its paper section | asserted in the suite |
| Violation within four interactions | two clicks from the home page |
| Fully offline after first load | 72 cached entries, verified offline |
| JS ≤ 250 KB gzipped | **149 KB** first load |

**Membership changes (§6) are in.** Cluster size is now a variable, so `majority(n)` is
gone from the algorithm: `hasQuorum(configuration, predicate)` is the only definition of
agreement, and a joint configuration requires majorities of *both* halves. That
conjunction is the whole of joint consensus.

Configurations live in the log and take effect **on append, not on commit** — which
looks reckless and is load-bearing, because waiting for commitment would be circular.
All three of §6's loose ends are implemented: a leader that removes itself keeps
managing the cluster until C-new commits then steps down; new servers need no special
catch-up path because the usual `nextIndex` backtracking or a snapshot handles them; and
removed servers cannot disrupt the cluster, because a server that has heard from a
leader disregards RequestVote outright — term adoption included.

That last rule is stated in the paper in wall-clock terms. There is no clock in
`lib/raft`, so it is expressed as `heardFromLeader`: set when a leader is heard, cleared
when the election timer fires. A server's election timer *is* its measure of how long
since it heard from a leader, so the window is bounded exactly as intended.

Not done, and deliberately so:

- **Snapshotting has no ablation toggle**, and should not get one by default. Figure
  13's rule 6 versus rule 7 is a liveness and efficiency distinction, not a safety one:
  discarding a suffix you could have kept costs a round trip, not a guarantee. A toggle
  that cannot break a named property would be exactly the cosmetic switch invariant 6
  forbids.
- **The exact Figure 8 lives in `tests/figure8`, driven by a director** that replaces
  only the network, and hits the paper's terms 2/3/4/5 precisely. The playable
  `figure-8` scenario reproduces the same shape in the full simulator but takes an
  extra election or two to get there, because the scheduler will not be told who wins.
- **`tests/fuzz/regressions.test.ts` has no entries yet**, because no fuzz failure has
  occurred. It exists so the next one has an obvious home.
